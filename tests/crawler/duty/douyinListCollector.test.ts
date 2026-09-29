import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Response } from 'playwright';
import {
  DouyinListCollector,
  waitForDouyinListResponse,
  TAB_TEXT_NEW,
  TAB_TEXT_CANCEL,
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

      const res = await waitForDouyinListResponse(mockPage, isDouyinBookOrderListUrl, TAB_TEXT_NEW);
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
        waitForDouyinListResponse(mockPage, isDouyinBookOrderListUrl, TAB_TEXT_NEW)
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.LIST_HTTP_ERROR,
        retryable: false,
      });
    });

    it('should throw LIST_RESPONSE_TIMEOUT when network times out', async () => {
      const mockPage = {
        waitForResponse: vi.fn().mockRejectedValue(new Error('Timeout 15000ms')),
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      await expect(
        waitForDouyinListResponse(mockPage, isDouyinBookOrderListUrl, TAB_TEXT_NEW)
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.LIST_RESPONSE_TIMEOUT,
        retryable: true,
      });
    });

    it('should include observed HTTP status code in timeout error message when response arrived but timed out', async () => {
      const mockPage = {
        waitForResponse: vi.fn(async (predicate: (res: Response) => boolean) => {
          // 模拟收到目标 URL 响应但由于非预期方式未匹配成功（如 302）
          const nonPostRes = {
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
            status: () => 302,
            request: () => ({ method: () => 'GET' }),
          } as unknown as Response;
          predicate(nonPostRes);
          throw new Error('Timeout 8000ms');
        }),
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      await expect(
        waitForDouyinListResponse(mockPage, isDouyinBookOrderListUrl, TAB_TEXT_NEW)
      ).rejects.toThrow('接口曾返回 HTTP 302');
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

    it('should throw LIST_BUSINESS_FAILED when API response is not valid JSON in collectUnhandledOrders', async () => {
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

      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();

      await expect(
        collector.collectUnhandledOrders(mockPage, DutyOrderStatus.NEW, runWithMutex)
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
      });
    });

    it('should collect unhandled orders under mutex and parse orders', async () => {
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
    });

    it('should coalesce concurrent calls into a single in-flight promise', async () => {
      const collector = new DouyinListCollector();
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue(false),
        frames: () => [],
      } as unknown as Page;

      const customRefreshFn = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          text: async () => JSON.stringify({
            status_code: 0,
            data: {
              data: [
                JSON.stringify({
                  order_base_info: { order_id: 'DY-COALESCED-001' },
                  book_detail_info: { hotel_name: '测试酒店' },
                }),
              ],
            },
          }),
        } as unknown as Response;
      });

      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();

      const [res1, res2] = await Promise.all([
        collector.collectUnhandledOrders(mockPage, DutyOrderStatus.NEW, runWithMutex, customRefreshFn),
        collector.collectUnhandledOrders(mockPage, DutyOrderStatus.NEW, runWithMutex, customRefreshFn),
      ]);

      expect(res1).toEqual(res2);
      expect(res1[0].orderId).toBe('DY-COALESCED-001');
      expect(customRefreshFn).toHaveBeenCalledTimes(1);
    });

    it('should generate precise single authoritative selector for Douyin tab', () => {
      const collector = new DouyinListCollector();

      let capturedSelector = '';
      const mockPage = {
        locator: vi.fn((sel: string) => {
          capturedSelector = sel;
          return { first: () => ({}) };
        }),
      } as unknown as Page;

      collector.getTabLocator(mockPage, '新订/变更');

      // 验证为唯一确定的权威选择器，彻底杜绝逗号备选与 Semi 臆测
      expect(capturedSelector).toBe('.byted-tab-bar .byted-tab-bar-item:has(.byted-tab-bar-item-label:has-text("新订/变更"))');
      expect(capturedSelector).not.toContain(',');
      expect(capturedSelector).not.toContain('semi');
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

  describe('TAB_TEXT constants & refreshOrderList routing', () => {
    it('should define accurate tab text constants', () => {
      expect(TAB_TEXT_NEW).toBe('新订/变更');
      expect(TAB_TEXT_CANCEL).toBe('取消/退款');
    });

    it('should route to refreshRefundOrderList when orderStatus is CANCEL, and refreshBookOrderList otherwise', async () => {
      const collector = new DouyinListCollector();
      const mockPage = {} as Page;
      const mockResponse = {} as Response;
      const refundSpy = vi.spyOn(collector, 'refreshRefundOrderList').mockResolvedValue(mockResponse);
      const bookSpy = vi.spyOn(collector, 'refreshBookOrderList').mockResolvedValue(mockResponse);

      const resRefund = await collector.refreshOrderList(mockPage, DutyOrderStatus.CANCEL);
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(bookSpy).not.toHaveBeenCalled();
      expect(resRefund).toBe(mockResponse);

      const resNew = await collector.refreshOrderList(mockPage, DutyOrderStatus.NEW);
      expect(bookSpy).toHaveBeenCalledTimes(1);
      expect(resNew).toBe(mockResponse);

      const resDefault = await collector.refreshOrderList(mockPage);
      expect(bookSpy).toHaveBeenCalledTimes(2);
      expect(resDefault).toBe(mockResponse);
    });
  });
});
