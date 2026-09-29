import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response as PlaywrightResponse } from 'playwright';
import {
  DouyinDutyRunner,
  checkDouyinPageRisk,
  dismissDouyinNoticeModals,
} from '@/src/crawler/duty/channels/douyin/douyinDutyRunner';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from '@/src/crawler/duty/channels/douyin/douyinDutyContracts';
import {
  DutyOrderStatus,
} from '@/src/crawler/duty/dutyTaskContext';
import { createPersistentBrowserSession } from '@/src/crawler/browserManager';

vi.mock('@/src/crawler/browserManager', () => ({
  createPersistentBrowserSession: vi.fn(),
}));

describe('douyinDutyRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkDouyinPageRisk', () => {
    it('should return false for safe normal page', async () => {
      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list?status=waiting',
        frames: () => [],
      } as unknown as import('playwright').Page;

      const hasRisk = await checkDouyinPageRisk(mockPage);
      expect(hasRisk).toBe(false);
    });

    it('should return true if page URL contains secsdk or verify', async () => {
      const mockPage = {
        url: () => 'https://verify.douyin.com/captcha/verify',
        frames: () => [],
      } as unknown as import('playwright').Page;

      const hasRisk = await checkDouyinPageRisk(mockPage);
      expect(hasRisk).toBe(true);
    });

    it('should return true if frame evaluate detects captcha DOM element', async () => {
      const mockPage = {
        url: () => 'https://life.douyin.com/p/workbench',
        frames: () => [
          {
            url: () => 'https://life.douyin.com/frame1',
            evaluate: async () => true,
          },
        ],
      } as unknown as import('playwright').Page;

      const hasRisk = await checkDouyinPageRisk(mockPage);
      expect(hasRisk).toBe(true);
    });
  });

  describe('dismissDouyinNoticeModals', () => {
    it('should return false when no notice modal exists', async () => {
      const mockPage = {
        locator: () => ({
          count: async () => 0,
        }),
      } as unknown as import('playwright').Page;

      const dismissed = await dismissDouyinNoticeModals(mockPage);
      expect(dismissed).toBe(false);
    });

    it('should safely dismiss announcement notice modal and avoid closing business dialogs', async () => {
      let clickCount = 0;
      let modalCount = 1;
      const mockModal = {
        isVisible: async () => true,
        innerText: async () => '系统通知公告：平台维护通知',
        locator: (sel: string) => {
          if (sel.includes('.byted-modal-title')) {
            return { innerText: async () => '维护通知' };
          }
          return {
            first: () => ({
              isVisible: async () => true,
              click: async () => {
                clickCount++;
                modalCount = 0;
              },
            }),
          };
        },
        waitFor: async () => {},
      };

      const mockPage = {
        locator: () => ({
          count: async () => modalCount,
          nth: () => mockModal,
        }),
      } as unknown as import('playwright').Page;

      const dismissed = await dismissDouyinNoticeModals(mockPage);
      expect(dismissed).toBe(true);
      expect(clickCount).toBe(1);
    });
  });

  describe('DouyinDutyRunner lifecycle & methods', () => {
    it('should initialize with correct channelCode and default targetUrl', () => {
      const runner = new DouyinDutyRunner();
      expect(runner.channelCode).toBe('DOUYIN');
      expect(runner.isRunning()).toBe(false);
      expect(runner.targetUrl).toContain('fulfillment-workbench');
    });

    it('should accept custom explicit targetUrl', () => {
      const customUrl = 'https://life.douyin.com/custom/url';
      const runner = new DouyinDutyRunner(customUrl);
      expect(runner.targetUrl).toBe(customUrl);
    });

    it('should throw when executing operations if runner is not running', async () => {
      const runner = new DouyinDutyRunner();
      await expect(runner.collectUnhandledOrders()).rejects.toThrow('抖音值守执行器未运行');
    });

    it('should start session and navigate to targetUrl', async () => {
      const runner = new DouyinDutyRunner();
      let navigatedUrl = '';
      const mockPage = {
        url: () => 'about:blank',
        goto: async (url: string) => {
          navigatedUrl = url;
        },
        bringToFront: async () => {},
        locator: () => ({
          first: () => ({
            waitFor: async () => {},
            count: async () => 0,
          }),
          count: async () => 0,
        }),
        waitForTimeout: async () => {},
        frames: () => [],
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();
      expect(runner.isRunning()).toBe(true);
      expect(navigatedUrl).toBe(runner.targetUrl);

      await runner.stop();
      expect(runner.isRunning()).toBe(false);
    });

    it('should navigate to targetUrl when currentUrl is on a different fulfillment workbench subpath', async () => {
      const runner = new DouyinDutyRunner();
      let navigatedUrl = '';
      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/delivery/list',
        goto: async (url: string) => {
          navigatedUrl = url;
        },
        bringToFront: async () => {},
        locator: () => ({
          first: () => ({
            waitFor: async () => {},
            count: async () => 0,
          }),
          count: async () => 0,
        }),
        waitForTimeout: async () => {},
        frames: () => [],
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();
      expect(navigatedUrl).toBe(runner.targetUrl);
      expect(runner.isRunning()).toBe(true);

      await runner.stop();
    });
  });

  describe('refreshOrderList & collectUnhandledOrders', () => {
    it('should refresh book tab by default and return unhandled new orders (single tab only)', async () => {
      const runner = new DouyinDutyRunner();

      const sampleBookPayload = {
        status_code: 0,
        BaseResp: { StatusCode: 0 },
        data: {
          data: [
            JSON.stringify({
              order_base_info: { order_id: 'DY-BOOK-001' },
              book_detail_info: { hotel_name: '淮安度假酒店', poi_life_account_id: 'poi-1' },
              status_info: { title: '新订' },
            }),
          ],
        },
      };

      let clickedTabs: string[] = [];

      const mockTabLocator = (label: string) => ({
        waitFor: async () => {},
        click: async () => {
          clickedTabs.push(label);
        },
      });

      const mockPage = {
        url: () => runner.targetUrl,
        goto: async () => {},
        bringToFront: async () => {},
        frames: () => [],
        waitForTimeout: async () => {},
        locator: (sel: string) => {
          if (sel.includes('新订/变更')) {
            return { first: () => mockTabLocator('新订/变更') };
          }
          if (sel.includes('取消/退款')) {
            return { first: () => mockTabLocator('取消/退款') };
          }
          return {
            first: () => ({
              waitFor: async () => {},
              count: async () => 0,
            }),
            count: async () => 0,
          };
        },
        waitForResponse: async (predicate: (res: PlaywrightResponse) => boolean) => {
          const mockBookRes = {
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
            status: () => 200,
            request: () => ({ method: () => 'POST' }),
            text: async () => JSON.stringify(sampleBookPayload),
          } as unknown as PlaywrightResponse;

          if (predicate(mockBookRes)) {
            return mockBookRes;
          }
          throw new Error('No matched response');
        },
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();

      const orders = await runner.collectUnhandledOrders();
      // 一次只能采集一个 Tab，默认采集新单 Tab
      expect(clickedTabs).toEqual(['新订/变更']);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toEqual({
        orderId: 'DY-BOOK-001',
        hotelId: 'poi-1',
        hotelName: '淮安度假酒店',
        cancelOrder: false,
        afterSaleId: undefined,
        orderDisplayLabel: '新订',
      });

      await runner.stop();
    });

    it('should refresh refund tab when tab is refund or task payload specifies cancel/refund', async () => {
      const runner = new DouyinDutyRunner();

      const sampleRefundPayload = {
        status_code: 0,
        BaseResp: { StatusCode: 0 },
        data: {
          data: [
            JSON.stringify({
              order_base_info: { order_id: 'DY-REFUND-002' },
              book_detail_info: { hotel_name: '淮安度假酒店' },
              after_sale_info_v2: {
                after_sale_info: { after_sale_id: 'as-002' },
              },
              status_info_v2: { title: '已取消' },
            }),
          ],
        },
      };

      let clickedTabs: string[] = [];

      const mockTabLocator = (label: string) => ({
        waitFor: async () => {},
        click: async () => {
          clickedTabs.push(label);
        },
      });

      const mockPage = {
        url: () => runner.targetUrl,
        goto: async () => {},
        bringToFront: async () => {},
        frames: () => [],
        waitForTimeout: async () => {},
        locator: (sel: string) => {
          if (sel.includes('新订/变更')) {
            return { first: () => mockTabLocator('新订/变更') };
          }
          if (sel.includes('取消/退款')) {
            return { first: () => mockTabLocator('取消/退款') };
          }
          return {
            first: () => ({
              waitFor: async () => {},
              count: async () => 0,
            }),
            count: async () => 0,
          };
        },
        waitForResponse: async (predicate: (res: PlaywrightResponse) => boolean) => {
          const mockRefundRes = {
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list',
            status: () => 200,
            request: () => ({ method: () => 'POST' }),
            text: async () => JSON.stringify(sampleRefundPayload),
          } as unknown as PlaywrightResponse;

          if (predicate(mockRefundRes)) {
            return mockRefundRes;
          }
          throw new Error('No matched response');
        },
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();

      const orders = await runner.collectUnhandledOrders(DutyOrderStatus.CANCEL);
      expect(clickedTabs).toEqual(['取消/退款']);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toEqual({
        orderId: 'DY-REFUND-002',
        hotelId: undefined,
        hotelName: '淮安度假酒店',
        cancelOrder: true,
        afterSaleId: 'as-002',
        orderDisplayLabel: '已取消',
      });

      await runner.stop();
    });

    it('should throw DutyExecutionError when Tab is unavailable', async () => {
      const runner = new DouyinDutyRunner();

      const mockPage = {
        url: () => runner.targetUrl,
        goto: async () => {},
        bringToFront: async () => {},
        frames: () => [],
        waitForTimeout: async () => {},
        locator: (sel: string) => {
          if (sel.includes('新订/变更')) {
            return {
              first: () => ({
                waitFor: async () => {
                  throw new Error('Element not found');
                },
                count: async () => 0,
              }),
              count: async () => 0,
            };
          }
          return {
            first: () => ({
              waitFor: async () => {},
              count: async () => 0,
            }),
            count: async () => 0,
          };
        },
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();

      await expect(runner.refreshBookOrderList(mockPage as unknown as import('playwright').Page)).rejects.toThrow(
        DutyExecutionError
      );

      try {
        await runner.refreshBookOrderList(mockPage as unknown as import('playwright').Page);
      } catch (err) {
        expect(err).toBeInstanceOf(DutyExecutionError);
        expect((err as DutyExecutionError).errorCode).toBe(DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE);
      }

      await runner.stop();
    });

    it('should throw DutyExecutionError when API returns HTTP non-200', async () => {
      const runner = new DouyinDutyRunner();

      const mockPage = {
        url: () => runner.targetUrl,
        goto: async () => {},
        bringToFront: async () => {},
        frames: () => [],
        waitForTimeout: async () => {},
        locator: () => ({
          first: () => ({
            waitFor: async () => {},
            click: async () => {},
            count: async () => 0,
          }),
          count: async () => 0,
        }),
        waitForResponse: async (predicate: (res: PlaywrightResponse) => boolean) => {
          const mockRes = {
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
            status: () => 500,
            request: () => ({ method: () => 'POST' }),
          } as unknown as PlaywrightResponse;

          if (predicate(mockRes)) {
            return mockRes;
          }
          throw new Error('No matched response');
        },
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();

      await expect(runner.refreshBookOrderList(mockPage as unknown as import('playwright').Page)).rejects.toThrow(
        DutyExecutionError
      );

      try {
        await runner.refreshBookOrderList(mockPage as unknown as import('playwright').Page);
      } catch (err) {
        expect(err).toBeInstanceOf(DutyExecutionError);
        expect((err as DutyExecutionError).errorCode).toBe(DouyinDutyErrorCode.LIST_HTTP_ERROR);
      }

      await runner.stop();
    });

    it('should throw DutyExecutionError when API response text is not valid JSON', async () => {
      const runner = new DouyinDutyRunner();

      const mockPage = {
        url: () => runner.targetUrl,
        goto: async () => {},
        bringToFront: async () => {},
        frames: () => [],
        waitForTimeout: async () => {},
        locator: () => ({
          first: () => ({
            waitFor: async () => {},
            click: async () => {},
            count: async () => 0,
          }),
          count: async () => 0,
        }),
        waitForResponse: async (predicate: (res: PlaywrightResponse) => boolean) => {
          const mockRes = {
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
            status: () => 200,
            request: () => ({ method: () => 'POST' }),
            text: async () => '<html>Gateway Error</html>',
          } as unknown as PlaywrightResponse;

          if (predicate(mockRes)) {
            return mockRes;
          }
          throw new Error('No matched response');
        },
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();

      await expect(runner.collectUnhandledOrders()).rejects.toThrow(
        '响应非合法 JSON'
      );

      await runner.stop();
    });

    it('should refresh list and collect unhandled orders under mutex', async () => {
      const runner = new DouyinDutyRunner();
      let networkCallCount = 0;

      const sampleBookPayload = {
        status_code: 0,
        BaseResp: { StatusCode: 0 },
        data: {
          data: [
            JSON.stringify({
              order_base_info: { order_id: 'DY-COALESCE-1' },
              book_detail_info: { hotel_name: '测试酒店' },
              status_info: { title: '新订' },
            }),
          ],
        },
      };

      const mockPage = {
        url: () => runner.targetUrl,
        goto: async () => {},
        bringToFront: async () => {},
        frames: () => [],
        waitForTimeout: async () => {},
        locator: () => ({
          first: () => ({
            waitFor: async () => {},
            click: async () => {},
            count: async () => 0,
          }),
          count: async () => 0,
        }),
        waitForResponse: async (predicate: (res: PlaywrightResponse) => boolean) => {
          networkCallCount++;
          await new Promise((r) => setTimeout(r, 20));
          const mockRes = {
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
            status: () => 200,
            request: () => ({ method: () => 'POST' }),
            text: async () => JSON.stringify(sampleBookPayload),
          } as unknown as PlaywrightResponse;

          if (predicate(mockRes)) {
            return mockRes;
          }
          throw new Error('No matched response');
        },
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();

      const res = await runner.collectUnhandledOrders(DutyOrderStatus.NEW);

      expect(networkCallCount).toBe(1);
      expect(res).toHaveLength(1);
      expect(res[0].orderId).toBe('DY-COALESCE-1');

      await runner.stop();
    });

    it('should correctly route various task contexts to refund tab', async () => {
      const runner = new DouyinDutyRunner();
      const clickedTabs: string[] = [];

      const sampleRefundPayload = {
        status_code: 0,
        BaseResp: { StatusCode: 0 },
        data: {
          data: [
            JSON.stringify({
              order_base_info: { order_id: 'DY-REFUND-ROUTE-1' },
              book_detail_info: { hotel_name: '测试酒店' },
              status_info: { title: '已取消' },
            }),
          ],
        },
      };

      const mockPage = {
        url: () => runner.targetUrl,
        goto: async () => {},
        bringToFront: async () => {},
        frames: () => [],
        waitForTimeout: async () => {},
        locator: (sel: string) => {
          if (sel.includes('新订/变更')) {
            return {
              first: () => ({
                waitFor: async () => {},
                click: async () => {
                  clickedTabs.push('新订/变更');
                },
              }),
            };
          }
          if (sel.includes('取消/退款')) {
            return {
              first: () => ({
                waitFor: async () => {},
                click: async () => {
                  clickedTabs.push('取消/退款');
                },
              }),
            };
          }
          return {
            first: () => ({
              waitFor: async () => {},
              count: async () => 0,
            }),
            count: async () => 0,
          };
        },
        waitForResponse: async (predicate: (res: PlaywrightResponse) => boolean) => {
          const mockRes = {
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list',
            status: () => 200,
            request: () => ({ method: () => 'POST' }),
            text: async () => JSON.stringify(sampleRefundPayload),
          } as unknown as PlaywrightResponse;

          if (predicate(mockRes)) {
            return mockRes;
          }
          throw new Error('No matched response');
        },
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();

      // Case 1: ParsedDutyTaskContext with orderStatus: DutyOrderStatus.CANCEL
      await runner.collectUnhandledOrders({
        task: {
          id: 't1',
          businessId: 'COLLECT:1',
          businessType: 'OTA_MIGRATION',
          msgType: 'OTA_COLLECT_ORDER',
          stationId: 's1',
          leaseToken: 'token1',
          data: '',
        },
        payload: { cancelOrder: true },
        channelCode: 'DOUYIN',
        businessId: 'COLLECT:1',
        orderStatus: DutyOrderStatus.CANCEL,
      });

      // Case 2: Direct DutyOrderStatus.CANCEL
      await runner.collectUnhandledOrders(DutyOrderStatus.CANCEL);

      expect(clickedTabs).toEqual(['取消/退款', '取消/退款']);

      await runner.stop();
    });

    it('should throw DutyExecutionError when active page is closed', async () => {
      const runner = new DouyinDutyRunner();

      const mockPage = {
        url: () => runner.targetUrl,
        goto: async () => {},
        bringToFront: async () => {},
        frames: () => [],
        waitForTimeout: async () => {},
        isClosed: () => true,
        locator: () => ({
          first: () => ({
            waitFor: async () => {},
            count: async () => 0,
          }),
          count: async () => 0,
        }),
      };

      vi.mocked(createPersistentBrowserSession).mockResolvedValue({
        page: mockPage,
        context: {},
        close: async () => {},
      } as unknown as import('../../../src/crawler/browserManager').BrowserSession);

      await runner.start();

      await expect(runner.collectUnhandledOrders()).rejects.toThrow(
        '抖音浏览器页面已关闭'
      );

      await runner.stop();
    });

    it('should throw RISK_VERIFICATION_REQUIRED when risk verification is triggered in waitForPageReady', async () => {
      const runner = new DouyinDutyRunner();

      const mockPage = {
        url: () => 'https://verify.douyin.com/captcha/verify',
        frames: () => [],
      } as unknown as import('playwright').Page;

      await expect(runner.waitForPageReady(mockPage)).rejects.toThrow(
        '抖音页面提示安全验证或操作频繁'
      );
    });

    it('should throw RUNNER_NOT_RUNNING when operations are called and runner is not running', async () => {
      const runner = new DouyinDutyRunner();

      await expect(runner.inspectOrderDetail('DY-123')).rejects.toThrow('抖音值守执行器未运行，无法查看订单详情');
      await expect(runner.confirmImport?.('CN-123', 'DY-123')).rejects.toThrow('抖音值守执行器未运行，无法回填确认号');
      await expect(runner.confirmCancel?.('DY-123')).rejects.toThrow('抖音值守执行器未运行，无法确认取消');
    });
  });
});
