import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import {
  getMeituanOrderScope,
  locateMeituanOrderCard,
} from '@/src/crawler/duty/channels/meituan/meituanCardLocator';

describe('meituanCardLocator', () => {
  describe('getMeituanOrderScope', () => {
    it('should return frameLocator when page is inside merchant shell iframe', () => {
      const mockFrameLocator = { locator: vi.fn() };
      const mockPage = {
        url: () => 'https://eb.meituan.com/ebooking/merchant/ebIframe?target=dealorder',
        frameLocator: vi.fn().mockReturnValue(mockFrameLocator),
      } as unknown as Page;

      const scope = getMeituanOrderScope(mockPage);
      expect(mockPage.frameLocator).toHaveBeenCalledWith('#me-iframe-container');
      expect(scope).toBe(mockFrameLocator);
    });

    it('should return page itself when not inside iframe', () => {
      const mockPage = {
        url: () => 'https://eb.meituan.com/ebooking/merchant/dealorder',
      } as unknown as Page;

      const scope = getMeituanOrderScope(mockPage);
      expect(scope).toBe(mockPage);
    });
  });

  describe('locateMeituanOrderCard', () => {
    it('should return null immediately when otaOrderId is empty or whitespace', async () => {
      const mockScope = { locator: vi.fn() } as unknown as Page;
      const mockPage = {} as Page;

      expect(await locateMeituanOrderCard(mockPage, mockScope, '')).toBeNull();
      expect(await locateMeituanOrderCard(mockPage, mockScope, '   ')).toBeNull();
      expect(mockScope.locator).not.toHaveBeenCalled();
    });

    it('should return null when item count is 0', async () => {
      const mockScope = {
        locator: vi.fn().mockReturnValue({
          count: async () => 0,
        }),
      } as unknown as Page;
      const mockPage = {
        locator: vi.fn().mockReturnValue({ count: async () => 0 }),
      } as unknown as Page;

      const result = await locateMeituanOrderCard(mockPage, mockScope, 'MT-12345');
      expect(result).toBeNull();
    });

    it('should return matched candidate locator when detail matches target orderId', async () => {
      const mockCandidate = {
        isVisible: async () => true,
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockScope = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel.includes('.detail-container:has-text("MT-12345")')) {
            return {
              first: () => ({
                isVisible: async () => true,
              }),
            };
          }
          return {
            count: async () => 1,
            nth: () => mockCandidate,
          };
        }),
      } as unknown as Page;

      const mockPage = {
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue({ count: async () => 0 }),
      } as unknown as Page;

      const result = await locateMeituanOrderCard(mockPage, mockScope, 'MT-12345');
      expect(result).toBe(mockCandidate);
      expect(mockCandidate.click).toHaveBeenCalled();
    });

    it('should return null when candidates exist but none match target orderId', async () => {
      const mockCandidate = {
        isVisible: async () => true,
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockScope = {
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel.includes('.detail-container:has-text("MT-99999")')) {
            return {
              first: () => ({
                isVisible: async () => false,
              }),
            };
          }
          return {
            count: async () => 1,
            nth: () => mockCandidate,
          };
        }),
      } as unknown as Page;

      const mockPage = {
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue({ count: async () => 0 }),
      } as unknown as Page;

      const result = await locateMeituanOrderCard(mockPage, mockScope, 'MT-99999');
      expect(result).toBeNull();
    });
  });
});
