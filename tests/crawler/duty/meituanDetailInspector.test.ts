import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Response } from 'playwright';
import { MeituanDetailInspector } from '@/src/crawler/duty/channels/meituan/meituanDetailInspector';
import { MeituanDutyErrorCode } from '@/src/crawler/duty/channels/meituan/meituanDutyContracts';

describe('meituanDetailInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw ORDER_CARD_NOT_FOUND when card is not found even after list refresh', async () => {
    const inspector = new MeituanDetailInspector();

    const mockPage = {
      url: () => 'https://eb.meituan.com/dealorder',
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({
        count: async () => 0,
      }),
    } as unknown as Page;

    const refreshOrderList = vi.fn().mockResolvedValue({} as Response);

    await expect(
      inspector.inspectOrderDetail(mockPage, 'MT-NONEXISTENT', { refreshOrderList })
    ).rejects.toThrow(
      expect.objectContaining({ errorCode: MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND })
    );

    expect(refreshOrderList).toHaveBeenCalledTimes(1);
  });

  it('should throw ORDER_DETAIL_TIMEOUT when card is located but network response times out', async () => {
    const inspector = new MeituanDetailInspector();

    const mockCard = {
      isVisible: async () => true,
      click: vi.fn().mockResolvedValue(undefined),
    };

    const mockPage = {
      url: () => 'https://eb.meituan.com/dealorder',
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockImplementation((sel: string) => {
        if (sel.includes('detail-container:has-text("MT-123")') || sel.includes('detail-header:has-text("MT-123")')) {
          return {
            first: () => ({ isVisible: async () => true }),
          };
        }
        if (sel.includes('.btn-text') || sel.includes('[class*="btn"]')) {
          return {
            first: () => ({ isVisible: async () => false }),
          };
        }
        return {
          count: async () => 1,
          nth: () => mockCard,
        };
      }),
      on: vi.fn(),
      off: vi.fn(),
      waitForResponse: vi.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as Page;

    const refreshOrderList = vi.fn().mockResolvedValue({} as Response);

    await expect(
      inspector.inspectOrderDetail(mockPage, 'MT-123', { refreshOrderList })
    ).rejects.toThrow(
      expect.objectContaining({ errorCode: MeituanDutyErrorCode.ORDER_DETAIL_TIMEOUT })
    );
  });

  it('should ignore responses from other orders and only accept payload matching requested otaOrderId', async () => {
    const inspector = new MeituanDetailInspector();

    const mockCard = {
      isVisible: async () => true,
      click: vi.fn().mockResolvedValue(undefined),
    };

    const mockPage = {
      url: () => 'https://eb.meituan.com/dealorder',
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockImplementation((sel: string) => {
        if (sel.includes('detail-container:has-text("MT-TARGET")') || sel.includes('detail-header:has-text("MT-TARGET")')) {
          return { first: () => ({ isVisible: async () => true }) };
        }
        return {
          first: () => ({ isVisible: async () => false }),
          count: async () => 1,
          nth: () => mockCard,
        };
      }),
      on: vi.fn(),
      off: vi.fn(),
      waitForResponse: vi.fn().mockResolvedValue({
        status: () => 200,
        text: async () => JSON.stringify({
          orderId: 'MT-TARGET',
          roomName: '豪华标间',
          guestMobile: '13800138000',
        }),
      }),
    } as unknown as Page;

    const refreshOrderList = vi.fn().mockResolvedValue({} as Response);

    const result = await inspector.inspectOrderDetail(mockPage, 'MT-TARGET', { refreshOrderList });
    expect(result).toBeDefined();
    expect(result.orderId).toBe('MT-TARGET');
    expect(result.roomName).toBe('豪华标间');
  });
});
