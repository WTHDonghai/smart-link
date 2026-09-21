import type { Page, BrowserContext, Locator } from 'playwright';
import { VISUAL_TRACKER_CSS } from './visualTrackerStyles';

export type TrackerStatusType = 'info' | 'action' | 'success' | 'warn' | 'error';

/**
 * 注入至网页上下文的视觉操作轨迹脚本源码 (单文件无外部依赖，零副作用，自愈式挂载)
 */
export const VISUAL_TRACKER_SCRIPT = `
(function() {
  // 顶层窗口守卫：严格确保仅在浏览器顶层主窗口中渲染，坚决禁止在嵌套子 frame (如 me-iframe) 内部挂载
  try {
    if (window !== window.top) {
      return;
    }
  } catch (_e) {
    // 跨域 iframe 访问 window.top 可能抛出 SecurityError，直接作为非顶层窗口安全拦截
    return;
  }

  function mountTrackerDOM() {
    try {
      if (window !== window.top) return false;
    } catch (_e) {
      return false;
    }

    const root = document.body || document.documentElement;
    if (!root) return false;

    // 1. 样式安全挂载
    if (!document.getElementById('__smartlink_tracker_styles__')) {
      const style = document.createElement('style');
      style.id = '__smartlink_tracker_styles__';
      style.textContent = \`${VISUAL_TRACKER_CSS}\`;
      (document.head || root).appendChild(style);
    }

    // 2. 接管发光边框
    if (!document.getElementById('__smartlink_takeover_vignette__')) {
      const vignette = document.createElement('div');
      vignette.id = '__smartlink_takeover_vignette__';
      vignette.innerHTML = \`
        <div class="__sl_corner__ __sl_corner_tl__"></div>
        <div class="__sl_corner__ __sl_corner_tr__"></div>
        <div class="__sl_corner__ __sl_corner_bl__"></div>
        <div class="__sl_corner__ __sl_corner_br__"></div>
      \`;
      root.appendChild(vignette);
    }

    // 3. 虚拟光标 (初始隐藏，防止加载时突兀悬浮在可视区)
    if (!document.getElementById('__smartlink_cursor__')) {
      const cursor = document.createElement('div');
      cursor.id = '__smartlink_cursor__';
      cursor.style.opacity = '0';
      root.appendChild(cursor);
    }

    // 4. 状态 HUD
    if (!document.getElementById('__smartlink_hud__')) {
      const hud = document.createElement('div');
      hud.id = '__smartlink_hud__';
      hud.innerHTML = \`
        <div style="display: flex; align-items: center; gap: 7px; flex-shrink: 0;">
          <span id="__sl_dot__" style="width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; box-shadow: 0 0 8px #3b82f6; animation: __sl_pulse 1.8s infinite; flex-shrink: 0;"></span>
          <span style="background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.16); padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; color: #93c5fd; letter-spacing: 0.3px;">SMART-LINK 接管中</span>
        </div>
        <span id="__sl_text__" style="color: #f1f5f9; font-weight: 500; max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: middle;">正在初始化自动化操作...</span>
        <span style="font-size: 11px; color: #94a3b8; border-left: 1px solid rgba(255,255,255,0.2); padding-left: 10px; flex-shrink: 0;">订单值守模式 · 请勿关闭</span>
      \`;
      root.appendChild(hud);
    }

    // 5. 高亮框
    if (!document.getElementById('__smartlink_highlight__')) {
      const highlight = document.createElement('div');
      highlight.id = '__smartlink_highlight__';
      root.appendChild(highlight);
    }

    return true;
  }

  // 挂载尝试
  mountTrackerDOM();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountTrackerDOM, { once: true });
    window.addEventListener('load', mountTrackerDOM, { once: true });
  }

  // 全局暴露内部控制对象 (保证幂等与自愈能力)
  window.__SMARTLINK_TRACKER__ = {
    ensureMounted() {
      try {
        if (window !== window.top) return;
      } catch (_e) {
        return;
      }
      mountTrackerDOM();
    },
    setCursor(x, y, clicking = false) {
      if (!mountTrackerDOM()) return;
      const cursor = document.getElementById('__smartlink_cursor__');
      if (!cursor) return;
      cursor.style.opacity = '1';
      cursor.style.left = x + 'px';
      cursor.style.top = y + 'px';
      if (clicking) {
        cursor.classList.add('clicking');
        this.createRipple(x, y);
      } else {
        cursor.classList.remove('clicking');
      }
    },
    createRipple(x, y) {
      if (!mountTrackerDOM()) return;
      const root = document.body || document.documentElement;
      if (!root) return;
      const ripple = document.createElement('div');
      ripple.style.position = 'fixed';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      ripple.style.borderRadius = '50%';
      ripple.style.border = '2px solid rgba(0, 74, 198, 0.9)';
      ripple.style.background = 'rgba(0, 74, 198, 0.25)';
      ripple.style.pointerEvents = 'none';
      ripple.style.zIndex = '2147483646';
      ripple.style.animation = '__sl_ripple 0.55s ease-out forwards';
      root.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    setHighlight(rect) {
      if (!mountTrackerDOM()) return;
      const highlight = document.getElementById('__smartlink_highlight__');
      if (!highlight) return;
      if (!rect) {
        highlight.style.opacity = '0';
        return;
      }
      highlight.style.left = (rect.left - 3) + 'px';
      highlight.style.top = (rect.top - 3) + 'px';
      highlight.style.width = (rect.width + 6) + 'px';
      highlight.style.height = (rect.height + 6) + 'px';
      highlight.style.opacity = '1';
    },
    setStatus(text, type = 'info') {
      if (!mountTrackerDOM()) return;
      const textElem = document.getElementById('__sl_text__');
      const dotElem = document.getElementById('__sl_dot__');
      const vignette = document.getElementById('__smartlink_takeover_vignette__');

      if (textElem && text) textElem.textContent = text;

      let dotColor = '#3b82f6';
      let themeClass = 'theme-info';
      let accentColor = '#004ac6';
      if (type === 'success') {
        dotColor = '#10b981';
        themeClass = 'theme-success';
        accentColor = '#10b981';
      } else if (type === 'warn') {
        dotColor = '#f59e0b';
        themeClass = 'theme-warn';
        accentColor = '#f59e0b';
      } else if (type === 'error') {
        dotColor = '#ef4444';
        themeClass = 'theme-error';
        accentColor = '#ef4444';
      } else if (type === 'action') {
        dotColor = '#8b5cf6';
        themeClass = 'theme-action';
        accentColor = '#8b5cf6';
      }

      if (dotElem) {
        dotElem.style.background = dotColor;
        dotElem.style.boxShadow = '0 0 8px ' + dotColor;
      }
      if (vignette) {
        vignette.className = themeClass;
        vignette.style.setProperty('--sl-accent-color', accentColor);
      }
    }
  };
})();
`;

