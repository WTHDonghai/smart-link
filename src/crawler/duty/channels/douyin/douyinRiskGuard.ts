import type { Page } from 'playwright';
import type { DouyinPageRiskEvidence, DouyinResponseRiskContext, DouyinRiskEvidence, DouyinRiskMatch } from '@/src/types/douyinRisk';
import { findDouyinResponseRisk, redactDouyinDiagnosticText, redactDouyinDiagnosticUrl, serializeDouyinOriginalError } from '@/src/utils/douyinRiskDiagnostics';
import { OTA_RISK_TEXT_PATTERN } from '@/src/utils/otaRiskPatterns';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import { logger } from '@/src/services/logger';
import { DutyExecutionError, DouyinDutyErrorCode } from './douyinDutyContracts';

/** 命中证据随错误文案经过现有调度与回执链路，不改变 ackData 契约。 */
function throwDouyinRisk(riskEvidence: DouyinRiskEvidence, checkpoint: string, originalError?: unknown, rawResponse?: string): never {
  const details = JSON.stringify({ checkpoint, ...riskEvidence });
  const description = riskEvidence.origin === 'page'
    ? '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证；页面特征命中'
    : '抖音接口响应特征命中安全验证或操作频繁，已停止当前操作';
  const error = new DutyExecutionError(
    `${description}；命中信息：${details}`,
    DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
    false
  );
  Object.assign(error, { riskEvidence });
  if (originalError !== undefined) error.cause = originalError;
  const original = originalError === undefined ? undefined : serializeDouyinOriginalError(originalError);
  logger.track('DOUYIN_RISK_CONTROL_MATCHED', {
    level: 'ERROR',
    module: 'DUTY_TASK',
    channelId: 'DOUYIN',
    message: description,
    details: JSON.stringify({
      checkpoint, ...riskEvidence, originalError: original,
    }),
    ...(riskEvidence.origin === 'api-response' ? {
      apiUrl: riskEvidence.apiUrl, apiMethod: riskEvidence.method, httpStatus: riskEvidence.httpStatus,
      apiResponse: rawResponse === undefined ? undefined : redactDouyinDiagnosticText(rawResponse),
    } : {}),
    meta: {
      checkpoint, riskEvidence, stack: error.stack, originalError: original,
    },
  });
  throw error;
}

export async function assertNoDouyinPageRisk(page: Page, checkpoint = '页面风控检查', originalError?: unknown): Promise<void> {
  const riskEvidence = await findDouyinPageRisk(page);
  if (!riskEvidence) return;
  await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
  throwDouyinRisk(riskEvidence, checkpoint, originalError);
}

/** 调用方已确定需要检查的响应范围；正常列表业务数据不因备注中的词新增拦截。 */
export function assertNoDouyinResponseRisk(
  text: string, context: DouyinResponseRiskContext, checkpoint: string, field: 'body' | 'status_msg' = 'body'
): void {
  const riskEvidence = findDouyinResponseRisk(text, context, field);
  if (riskEvidence) throwDouyinRisk(riskEvidence, checkpoint, undefined, text);
}

/** 非风控接口错误同样保留报文，便于定位真实业务失败，不伪造风控证据。 */
export function recordDouyinResponseFailure(
  text: string, context: DouyinResponseRiskContext, checkpoint: string, error?: unknown
): void {
  const originalError = error === undefined ? undefined : serializeDouyinOriginalError(error);
  logger.track('DOUYIN_API_RESPONSE_FAILED', {
    level: 'ERROR', module: 'DUTY_TASK', channelId: 'DOUYIN',
    message: '抖音接口处理失败，原始响应已记录',
    apiUrl: redactDouyinDiagnosticUrl(context.apiUrl), apiMethod: context.method, httpStatus: context.httpStatus,
    apiResponse: redactDouyinDiagnosticText(text),
    details: JSON.stringify({ checkpoint, originalError }),
    meta: { checkpoint, originalError },
  });
}

/** 保留现有布尔探测接口；断言与证据采集只执行同一轮页面检查。 */
export async function checkDouyinPageRisk(page: Page): Promise<boolean> {
  return (await findDouyinPageRisk(page)) !== null;
}

