import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import { DouyinDetailInspector } from '@/src/crawler/duty/channels/douyin/douyinDetailInspector';
import { DouyinDutyErrorCode } from '@/src/crawler/duty/channels/douyin/douyinDutyContracts';

describe('DouyinDetailInspector (Single Responsibility & Benchmark against Meituan)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw ORDER_CARD_NOT_FOUND when card is not found even after list refresh', async () => {
    const inspector = new DouyinDetailInspector();

    const mockRefreshList = vi.fn().mockResolvedValue([]);
    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(0),
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
        last: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page;

    await expect(
      inspector.inspectOrderDetail(mockPage, 'DY-NOT-FOUND-888', {
        refreshOrderList: mockRefreshList,
      })
    ).rejects.toMatchObject({
      errorCode: DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
      retryable: false,
    });

    expect(mockRefreshList).toHaveBeenCalled();
  });

  it('should return captured order detail when card is located and detail response is received', async () => {
    const inspector = new DouyinDetailInspector();
    let responseCallback: ((res: unknown) => Promise<void>) | null = null;

    const mockRawData = {
      order_base_info: { order_id: '1113572432327416823' },
      book_detail_info: { hotel_name: '淮安日月洲度假村' },
    };
    const mockPayload = { data: { data: JSON.stringify(mockRawData) } };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockImplementation(async () => {
        if (responseCallback) {
          await responseCallback({
            status: () => 200,
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1113572432327416823',
            text: async () => JSON.stringify(mockPayload),
          });
        }
      }),
      locator: vi.fn().mockReturnValue({
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn((sel: string) => {
        if (sel.includes('.byted-modal')) {
          return { count: vi.fn().mockResolvedValue(0) };
        }
        if (sel.includes('1113572432327416823')) {
          return {
            first: () => mockCard,
            last: () => mockCard,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      on: vi.fn((event: string, handler: (res: unknown) => Promise<void>) => {
        if (event === 'response') {
          responseCallback = handler;
        }
      }),
      off: vi.fn(),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1113572432327416823', {
      refreshOrderList: vi.fn(),
    });

    expect(result).toEqual(mockPayload);
    expect(mockCard.click).toHaveBeenCalled();
  });

  it('should throw ORDER_DETAIL_TIMEOUT when card is located but network response times out', async () => {
    const inspector = new DouyinDetailInspector();

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn((sel: string) => {
        if (sel.includes('.byted-modal')) {
          return { count: vi.fn().mockResolvedValue(0) };
        }
        if (sel.includes('DY-TIMEOUT-999')) {
          return {
            first: () => mockCard,
            last: () => mockCard,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page;

    await expect(
      inspector.inspectOrderDetail(mockPage, 'DY-TIMEOUT-999', {
        refreshOrderList: vi.fn(),
      })
    ).rejects.toMatchObject({
      errorCode: DouyinDutyErrorCode.ORDER_DETAIL_TIMEOUT,
      retryable: true,
    });
  });

  it('should capture and return full raw network payload without premature domain parsing', async () => {
    const inspector = new DouyinDetailInspector();
    let responseCallback: ((res: unknown) => Promise<void>) | null = null;
    const fullListPayload = {
      status_code: 0,
      status_msg: '',
      data: {
        count: 1,
        data: [
          JSON.stringify({
            order_base_info: { order_id: '1112769276121338025' },
            book_detail_info: { book_id: '800000449770071274116238025', hotel_name: '测试酒店' },
            sale_product_info: { physical_room_name: '海洋房' },
          }),
        ],
      },
    };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockImplementation(async () => {
        if (responseCallback) {
          await responseCallback({
            status: () => 200,
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1112769276121338025',
            text: async () => JSON.stringify(fullListPayload),
            request: () => ({ method: () => 'POST' }),
          });
        }
      }),
      locator: vi.fn().mockReturnValue({
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn((sel: string) => {
        if (sel.includes('.byted-modal')) {
          return { count: vi.fn().mockResolvedValue(0) };
        }
        if (sel.includes('1112769276121338025')) {
          return {
            first: () => mockCard,
            last: () => mockCard,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      on: vi.fn((event: string, handler: (res: unknown) => Promise<void>) => {
        if (event === 'response') {
          responseCallback = handler;
        }
      }),
      off: vi.fn(),
    } as unknown as Page;

    // 触发检查，并在卡片展开点击时触发模拟网络返回完整的列表响应
    const result = await inspector.inspectOrderDetail(mockPage, '1112769276121338025', {
      refreshOrderList: vi.fn(),
    });
    expect(result).not.toBeNull();
    // 关键断言：单一职责——拦截器忠实返回原始网络报文，解包与协议清洗归属于下游清洗层
    expect(result).toEqual(fullListPayload);
  });

  it('should decrypt guest phone when phone_ciphertext is present and phone is masked', async () => {
    const inspector = new DouyinDetailInspector();
    let responseCallback: ((res: unknown) => Promise<void>) | null = null;

    const mockRawWithCipher = {
      order_base_info: { order_id: '1112769276121338025' },
      book_detail_info: { hotel_name: '测试酒店' },
      guest_info: {
        user_list: [
          { name: '张三', phone: '*******5678', phone_ciphertext: 'CIPHERTEXT_123' },
        ],
      },
    };
    const mockPayload = { data: { data: JSON.stringify(mockRawWithCipher) } };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockImplementation(async () => {
        if (responseCallback) {
          await responseCallback({
            status: () => 200,
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1112769276121338025',
            text: async () => JSON.stringify(mockPayload),
          });
        }
      }),
      locator: vi.fn().mockReturnValue({
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
    };

    const mockEvaluate = vi.fn().mockImplementation(async (fn: unknown, _arg: unknown) => {
      if (typeof fn === 'function') {
        return '13812345678';
      }
      return false;
    });

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: mockEvaluate,
      locator: vi.fn((sel: string) => {
        if (sel.includes('.byted-modal')) {
          return { count: vi.fn().mockResolvedValue(0) };
        }
        if (sel.includes('1112769276121338025')) {
          return {
            first: () => mockCard,
            last: () => mockCard,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      on: vi.fn((event: string, handler: (res: unknown) => Promise<void>) => {
        if (event === 'response') {
          responseCallback = handler;
        }
      }),
      off: vi.fn(),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1112769276121338025', {
      refreshOrderList: vi.fn(),
    });

    expect(mockEvaluate).toHaveBeenCalled();
    expect(result.decryptedPhone).toBe('13812345678');
  });

  it('should capture order detail via waitForResponse when network latency is simulated', async () => {
    const inspector = new DouyinDetailInspector();

    const mockRawData = {
      order_base_info: { order_id: '1113572432327416999' },
      book_detail_info: { hotel_name: '常州嬉戏谷度假酒店' },
    };
    const mockPayload = { data: { data: JSON.stringify(mockRawData) } };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn((sel: string) => {
        if (sel.includes('.byted-modal')) {
          return { count: vi.fn().mockResolvedValue(0) };
        }
        if (sel.includes('1113572432327416999')) {
          return {
            first: () => mockCard,
            last: () => mockCard,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      on: vi.fn(),
      off: vi.fn(),
      waitForResponse: vi.fn().mockResolvedValue({
        status: () => 200,
        url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail',
        text: async () => JSON.stringify(mockPayload),
      }),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1113572432327416999', {
      refreshOrderList: vi.fn(),
    });

    expect(result).toEqual(mockPayload);
    expect(mockCard.click).toHaveBeenCalled();
    expect(mockPage.waitForResponse).toHaveBeenCalled();
  });

  it('should include HTTP status in error diagnosis when detail response returns non-200', async () => {
    const inspector = new DouyinDetailInspector();

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn((sel: string) => {
        if (sel.includes('.byted-modal')) {
          return { count: vi.fn().mockResolvedValue(0) };
        }
        if (sel.includes('1113572432327416500')) {
          return {
            first: () => mockCard,
            last: () => mockCard,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      on: vi.fn(),
      off: vi.fn(),
      waitForResponse: vi.fn(async (predicate: (res: { url: () => string; status: () => number }) => boolean) => {
        const mockErrorRes = {
          url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail',
          status: () => 500,
        };
        predicate(mockErrorRes);
        throw new Error('Timeout 8000ms');
      }),
    } as unknown as Page;

    await expect(
      inspector.inspectOrderDetail(mockPage, '1113572432327416500', {
        refreshOrderList: vi.fn(),
      })
    ).rejects.toThrow('详情接口返回异常 HTTP 状态码: 500');
  });

  it('should include business error in error diagnosis when detail response returns non-zero status_code', async () => {
    const inspector = new DouyinDetailInspector();

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn((sel: string) => {
        if (sel.includes('.byted-modal')) {
          return { count: vi.fn().mockResolvedValue(0) };
        }
        if (sel.includes('1113572432327416403')) {
          return {
            first: () => mockCard,
            last: () => mockCard,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      on: vi.fn(),
      off: vi.fn(),
      waitForResponse: vi.fn().mockResolvedValue({
        status: () => 200,
        url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail',
        text: async () => JSON.stringify({ status_code: 10001, status_msg: '登录态失效，请重新登录' }),
      }),
    } as unknown as Page;

    await expect(
      inspector.inspectOrderDetail(mockPage, '1113572432327416403', {
        refreshOrderList: vi.fn(),
      })
    ).rejects.toThrow('详情接口返回业务错误 (code: 10001, msg: 登录态失效，请重新登录)');
  });

  it('should ignore OPTIONS preflight response and capture subsequent POST response', async () => {
    const inspector = new DouyinDetailInspector();
    let responseCallback: ((res: unknown) => Promise<void>) | null = null;

    const mockRawData = {
      order_base_info: { order_id: '1113572432327416888' },
      book_detail_info: { hotel_name: '测试度假酒店' },
    };
    const mockPayload = { data: { data: JSON.stringify(mockRawData) } };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockImplementation(async () => {
        if (responseCallback) {
          // 1. 模拟浏览器首先触发了 OPTIONS 预检请求（状态 200，内容为空）
          await responseCallback({
            status: () => 200,
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1113572432327416888',
            text: async () => '',
            request: () => ({ method: () => 'OPTIONS' }),
          });

          // 2. 紧接着触发了真实的 POST 业务请求（状态 200，内容完整）
          await responseCallback({
            status: () => 200,
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1113572432327416888',
            text: async () => JSON.stringify(mockPayload),
            request: () => ({ method: () => 'POST' }),
          });
        }
      }),
      locator: vi.fn().mockReturnValue({
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      }),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      locator: vi.fn((sel: string) => {
        if (sel.includes('.byted-modal')) {
          return { count: vi.fn().mockResolvedValue(0) };
        }
        if (sel.includes('1113572432327416888')) {
          return {
            first: () => mockCard,
            last: () => mockCard,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      on: vi.fn((event: string, handler: (res: unknown) => Promise<void>) => {
        if (event === 'response') {
          responseCallback = handler;
        }
      }),
      off: vi.fn(),
      // 测试 waitForResponse 过滤断言
      waitForResponse: vi.fn(async (predicate: (res: unknown) => boolean) => {
        const mockOptionsRes = {
          url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1113572432327416888',
          status: () => 200,
          text: async () => '',
          request: () => ({ method: () => 'OPTIONS' }),
        };
        const mockPostRes = {
          url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1113572432327416888',
          status: () => 200,
          text: async () => JSON.stringify(mockPayload),
          request: () => ({ method: () => 'POST' }),
        };

        // predicate 必须判定 OPTIONS 为 false，POST 为 true
        expect(predicate(mockOptionsRes)).toBe(false);
        expect(predicate(mockPostRes)).toBe(true);

        return mockPostRes;
      }),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1113572432327416888', {
      refreshOrderList: vi.fn(),
    });

    expect(result).toEqual(mockPayload);
  });
});
