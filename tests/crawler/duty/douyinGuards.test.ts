import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Frame, Locator } from 'playwright';
import { dismissDouyinNoticeModals, clickWithModalBypass } from '@/src/crawler/duty/channels/douyin/douyinModalGuard';
import { checkDouyinPageRisk, assertNoDouyinPageRisk } from '@/src/crawler/duty/channels/douyin/douyinRiskGuard';
import { DutyExecutionError, DouyinDutyErrorCode } from '@/src/crawler/duty/channels/douyin/douyinDutyContracts';

describe('douyinGuards (Single Responsibility Principle & Benchmark against Meituan)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('assertNoDouyinPageRisk', () => {
    it('should pass cleanly when no risk is detected', async () => {
      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      await expect(assertNoDouyinPageRisk(mockPage)).resolves.toBeUndefined();
    });

    it('should throw DutyExecutionError with RISK_VERIFICATION_REQUIRED when risk is detected', async () => {
      const mockPage = {
        url: () => 'https://verify.douyin.com/captcha/verify',
        frames: () => [],
      } as unknown as Page;

      await expect(assertNoDouyinPageRisk(mockPage)).rejects.toThrowError(DutyExecutionError);
      try {
        await assertNoDouyinPageRisk(mockPage);
      } catch (err: unknown) {
        expect((err as DutyExecutionError).errorCode).toBe(DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED);
        expect((err as DutyExecutionError).retryable).toBe(false);
      }
    });
  });

  describe('checkDouyinPageRisk', () => {
    it('should return false if page is null or undefined', async () => {
      expect(await checkDouyinPageRisk(null as unknown as Page)).toBe(false);
      expect(await checkDouyinPageRisk(undefined as unknown as Page)).toBe(false);
    });

    it('should detect risk when page URL contains risk keyword', async () => {
      const mockPage = {
        url: () => 'https://verify.douyin.com/v2/captcha',
        frames: () => [],
      } as unknown as Page;

      expect(await checkDouyinPageRisk(mockPage)).toBe(true);
    });

    it('should detect risk when subframe URL contains risk keyword', async () => {
      const mockFrame = {
        url: () => 'https://secsdk.douyin.com/verify',
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Frame;

      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [mockFrame],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      expect(await checkDouyinPageRisk(mockPage)).toBe(true);
    });

    it('should detect risk when DOM elements contain captcha or secsdk verification selectors', async () => {
      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(true),
      } as unknown as Page;

      expect(await checkDouyinPageRisk(mockPage)).toBe(true);
    });

    it('should return false when no risk factors are detected', async () => {
      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      expect(await checkDouyinPageRisk(mockPage)).toBe(false);
    });
  });

  describe('dismissDouyinNoticeModals', () => {
    it('should return false when page is null or undefined', async () => {
      expect(await dismissDouyinNoticeModals(null as unknown as Page)).toBe(false);
    });

    it('should return false when no notice modal is visible', async () => {
      const mockPage = {
        locator: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(0),
        }),
      } as unknown as Page;

      expect(await dismissDouyinNoticeModals(mockPage)).toBe(false);
    });

    it('should skip modals containing core business texts (确认号, 接单, 拒单)', async () => {
      const mockModal = {
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('请填写酒店确认号并确认接单'),
        locator: vi.fn().mockReturnValue({
          innerText: vi.fn().mockResolvedValue('接单确认'),
        }),
      };

      const mockPage = {
        locator: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(1),
          nth: vi.fn().mockReturnValue(mockModal),
        }),
      } as unknown as Page;

      const result = await dismissDouyinNoticeModals(mockPage);
      expect(result).toBe(false);
    });

    it('should skip modals containing risk control texts (安全验证, 验证码)', async () => {
      const mockModal = {
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('安全验证：请拖动滑块完成人机验证'),
        locator: vi.fn().mockReturnValue({
          innerText: vi.fn().mockResolvedValue('安全验证'),
        }),
      };

      const mockPage = {
        locator: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(1),
          nth: vi.fn().mockReturnValue(mockModal),
        }),
      } as unknown as Page;

      const result = await dismissDouyinNoticeModals(mockPage);
      expect(result).toBe(false);
    });

    it('should safely dismiss notice modal when dismiss button is present', async () => {
      const mockCloseBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      };

      let modalVisible = true;
      const mockModal = {
        isVisible: vi.fn().mockImplementation(async () => modalVisible),
        innerText: vi.fn().mockResolvedValue('平台系统维护通知：今晚凌晨升级'),
        locator: vi.fn((sel: string) => {
          if (sel.includes('modal-title')) {
            return { innerText: vi.fn().mockResolvedValue('系统公告') };
          }
          return {
            first: () => mockCloseBtn,
          };
        }),
        waitFor: vi.fn().mockImplementation(async () => {
          modalVisible = false;
        }),
      };

      const mockPage = {
        locator: vi.fn().mockReturnValue({
          count: vi.fn().mockImplementation(async () => (modalVisible ? 1 : 0)),
          nth: vi.fn().mockReturnValue(mockModal),
        }),
      } as unknown as Page;

      const result = await dismissDouyinNoticeModals(mockPage);
      expect(result).toBe(true);
      expect(mockCloseBtn.click).toHaveBeenCalled();
    });
  });

  describe('clickWithModalBypass', () => {
    it('should click directly when no modal is blocking', async () => {
      const mockPage = {} as unknown as Page;
      const mockLocator = {
        click: vi.fn().mockResolvedValue(undefined),
      } as unknown as Locator;

      await clickWithModalBypass(mockPage, mockLocator);
      expect(mockLocator.click).toHaveBeenCalledTimes(1);
    });

    it('should dismiss modal and retry click when first click is intercepted', async () => {
      const mockPage = {} as unknown as Page;
      const clickMock = vi.fn()
        .mockRejectedValueOnce(new Error('Element is intercepted by another element'))
        .mockResolvedValueOnce(undefined);

      const mockLocator = {
        click: clickMock,
      } as unknown as Locator;

      const mockDismiss = vi.fn().mockResolvedValue(true);

      await clickWithModalBypass(mockPage, mockLocator, mockDismiss);
      expect(clickMock).toHaveBeenCalledTimes(2);
      expect(mockDismiss).toHaveBeenCalledTimes(1);
    });

    it('should throw original error when modal cannot be dismissed', async () => {
      const mockPage = {} as unknown as Page;
      const originalErr = new Error('Element is detached');
      const mockLocator = {
        click: vi.fn().mockRejectedValue(originalErr),
      } as unknown as Locator;

      const mockDismiss = vi.fn().mockResolvedValue(false);

      await expect(clickWithModalBypass(mockPage, mockLocator, mockDismiss)).rejects.toThrow('Element is detached');
    });
  });
});