/** 检查顺序与原门禁一致：主页面 URL → 每个 Frame 的 URL、DOM、文本。 */
async function findDouyinPageRisk(page: Page): Promise<DouyinPageRiskEvidence | null> {
  if (!page) return null;
  try {
    const pageUrl = typeof page.url === 'function' ? page.url() : '';
    const urlPattern = /(?:verify|captcha|secsdk)\.douyin\.com|secsdk|captcha/i;
    const pageUrlMatch = pageUrl.match(urlPattern);
    if (pageUrlMatch) {
      return {
        origin: 'page',
        pageUrl: redactDouyinDiagnosticUrl(pageUrl),
        frameUrl: redactDouyinDiagnosticUrl(pageUrl),
        frameIndex: null,
        match: { source: 'page-url', matched: pageUrlMatch[0] },
      };
    }

    const rawFrames = typeof page.frames === 'function' ? page.frames() : [];
    const frames = rawFrames.length > 0 ? rawFrames : [page];
    for (const [frameIndex, frame] of frames.entries()) {
      let frameUrl = '';
      try {
        frameUrl = typeof frame.url === 'function' ? frame.url() : '';
      } catch {
        // Frame 已销毁时仍尝试 evaluate；导航竞争不改变原探测行为。
      }
      const frameUrlMatch = frameUrl.match(urlPattern);
      if (frameUrlMatch) {
        return {
          origin: 'page',
          pageUrl: redactDouyinDiagnosticUrl(pageUrl),
          frameUrl: redactDouyinDiagnosticUrl(frameUrl),
          frameIndex,
          match: { source: 'frame-url', matched: frameUrlMatch[0] },
        };
      }

      if (typeof frame.evaluate !== 'function') continue;
      // evaluate 回调无法闭包引用模块常量，以 pattern.source 注入，保证与接口诊断共用同一份特征定义。
      const match = await frame.evaluate((patternSource: string): DouyinRiskMatch | null => {
        const norm = (text: string | null | undefined): string => String(text || '').replace(/\s+/g, ' ').trim();
        // 只采集命中附近短文本；隐去手机号、订单号等连续数字，不采集整页 HTML。
        const snippet = (text: string): string => text.replace(/\d{6,}/g, '[数字已隐藏]').slice(0, 160);
        const selectors = [
          'iframe[src*="captcha"]', 'iframe[src*="verify"]', 'iframe[src*="secsdk"]',
          '#captcha-verify-image', '.secsdk-captcha-drag-wrapper', '.captcha-verify-container',
          'div[id*="captcha"]', 'div[class*="captcha"]', 'div[class*="secsdk"]',
        ];
        const element = document.querySelector(selectors.join(', '));
        if (element) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return {
            source: 'dom',
            selector: selectors.find((selector) => element.matches(selector))!,
            tagName: element.tagName,
            elementId: element.id.slice(0, 160),
            className: (element.getAttribute('class') || '').slice(0, 160),
            src: element.getAttribute('src')?.replace(/\?[^#]*/g, '?redacted').replace(/#.*/, '#redacted').slice(0, 500) ?? null,
            // 记录布局尺寸与 visibility 判定的可见性，不作为拦截条件。
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse',
            snippet: snippet(norm(element.textContent)),
          };
        }

        const pattern = new RegExp(patternSource, 'i');
        const title = norm(document.title);
        const titleMatch = pattern.exec(title);
        if (titleMatch) {
          return { source: 'title', matched: titleMatch[0], snippet: snippet(title.slice(Math.max(0, titleMatch.index - 40))) };
        }
        const urlMatch = String(window.location.href || '').match(pattern);
        if (urlMatch) return { source: 'url', matched: urlMatch[0] };

        const textSource = document.body?.innerText ? 'innerText' : 'textContent';
        const bodyText = norm(document.body ? document.body.innerText || document.body.textContent : '').slice(0, 3000);
        const bodyMatch = pattern.exec(bodyText);
        return bodyMatch ? {
          source: 'body',
          textSource,
          matched: bodyMatch[0],
          snippet: snippet(bodyText.slice(Math.max(0, bodyMatch.index - 40))),
        } : null;
      }, OTA_RISK_TEXT_PATTERN.source).catch(() => null);

      if (match) {
        return { origin: 'page', pageUrl: redactDouyinDiagnosticUrl(pageUrl), frameUrl: redactDouyinDiagnosticUrl(frameUrl), frameIndex, match };
      }
    }
    return null;
  } catch {
    // 保留原探测器对页面导航/销毁的处理；本次只增强命中诊断，不调整拦截策略。
    return null;
  }
}
