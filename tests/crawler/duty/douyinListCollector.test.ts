import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Response, Request } from 'playwright';
import {
  DouyinListCollector,
  waitForDouyinListResponse,
  resolveDouyinTargetTab,
} from '@/src/crawler/duty/channels/douyin/douyinListCollector';
import {
  DouyinDutyErrorCode,
} from '@/src/crawler/duty/channels/douyin/douyinDutyContracts';
import { DutyOrderStatus } from '@/src/crawler/duty/dutyTaskContext';
import {
  isDouyinBookOrderListUrl,
} from '@/src/crawler/duty/channels/douyin/douyinOrderParsers';

describe('DouyinListCollector (Single Responsibility & Benchmark against Meituan)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('waitForDouyinListResponse', () => {
    it('should return response when target POST request succeeds with 200', async () => {
      const mockResponse = {
        url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
        status: () => 200,
        request: () => ({ method: () => 'POST' }),
      } as unknown as Response;

      const mockPage = {
        waitForResponse: vi.fn().mockResolvedValue(mockResponse),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Page;

      const res = await waitForDouyinListResponse(mockPage, isDouyinBookOrderListUrl, '新订/变更');
      expect(res).toBe(mockResponse);
    });

    it('should throw LIST_HTTP_ERROR when API returns non-200', async () => {
      const mockResponse = {
        url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
        status: () => 500,
        request: () => ({ method: () => 'POST' }),
      } as unknown as Response;

      const mockPage = {
        waitForResponse: vi.fn().mockResolvedValue(mockResponse),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Page;

      await expect(
        waitForDouyinListResponse(mockPage, isDouyinBookOrderListUrl, '新订/变更')
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.LIST_HTTP_ERROR,
        retryable: false,
      });
    });

    it('should throw LIST_RESPONSE_TIMEOUT when network times out', async () => {
      let requestListener: ((req: Request) => void) | undefined;
      const mockPage = {
        waitForResponse: vi.fn().mockRejectedValue(new Error('Timeout 15000ms')),
        on: vi.fn((event, handler) => {
          if (event === 'request') requestListener = handler;
        }),
        off: vi.fn(),
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      const promise = waitForDouyinListResponse(mockPage, isDouyinBookOrderListUrl, '新订/变更');

      if (requestListener) {
        requestListener({
          url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
        } as unknown as Request);
      }

      await expect(promise).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.LIST_RESPONSE_TIMEOUT,
        retryable: true,
      });
    });
  });

  describe('DouyinListCollector methods', () => {
    it('should throw LIST_TRIGGER_UNAVAILABLE when Tab is not visible', async () => {
      const collector = new DouyinListCollector();

      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
        locator: vi.fn().mockReturnValue({
          first: () => ({
            waitFor: vi.fn().mockRejectedValue(new Error('Element not visible')),
          }),
          count: vi.fn().mockResolvedValue(0),
        }),
      } as unknown as Page;

      await expect(collector.refreshBookOrderList(mockPage)).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
      });
    });

    it('should throw LIST_BUSINESS_FAILED when API response is not valid JSON', async () => {
      const collector = new DouyinListCollector();

      const mockTab = {
        waitFor: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockResponse = {
        url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
        status: () => 200,
        text: vi.fn().mockResolvedValue('<html>502 Bad Gateway</html>'),
        request: () => ({ method: () => 'POST' }),
      };

      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
        locator: vi.fn().mockReturnValue({
          first: () => mockTab,
          count: vi.fn().mockResolvedValue(0),
        }),
        waitForResponse: vi.fn().mockResolvedValue(mockResponse),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Page;

      await expect(collector.refreshBookOrderList(mockPage)).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
      });
    });

    it('should collect unhandled orders and cache raw payloads under mutex', async () => {
      const collector = new DouyinListCollector();

      const mockTab = {
        waitFor: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const validPayload = {
        status_code: 0,
        data: {
          data: [
            JSON.stringify({
              order_base_info: { order_id: '1113572432327416823' },
              book_detail_info: { hotel_name: '日月洲度假村', book_start_time: 1790179200, book_end_time: 1790265600 },
              sale_product_info: { physical_room_name: '豪华家庭房' },
              guest_info: { user_list: [{ name: '吕克' }] },
            }),
          ],
        },
      };

      const mockResponse = {
        url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
        status: () => 200,
        text: vi.fn().mockResolvedValue(JSON.stringify(validPayload)),
        request: () => ({ method: () => 'POST' }),
      };

      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
        locator: vi.fn().mockReturnValue({
          first: () => mockTab,
          count: vi.fn().mockResolvedValue(0),
        }),
        waitForResponse: vi.fn().mockResolvedValue(mockResponse),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Page;

      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();

      const res = await collector.collectUnhandledOrders(mockPage, DutyOrderStatus.NEW, runWithMutex);

      expect(res).toHaveLength(1);
      expect(res[0].orderId).toBe('1113572432327416823');
      expect(mockTab.click).toHaveBeenCalledTimes(1);

      // 验证缓存原始报文
      const cached = collector.getCachedOrderRaw('1113572432327416823');
      expect(cached).not.toBeNull();
      expect((cached as { order_base_info?: { order_id: string } })?.order_base_info?.order_id).toBe('1113572432327416823');
    });

    it('should generate precise selectors with DOM structure, CSS styling, and text constraints', () => {
      const collector = new DouyinListCollector();

      let capturedSelector = '';
      const mockPage = {
        locator: vi.fn((sel: string) => {
          capturedSelector = sel;
          return { first: () => ({}) };
        }),
      } as unknown as Page;

      collector.getTabLocator(mockPage, '新订/变更');

      // 验证 DOM 结构约束包含 .byted-tab-bar 与 .byted-tab-bar-item
      expect(capturedSelector).toContain('.byted-tab-bar .byted-tab-bar-item');
      // 验证 CSS 样式约束包含 .byted-tab-bar-item-label 并且不包含模糊通配 [class*="tab-bar-item"]
      expect(capturedSelector).toContain('.byted-tab-bar-item-label');
      expect(capturedSelector).not.toContain('[class*="tab-bar-item"]');
      // 验证文本约束包含精确的新订/变更
      expect(capturedSelector).toContain('新订/变更');
    });

    it('should prevent mis-clicking when tab element text does not match (e.g. 今日待入住)', async () => {
      const collector = new DouyinListCollector();

      // 模拟误匹配到「今日待入住」Tab
      const misMatchedTab = {
        waitFor: vi.fn().mockResolvedValue(undefined),
        innerText: vi.fn().mockResolvedValue('今日待入住 (3)'),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
        locator: vi.fn().mockReturnValue({
          first: () => misMatchedTab,
          count: vi.fn().mockResolvedValue(0),
        }),
      } as unknown as Page;

      await expect(collector.refreshBookOrderList(mockPage)).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        message: expect.stringContaining('Tab 元素文本校验失败'),
      });

      expect(misMatchedTab.click).not.toHaveBeenCalled();
    });
  });

  describe('resolveDouyinTargetTab', () => {
    it('should map DutyOrderStatus to target tab correctly', () => {
      expect(resolveDouyinTargetTab(DutyOrderStatus.CANCEL)).toBe('refund');
      expect(resolveDouyinTargetTab(DutyOrderStatus.NEW)).toBe('book');
      expect(resolveDouyinTargetTab(DutyOrderStatus.ALL)).toBe('book');
      expect(resolveDouyinTargetTab()).toBe('book');
    });
  });


  describe('Bounded Cache Eviction', () => {
    it('should evict oldest cached orders when capacity exceeds 200', async () => {
      const collector = new DouyinListCollector();

      // 依次注入 206 个订单 (通过内部调用 cacheRecentOrder)
      for (let i = 0; i <= 205; i++) {
        const currentOrderId = `ORDER-${i}`;
        // 使用私有方法测试边界淘汰机制
        (collector as unknown as { cacheRecentOrder: (id: string, raw: Record<string, unknown>) => void }).cacheRecentOrder(
          currentOrderId,
          { order_id: currentOrderId }
        );
      }

      // ORDER-0 至 ORDER-5 应该被 FIFO 淘汰
      expect(collector.getCachedOrderRaw('ORDER-0')).toBeNull();
      expect(collector.getCachedOrderRaw('ORDER-5')).toBeNull();
      // 最新的 ORDER-205 应该存在
      expect(collector.getCachedOrderRaw('ORDER-205')).not.toBeNull();
    });
  });
});
