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
      waitForResponse: vi.fn().mockReturnValue(new Promise(() => {})),
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
    expect(mockPage.waitForResponse).toHaveBeenCalled();
  });

  it('should return captured order detail when card is located and detail response is received', async () => {
    const inspector = new DouyinDetailInspector();

    const mockRawData = {
      order_base_info: { order_id: '1113572432327416823' },
      book_detail_info: { hotel_name: '淮安日月洲度假村' },
    };
    const mockPayload = { data: { data: JSON.stringify(mockRawData) } };

    const mockResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1113572432327416823',
      text: async () => JSON.stringify(mockPayload),
      request: () => ({ method: () => 'POST' }),
    };

    let resolveResponse: (res: typeof mockResponse) => void;
    const responsePromise = new Promise<typeof mockResponse>((resolve) => {
      resolveResponse = resolve;
    });

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockImplementation(async () => {
        resolveResponse(mockResponse);
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
      waitForResponse: vi.fn(async (predicate: (res: typeof mockResponse) => boolean) => {
        const res = await responsePromise;
        expect(predicate(res)).toBe(true);
        return res;
      }),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1113572432327416823', {
      refreshOrderList: vi.fn(),
    });

    expect(result).toEqual(mockPayload);
    expect(mockCard.click).toHaveBeenCalled();
    expect(mockPage.waitForResponse).toHaveBeenCalled();
  });

  it('should throw ORDER_DETAIL_TIMEOUT when card is located but network response times out', async () => {
    const inspector = new DouyinDetailInspector();

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
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
      waitForResponse: vi.fn().mockRejectedValue(new Error('Timeout 30000ms exceeded')),
    } as unknown as Page;

    await expect(
      inspector.inspectOrderDetail(mockPage, 'DY-TIMEOUT-999', {
        refreshOrderList: vi.fn(),
      })
    ).rejects.toMatchObject({
      errorCode: DouyinDutyErrorCode.ORDER_DETAIL_TIMEOUT,
      retryable: true,
    });

    expect(mockCard.click).toHaveBeenCalled();
    expect(mockPage.waitForResponse).toHaveBeenCalled();
  });

  it('should capture and return full raw network payload without premature domain parsing', async () => {
    const inspector = new DouyinDetailInspector();
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

    const mockResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1112769276121338025',
      text: async () => JSON.stringify(fullListPayload),
      request: () => ({ method: () => 'POST' }),
    };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
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
      waitForResponse: vi.fn(async (predicate: (res: typeof mockResponse) => boolean) => {
        expect(predicate(mockResponse)).toBe(true);
        return mockResponse;
      }),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1112769276121338025', {
      refreshOrderList: vi.fn(),
    });
    expect(result).not.toBeNull();
    expect(result).toEqual(fullListPayload);
    expect(mockCard.click).toHaveBeenCalled();
  });

  it('should locate element and intercept get_secret_num response when phone is masked', async () => {
    const inspector = new DouyinDetailInspector();

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

    const mockDetailResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1112769276121338025',
      text: async () => JSON.stringify(mockPayload),
      request: () => ({ method: () => 'POST' }),
    };

    const mockSecretNumResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/common/get_secret_num?root_life_account_id=7063009395525584896',
      text: async () => JSON.stringify({
        status_code: 0,
        status_msg: '',
        secret_nums: {
          CIPHERTEXT_123: {
            phone: '15782987061转3308',
            show_type: 1,
          },
        },
      }),
      request: () => ({ method: () => 'GET' }),
    };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const mockRevealBtn = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
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
        if (sel.includes('hideStroke') || sel.includes('M4.385') || sel.includes('SecretNumV2')) {
          return {
            first: () => mockRevealBtn,
            last: () => mockRevealBtn,
          };
        }
        return {
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          count: vi.fn().mockResolvedValue(0),
        };
      }),
      waitForResponse: vi.fn(async (predicate: (res: unknown) => boolean) => {
        if (predicate(mockDetailResponse)) {
          return mockDetailResponse;
        }
        if (predicate(mockSecretNumResponse)) {
          return mockSecretNumResponse;
        }
        throw new Error('Unexpected response predicate');
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1112769276121338025', {
      refreshOrderList: vi.fn(),
    });

    expect(mockRevealBtn.click).toHaveBeenCalled();
    expect(result.decryptedPhone).toBe('15782987061转3308');
    const innerData = JSON.parse((result.data as { data: string }).data);
    expect(innerData.guest_info.user_list[0].phone).toBe('15782987061转3308');
  });

  it('should capture order detail via waitForResponse when network latency is simulated', async () => {
    const inspector = new DouyinDetailInspector();

    const mockRawData = {
      order_base_info: { order_id: '1113572432327416999' },
      book_detail_info: { hotel_name: '常州嬉戏谷度假酒店' },
    };
    const mockPayload = { data: { data: JSON.stringify(mockRawData) } };

    const mockResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail',
      text: async () => JSON.stringify(mockPayload),
      request: () => ({ method: () => 'POST' }),
    };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
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
      waitForResponse: vi.fn(async (predicate: (res: typeof mockResponse) => boolean) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(predicate(mockResponse)).toBe(true);
        return mockResponse;
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
    };

    const mockErrorRes = {
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail',
      status: () => 500,
      request: () => ({ method: () => 'POST' }),
      text: async () => 'Internal Server Error',
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
      waitForResponse: vi.fn(async (predicate: (res: typeof mockErrorRes) => boolean) => {
        expect(predicate(mockErrorRes)).toBe(true);
        return mockErrorRes;
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
    };

    const mockResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail',
      text: async () => JSON.stringify({ status_code: 10001, status_msg: '登录态失效，请重新登录' }),
      request: () => ({ method: () => 'POST' }),
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
      waitForResponse: vi.fn(async (predicate: (res: typeof mockResponse) => boolean) => {
        expect(predicate(mockResponse)).toBe(true);
        return mockResponse;
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

    const mockRawData = {
      order_base_info: { order_id: '1113572432327416888' },
      book_detail_info: { hotel_name: '测试度假酒店' },
    };
    const mockPayload = { data: { data: JSON.stringify(mockRawData) } };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
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
    expect(mockCard.click).toHaveBeenCalled();
    expect(mockPage.waitForResponse).toHaveBeenCalled();
  });
});
