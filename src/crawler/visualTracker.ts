import type { Page, BrowserContext, Locator } from 'playwright';
import { VISUAL_TRACKER_CSS } from './visualTrackerStyles';
import { ACTION_TIMEOUT, getScaledTimeout } from './duty/dutyTimingConfig';

export type TrackerStatusType = 'info' | 'action' | 'success' | 'warn' | 'error';

/**
 * 会话级动态混淆标识（每次运行时动态派生，杜绝固定字符串被平台静态指纹库与黑名单扫描识别）
 */
export const TRACKER_SESSION_HASH = Math.random().toString(36).slice(2, 10);
export const TRACKER_PRIVATE_KEY = `__sl_t_${TRACKER_SESSION_HASH}`;
export const TRACKER_HOST_ID = `__sl_h_${TRACKER_SESSION_HASH}`;

export interface TrajectoryPoint {
  x: number;
  y: number;
}

export interface TrajectoryOptions {
  /** 自定义微步步数（若未提供则依欧氏距离自适应推导） */
  steps?: number;
  /** 是否注入微小生理颤抖（默认 true） */
  jitter?: boolean;
}

/**
 * 纯数学函数：生成符合人类生物动力学（Mouse Dynamics）的三次贝塞尔曲线（Cubic Bézier）轨迹与 Fitts' Law 速度缓动
 * 消除曲率为 0 的纯直线位移特征与骤发速度，并在末步保证零微颤精准着陆
 */
export function generateHumanBezierTrajectory(
  start: TrajectoryPoint,
  end: TrajectoryPoint,
  options: TrajectoryOptions = {}
): TrajectoryPoint[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 2) {
    return [{ x: end.x, y: end.y }];
  }

  // 1. 自适应微步步数推导 (压缩至 4~6 步，单步 4~8ms，避免极端 CDP 通信膨胀)
  let steps = options.steps;
  if (!steps || steps < 2) {
    if (dist < 80) {
      steps = 4;
    } else if (dist < 300) {
      steps = 5;
    } else {
      steps = 6;
    }
  }

  // 2. 计算弦向量与单位法向量（垂直于位移方向）
  const nx = -dy / dist;
  const ny = dx / dist;

  // 3. 拟人控制点生成（模拟手腕/手臂骨骼转动产生的自然弧度与 S 弯）
  // 控制点 1：位于起点 20%~35% 处，施加适度法向拱起
  const u1 = 0.2 + Math.random() * 0.15;
  const maxOffset1 = Math.min(50, dist * 0.28);
  const sign1 = Math.random() > 0.5 ? 1 : -1;
  const offset1 = sign1 * (0.2 + Math.random() * 0.8) * maxOffset1;
  const p1x = start.x + u1 * dx + nx * offset1;
  const p1y = start.y + u1 * dy + ny * offset1;

  // 控制点 2：位于终点前 65%~80% 处，向目标平滑收敛
  const u2 = 0.65 + Math.random() * 0.15;
  const maxOffset2 = Math.min(35, dist * 0.18);
  // 约 35% 概率反向形成 S 型轨迹，65% 保持单侧弧线
  const sign2 = Math.random() < 0.35 ? -sign1 : sign1;
  const offset2 = sign2 * (0.15 + Math.random() * 0.7) * maxOffset2;
  const p2x = start.x + u2 * dx + nx * offset2;
  const p2y = start.y + u2 * dy + ny * offset2;

  const trajectory: TrajectoryPoint[] = [];
  const enableJitter = options.jitter !== false;

  for (let i = 1; i <= steps; i++) {
    if (i === steps) {
      // 最终着陆步：严格消除微颤，百分之百对齐目标真实坐标
      trajectory.push({ x: end.x, y: end.y });
      break;
    }

    const s = i / steps;

    // Fitts' Law 速度缓动：Cubic Ease-In-Out，模拟人类启动加速与接近目标的减速瞄准
    const t = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;

    // 三次贝塞尔曲线公式: B(t) = (1-t)^3 * P0 + 3(1-t)^2*t * P1 + 3(1-t)*t^2 * P2 + t^3 * P3
    const oneMinusT = 1 - t;
    const b0 = oneMinusT * oneMinusT * oneMinusT;
    const b1 = 3 * oneMinusT * oneMinusT * t;
    const b2 = 3 * oneMinusT * t * t;
    const b3 = t * t * t;

    let bx = b0 * start.x + b1 * p1x + b2 * p2x + b3 * end.x;
    let by = b0 * start.y + b1 * p1y + b2 * p2y + b3 * end.y;

    // 生理微颤（Jitter）：中间高速运动阶段轻度微颤，两端收敛为 0
    if (enableJitter) {
      const jitterScale = Math.sin(Math.PI * s) * 1.0;
      const jitterX = (Math.random() - 0.5) * 2 * jitterScale;
      const jitterY = (Math.random() - 0.5) * 2 * jitterScale;
      bx += jitterX;
      by += jitterY;
    }

    trajectory.push({
      x: Math.round(bx),
      y: Math.round(by),
    });
  }

  return trajectory;
}

