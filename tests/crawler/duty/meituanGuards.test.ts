import { describe, it, expect, vi } from 'vitest';
import type { Page, Frame } from 'playwright';
import { dismissMeituanNoticeModals } from '@/src/crawler/duty/channels/meituan/meituanModalGuard';
import { checkMeituanPageRisk } from '@/src/crawler/duty/channels/meituan/meituanRiskGuard';

describe('meituanGuards (Single Responsibility Principle Extraction)', () => {
  describe('checkMeituanPageRisk', () => {
    it('should return false if page is null or undefined', async () => {
      expect(await checkMeituanPageRisk(null as unknown as Page)).toBe(false);
      expect(await checkMeituanPageRisk(undefined as unknown as Page)).toBe(false);
    });

    it('should detect risk when page URL contains risk keyword', async () => {
      const mockPage = {
        url: () => 'https://verify.meituan.com/v2/captcha',
        frames: () => [],
      } as unknown as Page;

      expect(await checkMeituanPageRisk(mockPage)).toBe(true);
    });

    it('should detect risk when subframe URL contains risk keyword', async () => {
      const mockFrame = {
        url: () => 'https://rules-center.meituan.com/secsdk-verify',
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Frame;

      const mockPage = {
        url: () => 'https://eb.meituan.com/order/list',
        frames: () => [mockFrame],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      expect(await checkMeituanPageRisk(mockPage)).toBe(true);
    });

    it('should detect risk when DOM elements contain yoda or captcha verification selectors', async () => {
      const mockPage = {
        url: () => 'https://eb.meituan.com/order/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(true),
      } as unknown as Page;

      expect(await checkMeituanPageRisk(mockPage)).toBe(true);
    });

    it('should return false when no risk factors are detected', async () => {
      const mockPage = {
        url: () => 'https://eb.meituan.com/order/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      expect(await checkMeituanPageRisk(mockPage)).toBe(false);
    });
  });

  describe('dismissMeituanNoticeModals', () => {
    it('should return false when page is null or undefined', async () => {
      expect(await dismissMeituanNoticeModals(null as unknown as Page)).toBe(false);
    });

    it('should return false when no notice modal is visible', async () => {
      const mockPage = {
        locator: vi.fn().mockReturnValue({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(false),
          }),
        }),
      } as unknown as Page;

      const dismissed = await dismissMeituanNoticeModals(mockPage);
      expect(dismissed).toBe(false);
    });

    it('should click dismiss button and wait for modal hidden when notice modal is visible', async () => {
      let modalVisible = true;
      const clickSpy = vi.fn().mockImplementation(async () => {
        modalVisible = false;
      });
      const waitForSpy = vi.fn().mockResolvedValue(undefined);

      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockImplementation(async () => modalVisible),
        click: clickSpy,
      };

      const mockTitle = {
        innerText: vi.fn().mockResolvedValue('联系客人'),
      };

      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockImplementation(async () => modalVisible),
        innerText: vi.fn().mockResolvedValue('联系客人\n请拨打虚拟号码\n我知道了'),
        locator: vi.fn((sel: string) => {
          if (sel.includes('.mtd-modal-title')) {
            return mockTitle;
          }
          return mockDismissBtn;
        }),
        waitFor: waitForSpy,
      };

      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
        locator: vi.fn().mockReturnValue(mockModal),
      } as unknown as Page;

      const dismissed = await dismissMeituanNoticeModals(mockPage);
      expect(dismissed).toBe(true);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(waitForSpy).toHaveBeenCalledWith(expect.objectContaining({ state: 'hidden' }));
    });
  });
});