/**
 * 为浏览器上下文全局注册轨迹追踪注入器（在新标签页或页面刷新时自动保留）
 */
export async function installVisualTracker(context: BrowserContext): Promise<void> {
  await context.addInitScript(VISUAL_TRACKER_SCRIPT);
}

/**
 * 确保在指定页面上立即注入并唤醒指示器与接管渲染
 */
export async function ensureVisualTrackerInjected(page: Page): Promise<void> {
  try {
    if (page.isClosed?.()) return;
    await page.evaluate(VISUAL_TRACKER_SCRIPT);
    await page.evaluate(() => {
      const tracker = (window as unknown as { __SMARTLINK_TRACKER__?: { ensureMounted: () => void } }).__SMARTLINK_TRACKER__;
      if (tracker?.ensureMounted) {
        tracker.ensureMounted();
      }
    });
  } catch {
    // 忽略导航中或页面销毁异常
  }
}

/**
 * 更新页面顶部 HUD 悬浮指示器的文本与状态 (具备自愈式注入能力)
 */
export async function updateVisualTrackerStatus(
  page: Page,
  text: string,
  type: TrackerStatusType = 'info'
): Promise<void> {
  try {
    if (page.isClosed?.()) return;

    const updated = await page.evaluate(
      ({ text, type }) => {
        const tracker = (window as unknown as {
          __SMARTLINK_TRACKER__?: {
            ensureMounted: () => void;
            setStatus: (t: string, s: string) => void;
          };
        }).__SMARTLINK_TRACKER__;
        if (tracker && typeof tracker.setStatus === 'function') {
          tracker.ensureMounted();
          tracker.setStatus(text, type);
          return true;
        }
        return false;
      },
      { text, type }
    );

    // 若页面中尚未就绪，执行自愈注入并重试设置状态
    if (!updated) {
      await ensureVisualTrackerInjected(page);
      await page.evaluate(
        ({ text, type }) => {
          const tracker = (window as unknown as {
            __SMARTLINK_TRACKER__?: {
              setStatus: (t: string, s: string) => void;
            };
          }).__SMARTLINK_TRACKER__;
          if (tracker && typeof tracker.setStatus === 'function') {
            tracker.setStatus(text, type);
          }
        },
        { text, type }
      );
    }
  } catch {
    // 忽略页面跳转或卸载期间的非关键调用异常
  }
}

