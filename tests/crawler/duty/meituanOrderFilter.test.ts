import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterMeituanOrder,
  getActiveMeituanFilterConfig,
  setActiveMeituanFilterConfig,
  resetMeituanFilterConfig,
  saveMeituanFilterConfig,
  loadMeituanFilterConfig,
} from '@/src/crawler/duty/channels/meituan/meituanOrderFilter';
import {
  extractMeituanOrdersFromPayload,
  parseMeituanOrderListResponse,
  type MeituanOrderExtractionAnomaly,
} from '@/src/crawler/duty/channels/meituan/meituanOrderParsers';
import type { OrderFilterResult } from '@/src/crawler/duty/channels/meituan/meituanOrderFilter';
import type { RawMeituanDutyOrder } from '@/src/crawler/duty/dutyContracts';

function rejectedEvidence(result: OrderFilterResult): Record<string, unknown> | undefined {
  if (result.allowed) {
    throw new Error(`Expected a rejected filter result, received allowed=true`);
  }
  return result.evidence;
}

function createTestDutyOrder(partial: Partial<RawMeituanDutyOrder> & { orderId: string }): RawMeituanDutyOrder {
  return {
    orderDisplayLabel: '新订',
    status: 'NEW_ORDER',
    roomName: '豪华大床房',
    checkInDate: '2026-10-10',
    checkOutDate: '2026-10-11',
    nights: 1,
    quantity: 1,
    totalAmount: 100,
    contacts: [],
    raw: {},
    ...partial,
  };
}

function createTempConfigPath(name: string): string {
  return resolve(tmpdir(), `meituanFilterRules-test-${process.pid}-${name}.json`);
}

