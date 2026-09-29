import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import { DouyinActionExecutor } from '@/src/crawler/duty/channels/douyin/douyinActionExecutor';
import { DouyinDutyErrorCode } from '@/src/crawler/duty/channels/douyin/douyinDutyContracts';
import { DutyOrderStatus } from '@/src/crawler/duty/dutyTaskContext';

interface MockPageOptions {
  orderId?: string;
  cardVisible?: boolean;
  triggerBtnVisible?: boolean;
  popoverVisible?: boolean;
  inputVisible?: boolean;
  initialInputValue?: string;
  readBackInputValue?: string;
  confirmBtnVisible?: boolean;
  cancelBtnVisible?: boolean;
  ackBtnVisible?: boolean;
  riskDetected?: boolean;
}

function createMockEnvironment(options: MockPageOptions = {}) {
  const targetOrderId = options.orderId;

  const mockCard = {
    isVisible: vi.fn().mockResolvedValue(options.cardVisible ?? true),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 100, width: 200, height: 80 }),
    click: vi.fn().mockResolvedValue(undefined),
  };

  const mockTriggerBtn = {
    isVisible: vi.fn().mockResolvedValue(options.triggerBtnVisible ?? true),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn().mockResolvedValue({ x: 300, y: 120, width: 100, height: 36 }),
    click: vi.fn().mockResolvedValue(undefined),
  };

  let currentInputValue = options.initialInputValue ?? '';
  let readCount = 0;
  const mockInput = {
    isVisible: vi.fn().mockResolvedValue(options.inputVisible ?? true),
    inputValue: vi.fn().mockImplementation(async () => {
      readCount++;
      if (readCount > 1 && options.readBackInputValue !== undefined) {
        return options.readBackInputValue;
      }
      return currentInputValue;
    }),
    fill: vi.fn().mockImplementation(async (text: string) => {
      currentInputValue = text;
    }),
    pressSequentially: vi.fn().mockImplementation(async (text: string) => {
      currentInputValue = text;
    }),
    click: vi.fn().mockResolvedValue(undefined),
  };

  const mockConfirmBtn = {
    isVisible: vi.fn().mockResolvedValue(options.confirmBtnVisible ?? true),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn().mockResolvedValue({ x: 350, y: 200, width: 60, height: 32 }),
    click: vi.fn().mockResolvedValue(undefined),
  };

  const mockCancelBtn = {
    isVisible: vi.fn().mockResolvedValue(options.cancelBtnVisible ?? true),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn().mockResolvedValue({ x: 280, y: 200, width: 60, height: 32 }),
    click: vi.fn().mockResolvedValue(undefined),
  };

  const mockPopover = {
    isVisible: vi.fn().mockResolvedValue(options.popoverVisible ?? true),
    locator: vi.fn((sel: string) => {
      if (sel.includes('input')) {
        return { first: () => mockInput };
      }
      if (sel.includes('byted-confirm-cancel') || sel.includes('取消')) {
        return { first: () => mockCancelBtn };
      }
      if (sel.includes('byted-confirm-ok') || sel.includes('确定')) {
        return { first: () => mockConfirmBtn };
      }
      return {
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      };
    }),
  };

  const mockAckBtn = {
    isVisible: vi.fn().mockResolvedValue(options.ackBtnVisible ?? true),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn().mockResolvedValue({ x: 300, y: 150, width: 100, height: 36 }),
    click: vi.fn().mockResolvedValue(undefined),
  };

  const mockKeyboard = {
    press: vi.fn().mockResolvedValue(undefined),
  };

  const mockPage = {
    url: () => 'https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list',
    frames: () => [],
    evaluate: vi.fn().mockResolvedValue(Boolean(options.riskDetected)),
    keyboard: mockKeyboard,
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
    },
    locator: vi.fn((sel: string) => {
      // 1. 抖音提示弹窗守卫探查
      if (sel.includes('.byted-modal') || sel.includes('.semi-modal')) {
        return {
          count: vi.fn().mockResolvedValue(0),
          first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
        };
      }
      // 2. 订单卡片选择器
      if (
        (targetOrderId && sel.includes(targetOrderId)) ||
        (!targetOrderId && (sel.includes('.hotel-book-list-order-card') || sel.includes('data-form-insight-meta')))
      ) {
        return {
          first: () => mockCard,
          last: () => mockCard,
        };
      }
      // 3. 填写确认号触发按钮选择器（位于详情区）
      if (sel.includes('byted-popper-trigger') || sel.includes('填写确认号') || sel.includes('接单')) {
        return {
          first: () => mockTriggerBtn,
        };
      }
      // 4. 气泡容器选择器
      if (sel.includes('byted-popover-confirm')) {
        return {
          first: () => mockPopover,
        };
      }
      // 5. 确认取消按钮选择器（真实 DOM 为「我知道了」）
      if (sel.includes('我知道了')) {
        return {
          first: () => mockAckBtn,
        };
      }
      return {
        first: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
        count: vi.fn().mockResolvedValue(0),
      };
    }),
  } as unknown as Page;

  return {
    mockPage,
    mockCard,
    mockTriggerBtn,
    mockPopover,
    mockInput,
    mockConfirmBtn,
    mockCancelBtn,
    mockAckBtn,
    mockKeyboard,
    targetOrderId,
  };
}

