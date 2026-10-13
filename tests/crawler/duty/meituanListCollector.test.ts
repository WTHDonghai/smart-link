import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Response } from 'playwright';
import {
  MeituanListCollector,
  waitForMeituanListResponse,
} from '@/src/crawler/duty/channels/meituan/meituanListCollector';
import {
  MeituanDutyErrorCode,
} from '@/src/crawler/duty/channels/meituan/meituanDutyContracts';
import { setMeituanBizSplitEnabled } from '@/src/crawler/duty/channels/meituan/meituanOrderFilter';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import { logger } from '@/src/services/logger';
import type { DutyTaskLogSink } from '@/src/crawler/duty/dutyTaskLogger';

type DutyOrderAuditEntry = Parameters<DutyTaskLogSink>[0];

vi.mock('@/src/crawler/visualTracker', () => ({
  updateVisualTrackerStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/services/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    track: vi.fn(),
  },
}));

describe('meituanListCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 商旅分流开关默认关闭，用例内按需开启（用例间隔离）
    setMeituanBizSplitEnabled(false);
  });

  describe('waitForMeituanListResponse', () => {
    it('should throw METHOD_NOT_SUPPORTED when waitForResponse is not supported', async () => {
      const mockPage = {} as Page;
      await expect(waitForMeituanListResponse(mockPage, '测试')).rejects.toThrow(
        expect.objectContaining({ errorCode: 'METHOD_NOT_SUPPORTED' })
      );
    });

    it('should throw LIST_HTTP_ERROR when server returns non-200', async () => {
      const mockResponse = {
        status: () => 502,
        url: () => 'https://eb.meituan.com/api/v2/task/list',
      } as unknown as Response;

      const mockPage = {
        waitForResponse: vi.fn().mockResolvedValue(mockResponse),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Page;

      await expect(waitForMeituanListResponse(mockPage, '待确认')).rejects.toThrow(
        expect.objectContaining({ errorCode: MeituanDutyErrorCode.LIST_HTTP_ERROR })
      );
    });

    it('should return valid response when server returns 200', async () => {
      const mockResponse = {
        status: () => 200,
        url: () => 'https://eb.meituan.com/api/v2/task/list',
      } as unknown as Response;

      const mockPage = {
        waitForResponse: vi.fn().mockResolvedValue(mockResponse),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Page;

      const result = await waitForMeituanListResponse(mockPage, '待确认');
      expect(result).toBe(mockResponse);
    });
  });

  describe('MeituanListCollector instance', () => {
    it('should throw LIST_BUSINESS_FAILED when list response is invalid JSON', async () => {
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;

      const mockResponse = {
        text: async () => 'invalid-json-text',
      } as unknown as Response;

      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockResolvedValue(mockResponse);

      await expect(collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn)).rejects.toThrow(
        expect.objectContaining({ errorCode: MeituanDutyErrorCode.LIST_BUSINESS_FAILED })
      );
    });

    it('响应内容读取失败时应保留原始错误并按可重试失败处理', async () => {
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;
      const bodyError = new Error('body stream aborted');
      const mockResponse = {
        text: vi.fn().mockRejectedValue(bodyError),
      } as unknown as Response;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();

      await expect(
        collector.collectUnhandledOrders(mockPage, runWithMutex, vi.fn().mockResolvedValue(mockResponse))
      ).rejects.toThrow(
        expect.objectContaining({
          errorCode: MeituanDutyErrorCode.LIST_RESPONSE_TIMEOUT,
          retryable: true,
          message: expect.stringContaining('body stream aborted'),
        })
      );
    });

    it('should successfully parse unhandled orders from valid JSON response', async () => {
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;

      const mockPayload = {
        code: 0,
        data: {
          orders: [
            {
              orderId: 'MT-888',
              status: 'NEW_ORDER',
              orderDisplayLabel: '新订',
              roomName: '豪华大床房',
              checkInDate: '2026-10-01',
              checkOutDate: '2026-10-03',
              totalAmount: 500,
              contactName: '张三',
            },
          ],
        },
      };

      const mockResponse = {
        text: async () => JSON.stringify(mockPayload),
      } as unknown as Response;

      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockResolvedValue(mockResponse);

      const orders = await collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn);
      expect(orders).toHaveLength(1);
      expect(orders[0].orderId).toBe('MT-888');
      expect(orders[0].orderDisplayLabel).toBe('新订');
    });

    it('should coalesce concurrent in-flight collectUnhandledOrders requests', async () => {
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;

      const mockPayload = {
        code: 0,
        data: { orders: [] },
      };

      const mockResponse = {
        text: async () => JSON.stringify(mockPayload),
      } as unknown as Response;

      let callCount = 0;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return mockResponse;
      });

      const [res1, res2] = await Promise.all([
        collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn),
        collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn),
      ]);

      expect(callCount).toBe(1);
      expect(res1).toEqual(res2);
    });

    it('并发不同渠道身份的采集不得互相合并结果（MEITUAN 与 MEITUAN_BIZ 各自独立过滤）', async () => {
      setMeituanBizSplitEnabled(true);
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;

      const mockPayload = {
        code: 0,
        data: {
          orders: [
            {
              orderId: 'MT-REG-1',
              status: 'NEW_ORDER',
              orderDisplayLabel: '新订',
              roomName: '大床房',
              checkInDate: '2026-10-01',
              checkOutDate: '2026-10-02',
              totalAmount: 300,
              contactName: '张三',
            },
            {
              orderId: 'MT-TMC-2',
              status: 'NEW_ORDER',
              orderDisplayLabel: '新订',
              roomName: '大床房',
              checkInDate: '2026-10-01',
              checkOutDate: '2026-10-02',
              totalAmount: 500,
              contactName: '李四',
              reversePriceTmcOrderTag: 'TMC',
            },
          ],
        },
      };

      const mockResponse = {
        text: async () => JSON.stringify(mockPayload),
      } as unknown as Response;

      let callCount = 0;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return mockResponse;
      });

      const [regularOrders, bizOrders] = await Promise.all([
        collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn, undefined, 'MEITUAN'),
        collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn, undefined, 'MEITUAN_BIZ'),
      ]);

      // 不同渠道身份的采集各自独立执行列表刷新，绝不合并结果
      expect(callCount).toBe(2);
      expect(regularOrders.map((o) => o.orderId)).toEqual(['MT-REG-1']);
      expect(bizOrders.map((o) => o.orderId)).toEqual(['MT-TMC-2']);
    });

    it('同一渠道身份的并发采集仍应在途合并（复用一次列表刷新）', async () => {
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;

      const mockPayload = {
        code: 0,
        data: {
          orders: [
            {
              orderId: 'MT-TMC-9',
              status: 'NEW_ORDER',
              orderDisplayLabel: '新订',
              roomName: '大床房',
              checkInDate: '2026-10-01',
              checkOutDate: '2026-10-02',
              totalAmount: 500,
              contactName: '王五',
              reversePriceTmcOrderTag: 'TMC',
            },
          ],
        },
      };

      const mockResponse = {
        text: async () => JSON.stringify(mockPayload),
      } as unknown as Response;

      let callCount = 0;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return mockResponse;
      });

      const [res1, res2] = await Promise.all([
        collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn, undefined, 'MEITUAN_BIZ'),
        collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn, undefined, 'MEITUAN_BIZ'),
      ]);

      expect(callCount).toBe(1);
      expect(res1.map((o) => o.orderId)).toEqual(['MT-TMC-9']);
      expect(res2).toEqual(res1);
    });

    it('完成后应清理在途采集状态，允许后续请求再次刷新', async () => {
      const collector = new MeituanListCollector();
      const mockPage = { url: () => 'https://eb.meituan.com/dealorder' } as unknown as Page;
      const mockResponse = {
        text: async () => JSON.stringify({ code: 0, data: { orders: [] } }),
      } as unknown as Response;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockResolvedValue(mockResponse);

      await collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn);
      // 清零仅用于跳过 3 秒防抖等待，聚焦断言在途状态清理本身。
      (collector as unknown as { lastListRefreshTime: number }).lastListRefreshTime = 0;
      await collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn);

      expect(refreshFn).toHaveBeenCalledTimes(2);
    });

    it('畸形合法 JSON envelope 应 Fail-Fast 抛出 LIST_BUSINESS_FAILED', async () => {
      const collector = new MeituanListCollector();
      const mockPage = { url: () => 'https://eb.meituan.com/dealorder' } as unknown as Page;
      const mockResponse = {
        text: async () => JSON.stringify({ data: {} }),
      } as unknown as Response;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();

      await expect(
        collector.collectUnhandledOrders(mockPage, runWithMutex, vi.fn().mockResolvedValue(mockResponse))
      ).rejects.toThrow(expect.objectContaining({
        errorCode: MeituanDutyErrorCode.LIST_BUSINESS_FAILED,
        retryable: false,
      }));
    });

    it('非法 JSON 应 Fail-Fast 并保留解析错误上下文', async () => {
      const collector = new MeituanListCollector();
      const mockPage = { url: () => 'https://eb.meituan.com/dealorder' } as unknown as Page;
      const mockResponse = { text: async () => '{invalid-json' } as unknown as Response;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();

      await expect(
        collector.collectUnhandledOrders(mockPage, runWithMutex, vi.fn().mockResolvedValue(mockResponse))
      ).rejects.toThrow(expect.objectContaining({
        errorCode: MeituanDutyErrorCode.LIST_BUSINESS_FAILED,
        retryable: false,
        message: expect.stringMatching(/^\[LIST_BUSINESS_FAILED\] 美团列表响应非合法 JSON: .+/),
      }));
    });

    it('应逐笔过滤改签、商旅与缺主键订单并输出结构化 WARN 与分类 HUD', async () => {
      setMeituanBizSplitEnabled(true);
      const collector = new MeituanListCollector();
      const mockPage = { url: () => 'https://eb.meituan.com/dealorder' } as unknown as Page;
      const mockPayload = {
        code: 0,
        data: {
          orders: [
            { orderId: '5035036081700000001', status: 'NEW_ORDER', orderDisplayLabel: '新订' },
            { orderId: '5035036081700000002', status: 'RESCHEDULED' },
            { orderId: '5035036081700000003', status: 'NEW_ORDER', reversePriceTmcOrderTag: 'TMC' },
            { orderId: '5035036081700000004', status: 'CANCELED', orderDisplayLabel: '取消' },
            { orderDisplayLabel: '新订' },
          ],
        },
      };
      const mockResponse = {
        text: async () => JSON.stringify(mockPayload),
      } as unknown as Response;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();

      const orders = await collector.collectUnhandledOrders(
        mockPage,
        runWithMutex,
        vi.fn().mockResolvedValue(mockResponse)
      );

      expect(orders.map((order) => order.orderId)).toEqual([
        '5035036081700000001',
        '5035036081700000004',
      ]);
      expect(orders[1].cancelOrder).toBe(true);
      expect(logger.track).toHaveBeenCalledTimes(3);

      const filterSkipCalls = vi.mocked(logger.track).mock.calls.filter(([event]) => event === 'MEITUAN_ORDER_FILTER_SKIPPED');
      expect(filterSkipCalls).toHaveLength(2);
      expect(filterSkipCalls[0][1]?.message).toContain('5035036081700000002');
      expect(filterSkipCalls[1][1]?.message).toContain('5035036081700000003');

      const anomalyCalls = vi.mocked(logger.track).mock.calls.filter(([event]) => event === 'MEITUAN_ORDER_EXTRACTION_ANOMALY');
      expect(anomalyCalls).toHaveLength(1);
      expect(anomalyCalls[0][1]).toMatchObject({
        level: 'WARN',
        message: expect.stringContaining('数据提取异常'),
        module: 'DUTY_TASK',
        channelId: 'MEITUAN',
        taskActionStage: 'collect-order',
        meta: expect.objectContaining({
          anomalyCount: 1,
          anomalies: [
            expect.objectContaining({
              reason: expect.stringContaining('缺少有效订单号'),
              evidence: expect.objectContaining({ orderDisplayLabel: '新订' }),
            }),
          ],
        }),
      });

      const hudMessage = vi.mocked(updateVisualTrackerStatus).mock.calls.at(-1)?.[1] ?? '';
      expect(hudMessage).toContain('需人工核对');
      expect(hudMessage).toContain('工位不匹配');
      expect(hudMessage).toContain('提取异常');
      expect(hudMessage).not.toContain('MANUAL_ATTENTION');
      expect(hudMessage).not.toContain('CHANNEL_MISMATCH');
    });

    it('传入任务审计上下文时应逐笔输出 MEITUAN_ORDER_FILTER_SKIPPED 且证据不包含完整原始订单', async () => {
      const collector = new MeituanListCollector();
      const mockPage = { url: () => 'https://eb.meituan.com/dealorder' } as unknown as Page;
      const mockPayload = {
        data: {
          results: [
            {
              orderId: '5035036081700000002',
              status: 'RESCHEDULED',
              guestName: '张三',
            },
          ],
        },
      };
      const mockResponse = { text: async () => JSON.stringify(mockPayload) } as unknown as Response;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const auditEntries: DutyOrderAuditEntry[] = [];

      const orders = await collector.collectUnhandledOrders(
        mockPage,
        runWithMutex,
        vi.fn().mockResolvedValue(mockResponse),
        (entry) => auditEntries.push(entry)
      );

      expect(orders).toEqual([]);
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]).toMatchObject({
        level: 'WARN',
        event: 'MEITUAN_ORDER_FILTER_SKIPPED',
        orderNo: '5035036081700000002',
        taskActionStage: 'collect-order',
        meta: {
          action: 'MANUAL_ATTENTION',
          orderType: 'RESCHEDULED',
          reason: expect.stringContaining('改签/改期'),
          evidence: expect.objectContaining({
            status: 'RESCHEDULED',
            guestName: '张三',
          }),
        },
      });
      expect((auditEntries[0].meta as Record<string, unknown>)?.evidence).toMatchObject({ guestName: '张三' });
      expect(logger.track).not.toHaveBeenCalled();
    });
  });
});
