import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import { DouyinActionExecutor } from '@/src/crawler/duty/channels/douyin/douyinActionExecutor';
import { DouyinDutyErrorCode } from '@/src/crawler/duty/channels/douyin/douyinDutyContracts';

describe('DouyinActionExecutor (Single Responsibility & Benchmark against Meituan)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('confirmImport (接单回填确认号)', () => {
    it('should throw CONFIRM_INPUT_NOT_FOUND when confirmNo is empty', async () => {
      const executor = new DouyinActionExecutor();
      const mockPage = {} as Page;

      await expect(
        executor.confirmImport(mockPage, '', 'DY-123', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
      });
    });

    it('should throw CONFIRM_INPUT_ALREADY_FILLED when target input has a different confirmation number', async () => {
      const executor = new DouyinActionExecutor();

      const mockInput = {
        isVisible: vi.fn().mockResolvedValue(true),
        inputValue: vi.fn().mockResolvedValue('EXISTING_CONFIRM_999'),
      };

      const mockDialog = {
        isVisible: vi.fn().mockResolvedValue(true),
        locator: vi.fn().mockReturnValue({
          first: () => mockInput,
        }),
      };

      const mockAcceptBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockCard = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue({
          first: () => mockAcceptBtn,
        }),
      };

      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
        locator: vi.fn((sel: string) => {
          if (sel.includes('.byted-modal') || sel.includes('dialog')) {
            return {
              filter: () => ({
                first: () => mockDialog,
              }),
              count: vi.fn().mockResolvedValue(0),
            };
          }
          if (sel.includes('DY-COLLISION-123')) {
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
      } as unknown as Page;

      await expect(
        executor.confirmImport(mockPage, 'NEW_CONFIRM_888', 'DY-COLLISION-123', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_INPUT_ALREADY_FILLED,
        retryable: false,
      });
    });

    it('should perform dryRun safely and return verification result without submitting', async () => {
      const executor = new DouyinActionExecutor();

      let currentInputValue = '';
      const mockInput = {
        isVisible: vi.fn().mockResolvedValue(true),
        inputValue: vi.fn().mockImplementation(async () => currentInputValue),
        pressSequentially: vi.fn().mockImplementation(async (text: string) => {
          currentInputValue = text;
        }),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockCancelBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockSubmitBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockDialog = {
        isVisible: vi.fn().mockResolvedValue(true),
        locator: vi.fn((sel: string) => {
          if (sel.includes('input')) {
            return { first: () => mockInput };
          }
          if (sel.includes('取消') || sel.includes('close')) {
            return { first: () => mockCancelBtn };
          }
          return { first: () => mockSubmitBtn };
        }),
      };

      const mockAcceptBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockCard = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue({
          first: () => mockAcceptBtn,
        }),
      };

      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
        locator: vi.fn((sel: string) => {
          if (sel.includes('.byted-modal') || sel.includes('dialog')) {
            return {
              filter: () => ({
                first: () => mockDialog,
              }),
              count: vi.fn().mockResolvedValue(0),
            };
          }
          if (sel.includes('DY-DRYRUN-123')) {
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
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const result = await executor.confirmImport(mockPage, 'CF-DRY-888', 'DY-DRYRUN-123', {
        refreshOrderList: vi.fn(),
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.dryRun).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.orderId).toBe('DY-DRYRUN-123');
      expect(result.fieldValues?.confirmNo).toBe('CF-DRY-888');
      expect(mockCancelBtn.click).toHaveBeenCalled();
      expect(mockSubmitBtn.click).not.toHaveBeenCalled();
    });
  });

  describe('confirmCancel (确认取消/我知道了)', () => {
    it('should throw ORDER_CARD_NOT_FOUND when otaOrderId is empty', async () => {
      const executor = new DouyinActionExecutor();
      const mockPage = {} as Page;

      await expect(
        executor.confirmCancel(mockPage, '', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
      });
    });

    it('should perform dryRun safely for confirmCancel and assert action button visibility', async () => {
      const executor = new DouyinActionExecutor();

      const mockAckBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockCard = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue({
          first: () => mockAckBtn,
        }),
      };

      const mockPage = {
        url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-refund/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
        locator: vi.fn((sel: string) => {
          if (sel.includes('.byted-modal')) {
            return { count: vi.fn().mockResolvedValue(0) };
          }
          if (sel.includes('DY-CANCEL-888')) {
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
      } as unknown as Page;

      const result = await executor.confirmCancel(mockPage, 'DY-CANCEL-888', {
        refreshOrderList: vi.fn(),
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.dryRun).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.orderId).toBe('DY-CANCEL-888');
      expect(mockAckBtn.click).not.toHaveBeenCalled();
    });
  });
});
