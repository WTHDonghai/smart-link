import type { Page, BrowserContext, Locator } from 'playwright';

export type TrackerStatusType = 'info' | 'action' | 'success' | 'warn' | 'error';

/**
 * 注入至网页上下文的视觉操作轨迹脚本源码 (单文件无外部依赖，零副作用)
 */
const VISUAL_TRACKER_SCRIPT = `
(function() {
  if (window.__SMARTLINK_TRACKER_INITIALIZED__) return;
  window.__SMARTLINK_TRACKER_INITIALIZED__ = true;

  const style = document.createElement('style');
  style.id = '__smartlink_tracker_styles__';
  style.textContent = \`
    @keyframes __sl_pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    @keyframes __sl_ripple {
      0% { width: 6px; height: 6px; opacity: 0.9; transform: translate(-50%, -50%) scale(1); }
      100% { width: 56px; height: 56px; opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
    }
    #__smartlink_cursor__ {
      position: fixed;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: rgba(0, 74, 198, 0.85);
      border: 2.5px solid #ffffff;
      box-shadow: 0 0 14px rgba(0, 74, 198, 0.6), 0 3px 8px rgba(0, 0, 0, 0.35);
      pointer-events: none;
      z-index: 2147483647;
      transform: translate(-50%, -50%);
      transition: left 0.35s cubic-bezier(0.2, 0.9, 0.3, 1), top 0.35s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.15s ease;
      left: 100px;
      top: 100px;
    }
    #__smartlink_cursor__.clicking {
      transform: translate(-50%, -50%) scale(0.7);
      background: rgba(220, 38, 38, 0.9);
      box-shadow: 0 0 16px rgba(220, 38, 38, 0.8);
    }
    #__smartlink_hud__ {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(11, 28, 48, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(220, 233, 255, 0.25);
      border-radius: 9999px;
      padding: 8px 18px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 74, 198, 0.2);
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-weight: 500;
      letter-spacing: 0.2px;
      pointer-events: none;
      z-index: 2147483647;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      max-width: 90vw;
      white-space: nowrap;
    }
    #__smartlink_highlight__ {
      position: fixed;
      border: 2px solid #004ac6;
      border-radius: 6px;
      box-shadow: 0 0 16px rgba(0, 74, 198, 0.5), inset 0 0 10px rgba(0, 74, 198, 0.15);
      background: rgba(0, 74, 198, 0.08);
      pointer-events: none;
      z-index: 2147483646;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      opacity: 0;
    }
  \`;
  document.head.appendChild(style);

  // 1. 创建虚拟光标
  const cursor = document.createElement('div');
  cursor.id = '__smartlink_cursor__';
  document.documentElement.appendChild(cursor);

  // 2. 创建状态 HUD
  const hud = document.createElement('div');
  hud.id = '__smartlink_hud__';
  hud.innerHTML = \`
    <span id="__sl_dot__" style="width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; animation: __sl_pulse 1.8s infinite; shrink: 0;"></span>
    <span style="background: rgba(255,255,255,0.12); padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; color: #93c5fd;">Smart-Link 自动化</span>
    <span id="__sl_text__" style="color: #f1f5f9;">正在初始化自动化操作...</span>
  \`;
  document.documentElement.appendChild(hud);

  // 3. 创建高亮框
  const highlight = document.createElement('div');
  highlight.id = '__smartlink_highlight__';
  document.documentElement.appendChild(highlight);

  // 全局暴露内部控制对象
  window.__SMARTLINK_TRACKER__ = {
    setCursor(x, y, clicking = false) {
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
      document.documentElement.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    setHighlight(rect) {
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
      const textElem = document.getElementById('__sl_text__');
      const dotElem = document.getElementById('__sl_dot__');
      if (textElem) textElem.textContent = text;
      if (dotElem) {
        if (type === 'success') {
          dotElem.style.background = '#10b981';
        } else if (type === 'warn') {
          dotElem.style.background = '#f59e0b';
        } else if (type === 'error') {
          dotElem.style.background = '#ef4444';
        } else if (type === 'action') {
          dotElem.style.background = '#8b5cf6';
        } else {
          dotElem.style.background = '#3b82f6';
        }
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
 * 更新页面顶部 HUD 悬浮指示器的文本与状态
 */
export async function updateVisualTrackerStatus(
  page: Page,
  text: string,
  type: TrackerStatusType = 'info'
): Promise<void> {
  try {
    if (page.isClosed()) return;
    await page.evaluate(
      ({ text, type }) => {
        const tracker = (window as unknown as { __SMARTLINK_TRACKER__?: { setStatus: (t: string, s: string) => void } }).__SMARTLINK_TRACKER__;
        if (tracker) tracker.setStatus(text, type);
      },
      { text, type }
    );
  } catch {
    // 忽略页面跳转或卸载期间的非关键调用异常
  }
}

/**
 * 模拟并展示鼠标移动至指定绝对坐标的平滑轨迹
 */
export async function visualMoveMouse(page: Page, x: number, y: number): Promise<void> {
  try {
    if (page.isClosed()) return;
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
  try {
    if (page.isClosed()) return;

    if (actionText) {
      await updateVisualTrackerStatus(page, `🖱️ ${actionText}`, 'action');
    }

    // 确保元素在视口内
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    const box = await locator.boundingBox();

    if (box) {
      const targetX = Math.round(box.x + box.width / 2);
      const targetY = Math.round(box.y + box.height / 2);

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

      // 4. 执行 Playwright 真实点击
      await locator.click({ timeout: 4000 });

      // 5. 释放点击态
      await page.evaluate(
        ({ x, y }) => {
          const tracker = (window as unknown as { __SMARTLINK_TRACKER__?: { setCursor: (x: number, y: number, c?: boolean) => void; setHighlight: (r: unknown) => void } }).__SMARTLINK_TRACKER__;
          if (tracker) {
            tracker.setCursor(x, y, false);
            setTimeout(() => tracker.setHighlight(null), 300);
          }
        },
        { x: targetX, y: targetY }
      );
    } else {
      // 若无法获取边界框，直接执行兜底点击
      await locator.click({ timeout: 4000 });
    }
  } catch (error) {
    // 若视觉点击遇到遮挡，降级尝试真实强制点击
    try {
      await locator.click({ force: true, timeout: 2000 });
    } catch {
      throw error;
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
    if (page.isClosed()) return;
    if (actionText) {
      await updateVisualTrackerStatus(page, `📜 ${actionText}`, 'action');
    }
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(300);
  } catch {
    // 忽略滚动异常
  }
}
