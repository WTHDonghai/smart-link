/**
 * 值守页面只读观察器（P3，设计 7.3 observe_page 的首期实现）。
 *
 * 仅执行定位与文本提取，不点击、不输入、不导航；观察结果作为诊断证据，
 * 脱敏统一由 utils/agent/sensitiveTextMask 完成（设计 9.8），
 * 首期不采集截图（截图脱敏基础设施属后续阶段，见设计 9.8）。
 */

import type {
  DutyPageDialogObservation,
  DutyPageObservation,
} from '@/src/types/agent';
import type { Page } from 'playwright';
import { maskSensitiveText } from '@/src/utils/agent/sensitiveTextMask';
import { describeErrorMessage } from '@/src/utils/errorCauses';

/** 单条观察文本的统一截断上限，禁止悄悄保留超长内容 */
const MAX_TEXT_LENGTH = 300;
const MAX_EXCERPT_LENGTH = 500;
const MAX_BUTTONS = 10;

function truncate(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

/**
 * 在页面上下文内执行的对话框提取函数（序列化后在浏览器中运行，无法在 Node 侧单测）。
 * 保持极简与确定性：角色语义元素 + 已知渠道浮层类名，逐项判断可见性。
 */
function extractDialogsInPage(): Array<{ role: string; title: string; bodyText: string; buttons: string[] }> {
  const selectors = 'dialog,[role="dialog"],[role="alertdialog"],.mtd-modal';
  const roots = Array.from(document.querySelectorAll(selectors));
  const results: Array<{ role: string; title: string; bodyText: string; buttons: string[] }> = [];

  for (const root of roots) {
    const element = root as HTMLElement;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const heading = element.querySelector('h1,h2,h3,h4,[role="heading"],.mtd-modal-title');
    const buttons = Array.from(element.querySelectorAll('button,[role="button"]'))
      .map((button) => (button as HTMLElement).innerText || (button as HTMLElement).textContent || '')
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 10);

    results.push({
      role: element.getAttribute('role') || element.className.toString().slice(0, 60) || 'dialog',
      title: ((heading as HTMLElement | null)?.innerText || element.getAttribute('aria-label') || '').trim(),
      bodyText: (element.innerText || '').trim().slice(0, 300),
      buttons,
    });
  }
  return results;
}

/** 观察单个 frame：跨域或不可访问 frame 的失败如实记入 note，不中断整体观察 */ 
async function observeFrame(
  frame: { url(): string; evaluate<Arg, R>(pageFunction: (arg: Arg) => R, arg: Arg): Promise<R> }
): Promise<{ dialogs: DutyPageDialogObservation[]; error?: string }> {
  try {
    const rawDialogs = await frame.evaluate(extractDialogsInPage, null);
    const frameUrl = frame.url();
    return {
      dialogs: rawDialogs.map((dialog) => ({
        frameUrl: maskSensitiveText(frameUrl),
        role: truncate(maskSensitiveText(dialog.role), 60),
        title: truncate(maskSensitiveText(dialog.title), 120),
        bodyText: truncate(maskSensitiveText(dialog.bodyText), MAX_TEXT_LENGTH),
        buttons: dialog.buttons.map((text) => truncate(maskSensitiveText(text), 30)).slice(0, MAX_BUTTONS),
      })),
    };
  } catch (error) {
    return { dialogs: [], error: describeErrorMessage(error) };
  }
}

/**
 * 观察当前值守页面现场（只读）。顶层 frame 额外采集可见文本摘录。
 */
export async function observeDutyPage(page: Page): Promise<DutyPageObservation> {
  const noteParts: string[] = [];
  const dialogs: DutyPageDialogObservation[] = [];
  let visibleTextExcerpt = '';

  for (const frame of page.frames()) {
    const result = await observeFrame(frame);
    dialogs.push(...result.dialogs);
    if (result.error) {
      noteParts.push(`frame ${frame.url().slice(0, 80)} 观察失败: ${result.error.slice(0, 120)}`);
    }
    if (frame === page.mainFrame()) {
      try {
        const bodyText = await frame.evaluate(
          () => (document.body?.innerText || '').replace(/\s+/g, ' ').trim(),
          null
        );
        visibleTextExcerpt = truncate(maskSensitiveText(bodyText), MAX_EXCERPT_LENGTH);
      } catch (error) {
        noteParts.push(`主 frame 文本提取失败: ${describeErrorMessage(error)}`);
      }
    }
  }

  const observation: DutyPageObservation = {
    observedAt: new Date().toISOString(),
    pageUrl: maskSensitiveText(page.url()),
    visibleTextExcerpt,
    dialogs,
  };
  if (noteParts.length > 0) {
    observation.note = noteParts.join('；').slice(0, MAX_TEXT_LENGTH);
  }
  return observation;
}
