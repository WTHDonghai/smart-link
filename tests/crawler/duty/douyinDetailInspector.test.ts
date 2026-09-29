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

  it('should return cached raw detail when card is located and cached detail is available', async () => {
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
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page;

    const mockRawData = {
      order_base_info: { order_id: '1113572432327416823' },
      book_detail_info: { hotel_name: '淮安日月洲度假村' },
    };

    const result = await inspector.inspectOrderDetail(mockPage, '1113572432327416823', {
      refreshOrderList: vi.fn(),
      getCachedOrderRaw: () => mockRawData,
    });

    expect(result).toBe(mockRawData);
    expect(mockCard.click).toHaveBeenCalled();
  });

  it('should throw ORDER_DETAIL_TIMEOUT when card is located but network response times out and no cached raw exists', async () => {
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
        getCachedOrderRaw: () => null,
      })
    ).rejects.toMatchObject({
      errorCode: DouyinDutyErrorCode.ORDER_DETAIL_TIMEOUT,
      retryable: true,
    });
  });

  it('should unwrap and return single order entity when network response emits full list payload', async () => {
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
            url: () => 'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
            text: async () => JSON.stringify(fullListPayload),
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
      getCachedOrderRaw: () => null,
    });
    expect(result).not.toBeNull();
    // 关键断言：结果必须是单条订单实体，绝不能是外层包装对象！
    expect(result.data).toBeUndefined();
    expect((result.order_base_info as Record<string, unknown>).order_id).toBe('1112769276121338025');
    expect((result.book_detail_info as Record<string, unknown>).book_id).toBe('800000449770071274116238025');
  });

  it('should decrypt guest phone when phone_ciphertext is present and phone is masked', async () => {
    const inspector = new DouyinDetailInspector();

    const mockCard = {
      isVisible: vi.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
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
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Page;

    const mockRawWithCipher = {
      order_base_info: { order_id: '1112769276121338025' },
      book_detail_info: { hotel_name: '测试酒店' },
      guest_info: {
        user_list: [
          { name: '张三', phone: '*******5678', phone_ciphertext: 'CIPHERTEXT_123' },
        ],
      },
    };

    const result = await inspector.inspectOrderDetail(mockPage, '1112769276121338025', {
      refreshOrderList: vi.fn(),
      getCachedOrderRaw: () => mockRawWithCipher,
    });

    expect(mockEvaluate).toHaveBeenCalled();
    const guest = (result.guest_info as { user_list: Array<{ phone: string }> }).user_list[0];
    expect(guest.phone).toBe('13812345678');
  });
});
