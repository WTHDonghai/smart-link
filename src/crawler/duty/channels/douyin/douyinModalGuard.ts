import type { Page, FrameLocator, Locator } from 'playwright';
import { logger } from '@/src/services/logger';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import { ACTION_TIMEOUT, getScaledTimeout, isProbeVisible } from '../../dutyTimingConfig';

/**
 * 安全提取弹窗标题（优先读取 .byted-modal-title 或 .semi-modal-title）
 */
async function extractModalTitle(modal: Locator): Promise<string> {
  try {
    if (typeof modal?.locator === 'function') {
      const titleLocator = modal.locator('.byted-modal-title, .semi-modal-title, [class*="modal-title"]');
      if (titleLocator && typeof titleLocator.innerText === 'function') {
        const text = await titleLocator.innerText().catch(() => '');
        if (text && text.trim()) {
          return text.trim();
        }
      }
    }
  } catch {
    // 忽略标题提取异常
  }
  return '通知公告';
}

/**
 * 防遮挡安全点击封装：尝试点击 locator，若因非业务弹窗遮挡抛出异常，自动尝试关闭弹窗并重试点击一次
 */
export async function clickWithModalBypass(
  page: Page,
  locator: Locator,
  dismissFn?: (page: Page) => Promise<boolean>,
  options?: { timeout?: number }
): Promise<void> {
  const timeout = options?.timeout;
  const dismiss = dismissFn || ((p: Page) => dismissDouyinNoticeModals(p));
  try {
    await locator.click({ timeout });
  } catch (clickErr) {
    const clickErrMsg = clickErr instanceof Error ? clickErr.message : String(clickErr);
    logger.warn(`[抖音弹窗守卫] 目标元素点击受阻，可能存在弹窗遮挡，尝试探测并关闭提示弹窗: ${clickErrMsg}`, {
      module: 'DUTY_TASK',
      channelId: 'DOUYIN',
      details: clickErrMsg,
      meta: { error: clickErrMsg },
    });

    const dismissed = await dismiss(page).catch((dismissErr) => {
      const errMsg = dismissErr instanceof Error ? dismissErr.message : String(dismissErr);
      logger.warn(`[抖音弹窗守卫] 执行弹窗清理逻辑抛出异常: ${errMsg}`, {
        module: 'DUTY_TASK',
        channelId: 'DOUYIN',
        details: errMsg,
        meta: { error: errMsg },
      });
      return false;
    });

    if (dismissed) {
      logger.info('[抖音弹窗守卫] 遮挡弹窗已成功关闭，正在重试点击目标元素', {
        module: 'DUTY_TASK',
        channelId: 'DOUYIN',
      });
      await locator.click({ timeout });
      logger.info('[抖音弹窗守卫] 弹窗关闭后目标元素重试点击成功', {
        module: 'DUTY_TASK',
        channelId: 'DOUYIN',
      });
    } else {
      logger.warn('[抖音弹窗守卫] 未能检测到或未能关闭遮挡弹窗，向外抛出原始点击异常', {
        module: 'DUTY_TASK',
        channelId: 'DOUYIN',
        details: clickErrMsg,
        meta: { error: clickErrMsg },
      });
      throw clickErr;
    }
  }
}

/**
 * 自动检测并安全关闭抖音后台提示性通知弹窗（如公告须知等）
 * 严格避让核心业务弹窗（接单、拒单、确认号填报）与安全风控验证弹窗
 *
 * @param page Playwright Page
 * @param preferredScope 优先探查的作用域（通常为 iframe scope 或顶层 page）
 * @returns 是否成功关闭了至少一个提示弹窗
 */
export async function dismissDouyinNoticeModals(
  page: Page,
  preferredScope?: Page | FrameLocator
): Promise<boolean> {
  if (!page) return false;

  const scopes: (Page | FrameLocator)[] = [];
  if (preferredScope) {
    scopes.push(preferredScope);
  }
  if (!scopes.includes(page)) {
    scopes.push(page);
  }

  let dismissedAny = false;

  for (const scope of scopes) {
    if (!scope || typeof scope.locator !== 'function') continue;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const modalWrappers = scope.locator('.byted-modal, .semi-modal, .semi-modal-wrap, div[role="dialog"]');
        const count = typeof modalWrappers?.count === 'function'
          ? await modalWrappers.count().catch(() => 0)
          : 0;
        if (count === 0) break;

        let dismissedInThisAttempt = false;
        for (let i = 0; i < count; i++) {
          const modal = modalWrappers.nth(i);
          const isVisible = await isProbeVisible(modal, ACTION_TIMEOUT.FAST_PROBE);
          if (!isVisible) continue;

          if (typeof modal?.innerText !== 'function') {
            continue;
          }

          const modalText = await modal.innerText().catch(() => '');
          const title = await extractModalTitle(modal);
          const preview = modalText.replace(/\s+/g, ' ').trim().slice(0, 150);

          // 核心安全红线 1：严禁关闭接单确认号弹窗与业务决策弹窗
          if (modalText.includes('确认号') || modalText.includes('接单') || modalText.includes('拒单')) {
            logger.info(`[抖音弹窗守卫] 检测到弹窗「${title}」，包含核心业务填报内容（接单/确认号），安全避让不予关闭`, {
              module: 'DUTY_TASK',
              channelId: 'DOUYIN',
              details: preview,
              meta: { title, action: 'skip_core_business', preview },
            });
            continue;
          }

          // 核心安全红线 2：严禁关闭安全风控/滑块弹窗
          if (/安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|secsdk|captcha/i.test(modalText)) {
            logger.warn(`[抖音弹窗守卫] 检测到弹窗「${title}」，包含安全风控/人机验证内容，保留弹窗交由风控模块处理`, {
              module: 'DUTY_TASK',
              channelId: 'DOUYIN',
              details: preview,
              meta: { title, action: 'skip_risk_control', preview },
            });
            continue;
          }

          // 核心安全红线 3：严禁关闭取消/退款业务决策弹窗
          if (/确认取消|确认退款|同意退款|拒绝退款/i.test(modalText)) {
            logger.info(`[抖音弹窗守卫] 检测到弹窗「${title}」，包含退款/取消业务决策内容，安全避让不予关闭`, {
              module: 'DUTY_TASK',
              channelId: 'DOUYIN',
              details: preview,
              meta: { title, action: 'skip_refund_business', preview },
            });
            continue;
          }

          const dismissBtn = modal.locator(
            'button:has-text("我知道了"), ' +
            'button:has-text("知道了"), ' +
            'button:has-text("我已阅读"), ' +
            'button:has-text("确定"), ' +
            'button:has-text("确认"), ' +
            'button:has-text("关闭"), ' +
            '.byted-modal-close, ' +
            '.semi-modal-close, ' +
            '[class*="modal-close"], ' +
            '[aria-label="Close"]'
          ).first();

          const btnVisible = await isProbeVisible(dismissBtn, ACTION_TIMEOUT.FAST_PROBE);
          if (!btnVisible) continue;

          await updateVisualTrackerStatus(page, '🛡️ 检测到提示弹窗，已自动关闭以恢复操作', 'action');
          await dismissBtn.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.SENSITIVE_FIELD) }).catch(() => {});
          await modal.waitFor({ state: 'hidden', timeout: getScaledTimeout(ACTION_TIMEOUT.ELEMENT) }).catch(() => {});
          dismissedAny = true;
          dismissedInThisAttempt = true;
          break;
        }
        if (!dismissedInThisAttempt) break;
      } catch {
        break;
      }
    }
  }
  return dismissedAny;
}
