import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Locator } from 'playwright';
import {
  getDouyinOrderScope,
  locateDouyinOrderCard,
  buildDouyinOrderCardSelector,
} from '@/src/crawler/duty/channels/douyin/douyinCardLocator';

describe('douyinCardLocator (Deterministic Card Locator against Production DOM)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDouyinOrderScope', () => {
    it('should return page itself for douyin fulfillment workbench', () => {
      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
      } as unknown as Page;

      const scope = getDouyinOrderScope(mockPage);
      expect(scope).toBe(mockPage);
    });
  });

  describe('buildDouyinOrderCardSelector', () => {
    it('should generate deterministic selectors based on production data-form-insight-meta and aria-label', () => {
      const selector = buildDouyinOrderCardSelector('1114424063142778025');
      expect(selector).toContain('.hotel-book-list-order-card[data-form-insight-meta="1114424063142778025"]');
      expect(selector).toContain('.hotel-book-list-order-card[aria-label="1114424063142778025"]');
      expect(selector).toContain('[data-form-insight-meta="1114424063142778025"]');
      // 核心断言：绝对杜绝臆造属性与失效的 :has-text() 文本伪类
      expect(selector).not.toContain(':has-text(');
      expect(selector).not.toContain('smart-link');
      expect(selector).not.toContain('table-row');
    });
  });

  describe('locateDouyinOrderCard', () => {
    it('should return null when orderId is empty or whitespace', async () => {
      const mockPage = {
        locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      } as unknown as Page;

      expect(await locateDouyinOrderCard(mockPage, mockPage, '')).toBeNull();
      expect(await locateDouyinOrderCard(mockPage, mockPage, '   ')).toBeNull();
    });

    it('should locate card directly by deterministic attribute selectors and scroll into view', async () => {
      const mockScroll = vi.fn().mockResolvedValue(undefined);
      const mockCard = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: mockScroll,
      } as unknown as Locator;

      const mockScope = {
        locator: vi.fn((sel: string) => {
          if (sel.includes('.byted-modal')) {
            return { count: vi.fn().mockResolvedValue(0) };
          }
          if (sel.includes('1113572432327416823')) {
            return {
              first: () => mockCard,
            };
          }
          return {
            count: vi.fn().mockResolvedValue(0),
            first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
          };
        }),
      } as unknown as Page;

      const result = await locateDouyinOrderCard(mockScope, mockScope, '1113572432327416823');
      expect(result).toBe(mockCard);
      expect(mockScroll).toHaveBeenCalled();
    });

    it('should return null when card with exact attributes is not found or not visible', async () => {
      const mockScope = {
        locator: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(0),
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
        }),
      } as unknown as Page;

      const result = await locateDouyinOrderCard(mockScope, mockScope, 'NOT_EXISTING_ID');
      expect(result).toBeNull();
    });
  });
});
