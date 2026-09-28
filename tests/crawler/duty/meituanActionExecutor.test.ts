import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Response } from 'playwright';
import { MeituanActionExecutor } from '@/src/crawler/duty/channels/meituan/meituanActionExecutor';
import { MeituanDutyErrorCode } from '@/src/crawler/duty/channels/meituan/meituanDutyContracts';

describe('meituanActionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('confirmImport', () => {
    it('should throw CONFIRM_INPUT_NOT_FOUND when confirmNo is empty', async () => {
      const executor = new MeituanActionExecutor();
      const mockPage = { url: () => 'https://eb.meituan.com/dealorder' } as Page;
      const refreshOrderList = vi.fn().mockResolvedValue({} as Response);

      await expect(
        executor.confirmImport(mockPage, '', 'MT-123', { refreshOrderList })
      ).rejects.toThrow(
        expect.objectContaining({ errorCode: MeituanDutyErrorCode.CONFIRM_INPUT_NOT_FOUND })
      );
    });

    it('should throw ORDER_CARD_NOT_FOUND when order card cannot be found', async () => {
      const executor = new MeituanActionExecutor();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue({ count: async () => 0 }),
      } as unknown as Page;
      const refreshOrderList = vi.fn().mockResolvedValue({} as Response);

      await expect(
        executor.confirmImport(mockPage, 'CONFIRM-999', 'MT-123', { refreshOrderList })
      ).rejects.toThrow(
        expect.objectContaining({ errorCode: MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND })
      );
    });

    it('should safely return verification result in dryRun mode without submitting', async () => {
      const executor = new MeituanActionExecutor();

      const mockCard = {
        isVisible: async () => true,
        click: vi.fn().mockResolvedValue(undefined),
      };
      const mockCancelBtn = {
        isVisible: async () => true,
        click: vi.fn().mockResolvedValue(undefined),
      };

      let storedInputValue = '';
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel.includes('.detail-container:has-text("MT-123")') || sel.includes('.detail-header:has-text("MT-123")')) {
            return { first: () => ({ isVisible: async () => true }) };
          }
          if (sel.includes('button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受")')) {
            return { first: () => ({ isVisible: async () => true, click: vi.fn() }) };
          }
          if (sel.includes('modal-container:has-text("酒店确认号")')) {
            return {
              first: () => ({
                isVisible: async () => true,
                locator: (subSel: string) => {
                  if (subSel.includes('input.mtd-input')) {
                    return {
                      first: () => ({
                        isVisible: async () => true,
                        inputValue: async () => storedInputValue,
                        fill: vi.fn(async (val: string) => {
                          storedInputValue = val;
                        }),
                      }),
                    };
                  }
                  if (subSel.includes('button.mtd-btn.btn-item.mtd-btn-primary:has-text("确认接受")')) {
                    return { first: () => ({ isVisible: async () => true }) };
                  }
                  if (subSel.includes('button:has-text("取消")')) {
                    return { first: () => mockCancelBtn };
                  }
                  return { first: () => ({ isVisible: async () => false }) };
                },
              }),
            };
          }
          return {
            count: async () => 1,
            nth: () => mockCard,
          };
        }),
      } as unknown as Page;

      const refreshOrderList = vi.fn().mockResolvedValue({} as Response);

      const result = await executor.confirmImport(mockPage, 'CONFIRM-999', 'MT-123', {
        dryRun: true,
        refreshOrderList,
      });

      expect(result).toBeDefined();
      expect(result?.verified).toBe(true);
      expect(result?.dryRun).toBe(true);
      expect(result?.orderId).toBe('MT-123');
      expect(result?.action).toBe('confirmImport');
      expect(result?.fieldValues?.confirmNo).toBe('CONFIRM-999');
    });
  });

  describe('confirmCancel', () => {
    it('should throw ORDER_CARD_NOT_FOUND when otaOrderId is empty', async () => {
      const executor = new MeituanActionExecutor();
      const mockPage = { url: () => 'https://eb.meituan.com/dealorder' } as Page;
      const refreshOrderList = vi.fn().mockResolvedValue({} as Response);

      await expect(
        executor.confirmCancel(mockPage, '', { refreshOrderList })
      ).rejects.toThrow(
        expect.objectContaining({ errorCode: MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND })
      );
    });

    it('should safely return verification result in dryRun mode for cancel confirmation', async () => {
      const executor = new MeituanActionExecutor();

      const mockCard = {
        isVisible: async () => true,
        click: vi.fn().mockResolvedValue(undefined),
      };

      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel.includes('.detail-container:has-text("MT-CANCEL-1")') || sel.includes('.detail-header:has-text("MT-CANCEL-1")')) {
            return { first: () => ({ isVisible: async () => true }) };
          }
          if (sel.includes('button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓")')) {
            return { first: () => ({ isVisible: async () => true }) };
          }
          return {
            count: async () => 1,
            nth: () => mockCard,
          };
        }),
      } as unknown as Page;

      const refreshOrderList = vi.fn().mockResolvedValue({} as Response);

      const result = await executor.confirmCancel(mockPage, 'MT-CANCEL-1', {
        dryRun: true,
        refreshOrderList,
      });

      expect(result).toBeDefined();
      expect(result?.verified).toBe(true);
      expect(result?.dryRun).toBe(true);
      expect(result?.orderId).toBe('MT-CANCEL-1');
      expect(result?.action).toBe('confirmCancel');
    });
  });
});
