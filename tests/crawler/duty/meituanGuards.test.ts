import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Frame } from 'playwright';
import { logger } from '@/src/services/logger';
import { dismissMeituanNoticeModals, clickWithModalBypass } from '@/src/crawler/duty/channels/meituan/meituanModalGuard';
import { checkMeituanPageRisk, assertNoMeituanPageRisk } from '@/src/crawler/duty/channels/meituan/meituanRiskGuard';
import { DutyExecutionError, MeituanDutyErrorCode } from '@/src/crawler/duty/channels/meituan/meituanDutyContracts';

describe('meituanGuards (Single Responsibility Principle Extraction)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  describe('assertNoMeituanPageRisk', () => {
    it('should pass cleanly when no risk is detected', async () => {
      const mockPage = {
        url: () => 'https://eb.meituan.com/order/list',
        frames: () => [],
        evaluate: vi.fn().mockResolvedValue(false),
      } as unknown as Page;

      await expect(assertNoMeituanPageRisk(mockPage)).resolves.toBeUndefined();
    });

    it('should throw DutyExecutionError with RISK_VERIFICATION_REQUIRED when risk is detected', async () => {
      const mockPage = {
        url: () => 'https://verify.meituan.com/v2/captcha',
        frames: () => [],
      } as unknown as Page;

      await expect(assertNoMeituanPageRisk(mockPage)).rejects.toThrowError(DutyExecutionError);
      try {
        await assertNoMeituanPageRisk(mockPage);
      } catch (err: unknown) {
        expect((err as DutyExecutionError).errorCode).toBe(MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED);
        expect((err as DutyExecutionError).retryable).toBe(false);
      }
    });
  });
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

    it('should click dismiss button, wait for modal hidden, and record info logs when notice modal is visible', async () => {
      const infoSpy = vi.spyOn(logger, 'info');
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

      // 验证找到弹窗与点击弹窗的日志记录
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('检测到可关闭的提示性通知弹窗「联系客人」'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('正在点击关闭提示弹窗「联系客人」...'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('成功关闭提示弹窗「联系客人」'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });

    it('should log info when skipping modal with hotel confirmation red line', async () => {
      const infoSpy = vi.spyOn(logger, 'info');
      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('接单确认\n酒店确认号：\n确认接受'),
        locator: vi.fn().mockReturnValue({ first: () => ({ isVisible: vi.fn().mockResolvedValue(true) }) }),
      };
      const mockPage = { locator: vi.fn().mockReturnValue(mockModal) } as unknown as Page;

      const dismissed = await dismissMeituanNoticeModals(mockPage);
      expect(dismissed).toBe(false);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('包含核心业务填报内容（酒店确认号/确认接受），安全避让不予关闭'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });

    it('should log warn when skipping modal with risk/captcha verification', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('安全验证\n为了您的账号安全，请完成滑动验证码'),
        locator: vi.fn().mockReturnValue({ first: () => ({ isVisible: vi.fn().mockResolvedValue(true) }) }),
      };
      const mockPage = { locator: vi.fn().mockReturnValue(mockModal) } as unknown as Page;

      const dismissed = await dismissMeituanNoticeModals(mockPage);
      expect(dismissed).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('包含安全风控/人机验证内容，保留弹窗交由风控模块处理'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });

    it('should log info when skipping modal with dangerous decision keywords', async () => {
      const infoSpy = vi.spyOn(logger, 'info');
      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('提示\n确认取消该笔订单吗？取消后不可恢复'),
        locator: vi.fn().mockReturnValue({ first: () => ({ isVisible: vi.fn().mockResolvedValue(true) }) }),
      };
      const mockPage = { locator: vi.fn().mockReturnValue(mockModal) } as unknown as Page;

      const dismissed = await dismissMeituanNoticeModals(mockPage);
      expect(dismissed).toBe(false);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('包含业务决策指令（取消/拒绝/退款），安全避让不予关闭'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });

    it('should log warn when modal dismiss button is not visible', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockResolvedValue(false),
      };
      const mockTitle = {
        innerText: vi.fn().mockResolvedValue('公告'),
      };
      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('纯展示信息公告'),
        locator: vi.fn((sel: string) => {
          if (sel.includes('.mtd-modal-title')) return mockTitle;
          return mockDismissBtn;
        }),
      };
      const mockPage = { locator: vi.fn().mockReturnValue(mockModal) } as unknown as Page;

      const dismissed = await dismissMeituanNoticeModals(mockPage);
      expect(dismissed).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('未找到符合白名单的可见关闭按钮'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });

    it('should log warn when clicking dismiss button throws error', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockRejectedValue(new Error('Click intercepted by overlay')),
      };
      const mockTitle = {
        innerText: vi.fn().mockResolvedValue('通知'),
      };
      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('通知\n请注意防疫政策\n我知道了'),
        locator: vi.fn((sel: string) => {
          if (sel.includes('.mtd-modal-title')) return mockTitle;
          return mockDismissBtn;
        }),
        waitFor: vi.fn(),
      };
      const mockPage = { locator: vi.fn().mockReturnValue(mockModal) } as unknown as Page;

      const dismissed = await dismissMeituanNoticeModals(mockPage);
      expect(dismissed).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('点击提示弹窗「通知」关闭按钮失败: Click intercepted by overlay'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });

    it('should log warn when waiting for modal hidden times out but still return dismissed true', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      };
      const mockTitle = {
        innerText: vi.fn().mockResolvedValue('通知'),
      };
      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('通知\n请注意防疫政策\n我知道了'),
        locator: vi.fn((sel: string) => {
          if (sel.includes('.mtd-modal-title')) return mockTitle;
          return mockDismissBtn;
        }),
        waitFor: vi.fn().mockRejectedValue(new Error('Timeout 1500ms waiting for hidden')),
      };
      const mockPage = { locator: vi.fn().mockReturnValue(mockModal) } as unknown as Page;

      const dismissed = await dismissMeituanNoticeModals(mockPage);
      expect(dismissed).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('等待提示弹窗「通知」隐藏消失超时: Timeout 1500ms waiting for hidden'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });
  });

  describe('clickWithModalBypass', () => {
    it('should click directly when not obstructed', async () => {
      const clickSpy = vi.fn().mockResolvedValue(undefined);
      const mockLocator = { click: clickSpy } as unknown as import('playwright').Locator;
      const mockPage = {} as unknown as Page;

      await clickWithModalBypass(mockPage, mockLocator);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('should dismiss modal, retry click, and record warn & info logs when first click throws due to obstruction', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const infoSpy = vi.spyOn(logger, 'info');
      const clickSpy = vi.fn()
        .mockRejectedValueOnce(new Error('Element is obscured by modal'))
        .mockResolvedValueOnce(undefined);
      const mockLocator = { click: clickSpy } as unknown as import('playwright').Locator;
      const mockPage = {} as unknown as Page;
      const dismissSpy = vi.fn().mockResolvedValue(true);

      await clickWithModalBypass(mockPage, mockLocator, dismissSpy);
      expect(clickSpy).toHaveBeenCalledTimes(2);
      expect(dismissSpy).toHaveBeenCalledWith(mockPage);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('目标元素点击受阻，可能存在弹窗遮挡'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('遮挡弹窗已成功关闭，正在重试点击目标元素'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('弹窗关闭后目标元素重试点击成功'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });

    it('should rethrow error and log warn when dismissal did not close any modal', async () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const clickError = new Error('Element is obscured');
      const clickSpy = vi.fn().mockRejectedValue(clickError);
      const mockLocator = { click: clickSpy } as unknown as import('playwright').Locator;
      const mockPage = {} as unknown as Page;
      const dismissSpy = vi.fn().mockResolvedValue(false);

      await expect(clickWithModalBypass(mockPage, mockLocator, dismissSpy)).rejects.toThrow(clickError);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('未能检测到或未能关闭遮挡弹窗，向外抛出原始点击异常'),
        expect.objectContaining({ module: 'DUTY_TASK', channelId: 'MEITUAN' })
      );
    });
  });
});
