import type { Page, Frame } from 'playwright';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import { DutyExecutionError, MeituanDutyErrorCode } from './meituanDutyContracts';

/**
 * 页面级风控门禁断言器：若检测到人机验证/滑块/风控，立即更新 VisualTracker 并抛出结构化不可重试错误
 */
export async function assertNoMeituanPageRisk(page: Page): Promise<void> {
  if (await checkMeituanPageRisk(page)) {
    await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
    throw new DutyExecutionError(
      '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
      MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
      false
    );
  }
}

/**
 * 页面级人机验证、滑块与风控拦截嗅探函数（跨顶层与所有子 Frame 深度检测）
 */
export async function checkMeituanPageRisk(page: Page): Promise<boolean> {
  if (!page) return false;
  try {
    // 1. 检查页面 URL 本身是否包含风控/验证重定向
    const pageUrl = typeof page.url === 'function' ? page.url() : '';
    if (pageUrl && /(?:verify|captcha|yoda|secsdk)\.meituan\.com|secsdk|captcha|yoda/i.test(pageUrl)) {
      return true;
    }

    // 2. 检查顶层及所有子 Frame
    const rawFrames = typeof page.frames === 'function' ? page.frames() : [];
    const frames = rawFrames.length > 0 ? rawFrames : [page as unknown as Frame];
    for (const frame of frames) {
      try {
        const frameUrl = typeof frame.url === 'function' ? frame.url() : '';
        if (frameUrl && /(?:verify|captcha|yoda|secsdk)\.meituan\.com|secsdk|captcha|yoda/i.test(frameUrl)) {
          return true;
        }
      } catch {
        // 忽略跨域或已销毁 frame
      }

      if (typeof frame.evaluate === 'function') {
        const riskFound = await frame.evaluate(() => {
          // A. 检查风控 iframe、容器或滑块 DOM 节点
          const hasCaptchaEl = Boolean(
            document.querySelector(
              'iframe[src*="captcha"], iframe[src*="verify"], iframe[src*="yoda"], iframe[src*="secsdk"], ' +
              '#yodaBox, #yodaContainer, .yoda-captcha, .yoda-dialog, .yoda-modal, [data-test="captcha"], ' +
              '.secsdk-captcha-drag-wrapper, .geetest_holder, #waf_nc_wrapper, .waf-nc-wrapper, ' +
              'div[id*="yoda"], div[class*="yoda"]'
            )
          );
          if (hasCaptchaEl) return true;

          // B. 嗅探页面主体、标题与特征文本
          const norm = (str: string | null | undefined) => String(str || '').replace(/\s+/g, ' ').trim();
          const bodyText = norm(document.body ? document.body.innerText || document.body.textContent : '');
          const title = norm(document.title);
          const url = String(window.location.href || '');
          const combined = `${title}\n${url}\n${bodyText.slice(0, 3000)}`;
          return /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|验证一下|拖动滑块|请完成验证|yoda|captcha|secsdk/i.test(combined);
        }).catch(() => false);

        if (riskFound === true) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