interface InternalVisualTracker {
  ensureMounted: () => void;
  setStatus: (text: string, type: TrackerStatusType) => void;
  setCursor: (x: number, y: number, clicking?: boolean) => void;
  createRipple: (x: number, y: number) => void;
  setHighlight: (rect: { left: number; top: number; width: number; height: number } | null) => void;
}

/**
 * 注入至网页上下文的视觉操作轨迹脚本源码 (单文件无外部依赖，零副作用，自愈式挂载)
 * 采用 Closed ShadowRoot 深度沙箱隔离，并以会话级动态混淆标识登记，宿主脚本与 MutationObserver 零指纹
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

  // 防重入沙箱保护：若当前上下文已完成追踪器初始化与私有属性挂载，直接幂等返回，杜绝重复 attachShadow 异常与沙箱破裂
  try {
    if (window['${TRACKER_PRIVATE_KEY}']) {
      return;
    }
  } catch (_e) {
    // 忽略
  }

  // 轨迹点恒定节点池与坐标追踪 (上限 32 个，全部挂载于 Closed ShadowRoot 内部)
  const MAX_TRAIL_DOTS = 32;
  const trailDots = [];
  let lastPos = null;
  let lastPhysicalPos = null;
  let currentThemeColor = '#004ac6';
  let hoverBound = false;
  let shadowRoot = null;
  let cachedHudRect = null;

  function updateHudRectCache() {
    if (!shadowRoot) return;
    const hud = shadowRoot.getElementById('__smartlink_hud__');
    if (!hud || typeof hud.getBoundingClientRect !== 'function') return;
    const rect = hud.getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0 || rect.bottom > 0)) {
      cachedHudRect = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    }
  }

  function createTrailDot(x, y, root, delayMs = 0) {
    try {
      const dot = document.createElement('div');
      dot.className = '__sl_trail_dot__';
      dot.style.left = x + 'px';
      dot.style.top = y + 'px';
      if (delayMs > 0) {
        dot.style.animationDelay = delayMs + 'ms';
      }
      if (currentThemeColor) {
        dot.style.background = currentThemeColor;
        dot.style.boxShadow = '0 0 10px ' + currentThemeColor + ', 0 0 3px #ffffff';
      }
      root.appendChild(dot);

      let timerId = null;
      timerId = setTimeout(() => {
        if (dot.parentNode) dot.remove();
        const idx = trailDots.findIndex(item => item.element === dot);
        if (idx !== -1) trailDots.splice(idx, 1);
      }, 500 + delayMs);

      trailDots.push({ element: dot, timerId: timerId });

      // 超出池上限时严格清理定时器与 DOM 节点，杜绝僵尸定时器堆积
      if (trailDots.length > MAX_TRAIL_DOTS) {
        const oldest = trailDots.shift();
        if (oldest) {
          if (oldest.timerId) {
            clearTimeout(oldest.timerId);
          }
          if (oldest.element && oldest.element.parentNode) {
            oldest.element.remove();
          }
        }
      }
    } catch (_e) {
      // 忽略 DOM 卸载异常
    }
  }

  function checkHudProximity(x, y) {
    if (!shadowRoot) return;
    const hud = shadowRoot.getElementById('__smartlink_hud__');
    if (!hud) return;

    // 读写分离与几何缓存：优先读取恒定几何尺寸，杜绝 DOM 变更后同步触发 getBoundingClientRect 导致强制同步重排
    if (!cachedHudRect) {
      updateHudRectCache();
    }
    const rect = cachedHudRect;
    if (!rect) return;

    // 计算光标到 HUD 矩形边缘的实际欧氏距离（若光标在 HUD 内部则为 0）
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const dist = Math.hypot(dx, dy);

    // 附近感知（80px 范围即判定为“进入 HUD 附近”）：触发平滑半透明（透明透视底层网页，绝非隐藏消失）
    // 离开 100px 范围恢复实体高对比度，20px 迟滞彻底避免临界抖动
    if (dist <= 80) {
      hud.classList.add('__sl_hud_transparent__');
      hud.classList.add('__sl_hud_hidden__');
    } else if (dist >= 100) {
      hud.classList.remove('__sl_hud_transparent__');
      hud.classList.remove('__sl_hud_hidden__');
    }
  }

  function mountTrackerDOM() {
    try {
      if (window !== window.top) return false;
    } catch (_e) {
      return false;
    }

    // 严格防风控加固：若 document.body 尚不存在，绝对严禁挂载到 documentElement，避免产生 <html> 异类子节点
    if (!document.body) return false;
    const docRoot = document.body;

    // 1. 防风控核心：创建单一宿主容器（使用动态混淆 ID），并初始化 closed ShadowRoot
    let host = document.getElementById('${TRACKER_HOST_ID}');
    if (!host) {
      host = document.createElement('div');
      host.id = '${TRACKER_HOST_ID}';
      host.setAttribute('style', 'position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:999999!important;');
      docRoot.appendChild(host);
    }

    if (!shadowRoot) {
      try {
        if (typeof host.attachShadow === 'function') {
          shadowRoot = host.attachShadow({ mode: 'closed' });
        } else {
          shadowRoot = host;
        }
      } catch (_e) {
        shadowRoot = host;
      }
    }

    const root = shadowRoot;

    // 2. 样式安全挂载至 ShadowRoot
    if (!root.getElementById('__smartlink_tracker_styles__')) {
      const style = document.createElement('style');
      style.id = '__smartlink_tracker_styles__';
      style.textContent = \`${VISUAL_TRACKER_CSS}\`;
      root.appendChild(style);
    }

    // 3. 全屏柔和呼吸光晕 (纯无边框设计，挂载至 ShadowRoot)
    if (!root.getElementById('__smartlink_takeover_vignette__')) {
      const vignette = document.createElement('div');
      vignette.id = '__smartlink_takeover_vignette__';
      root.appendChild(vignette);
    }

    // 4. 虚拟光标 (初始隐藏，挂载至 ShadowRoot)
    if (!root.getElementById('__smartlink_cursor__')) {
      const cursor = document.createElement('div');
      cursor.id = '__smartlink_cursor__';
      cursor.style.opacity = '0';
      root.appendChild(cursor);
    }

    // 5. 状态 HUD：位于中下部 (挂载至 ShadowRoot)
    if (!root.getElementById('__smartlink_hud__')) {
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
      updateHudRectCache();
    }

    // 6. 高亮框 (挂载至 ShadowRoot)
    if (!root.getElementById('__smartlink_highlight__')) {
      const highlight = document.createElement('div');
      highlight.id = '__smartlink_highlight__';
      root.appendChild(highlight);
    }

    // 7. 全局物理鼠标移动轨迹与悬停避让监听器 (微秒级节流，0 性能开销，最新位置无损采集)
    if (!hoverBound) {
      hoverBound = true;
      let rafId = null;
      let lastEvent = null;
      window.addEventListener('mousemove', (e) => {
        lastEvent = e;
        if (rafId) return;
        const cb = () => {
          rafId = null;
          if (!lastEvent) return;
          const currentX = lastEvent.clientX;
          const currentY = lastEvent.clientY;
          checkHudProximity(currentX, currentY);
          if (!shadowRoot) return;
          if (!lastPhysicalPos) {
            lastPhysicalPos = { x: currentX, y: currentY };
            createTrailDot(currentX, currentY, shadowRoot, 0);
            return;
          }
          const dist = Math.hypot(currentX - lastPhysicalPos.x, currentY - lastPhysicalPos.y);
          if (dist >= 14) {
            if (dist > 28) {
              const steps = Math.min(3, Math.floor(dist / 14));
              for (let s = 1; s < steps; s++) {
                const ratio = s / steps;
                createTrailDot(
                  Math.round(lastPhysicalPos.x + (currentX - lastPhysicalPos.x) * ratio),
                  Math.round(lastPhysicalPos.y + (currentY - lastPhysicalPos.y) * ratio),
                  shadowRoot,
                  0
                );
              }
            }
            createTrailDot(currentX, currentY, shadowRoot, 0);
            lastPhysicalPos = { x: currentX, y: currentY };
          }
        };
        if (typeof window.requestAnimationFrame === 'function') {
          rafId = window.requestAnimationFrame(cb);
        } else {
          cb();
        }
      }, { passive: true });

      window.addEventListener('mouseleave', () => {
        if (!shadowRoot) return;
        const hud = shadowRoot.getElementById('__smartlink_hud__');
        if (hud) {
          hud.classList.remove('__sl_hud_transparent__');
          hud.classList.remove('__sl_hud_hidden__');
        }
      }, { passive: true });

      window.addEventListener('resize', () => {
        cachedHudRect = null;
        updateHudRectCache();
      }, { passive: true });
    }

    return true;
  }

  // 挂载尝试：若 body 尚未构建完成，静默等待 DOMContentLoaded 或 load 事件触发，杜绝挂载到 documentElement
  function scheduleMount() {
    if (mountTrackerDOM()) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleMount, { once: true });
    }
    window.addEventListener('load', scheduleMount, { once: true });
  }
  scheduleMount();

  // 内部控制对象 (保证幂等与自愈能力)
  const tracker = {
    ensureMounted() {
      try {
        if (window !== window.top) return;
      } catch (_e) {
        return;
      }
      mountTrackerDOM();
    },
    setCursor(x, y, clicking = false) {
      if (!mountTrackerDOM() || !shadowRoot) return;
      const cursor = shadowRoot.getElementById('__smartlink_cursor__');
      if (!cursor) return;

      const startX = lastPos ? lastPos.x : (x - 30);
      const startY = lastPos ? lastPos.y : (y - 30);
      const dist = Math.hypot(x - startX, y - startY);

      // 1. 沿途生成连续平滑流光轨迹微粒（依距离插值并配合 delay 顺序点亮）
      if (dist > 14) {
        const count = Math.min(16, Math.max(3, Math.floor(dist / 22)));
        for (let i = 1; i <= count; i++) {
          const ratio = i / count;
          const dotX = Math.round(startX + (x - startX) * ratio);
          const dotY = Math.round(startY + (y - startY) * ratio);
          const delay = Math.round(i * 12);
          createTrailDot(dotX, dotY, shadowRoot, delay);
        }
      } else {
        createTrailDot(x, y, shadowRoot, 0);
      }
      lastPos = { x, y };

      // 2. 检测虚拟光标是否接近 HUD 并触发避让（使用已缓存的矩形坐标，零同步重排）
      checkHudProximity(x, y);

      // 3. 更新虚拟光标实体
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
      if (!mountTrackerDOM() || !shadowRoot) return;
      const ripple = document.createElement('div');
      ripple.style.position = 'fixed';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      ripple.style.borderRadius = '50%';
      ripple.style.border = '2px solid rgba(0, 74, 198, 0.9)';
      ripple.style.background = 'rgba(0, 74, 198, 0.25)';
      ripple.style.pointerEvents = 'none';
      ripple.style.zIndex = '999998';
      ripple.style.animation = '__sl_ripple 0.55s ease-out forwards';
      shadowRoot.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    setHighlight(rect) {
      if (!mountTrackerDOM() || !shadowRoot) return;
      const highlight = shadowRoot.getElementById('__smartlink_highlight__');
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
      if (!mountTrackerDOM() || !shadowRoot) return;
      const textElem = shadowRoot.getElementById('__sl_text__');
      const dotElem = shadowRoot.getElementById('__sl_dot__');
      const vignette = shadowRoot.getElementById('__smartlink_takeover_vignette__');

      if (textElem && text) {
        textElem.textContent = text;
        cachedHudRect = null;
      }

      let dotColor = '#3b82f6';
      let themeClass = 'theme-info';
      if (type === 'success') {
        dotColor = '#10b981';
        themeClass = 'theme-success';
      } else if (type === 'warn') {
        dotColor = '#f59e0b';
        themeClass = 'theme-warn';
      } else if (type === 'error') {
        dotColor = '#ef4444';
        themeClass = 'theme-error';
      } else if (type === 'action') {
        dotColor = '#8b5cf6';
        themeClass = 'theme-action';
      }

      currentThemeColor = dotColor;
      const cursor = shadowRoot.getElementById('__smartlink_cursor__');
      if (cursor) {
        cursor.style.background = dotColor;
        cursor.style.boxShadow = '0 0 16px ' + dotColor + ', 0 3px 8px rgba(0, 0, 0, 0.35)';
      }

      if (dotElem) {
        dotElem.style.background = dotColor;
        dotElem.style.boxShadow = '0 0 8px ' + dotColor;
      }
      if (vignette) {
        vignette.className = themeClass;
      }
    }
  };

  // 防风控核心：挂载会话级隐蔽私有属性（非可枚举），彻底杜绝在 window 上注册全局 Symbol.for 导致被 Object.getOwnPropertySymbols(window) 探测
  try {
    Object.defineProperty(window, '${TRACKER_PRIVATE_KEY}', {
      value: tracker,
      enumerable: false,
      configurable: false,
      writable: false
    });
  } catch (_e) {
    try {
      window['${TRACKER_PRIVATE_KEY}'] = tracker;
    } catch {
      // 兼容降级
    }
  }
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
    await page.evaluate((privateKey) => {
      const tracker = (window as unknown as Record<string, InternalVisualTracker | undefined>)[privateKey];
      if (tracker?.ensureMounted) {
        tracker.ensureMounted();
      }
    }, TRACKER_PRIVATE_KEY);
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
      ({ text, type, privateKey }) => {
        const tracker = (window as unknown as Record<string, InternalVisualTracker | undefined>)[privateKey];
        if (tracker && typeof tracker.setStatus === 'function') {
          tracker.ensureMounted();
          tracker.setStatus(text, type as TrackerStatusType);
          return true;
        }
        return false;
      },
      { text, type, privateKey: TRACKER_PRIVATE_KEY }
    );

    // 若页面中尚未就绪，执行自愈注入并重试设置状态
    if (!updated) {
      await ensureVisualTrackerInjected(page);
      await page.evaluate(
        ({ text, type, privateKey }) => {
          const tracker = (window as unknown as Record<string, InternalVisualTracker | undefined>)[privateKey];
          if (tracker && typeof tracker.setStatus === 'function') {
            tracker.setStatus(text, type as TrackerStatusType);
          }
        },
        { text, type, privateKey: TRACKER_PRIVATE_KEY }
      );
    }
  } catch {
    // 忽略页面跳转或卸载期间的非关键调用异常
  }
}

/** 维护各页面的物理光标终点坐标，保障后续轨迹衔接的平滑与自然 */
const pageMousePositions = new WeakMap<Page, TrajectoryPoint>();

