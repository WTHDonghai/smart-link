import type { Page, FrameLocator, Locator } from 'playwright';
import { logger } from '@/src/services/logger';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import { ACTION_TIMEOUT, getScaledTimeout, isProbeVisible } from '../../dutyTimingConfig';

/**
 * 安全提取弹窗标题（优先读取 .mtd-modal-title，防御性处理以防不同 DOM 结构或测试 Mock 差异）
 */
async function extractModalTitle(modal: Locator): Promise<string> {
  try {
    if (typeof modal?.locator === 'function') {
      const titleLocator = modal.locator('.mtd-modal-title');
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
  const dismiss = dismissFn || ((p: Page) => dismissMeituanNoticeModals(p));
  try {
    await locator.click({ timeout });
  } catch (clickErr) {
    const clickErrMsg = clickErr instanceof Error ? clickErr.message : String(clickErr);
    logger.warn(`[美团弹窗守卫] 目标元素点击受阻，可能存在弹窗遮挡，尝试探测并关闭提示弹窗: ${clickErrMsg}`, {
      module: 'DUTY_TASK',
      channelId: 'MEITUAN',
      details: clickErrMsg,
      meta: { error: clickErrMsg },
    });

    const dismissed = await dismiss(page).catch((dismissErr) => {
      const errMsg = dismissErr instanceof Error ? dismissErr.message : String(dismissErr);
      logger.warn(`[美团弹窗守卫] 执行弹窗清理逻辑抛出异常: ${errMsg}`, {
        module: 'DUTY_TASK',
        channelId: 'MEITUAN',
        details: errMsg,
        meta: { error: errMsg },
      });
      return false;
    });

    if (dismissed) {
      logger.info('[美团弹窗守卫] 遮挡弹窗已成功关闭，正在重试点击目标元素', {
        module: 'DUTY_TASK',
        channelId: 'MEITUAN',
      });
      await locator.click({ timeout });
      logger.info('[美团弹窗守卫] 弹窗关闭后目标元素重试点击成功', {
        module: 'DUTY_TASK',
        channelId: 'MEITUAN',
      });
    } else {
      logger.warn('[美团弹窗守卫] 未能检测到或未能关闭遮挡弹窗，向外抛出原始点击异常', {
        module: 'DUTY_TASK',
        channelId: 'MEITUAN',
        details: clickErrMsg,
        meta: { error: clickErrMsg },
      });
      throw clickErr;
    }
  }
}

/**
 * 自动检测并安全关闭美团后台提示性通知弹窗（如“联系客人”虚拟号说明、商家规则须知、系统公告等）
 * 严格避让核心业务弹窗（接单确认号填报）与安全风控验证弹窗。
 *
 * @param page Playwright Page
 * @param preferredScope 优先探查的作用域（通常为 iframe scope 或顶层 page）
 * @returns 是否成功关闭了至少一个提示弹窗
 */
export async function dismissMeituanNoticeModals(
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

    // 支持连续关闭可能叠加的多层通知公告弹窗（最多尝试 3 次）
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const modalWrappers = scope.locator('.mtd-modal-wrapper, .mtd-modal');
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

          // 核心安全红线 1：严禁关闭接单确认号弹窗与业务输入弹窗
          if (modalText.includes('酒店确认号') || modalText.includes('确认接受')) {
            logger.info(`[美团弹窗守卫] 检测到弹窗「${title}」，包含核心业务填报内容（酒店确认号/确认接受），安全避让不予关闭`, {
              module: 'DUTY_TASK',
              channelId: 'MEITUAN',
              details: preview,
              meta: { title, action: 'skip_core_business', preview },
            });
            continue;
          }

          // 核心安全红线 2：严禁关闭安全风控/滑块弹窗（由专用风控嗅探器接管）
          if (/安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|yoda|captcha|secsdk/i.test(modalText)) {
            logger.warn(`[美团弹窗守卫] 检测到弹窗「${title}」，包含安全风控/人机验证内容，保留弹窗交由风控模块处理`, {
              module: 'DUTY_TASK',
              channelId: 'MEITUAN',
              details: preview,
              meta: { title, action: 'skip_risk_captcha', preview },
            });
            continue;
          }

          // 核心安全红线 3：严禁关闭危险业务决策弹窗（取消订单/拒绝接单/退款审核等）
          if (/确认取消|确认拒绝|拒绝接单|退款审核/i.test(modalText)) {
            logger.info(`[美团弹窗守卫] 检测到弹窗「${title}」，包含业务决策指令（取消/拒绝/退款），安全避让不予关闭`, {
              module: 'DUTY_TASK',
              channelId: 'MEITUAN',
              details: preview,
              meta: { title, action: 'skip_business_decision', preview },
            });
            continue;
          }

          // 寻找符合白名单的知晓/关闭按钮
          const dismissBtn = modal.locator(
            'button:has-text("我知道了"), ' +
            'button:has-text("知道了"), ' +
            'button:has-text("我已阅读"), ' +
            'button:has-text("确定"), ' +
            'button:has-text("确认"), ' +
            'button:has-text("关闭"), ' +
            '.mtd-btn:has-text("我知道了"), ' +
            '.mtd-btn:has-text("知道了"), ' +
            '.mtd-btn:has-text("确定"), ' +
            '.mtd-btn:has-text("确认"), ' +
            '.mtd-btn:has-text("关闭"), ' +
            ':text-is("我知道了"), ' +
            ':text-is("知道了"), ' +
            '.mtd-modal-close, ' +
            '[class*="modal-close"]'
          ).first();

          const btnVisible = await isProbeVisible(dismissBtn, ACTION_TIMEOUT.FAST_PROBE);
          if (!btnVisible) {
            logger.warn(`[美团弹窗守卫] 发现提示性弹窗「${title}」，但未找到符合白名单的可见关闭按钮`, {
              module: 'DUTY_TASK',
              channelId: 'MEITUAN',
              details: preview,
              meta: { title, preview, attempt: attempt + 1 },
            });
            continue;
          }

          logger.info(`[美团弹窗守卫] 检测到可关闭的提示性通知弹窗「${title}」，找到关闭按钮，准备点击`, {
            module: 'DUTY_TASK',
            channelId: 'MEITUAN',
            details: preview,
            meta: { title, preview, attempt: attempt + 1 },
          });

          await updateVisualTrackerStatus(page, `🛡️ 检测到提示弹窗「${title.trim()}」，已自动关闭以恢复操作`, 'action');

          let clickSuccess = false;
          try {
            logger.info(`[美团弹窗守卫] 正在点击关闭提示弹窗「${title}」...`, {
              module: 'DUTY_TASK',
              channelId: 'MEITUAN',
              meta: { title, attempt: attempt + 1 },
            });
            await dismissBtn.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.SENSITIVE_FIELD) });
            clickSuccess = true;
          } catch (clickErr) {
            const errMsg = clickErr instanceof Error ? clickErr.message : String(clickErr);
            logger.warn(`[美团弹窗守卫] 点击提示弹窗「${title}」关闭按钮失败: ${errMsg}`, {
              module: 'DUTY_TASK',
              channelId: 'MEITUAN',
              details: errMsg,
              meta: { title, error: errMsg, attempt: attempt + 1 },
            });
          }

          if (clickSuccess) {
            try {
              await modal.waitFor({ state: 'hidden', timeout: getScaledTimeout(ACTION_TIMEOUT.ELEMENT) });
              logger.info(`[美团弹窗守卫] 成功关闭提示弹窗「${title}」`, {
                module: 'DUTY_TASK',
                channelId: 'MEITUAN',
                meta: { title, attempt: attempt + 1 },
              });
            } catch (waitErr) {
              const errMsg = waitErr instanceof Error ? waitErr.message : String(waitErr);
              logger.warn(`[美团弹窗守卫] 等待提示弹窗「${title}」隐藏消失超时: ${errMsg}`, {
                module: 'DUTY_TASK',
                channelId: 'MEITUAN',
                details: errMsg,
                meta: { title, error: errMsg, attempt: attempt + 1 },
              });
            }

            dismissedAny = true;
            dismissedInThisAttempt = true;
            // 一旦成功关闭一个可见弹窗，跳出内层遍历重新扫描，防止 DOM 列表索引变化
            break;
          }
        }

        if (!dismissedInThisAttempt) {
          // 当前轮次未发现任何可关闭的可见通知弹窗，结束外层尝试
          break;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[美团弹窗守卫] 探测或处理弹窗异常: ${errMsg}`, {
          module: 'DUTY_TASK',
          channelId: 'MEITUAN',
          details: errMsg,
          meta: { error: errMsg, attempt: attempt + 1 },
        });
        break;
      }
    }
  }

  return dismissedAny;
}
