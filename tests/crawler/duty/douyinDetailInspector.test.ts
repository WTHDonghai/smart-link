import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import { DouyinDetailInspector } from '@/src/crawler/duty/channels/douyin/douyinDetailInspector';
import { DouyinDutyErrorCode } from '@/src/crawler/duty/channels/douyin/douyinDutyContracts';
import { logger } from '@/src/services/logger';

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

  it('真实事故回归：先到达的非目标订单详情响应应被丢弃，继续等待目标单号响应后成功解析', async () => {
    const inspector = new DouyinDetailInspector();

    const targetOrderId = '1114091864839417197';
    const staleRawData = {
      order_base_info: { order_id: '1118500327345300277' },
      book_detail_info: { hotel_name: '其他订单酒店' },
    };
    const targetRawData = {
      order_base_info: { order_id: targetOrderId },
      book_detail_info: { hotel_name: '淮安日月洲度假村' },
    };

    const staleResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1118500327345300277',
      text: async () => JSON.stringify({ data: { data: JSON.stringify(staleRawData) } }),
      request: () => ({ method: () => 'POST' }),
    };
    const targetResponse = {
      status: () => 200,
      url: () => `https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=${targetOrderId}`,
      text: async () => JSON.stringify({ data: { data: JSON.stringify(targetRawData) } }),
      request: () => ({ method: () => 'POST' }),
    };

    // 第一次捕获到非目标订单的在途响应，第二次才等到目标单号响应
    const waitForResponse = vi
      .fn()
      .mockResolvedValueOnce(staleResponse as unknown as never)
      .mockResolvedValueOnce(targetResponse as unknown as never);

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
        if (sel.includes(targetOrderId)) {
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
      waitForResponse,
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, targetOrderId, {
      refreshOrderList: vi.fn(),
    });

    // 非目标响应被丢弃后，最终以目标单号报文成功解析
    expect(waitForResponse).toHaveBeenCalledTimes(2);
    expect((result as { data?: { data?: string } }).data?.data).toContain(targetOrderId);
    expect(mockCard.click).toHaveBeenCalled();
  });

  it('仅存在非目标订单响应且等待耗尽时，应报 ORDER_DETAIL_TIMEOUT 且可重试（而非终态 FIELD_MISSING）', async () => {
    const inspector = new DouyinDetailInspector();

    const targetOrderId = 'DY-STALE-ONLY-001';
    const staleResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=999',
      text: async () => JSON.stringify({ data: { data: JSON.stringify({ order_base_info: { order_id: '999' } }) } }),
      request: () => ({ method: () => 'POST' }),
    };

    // 第一次返回非目标响应，第二次等待超时
    const waitForResponse = vi
      .fn()
      .mockResolvedValueOnce(staleResponse as unknown as never)
      .mockRejectedValueOnce(new Error('Timeout 15000ms exceeded'));

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
        if (sel.includes(targetOrderId)) {
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
      waitForResponse,
    } as unknown as Page;

    await expect(
      inspector.inspectOrderDetail(mockPage, targetOrderId, {
        refreshOrderList: vi.fn(),
      })
    ).rejects.toMatchObject({
      errorCode: DouyinDutyErrorCode.ORDER_DETAIL_TIMEOUT,
      retryable: true,
    });

    expect(waitForResponse).toHaveBeenCalledTimes(2);
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

  it('should click copy button and collect real phone across two get_secret_num calls (first empty)', async () => {
    const inspector = new DouyinDetailInspector();

    const mockRawWithCipher = {
      order_base_info: { order_id: '1112769276121338025' },
      book_detail_info: { hotel_name: '测试酒店' },
      guest_info: {
        buyer: { name: ' ', phone: '', phone_ciphertext: 'CIPHERTEXT_BUYER' },
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

    // 实测结论 (docs/channels/douyin/02-order-api-spec.md §4.2)：
    // 点击「一键复制」后 get_secret_num 连续调用两次，首次 secret_nums 为空，仅第二次携带真实手机号
    const secretUrl = 'https://life.douyin.com/life/trade_view/v1/common/get_secret_num?root_life_account_id=7063009395525584896';
    const mockSecretEmptyResponse = {
      status: () => 200,
      url: () => secretUrl,
      text: async () => JSON.stringify({ status_code: 0, status_msg: '', secret_nums: {} }),
      request: () => ({ method: () => 'GET' }),
    };
    const mockSecretRealResponse = {
      status: () => 200,
      url: () => secretUrl,
      text: async () => JSON.stringify({
        BaseResp: { StatusCode: 0, StatusMessage: '' },
        status_code: 0,
        status_msg: '',
        secret_nums: {
          CIPHERTEXT_123: { phone: '18082151396', show_type: 2 },
        },
      }),
      request: () => ({ method: () => 'GET' }),
    };

    let secretCallCount = 0;

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const mockCopyBtn = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
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
        if (sel.includes('一键复制')) {
          return {
            first: () => mockCopyBtn,
            last: () => mockCopyBtn,
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
        if (predicate(mockSecretEmptyResponse)) {
          secretCallCount += 1;
          return secretCallCount === 1 ? mockSecretEmptyResponse : mockSecretRealResponse;
        }
        throw new Error('Unexpected response predicate');
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1112769276121338025', {
      refreshOrderList: vi.fn(),
    });

    // 点击的是「一键复制」按钮而非已废弃的电话图标通道
    expect(mockCopyBtn.click).toHaveBeenCalled();
    // 循环收集确实消费了两次接口响应（首次空、二次真实号）
    expect(secretCallCount).toBe(2);
    // 真实手机号注入根级与嵌套结构（生产详情报文的 guest_info 位于嵌套 data.data 字符串内）
    expect(result.decryptedPhone).toBe('18082151396');
    const innerData = JSON.parse((result.data as { data: string }).data);
    expect(innerData.guest_info.user_list[0].phone).toBe('18082151396');
    expect(innerData.guest_info.buyer.phone).toBe('18082151396');
  });

  it('get_secret_num 响应体读取失败时应 Fail-Fast 上抛外层告警并按空值策略返回原始详情（禁止吞为空串续等）', async () => {
    const inspector = new DouyinDetailInspector();
    const warnSpy = vi.spyOn(logger, 'warn');

    const mockRawWithCipher = {
      order_base_info: { order_id: '1112769276121338025' },
      book_detail_info: { hotel_name: '测试酒店' },
      guest_info: {
        buyer: { name: ' ', phone: '', phone_ciphertext: 'CIPHERTEXT_BUYER' },
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

    // 模拟底层网络层响应体读取失败（如连接中断），读取异常必须显式暴露而非兜底为空串继续等待
    const secretUrl = 'https://life.douyin.com/life/trade_view/v1/common/get_secret_num?root_life_account_id=7063009395525584896';
    const mockSecretReadFailResponse = {
      status: () => 200,
      url: () => secretUrl,
      text: async () => {
        throw new Error('Response body is unavailable');
      },
      request: () => ({ method: () => 'GET' }),
    };

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const mockCopyBtn = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const mockPage = {
      url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      frames: () => [],
      evaluate: vi.fn().mockResolvedValue(false),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
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
        if (sel.includes('一键复制')) {
          return {
            first: () => mockCopyBtn,
            last: () => mockCopyBtn,
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
        return mockSecretReadFailResponse;
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1112769276121338025', {
      refreshOrderList: vi.fn(),
    });

    // 读取失败被显式上抛到外层异常路径告警（携带失败原因），而非吞掉后续等
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('读取真实手机号接口响应体失败: Response body is unavailable'),
      expect.objectContaining({ orderNo: '1112769276121338025' })
    );
    // 按空值策略返回原始详情：未注入 decryptedPhone，联系人保持脱敏原样
    expect(result.decryptedPhone).toBeUndefined();
    const innerData = JSON.parse((result.data as { data: string }).data);
    expect(innerData.guest_info.user_list[0].phone).toBe('*******5678');
  });

  it('should return detail unchanged when copy button is absent (phone stays empty by protocol policy)', async () => {
    const inspector = new DouyinDetailInspector();

    const mockRawData = {
      order_base_info: { order_id: '1112769276121338025' },
      guest_info: { user_list: [{ name: '张三', phone: '*******5678' }] },
    };
    const mockPayload = { data: { data: JSON.stringify(mockRawData) } };

    const mockDetailResponse = {
      status: () => 200,
      url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?order_id=1112769276121338025',
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
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
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
      waitForResponse: vi.fn(async (predicate: (res: unknown) => boolean) => {
        if (predicate(mockDetailResponse)) {
          return mockDetailResponse;
        }
        throw new Error('Unexpected response predicate');
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page;

    const result = await inspector.inspectOrderDetail(mockPage, '1112769276121338025', {
      refreshOrderList: vi.fn(),
    });

    // 无「一键复制」入口：不注入 decryptedPhone，联系电话由协议层按空值策略置空
    expect(result.decryptedPhone).toBeUndefined();
    const innerData = JSON.parse((result.data as { data: string }).data);
    expect(innerData.guest_info.user_list[0].phone).toBe('*******5678');
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