/**
 * 模拟并展示鼠标移动至指定绝对坐标的平滑轨迹
 */
export async function visualMoveMouse(page: Page, x: number, y: number): Promise<void> {
  try {
    if (page.isClosed?.()) return;
    await page.evaluate(
      ({ x, y }) => {
        const tracker = (window as unknown as { __SMARTLINK_TRACKER__?: { setCursor: (x: number, y: number, c?: boolean) => void } }).__SMARTLINK_TRACKER__;
        if (tracker) tracker.setCursor(x, y, false);
      },
      { x, y }
    );
    await page.waitForTimeout(180);
  } catch {
    // 忽略异常
  }
}

/**
 * 智能视觉高亮与点击：将虚拟光标移动到目标控件、闪烁聚焦框、触发波纹动画并执行真实点击
 */
export async function visualClickLocator(
  page: Page,
  locator: Locator,
  actionText?: string
): Promise<void> {
  if (page.isClosed?.()) return;

  if (actionText) {
    await updateVisualTrackerStatus(page, `🖱️ ${actionText}`, 'action');
  }

  // 确保元素在视口内
  await locator.scrollIntoViewIfNeeded?.({ timeout: 3000 }).catch(() => {});
  const box = typeof locator.boundingBox === 'function' ? await locator.boundingBox().catch(() => null) : null;

  if (box) {
    const targetX = Math.round(box.x + box.width / 2);
    const targetY = Math.round(box.y + box.height / 2);

    try {
      // 1. 高亮框包围目标
      await page.evaluate(
        (rect) => {
          const tracker = (window as unknown as { __SMARTLINK_TRACKER__?: { setHighlight: (r: unknown) => void } }).__SMARTLINK_TRACKER__;
          if (tracker) tracker.setHighlight(rect);
        },
        { left: box.x, top: box.y, width: box.width, height: box.height }
      );

      // 2. 鼠标平滑移动至目标中心
      await visualMoveMouse(page, targetX, targetY);

      // 3. 点击动画 (水波纹扩散与光标收缩)
      await page.evaluate(
        ({ x, y }) => {
          const tracker = (window as unknown as { __SMARTLINK_TRACKER__?: { setCursor: (x: number, y: number, c?: boolean) => void } }).__SMARTLINK_TRACKER__;
          if (tracker) tracker.setCursor(x, y, true);
        },
        { x: targetX, y: targetY }
      );

      await page.waitForTimeout(120);

      // 4. 执行 Playwright 真实点击 (如遇拦截则降级尝试 force: true 强制点击)
      try {
        await locator.click({ timeout: 4000 });
      } catch (clickError) {
        try {
          await locator.click({ force: true, timeout: 2000 });
        } catch {
          throw clickError;
        }
      }
    } finally {
      // 5. 状态保障清理：确保即使点击抛出异常或超时，光标依然解除点击态，高亮框正常清理
      try {
        if (!page.isClosed?.()) {
          await page.evaluate(
            ({ x, y }) => {
              const tracker = (window as unknown as {
                __SMARTLINK_TRACKER__?: {
                  setCursor: (x: number, y: number, c?: boolean) => void;
                  setHighlight: (r: unknown) => void;
                };
              }).__SMARTLINK_TRACKER__;
              if (tracker) {
                tracker.setCursor(x, y, false);
                tracker.setHighlight(null);
              }
            },
            { x: targetX, y: targetY }
          );
        }
      } catch {
        // 忽略重置期间由于页面跳转或销毁引起的异常
      }
    }
  } else {
    // 若无法获取边界框，直接执行兜底点击
    try {
      await locator.click({ timeout: 4000 });
    } catch (clickError) {
      try {
        await locator.click({ force: true, timeout: 2000 });
      } catch {
        throw clickError;
      }
    }
  }
}

/**
 * 视觉滚动：在页面上平滑滚动并展示当前动作
 */
export async function visualScroll(
  page: Page,
  deltaY: number,
  actionText?: string
): Promise<void> {
  try {
    if (page.isClosed?.()) return;
    if (actionText) {
      await updateVisualTrackerStatus(page, `📜 ${actionText}`, 'action');
    }
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(300);
  } catch {
    // 忽略滚动异常
  }
}