describe('MeituanOrderFilter (美团订单分层过滤器)', () => {
  describe('filterMeituanOrder (基于表达式与文件持久化的业务过滤流水线)', () => {
    it('应基于文件持久化表达式识别改签单并转人工', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035036081700000002',
        status: 'RESCHEDULED',
      }));

      expect(result).toMatchObject({
        allowed: false,
        action: 'MANUAL_ATTENTION',
        orderType: 'RESCHEDULED',
        orderId: '5035036081700000002',
      });
      expect(result.reason).toContain('改签/改期');
    });

    it('应基于文件持久化表达式识别 TMC 订单并在散客工位跳过', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035036081700000003',
        reversePriceTmcOrderTag: 'TMC',
      }));

      expect(result).toMatchObject({
        allowed: false,
        action: 'CHANNEL_MISMATCH',
        orderType: 'TMC',
        orderId: '5035036081700000003',
      });
      expect(result.reason).toContain('企业商旅订单');
    });

    it('支持商户定制化：当工位配置允许商旅 (enabled: false) 时，商旅单应 ALLOW 放行', () => {
      const currentConfig = getActiveMeituanFilterConfig();
      try {
        // 模拟商旅散客一体工位：禁用 TMC 过滤拦截规则
        const tmcAllowedConfig = {
          ...currentConfig,
          rules: currentConfig.rules.map((r) =>
            r.id === 'meituan-tmc' ? { ...r, enabled: false } : r
          ),
        };
        setActiveMeituanFilterConfig(tmcAllowedConfig);

        const result = filterMeituanOrder(createTestDutyOrder({
          orderId: '5035036081700000003',
          reversePriceTmcOrderTag: 'TMC',
        }));

        expect(result.allowed).toBe(true);
        expect(result.action).toBe('ALLOW');
      } finally {
        resetMeituanFilterConfig();
      }
    });

    it('支持文件持久化规则加载与保存', () => {
      const tempConfig = {
        channelId: 'MEITUAN',
        rules: [
          {
            id: 'custom-vip-rule',
            condition: "totalAmount > 1000",
            action: 'MANUAL_ATTENTION' as const,
            reason: '高价值订单人工核验',
            enabled: true,
          },
        ],
      };

      const tempFilePath = createTempConfigPath('roundtrip');
      try {
        saveMeituanFilterConfig(tempConfig, tempFilePath);
        const loaded = loadMeituanFilterConfig(tempFilePath);
        expect(loaded.rules).toHaveLength(1);
        expect(loaded.rules[0].id).toBe('custom-vip-rule');

        const result = filterMeituanOrder(createTestDutyOrder({
          orderId: '5035036081700000099',
          totalAmount: 1500,
        }));
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('高价值订单人工核验');
      } finally {
        resetMeituanFilterConfig();
        if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
      }
    });

    it('持久化文件损坏时应 Fail-Fast 抛出异常而不是静默回退默认规则', () => {
      const tempFilePath = createTempConfigPath('broken');
      const activeBefore = getActiveMeituanFilterConfig();
      try {
        writeFileSync(tempFilePath, '{ broken json !!!', 'utf8');

        expect(() => loadMeituanFilterConfig(tempFilePath)).toThrow('美团过滤规则配置文件读取或解析失败');
        expect(() => loadMeituanFilterConfig(tempFilePath)).toThrow(tempFilePath);
        expect(getActiveMeituanFilterConfig()).toBe(activeBefore);
      } finally {
        if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
      }
    });

    it('持久化文件结构无效 (缺少 rules 数组) 时应 Fail-Fast 抛出异常', () => {
      const tempFilePath = createTempConfigPath('invalid');
      const activeBefore = getActiveMeituanFilterConfig();
      try {
        writeFileSync(tempFilePath, JSON.stringify({ channelId: 'MEITUAN', rules: 'not-an-array' }), 'utf8');

        expect(() => loadMeituanFilterConfig(tempFilePath)).toThrow('美团过滤规则配置文件结构无效');
        expect(() => loadMeituanFilterConfig(tempFilePath)).toThrow(tempFilePath);
        expect(getActiveMeituanFilterConfig()).toBe(activeBefore);
      } finally {
        if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
      }
    });

    it('持久化文件不存在时应回退随包默认规则 (首启场景)', () => {
      const nonexistentPath = createTempConfigPath('__nonexistent__');
      try {
        const loaded = loadMeituanFilterConfig(nonexistentPath);

        expect(loaded.channelId).toBe('MEITUAN');
        expect(loaded.rules.map((r) => r.id)).toEqual(['meituan-rescheduled', 'meituan-tmc']);
        expect(getActiveMeituanFilterConfig()).toBe(loaded);
      } finally {
        resetMeituanFilterConfig();
      }
    });

    it('保存非法表达式规则配置时应 Fail-Fast 拒绝并抛出异常', () => {
      const invalidConfig = {
        channelId: 'MEITUAN',
        rules: [
          {
            id: 'broken-syntax-rule',
            condition: "totalAmount >",
            action: 'MANUAL_ATTENTION' as const,
            reason: '语法错误规则',
            enabled: true,
          },
        ],
      };

      expect(() => saveMeituanFilterConfig(invalidConfig)).toThrow('[Expression Error]');
    });

    it('规则表达式求值异常时应 Fail-Fast 转 MANUAL_ATTENTION 而不是静默放行', () => {
      const currentConfig = getActiveMeituanFilterConfig();
      try {
        setActiveMeituanFilterConfig({
          channelId: 'MEITUAN',
          rules: [
            {
              id: 'eval-error-rule',
              condition: 'brokenOp ~~~ 123',
              action: 'MANUAL_ATTENTION',
              reason: '异常测试',
              enabled: true,
            },
          ],
        });

        const order = createTestDutyOrder({
          orderId: '5035036081700000088',
        });

        const result = filterMeituanOrder(order);
        expect(result.allowed).toBe(false);
        expect(result.action).toBe('MANUAL_ATTENTION');
        expect(result.reason).toContain('过滤规则「eval-error-rule」求值异常');
      } finally {
        resetMeituanFilterConfig();
      }
    });

    it('关联原单号为 0 的订单不得误判为改签单，应 ALLOW 放行', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035036081700000219',
        orderDisplayLabel: '新订',
        rescheduledOrderId: '0',
      }));

      expect(result).toMatchObject({
        allowed: true,
        action: 'ALLOW',
        orderId: '5035036081700000219',
      });
    });

    it('拦截证据应保留真实客人姓名与房型用于前台人工排查核对', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035036081700000077',
        status: 'RESCHEDULED',
        contacts: [{ name: '李四', phone: '13800000000' }],
        roomName: '豪华大床房',
        orderDisplayLabel: '改签',
        raw: {
          orderId: '5035036081700000077',
          contacts: [{ name: '李四', phone: '13800000000' }],
          roomTypeName: '豪华大床房',
          orderDisplayLabel: '改签',
        },
      }));

      expect(result.allowed).toBe(false);
      const evidence = rejectedEvidence(result);
      expect(evidence?.guestName).toBe('李四');
      expect(evidence?.roomName).toBe('豪华大床房');
      expect(evidence?.orderDisplayLabel).toBe('改签');
      expect(evidence?.status).toBe('RESCHEDULED');
    });

    it('真实改签样本形态 (label 新订 / origin 100 / status RESCHEDULED) 应 MANUAL_ATTENTION 且分类为 RESCHEDULED', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035035912543413058',
        status: 'RESCHEDULED',
        orderDisplayLabel: '新订',
        rescheduledOrderId: '5035035915540102978',
        raw: {
          orderId: '5035035912543413058',
          status: 'RESCHEDULED',
          orderDisplayLabel: '新订',
          originOrRescheduled: 100,
          rescheduledOrderId: '5035035915540102978',
        },
      }));

      expect(result).toMatchObject({
        action: 'MANUAL_ATTENTION',
        orderType: 'RESCHEDULED',
        orderId: '5035035912543413058',
      });
      expect(result.reason).toContain('改签/改期');
    });

    it('status 非 RESCHEDULED 时改签文案与关联原单启发式不再作为判定依据（status 唯一标准）', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035036081700000500',
        orderDisplayLabel: '改签',
        rescheduledOrderId: '5035036081799999999',
      }));

      expect(result).toMatchObject({
        allowed: true,
        action: 'ALLOW',
        orderId: '5035036081700000500',
      });
    });

    it('美团商旅订单在普通散客工位应 CHANNEL_MISMATCH', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035036099999999999',
        orderDisplayLabel: '新订',
        reversePriceTmcOrderTag: 'TMC',
        raw: {
          orderId: '5035036099999999999',
          orderDisplayLabel: '新订',
          reversePriceTmcOrderTag: 'TMC',
        },
      }));

      expect(result).toMatchObject({
        action: 'CHANNEL_MISMATCH',
        orderType: 'TMC',
        orderId: '5035036099999999999',
      });
      expect(result.reason).toContain('企业商旅订单');
    });

    it('reversePriceTmcOrderTag 为空串时应 ALLOW 放行（非空才判商旅）', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035036081700000510',
        reversePriceTmcOrderTag: '',
      }));

      expect(result).toMatchObject({
        allowed: true,
        action: 'ALLOW',
        orderId: '5035036081700000510',
      });
    });

    it('真实取消单 fixture 经阶段一解析为标准协议实体后，应 ALLOW 放行', () => {
      const fixtureJson = JSON.parse(
        readFileSync(resolve(__dirname, '../../fixtures/meituanRealOrder.json'), 'utf-8')
      ) as { data: Record<string, unknown> };

      const realOrder = fixtureJson.data;

      const extractedOrders = extractMeituanOrdersFromPayload([realOrder]);
      expect(extractedOrders).toHaveLength(1);
      const realDutyOrder = extractedOrders[0];

      const result = filterMeituanOrder(realDutyOrder);
      expect(result).toMatchObject({
        allowed: true,
        action: 'ALLOW',
        orderId: '5035036080553098350',
      });
    });

    it('标准新订订单应 ALLOW 放行', () => {
      const result = filterMeituanOrder(createTestDutyOrder({
        orderId: '5035036069802774638',
        orderDisplayLabel: '新订',
        status: 'NEW_ORDER',
        raw: {
          orderId: '5035036069802774638',
          orderDisplayLabel: '新订',
          status: 'NEW_ORDER',
        },
      }));

      expect(result).toMatchObject({
        allowed: true,
        action: 'ALLOW',
        orderId: '5035036069802774638',
      });
    });
  });

  describe('列表解析集成验证 (两阶段流水线: 数据提取 -> 业务过滤)', () => {
    it('应从数据源提取有效订单，记录提取异常，过滤改签与商旅，并放行新订与取消单', () => {
      const payload = {
        data: {
          results: [
            { orderId: '5035036081700000001', status: 'NEW_ORDER', orderDisplayLabel: '新订', totalFee: 20000 },
            {
              orderId: '5035036081700000002',
              status: 'RESCHEDULED',
              totalFee: 30000,
            },
            { orderId: '5035036081700000003', status: 'NEW_ORDER', reversePriceTmcOrderTag: 'TMC' },
            { orderId: '5035036081700000004', status: 'CANCELED', orderDisplayLabel: '取消' },
            { orderId: '', orderDisplayLabel: '新订' },
            null,
            'malformed_string_item',
          ],
        },
      };

      const anomalies: MeituanOrderExtractionAnomaly[] = [];
      const skipped: Array<[string, OrderFilterResult['action']]> = [];
      const summaries = parseMeituanOrderListResponse(payload, {
        onExtractionAnomaly: (anomaly) => {
          anomalies.push(anomaly);
        },
        onFilterResult: (result) => {
          if (!result.allowed) skipped.push([result.orderId, result.action]);
        },
      });

      // 阶段一验证：成功从数据源提取出 4 笔完整订单，另有 3 笔提取异常
      const extractedOrders = extractMeituanOrdersFromPayload(payload);
      expect(extractedOrders).toHaveLength(4);
      expect(anomalies).toHaveLength(3);
      expect(anomalies[0].reason).toContain('缺少有效订单号主键');
      expect(anomalies[1].reason).toContain('订单原始载荷为空或非对象');
      expect(anomalies[2].reason).toContain('订单原始载荷为空或非对象');

      // 阶段二验证：业务规则过滤拦截了 1 笔改签和 1 笔商旅
      expect(skipped).toEqual([
        ['5035036081700000002', 'MANUAL_ATTENTION'],
        ['5035036081700000003', 'CHANNEL_MISMATCH'],
      ]);

      // 最终放行验证：新订与取消单正常放行
      expect(summaries.map((order) => order.orderId)).toEqual([
        '5035036081700000001',
        '5035036081700000004',
      ]);
      expect(summaries[0].cancelOrder).toBe(false);
      expect(summaries[1].cancelOrder).toBe(true);
    });
  });
});
