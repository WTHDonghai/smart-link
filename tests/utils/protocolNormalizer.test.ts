import { describe, it, expect } from 'vitest';
import {
  normalizeOrderPayload,
  ProtocolNormalizationError,
} from '../../src/utils/template/protocolNormalizer';
import {
  MEITUAN_RAW_SAMPLE_ORDER,
  DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
} from '../../src/services/protocols/meituanProtocol';
import { renderTemplate } from '../../src/utils/template/templateEngine';

const SAMPLE_MEITUAN_REMARK_TEMPLATE =
  '【美团搬单】单号:{美团单号} | 房型:{房型名称} x {房间间数}间 | 客人:{入住人} ({联系电话}) | 入住:{入住日期}至{离店日期} | 底价:¥{结算底价} | 早餐:{早餐说明}' +
  '{{#if hasRights}}\n【权益】{特色权益}{{/if}}' +
  '{{#if needInvoice}}\n【发票提醒】该单客人要求酒店开具发票(参考金额:¥{参考开票金额}){{/if}}';

describe('protocolNormalizer (Meituan Protocol)', () => {
  it('successfully cleans Meituan raw payload into 15+ canonical business fields', () => {
    const cleanCtx = normalizeOrderPayload(
      MEITUAN_RAW_SAMPLE_ORDER,
      DEFAULT_MEITUAN_PROTOCOL_SCHEMA
    );

    // 基础单号与状态
    expect(cleanCtx.orderNo).toBe('5035036057245515034');
    expect(cleanCtx['美团单号']).toBe('5035036057245515034');
    expect(cleanCtx.orderStatus).toBe('新订');
    expect(cleanCtx.orderTime).toBe('2026-09-15 11:37:44');

    // 酒店房型
    expect(cleanCtx.roomName).toBe('松香大床房');
    expect(cleanCtx.roomCount).toBe('1');

    // 入离时间
    expect(cleanCtx.checkInDate).toBe('2026-09-15');
    expect(cleanCtx.checkOutDate).toBe('2026-09-16');
    expect(cleanCtx.arriveTime).toBe('2026-09-15 14:00:00');

    // 客人联系人
    expect(cleanCtx.guestName).toBe('巨*');
    expect(cleanCtx.guestPhone).toBe('138****9999');

    // 财务结算（分转元自动清洗）
    expect(cleanCtx.floorPrice).toBe('239.00');
    expect(cleanCtx['结算底价']).toBe('239.00');
    expect(cleanCtx.salePrice).toBe('265.55');

    // 权益服务
    expect(cleanCtx.breakfast).toBe('不含早');
    expect(cleanCtx.rightsDesc).toBe('延迟退房至 14:00，共 1 间');
    expect(cleanCtx.hasRights).toBe(true);

    // 发票判定
    expect(cleanCtx.needInvoice).toBe(true);
    expect(cleanCtx.invoiceMoney).toBe('265.55');
  });

  it('renders default Meituan remark template end-to-end with real data', () => {
    const cleanCtx = normalizeOrderPayload(
      MEITUAN_RAW_SAMPLE_ORDER,
      DEFAULT_MEITUAN_PROTOCOL_SCHEMA
    );
    const rendered = renderTemplate(SAMPLE_MEITUAN_REMARK_TEMPLATE, cleanCtx);

    expect(rendered).toContain('【美团搬单】单号:5035036057245515034');
    expect(rendered).toContain('房型:松香大床房 x 1间');
    expect(rendered).toContain('客人:巨* (138****9999)');
    expect(rendered).toContain('入住:2026-09-15至2026-09-16');
    expect(rendered).toContain('底价:¥239.00');
    expect(rendered).toContain('早餐:不含早');
    expect(rendered).toContain('\n【权益】延迟退房至 14:00，共 1 间');
    expect(rendered).toContain('\n【发票提醒】该单客人要求酒店开具发票(参考金额:¥265.55)');
  });

  it('renders Meituan remark template correctly across all conditional permutations without text concatenation bugs', () => {
    const baseCtx = {
      '美团单号': 'MT-1001',
      '房型名称': '标准大床房',
      '房间间数': '1',
      '入住人': '张三',
      '联系电话': '138****0000',
      '入住日期': '2026-09-15',
      '离店日期': '2026-09-16',
      '结算底价': '200.00',
      '早餐说明': '不含早',
    };

    // 1. 无权益，但有发票：发票提醒必须独立成行，绝不与早餐说明粘连在同一行
    const ctxNoRightsWithInvoice = {
      ...baseCtx,
      hasRights: false,
      needInvoice: true,
      '参考开票金额': '220.00',
    };
    const res1 = renderTemplate(SAMPLE_MEITUAN_REMARK_TEMPLATE, ctxNoRightsWithInvoice);
    expect(res1.includes('早餐:不含早\n【发票提醒】')).toBe(true);
    expect(res1.includes('早餐:不含早【发票提醒】')).toBe(false);
    expect(res1.includes('【权益】')).toBe(false);

    // 2. 有权益，无发票：权益独立成行，末尾无悬挂空行
    const ctxWithRightsNoInvoice = {
      ...baseCtx,
      hasRights: true,
      '特色权益': '免费升房',
      needInvoice: false,
    };
    const res2 = renderTemplate(SAMPLE_MEITUAN_REMARK_TEMPLATE, ctxWithRightsNoInvoice);
    expect(res2.includes('早餐:不含早\n【权益】免费升房')).toBe(true);
    expect(res2.endsWith('\n')).toBe(false);
    expect(res2.includes('【发票提醒】')).toBe(false);

    // 3. 两者皆无：单行输出，末尾无悬挂空行
    const ctxNeither = {
      ...baseCtx,
      hasRights: false,
      needInvoice: false,
    };
    const res3 = renderTemplate(SAMPLE_MEITUAN_REMARK_TEMPLATE, ctxNeither);
    expect(res3.includes('\n')).toBe(false);
    expect(res3.endsWith('早餐:不含早')).toBe(true);
  });

  it('supports protocol field pruning (disabling unnecessary fields)', () => {
    // 禁用预结算收益与早餐说明
    const prunedSchema = {
      ...DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
      fields: DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields.map((f) => {
        if (f.key === 'partnerIncome' || f.key === 'breakfast') {
          return { ...f, enabled: false };
        }
        return f;
      }),
    };

    const cleanCtx = normalizeOrderPayload(MEITUAN_RAW_SAMPLE_ORDER, prunedSchema);
    expect(cleanCtx.partnerIncome).toBeUndefined();
    expect(cleanCtx.breakfast).toBeUndefined();
    expect(cleanCtx.orderNo).toBe('5035036057245515034');
  });

  it('detects protocol contract drift and triggers Fail-Fast warning when required field is missing', () => {
    // 构造缺失核心字段 orderId 和 floorPrice 的异常报文
    const corruptedPayload = {
      data: {
        roomName: '松香大床房',
        // 缺少 orderId, floorPrice, checkInDateString, checkOutDateString
      },
    };

    expect(() =>
      normalizeOrderPayload(corruptedPayload, DEFAULT_MEITUAN_PROTOCOL_SCHEMA)
    ).toThrowError(ProtocolNormalizationError);

    try {
      normalizeOrderPayload(corruptedPayload, DEFAULT_MEITUAN_PROTOCOL_SCHEMA);
      expect.unreachable('应当抛出 ProtocolNormalizationError 异常');
    } catch (e) {
      const err = e as ProtocolNormalizationError;
      expect(err.warning.channelCode).toBe('MEITUAN');
      expect(err.warning.missingRequiredFields.some((f) => f.includes('美团单号'))).toBe(true);
      expect(err.warning.missingRequiredFields.some((f) => f.includes('结算底价'))).toBe(true);
    }
  });

  it('supports zero-code protocol path update when Meituan renames field', () => {
    // 模拟美团将来将 orderId 改名为 orderSerialNo，将 floorPrice 移动到 pricing.cost
    const futureMeituanPayload = {
      data: {
        orderSerialNo: 'MT-FUTURE-9999',
        pricing: {
          cost: 19900,
        },
        roomName: '未来科技套房',
        checkInDateString: '2026-10-01 00:00:00',
        checkOutDateString: '2026-10-02 00:00:00',
      },
    };

    // 无需重新编写代码，直接在 Schema 配置中更新 path
    const updatedSchema = {
      ...DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
      fields: DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields.map((f) => {
        if (f.key === 'orderNo') {
          return { ...f, path: 'data.orderSerialNo' };
        }
        if (f.key === 'floorPrice') {
          return { ...f, path: 'data.pricing.cost' };
        }
        // 非必须测试字段临时标记可选
        return { ...f, required: false };
      }),
    };

    const cleanCtx = normalizeOrderPayload(futureMeituanPayload, updatedSchema);
    expect(cleanCtx.orderNo).toBe('MT-FUTURE-9999');
    expect(cleanCtx.floorPrice).toBe('199.00');
  });

  it('correctly cleans and concatenates multiple guests and contacts with Chinese pause marks', () => {
    const multiGuestOrder = {
      ...MEITUAN_RAW_SAMPLE_ORDER,
      data: {
        ...MEITUAN_RAW_SAMPLE_ORDER.data,
        guests: [
          { name: '张三' },
          { name: '李四' },
          { name: '王五' },
        ],
        contacts: [
          { phone: '13812345678' },
          { phone: '13987654321' },
        ],
      },
    };

    const cleanCtx = normalizeOrderPayload(multiGuestOrder, DEFAULT_MEITUAN_PROTOCOL_SCHEMA);

    expect(cleanCtx.guestName).toBe('张三、李四、王五');
    expect(cleanCtx['入住人']).toBe('张三、李四、王五');
    expect(cleanCtx.guestPhone).toBe('138****5678、139****4321');
    expect(cleanCtx['联系电话']).toBe('138****5678、139****4321');

    const rendered = renderTemplate(SAMPLE_MEITUAN_REMARK_TEMPLATE, cleanCtx);
    expect(rendered).toContain('客人:张三、李四、王五 (138****5678、139****4321)');
  });

  it('triggers Fail-Fast warning when a required field resolves to an empty array', () => {
    // 构造将入住人设为必填，但原始报文 guests 为空数组的场景
    const strictSchema = {
      ...DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
      fields: DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields.map((f) => {
        if (f.key === 'guestName') {
          return { ...f, required: true };
        }
        return f;
      }),
    };

    const emptyGuestOrder = {
      ...MEITUAN_RAW_SAMPLE_ORDER,
      data: {
        ...MEITUAN_RAW_SAMPLE_ORDER.data,
        guests: [],
      },
    };

    expect(() => normalizeOrderPayload(emptyGuestOrder, strictSchema)).toThrowError(
      ProtocolNormalizationError
    );

    try {
      normalizeOrderPayload(emptyGuestOrder, strictSchema);
      expect.unreachable('应当抛出 ProtocolNormalizationError 异常');
    } catch (e) {
      const err = e as ProtocolNormalizationError;
      expect(err.warning.missingRequiredFields.some((f) => f.includes('入住人'))).toBe(true);
    }
  });
});