describe('DouyinActionExecutor (Single Responsibility & DOM Reality Benchmark)', () => {
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

    it('should throw ORDER_CARD_NOT_FOUND when otaOrderId is empty', async () => {
      const executor = new DouyinActionExecutor();
      const mockPage = {
        url: () => 'https://life.douyin.com',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      await expect(
        executor.confirmImport(mockPage, 'CF-123', '', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
      });
    });

    it('should throw RISK_VERIFICATION_REQUIRED when page is in risk state', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage } = createMockEnvironment({ riskDetected: true });

      await expect(
        executor.confirmImport(mockPage, 'CF-123', 'DY-ORDER-888', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        retryable: false,
      });
    });

    it('should refresh order list and throw ORDER_CARD_NOT_FOUND when card is still not found after refresh', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard } = createMockEnvironment({ cardVisible: false });
      const refreshOrderList = vi.fn().mockResolvedValue(undefined);

      await expect(
        executor.confirmImport(mockPage, 'CF-123', 'DY-NOT-FOUND', {
          refreshOrderList,
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
        retryable: false,
      });

      expect(refreshOrderList).toHaveBeenCalledWith(mockPage, DutyOrderStatus.NEW);
      expect(mockCard.click).not.toHaveBeenCalled();
    });

    it('should retry after refresh and succeed if card appears on second attempt', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard, mockTriggerBtn, mockConfirmBtn } = createMockEnvironment();
      let cardCheckCount = 0;
      mockCard.isVisible = vi.fn().mockImplementation(async () => {
        cardCheckCount++;
        return cardCheckCount > 1;
      });
      const refreshOrderList = vi.fn().mockResolvedValue(undefined);

      await executor.confirmImport(mockPage, 'CF-RETRY-OK', 'DY-ORDER-888', {
        refreshOrderList,
      });

      expect(refreshOrderList).toHaveBeenCalledWith(mockPage, DutyOrderStatus.NEW);
      expect(mockCard.click).toHaveBeenCalled();
      expect(mockTriggerBtn.click).toHaveBeenCalled();
      expect(mockConfirmBtn.click).toHaveBeenCalled();
    });

    it('should click orderCard to expand detail, but throw CONFIRM_SUBMIT_NOT_FOUND if trigger button is not visible', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard, mockTriggerBtn } = createMockEnvironment({ triggerBtnVisible: false });

      await expect(
        executor.confirmImport(mockPage, 'CF-123', 'DY-ORDER-888', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        retryable: false,
      });

      expect(mockCard.click).toHaveBeenCalled();
      expect(mockTriggerBtn.click).not.toHaveBeenCalled();
    });

    it('should click triggerBtn, but throw CONFIRM_INPUT_NOT_FOUND if popover confirm container does not appear', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard, mockTriggerBtn, mockPopover } = createMockEnvironment({ popoverVisible: false });

      await expect(
        executor.confirmImport(mockPage, 'CF-123', 'DY-ORDER-888', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
        retryable: false,
      });

      expect(mockCard.click).toHaveBeenCalled();
      expect(mockTriggerBtn.click).toHaveBeenCalled();
      expect(mockPopover.isVisible).toHaveBeenCalled();
    });

    it('should throw CONFIRM_INPUT_NOT_FOUND if target input is not found inside popover', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard, mockTriggerBtn, mockInput } = createMockEnvironment({ inputVisible: false });

      await expect(
        executor.confirmImport(mockPage, 'CF-123', 'DY-ORDER-888', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
        retryable: false,
      });

      expect(mockCard.click).toHaveBeenCalled();
      expect(mockTriggerBtn.click).toHaveBeenCalled();
      expect(mockInput.isVisible).toHaveBeenCalled();
    });

    it('should throw CONFIRM_INPUT_ALREADY_FILLED when target input already contains a different confirmation number', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockInput, mockConfirmBtn } = createMockEnvironment({
        initialInputValue: 'EXISTING_CONFIRM_999',
      });

      await expect(
        executor.confirmImport(mockPage, 'NEW_CONFIRM_888', 'DY-ORDER-888', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_INPUT_ALREADY_FILLED,
        retryable: false,
      });

      expect(mockInput.pressSequentially).not.toHaveBeenCalled();
      expect(mockConfirmBtn.click).not.toHaveBeenCalled();
    });

    it('should not re-type when target input already contains the identical confirmation number', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockInput, mockConfirmBtn } = createMockEnvironment({
        initialInputValue: 'EXACT_MATCH_123',
      });

      await executor.confirmImport(mockPage, 'EXACT_MATCH_123', 'DY-ORDER-888', {
        refreshOrderList: vi.fn(),
      });

      expect(mockInput.pressSequentially).not.toHaveBeenCalled();
      expect(mockConfirmBtn.click).toHaveBeenCalled();
    });

    it('should throw CONFIRM_VALUE_MISMATCH when readBack value differs from target confirm number', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockConfirmBtn } = createMockEnvironment({
        readBackInputValue: 'CORRUPTED_VALUE',
      });

      await expect(
        executor.confirmImport(mockPage, 'DESIRED_CONFIRM', 'DY-ORDER-888', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_VALUE_MISMATCH,
        retryable: false,
      });

      expect(mockConfirmBtn.click).not.toHaveBeenCalled();
    });

    it('should throw CONFIRM_SUBMIT_NOT_FOUND if confirm submit button is not visible in popover', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockConfirmBtn } = createMockEnvironment({
        confirmBtnVisible: false,
      });

      await expect(
        executor.confirmImport(mockPage, 'CF-123', 'DY-ORDER-888', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        retryable: false,
      });

      expect(mockConfirmBtn.click).not.toHaveBeenCalled();
    });

    it('should perform dryRun safely: click card, click trigger, fill confirmNo, click cancelBtn to close popover, and return verification result without submitting', async () => {
      const executor = new DouyinActionExecutor();
      const {
        mockPage,
        mockCard,
        mockTriggerBtn,
        mockInput,
        mockConfirmBtn,
        mockCancelBtn,
      } = createMockEnvironment();

      const result = await executor.confirmImport(mockPage, 'CF-DRY-888', 'DY-ORDER-888', {
        refreshOrderList: vi.fn(),
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.dryRun).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.orderId).toBe('DY-ORDER-888');
      expect(result.fieldValues?.confirmNo).toBe('CF-DRY-888');
      expect(result.verifiedSteps).toEqual([
        'locate_order_card',
        'activate_order_detail',
        'click_trigger_btn',
        'verify_popover',
        'fill_confirm_no',
        'verify_submit_btn',
        'close_popover_safely',
      ]);

      // 严密断言交互行为
      expect(mockCard.click).toHaveBeenCalled();
      expect(mockTriggerBtn.click).toHaveBeenCalled();
      expect(mockInput.pressSequentially).toHaveBeenCalledWith('CF-DRY-888', expect.any(Object));
      expect(mockCancelBtn.click).toHaveBeenCalled();
      expect(mockConfirmBtn.click).not.toHaveBeenCalled();
    });

    it('should press Escape to close popover when cancel button is not visible during dryRun', async () => {
      const executor = new DouyinActionExecutor();
      const {
        mockPage,
        mockCancelBtn,
        mockConfirmBtn,
        mockKeyboard,
      } = createMockEnvironment({ cancelBtnVisible: false });

      const result = await executor.confirmImport(mockPage, 'CF-DRY-ESC', 'DY-ORDER-888', {
        refreshOrderList: vi.fn(),
        dryRun: true,
      });

      expect(result.verified).toBe(true);
      expect(mockCancelBtn.click).not.toHaveBeenCalled();
      expect(mockKeyboard.press).toHaveBeenCalledWith('Escape');
      expect(mockConfirmBtn.click).not.toHaveBeenCalled();
    });

    it('should execute full real confirmImport flow: click card -> click trigger -> fill confirmNo -> click confirmBtn', async () => {
      const executor = new DouyinActionExecutor();
      const {
        mockPage,
        mockCard,
        mockTriggerBtn,
        mockInput,
        mockConfirmBtn,
        mockCancelBtn,
      } = createMockEnvironment();

      const result = await executor.confirmImport(mockPage, 'CF-REAL-999', 'DY-ORDER-888', {
        refreshOrderList: vi.fn(),
      });

      expect(result).toBeUndefined();
      expect(mockCard.click).toHaveBeenCalled();
      expect(mockTriggerBtn.click).toHaveBeenCalled();
      expect(mockInput.pressSequentially).toHaveBeenCalledWith('CF-REAL-999', expect.any(Object));
      expect(mockConfirmBtn.click).toHaveBeenCalled();
      expect(mockCancelBtn.click).not.toHaveBeenCalled();
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

    it('should refresh order list with DutyOrderStatus.CANCEL and throw ORDER_CARD_NOT_FOUND when card is not found', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard } = createMockEnvironment({ cardVisible: false });
      const refreshOrderList = vi.fn().mockResolvedValue(undefined);

      await expect(
        executor.confirmCancel(mockPage, 'DY-ORDER-888', {
          refreshOrderList,
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
        retryable: false,
      });

      expect(refreshOrderList).toHaveBeenCalledWith(mockPage, DutyOrderStatus.CANCEL);
      expect(mockCard.click).not.toHaveBeenCalled();
    });

    it('should click orderCard, but throw CONFIRM_SUBMIT_NOT_FOUND if ack button is not visible', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard, mockAckBtn } = createMockEnvironment({ ackBtnVisible: false });

      await expect(
        executor.confirmCancel(mockPage, 'DY-ORDER-888', {
          refreshOrderList: vi.fn(),
        })
      ).rejects.toMatchObject({
        errorCode: DouyinDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
        retryable: false,
      });

      expect(mockCard.click).toHaveBeenCalled();
      expect(mockAckBtn.click).not.toHaveBeenCalled();
    });

    it('should perform dryRun safely for confirmCancel: click card, verify ack button visibility, and return verification without clicking ack button', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard, mockAckBtn } = createMockEnvironment();

      const result = await executor.confirmCancel(mockPage, 'DY-ORDER-888', {
        refreshOrderList: vi.fn(),
        dryRun: true,
      });

      expect(result).toBeDefined();
      expect(result.dryRun).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.orderId).toBe('DY-ORDER-888');
      expect(result.verifiedSteps).toEqual([
        'locate_order_card',
        'activate_order_detail',
        'locate_ack_btn',
        'assert_ack_btn_visible',
      ]);
      expect(mockCard.click).toHaveBeenCalled();
      expect(mockAckBtn.click).not.toHaveBeenCalled();
    });

    it('should complete real confirmCancel flow: click card -> click ackBtn', async () => {
      const executor = new DouyinActionExecutor();
      const { mockPage, mockCard, mockAckBtn } = createMockEnvironment();

      const result = await executor.confirmCancel(mockPage, 'DY-ORDER-888', {
        refreshOrderList: vi.fn(),
      });

      expect(result).toBeUndefined();
      expect(mockCard.click).toHaveBeenCalled();
      expect(mockAckBtn.click).toHaveBeenCalled();
    });
  });
});