/**
 * 模拟并展示鼠标移动至指定绝对坐标的平滑轨迹 (结合 CDP 原生拟人贝塞尔微步事件与 ShadowRoot 内部视觉轨迹)
 */
export async function visualMoveMouse(page: Page, x: number, y: number): Promise<void> {
  try {
    if (page.isClosed?.()) return;

    // 1. 获取移动起点：优先使用当前 Page 上次移动终点，若无则从合理偏移点启动
    let startPos = pageMousePositions.get(page);
    if (!startPos) {
      startPos = { x: Math.max(0, x - 100), y: Math.max(0, y - 60) };
    }

    const targetPos: TrajectoryPoint = { x, y };
    const trajectory = generateHumanBezierTrajectory(startPos, targetPos);

    // 2. 发射拟人化贝塞尔多步物理鼠标移动（微步 4~6 步，单步延迟 4~8ms，避免极端 CDP 通信延迟）
    if (page.mouse && typeof page.mouse.move === 'function') {
      for (let i = 0; i < trajectory.length; i++) {
        const pt = trajectory[i];
        await page.mouse.move(pt.x, pt.y).catch(() => {});
        if (i < trajectory.length - 1) {
          // 自适应微步延迟 (4~8ms，兼顾平滑与低延迟)
          const microDelay = 4 + Math.floor(Math.random() * 5);
          await page.waitForTimeout(microDelay).catch(() => {});
        }
      }
    }

    // 3. 驱动 ShadowRoot 内部视觉光标同步滑行并发射流光轨迹
    await page.evaluate(
      ({ x, y, privateKey }) => {
        const tracker = (window as unknown as Record<string, InternalVisualTracker | undefined>)[privateKey];
        if (tracker) tracker.setCursor(x, y, false);
      },
      { x, y, privateKey: TRACKER_PRIVATE_KEY }
    );

    // 4. 记录本次移动终点以供后续轨迹自然衔接
    pageMousePositions.set(page, targetPos);

    // 5. 极简微延时保证视觉平稳 (精简至 20ms)
    await page.waitForTimeout(20).catch(() => {});
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
  await locator.scrollIntoViewIfNeeded?.({ timeout: getScaledTimeout(ACTION_TIMEOUT.MODAL) }).catch(() => {});
  const box = typeof locator.boundingBox === 'function' ? await locator.boundingBox().catch(() => null) : null;

  if (box) {
    // 拟人化自然离散偏移：严禁次次命中 100% 绝对正中心（消除反爬生物动力学探针的绝对居中特征）
    // 在中心 40% ~ 60% 安全有效点击区域内引入随机正态离散分布
    const offsetX = box.width > 12 ? box.width * (0.4 + Math.random() * 0.2) : box.width / 2;
    const offsetY = box.height > 12 ? box.height * (0.4 + Math.random() * 0.2) : box.height / 2;
    const targetX = Math.round(box.x + offsetX);
    const targetY = Math.round(box.y + offsetY);

    try {
      // 1. 高亮框包围目标
      await page.evaluate(
        ({ rect, privateKey }) => {
          const tracker = (window as unknown as Record<string, InternalVisualTracker | undefined>)[privateKey];
          if (tracker) tracker.setHighlight(rect);
        },
        { rect: { left: box.x, top: box.y, width: box.width, height: box.height }, privateKey: TRACKER_PRIVATE_KEY }
      );

      // 2. 原生拟人多步贝塞尔轨迹移动至目标中心 (含流光轨迹生成)
      await visualMoveMouse(page, targetX, targetY);

      // 3. 拟人化悬停微延时 (精简至 25ms，消除瞬间点击特征同时保障高执行吞吐)
      await page.waitForTimeout(25).catch(() => {});

      // 4. 点击动画 (水波纹扩散与光标收缩)
      await page.evaluate(
        ({ x, y, privateKey }) => {
          const tracker = (window as unknown as Record<string, InternalVisualTracker | undefined>)[privateKey];
          if (tracker) tracker.setCursor(x, y, true);
        },
        { x: targetX, y: targetY, privateKey: TRACKER_PRIVATE_KEY }
      );

      await page.waitForTimeout(25).catch(() => {});

      // 5. 执行 Playwright 真实点击（显式透传相对偏移量 position，确保物理点击落点带有正态自然散布，严禁被 Playwright 重置至绝对正中心）
      await locator.click({
        timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK),
        position: {
          x: Math.round(offsetX),
          y: Math.round(offsetY),
        },
      });
    } finally {
      // 6. 状态保障清理：确保即使点击抛出异常或超时，光标依然解除点击态，高亮框正常清理
      try {
        if (!page.isClosed?.()) {
          await page.evaluate(
            ({ x, y, privateKey }) => {
              const tracker = (window as unknown as Record<string, InternalVisualTracker | undefined>)[privateKey];
              if (tracker) {
                tracker.setCursor(x, y, false);
                tracker.setHighlight(null);
              }
            },
            { x: targetX, y: targetY, privateKey: TRACKER_PRIVATE_KEY }
          );
        }
      } catch {
        // 忽略重置期间由于页面跳转或销毁引起的异常
      }
    }
  } else {
    // 若无法获取边界框，直接执行真实标准点击，严禁 force 穿透
    await locator.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
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
    await page.waitForTimeout(200);
  } catch {
    // 忽略滚动异常
  }
}
