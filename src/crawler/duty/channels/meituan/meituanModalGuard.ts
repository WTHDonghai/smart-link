import type { Page, FrameLocator } from 'playwright';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import { ACTION_TIMEOUT, getScaledTimeout, isProbeVisible } from '../../dutyTimingConfig';

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
        const count = await modalWrappers.count().catch(() => 0);

        if (count === 0) break;

        let dismissedInThisAttempt = false;

        for (let i = 0; i < count; i++) {
          const modal = modalWrappers.nth(i);

          const isVisible = await isProbeVisible(modal, ACTION_TIMEOUT.FAST_PROBE);
          if (!isVisible) continue;

          const modalText = await modal.innerText().catch(() => '');

          // 核心安全红线 1：严禁关闭接单确认号弹窗与业务输入弹窗
          if (modalText.includes('酒店确认号') || modalText.includes('确认接受')) {
            continue;
          }

          // 核心安全红线 2：严禁关闭安全风控/滑块弹窗（由专用风控嗅探器接管）
          if (/安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|yoda|captcha|secsdk/i.test(modalText)) {
            continue;
          }

          // 核心安全红线 3：严禁关闭危险业务决策弹窗（取消订单/拒绝接单/退款审核等）
          if (/确认取消|确认拒绝|拒绝接单|退款审核/i.test(modalText)) {
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
            continue;
          }

          const title = (await modal.locator('.mtd-modal-title').innerText().catch(() => '')) || '通知公告';
          await updateVisualTrackerStatus(page, `🛡️ 检测到提示弹窗「${title.trim()}」，已自动关闭以恢复操作`, 'action');

          await dismissBtn.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.SENSITIVE_FIELD) }).catch(() => {});
          await modal.waitFor({ state: 'hidden', timeout: getScaledTimeout(ACTION_TIMEOUT.ELEMENT) }).catch(() => {});
          dismissedAny = true;
          dismissedInThisAttempt = true;
          // 一旦成功关闭一个可见弹窗，跳出内层遍历重新扫描，防止 DOM 列表索引变化
          break;
        }

        if (!dismissedInThisAttempt) {
          // 当前轮次未发现任何可关闭的可见通知弹窗，结束外层尝试
          break;
        }
      } catch {
        break;
      }
    }
  }

  return dismissedAny;
}
