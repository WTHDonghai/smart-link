import { describe, it, expect, vi } from 'vitest';
import type { Page, BrowserContext, Locator } from 'playwright';
import {
  installVisualTracker,
  ensureVisualTrackerInjected,
  updateVisualTrackerStatus,
  visualMoveMouse,
  visualClickLocator,
  visualScroll,
  VISUAL_TRACKER_SCRIPT,
  TRACKER_PRIVATE_KEY,
  TRACKER_HOST_ID,
  TrackerStatusType,
  generateHumanBezierTrajectory,
} from '../../src/crawler/visualTracker';
import { VISUAL_TRACKER_CSS } from '../../src/crawler/visualTrackerStyles';
import { ACTION_TIMEOUT, getScaledTimeout } from '../../src/crawler/duty/dutyTimingConfig';

interface MockStyle {
  [key: string]: unknown;
  setProperty: (prop: string, value: string) => void;
  opacity?: string;
  left?: string;
  top?: string;
  width?: string;
  height?: string;
  background?: string;
  boxShadow?: string;
}

interface MockShadowRoot {
  getElementById: (id: string) => MockElement | null;
  appendChild: (child: MockElement) => MockElement;
}

interface MockElement {
  id: string;
  tagName?: string;
  style: MockStyle;
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    contains: (cls: string) => boolean;
  };
  className: string;
  innerHTML: string;
  textContent: string;
  setAttribute: (name: string, value: string) => void;
  appendChild: (child: MockElement) => MockElement;
  parentNode?: MockElement | null;
  remove?: () => void;
  getBoundingClientRect?: () => { left: number; right: number; top: number; bottom: number; width: number; height: number };
  attachShadow?: (init: { mode: string }) => MockShadowRoot;
}

interface MockDocument {
  body: MockElement | null;
  documentElement: MockElement;
  head: MockElement;
  readyState: string;
  getElementById: (id: string) => MockElement | null;
  createElement: (tag: string) => MockElement;
  addEventListener: (event: string, handler: unknown, options?: unknown) => void;
}

interface MockTracker {
  ensureMounted: () => void;
  setCursor: (x: number, y: number, clicking?: boolean) => void;
  createRipple: (x: number, y: number) => void;
  setHighlight: (rect: { left: number; top: number; width: number; height: number } | null) => void;
  setStatus: (text: string, type?: TrackerStatusType) => void;
}

interface MockWindow {
  top?: MockWindow;
  addEventListener: (event: string, handler: unknown, options?: unknown) => void;
  requestAnimationFrame?: (cb: () => void) => number;
  [key: string]: unknown;
}

function createMockElement(id = '', targetMap?: Map<string, MockElement>): MockElement {
  const elem: MockElement = {
    id,
    style: {
      setProperty(prop: string, val: string) {
        elem.style[prop] = val;
      },
    },
    classList: {
      add: vi.fn((cls: string) => {
        elem.className = elem.className ? `${elem.className} ${cls}` : cls;
      }),
      remove: vi.fn((cls: string) => {
        elem.className = elem.className
          .split(' ')
          .filter((c) => c !== cls)
          .join(' ');
      }),
      contains: vi.fn((cls: string) => {
        return elem.className.split(' ').includes(cls);
      }),
    },
    className: '',
    innerHTML: '',
    textContent: '',
    setAttribute: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })),
    appendChild: vi.fn((child: MockElement) => {
      child.parentNode = elem;
      if (child.id && targetMap) targetMap.set(child.id, child);
      if (child.className && targetMap) targetMap.set(`${child.className}_${Math.random()}`, child);
      return child;
    }),
    remove: vi.fn(() => {
      elem.parentNode = null;
    }),
    attachShadow: vi.fn(),
  };
  return elem;
}

function createMockEnvironment(isIframe = false, isCrossOrigin = false) {
  const elements = new Map<string, MockElement>();
  const shadowElements = new Map<string, MockElement>();
  let activeShadowRoot: MockShadowRoot | null = null;

  function createMockElem(id = '', targetMap: Map<string, MockElement> = elements): MockElement {
    const elem = createMockElement(id, targetMap);
    elem.attachShadow = vi.fn(() => {
      const shadowRoot: MockShadowRoot = {
        getElementById: vi.fn((sid: string) => shadowElements.get(sid) || null),
        appendChild: vi.fn((child: MockElement) => {
          child.parentNode = elem;
          if (child.id) shadowElements.set(child.id, child);
          if (child.className) shadowElements.set(`${child.className}_${Math.random()}`, child);
          return child;
        }),
      };
      activeShadowRoot = shadowRoot;
      return shadowRoot;
    });
    return elem;
  }

  const mockBody = createMockElem('body', elements);
  const mockDocElement = createMockElem('html', elements);
  const mockHead = createMockElem('head', elements);

  const mockDoc: MockDocument = {
    body: mockBody,
    documentElement: mockDocElement,
    head: mockHead,
    readyState: 'complete',
    getElementById: vi.fn((id: string) => elements.get(id) || null),
    createElement: vi.fn((tag: string) => {
      const el = createMockElem('', elements);
      el.tagName = tag;
      return el;
    }),
    addEventListener: vi.fn(),
  };

  const mockWin: MockWindow = {
    addEventListener: vi.fn(),
  };

  if (isCrossOrigin) {
    Object.defineProperty(mockWin, 'top', {
      get() {
        throw new Error('Blocked a frame with origin from accessing a cross-origin frame.');
      },
    });
  } else if (isIframe) {
    const parentWin: MockWindow = {
      addEventListener: vi.fn(),
    };
    parentWin.top = parentWin;
    mockWin.top = parentWin;
  } else {
    mockWin.top = mockWin;
  }

  return {
    mockDoc,
    mockWin,
    elements,
    shadowElements,
    getShadowRoot: () => activeShadowRoot,
  };
}

describe('visualTracker', () => {
  describe('Anti-Risk & Anti-Fingerprinting Identifiers', () => {
    it('uses dynamic randomized session hash rather than static blacklisted strings', () => {
      // 杜绝静态规则命中特征：不能包含旧的固定明文字符串
      expect(TRACKER_PRIVATE_KEY).not.toBe('__sl_guardian_tracker__');
      expect(TRACKER_PRIVATE_KEY).toMatch(/^__sl_t_[a-z0-9]+$/);

      expect(TRACKER_HOST_ID).not.toBe('__sl_guardian_host__');
      expect(TRACKER_HOST_ID).toMatch(/^__sl_h_[a-z0-9]+$/);
    });

    it('does not register any Symbol on window to prevent detection via Object.getOwnPropertySymbols(window)', () => {
      const { mockDoc, mockWin } = createMockEnvironment(false);
      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      // 核心防风控断言：window 上绝不出现全局注册 Symbol，Object.getOwnPropertySymbols 为空
      const symbols = Object.getOwnPropertySymbols(mockWin);
      expect(symbols).toHaveLength(0);
      expect((mockWin as unknown as Record<string, unknown>)[TRACKER_PRIVATE_KEY]).toBeDefined();
    });
  });

  describe('Human Biomechanical Bézier Trajectory Generator', () => {
    it('generates non-linear cubic Bézier curve with curvature rather than a mechanical straight line', () => {
      const start = { x: 100, y: 100 };
      const end = { x: 500, y: 400 };
      const trajectory = generateHumanBezierTrajectory(start, end, { steps: 16, jitter: false });

      expect(trajectory.length).toBe(16);

      // 验证终点百分之百精准着陆
      expect(trajectory[trajectory.length - 1]).toEqual(end);

      // 计算纯直线插值，验证贝塞尔轨迹确实产生符合生物力学的弯曲（曲率非零）
      let hasCurvatureDeviation = false;
      for (let i = 0; i < trajectory.length - 1; i++) {
        const s = (i + 1) / 16;
        const straightX = Math.round(start.x + (end.x - start.x) * s);
        const straightY = Math.round(start.y + (end.y - start.y) * s);
        const pt = trajectory[i];
        if (Math.abs(pt.x - straightX) > 2 || Math.abs(pt.y - straightY) > 2) {
          hasCurvatureDeviation = true;
          break;
        }
      }
      expect(hasCurvatureDeviation).toBe(true);
    });

    it('implements Fitts Law ease-in-out easing profile (accelerates then decelerates)', () => {
      const start = { x: 50, y: 50 };
      const end = { x: 850, y: 50 };
      const trajectory = generateHumanBezierTrajectory(start, end, { steps: 20, jitter: false });

      // 计算每步位移速度（deltaX）
      const stepSpeeds: number[] = [];
      let prevX = start.x;
      for (const pt of trajectory) {
        stepSpeeds.push(pt.x - prevX);
        prevX = pt.x;
      }

      // 中段最高移动速度必须显著大于启动与着陆阶段的速度
      const maxSpeed = Math.max(...stepSpeeds);
      const startSpeed = stepSpeeds[0];
      const endSpeed = stepSpeeds[stepSpeeds.length - 1];

      expect(maxSpeed).toBeGreaterThan(startSpeed * 1.5);
      expect(maxSpeed).toBeGreaterThan(endSpeed * 1.5);
    });

    it('injects subtle jitter during motion transit while strictly eliminating jitter at final landing', () => {
      const start = { x: 200, y: 200 };
      const end = { x: 600, y: 600 };
      const trajectory = generateHumanBezierTrajectory(start, end, { steps: 20, jitter: true });

      // 无论抖动如何随机，终点必须精准对齐真实目标坐标
      expect(trajectory[trajectory.length - 1]).toEqual(end);
    });

    it('handles tiny distances gracefully without throwing', () => {
      const start = { x: 100, y: 100 };
      const end = { x: 101, y: 100 };
      const trajectory = generateHumanBezierTrajectory(start, end);

      expect(trajectory.length).toBeGreaterThanOrEqual(1);
      expect(trajectory[trajectory.length - 1]).toEqual(end);
    });
  });

  describe('installVisualTracker', () => {
    it('registers init script on BrowserContext without errors', async () => {
      const mockContext = {
        addInitScript: vi.fn().mockResolvedValue(undefined),
      } as unknown as BrowserContext;

      await installVisualTracker(mockContext);
      expect(mockContext.addInitScript).toHaveBeenCalledTimes(1);
    });
  });

  describe('ensureVisualTrackerInjected', () => {
    it('evaluates tracker script and calls ensureMounted', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await ensureVisualTrackerInjected(mockPage);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    });

    it('gracefully handles closed page without throwing', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(true),
        evaluate: vi.fn(),
      } as unknown as Page;

      await expect(ensureVisualTrackerInjected(mockPage)).resolves.toBeUndefined();
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });
  });

  describe('updateVisualTrackerStatus', () => {
    it('evaluates status script inside page context when tracker exists', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(true),
      } as unknown as Page;

      await updateVisualTrackerStatus(mockPage, '测试状态', 'action');
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
    });

    it('triggers self-healing injection and updates status when tracker not initially present', async () => {
      const evaluateMock = vi
        .fn()
        .mockResolvedValueOnce(false) // First attempt: tracker not ready
        .mockResolvedValueOnce(undefined) // ensureVisualTrackerInjected script
        .mockResolvedValueOnce(undefined) // ensureVisualTrackerInjected ensureMounted
        .mockResolvedValueOnce(undefined); // retry setStatus

      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: evaluateMock,
      } as unknown as Page;

      await updateVisualTrackerStatus(mockPage, '自愈状态更新', 'success');
      expect(evaluateMock).toHaveBeenCalledTimes(4);
    });

    it('gracefully handles closed page without throwing', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(true),
        evaluate: vi.fn(),
      } as unknown as Page;

      await expect(
        updateVisualTrackerStatus(mockPage, '测试状态', 'info')
      ).resolves.toBeUndefined();
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });

    it('safely catches evaluate errors during page navigation', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockRejectedValue(new Error('Execution context was destroyed')),
      } as unknown as Page;

      await expect(
        updateVisualTrackerStatus(mockPage, '导航中断', 'warn')
      ).resolves.toBeUndefined();
    });
  });

  describe('visualMoveMouse', () => {
    it('dispatches multi-step Bézier mouse move events and lands precisely on destination', async () => {
      const moveCalls: Array<[number, number]> = [];
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        mouse: {
          move: vi.fn().mockImplementation((x: number, y: number) => {
            moveCalls.push([x, y]);
            return Promise.resolve();
          }),
        },
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualMoveMouse(mockPage, 250, 400);

      // 验证至少产生多步位移事件 (4~6 步，兼顾拟人化与低通信开销)
      expect(moveCalls.length).toBeGreaterThanOrEqual(4);
      expect(moveCalls.length).toBeLessThanOrEqual(6);

      // 验证最终一步严格命中指定目标坐标 (250, 400)
      const lastMove = moveCalls[moveCalls.length - 1];
      expect(lastMove).toEqual([250, 400]);

      // 验证光标在 ShadowRoot 中完成同步
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);

      // 验证采用了微步自适应延迟与终点平稳延迟
      expect(mockPage.waitForTimeout).toHaveBeenCalled();
    });
  });

  describe('visualClickLocator', () => {
    it('scrolls, calculates bounding box, moves cursor, pulses and performs click without force: true', async () => {
      const mockLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 200, width: 80, height: 40 }),
        click: vi.fn().mockResolvedValue(undefined),
      } as unknown as Locator;

      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        mouse: {
          move: vi.fn().mockResolvedValue(undefined),
        },
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualClickLocator(mockPage, mockLocator, '点击目标按钮');
      expect(mockLocator.scrollIntoViewIfNeeded).toHaveBeenCalled();
      expect(mockLocator.boundingBox).toHaveBeenCalled();
      expect(mockPage.mouse.move).toHaveBeenCalled();
      // 严格验证：以真实标准参数点击，显式透传自然离散偏移量 position，绝不使用 force: true 强行穿透
      expect(mockLocator.click).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK),
          position: expect.objectContaining({
            x: expect.any(Number),
            y: expect.any(Number),
          }),
        })
      );
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('falls back to direct standard click without force: true when bounding box is null', async () => {
      const mockLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue(null),
        click: vi.fn().mockResolvedValue(undefined),
      } as unknown as Locator;

      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualClickLocator(mockPage, mockLocator);
      expect(mockLocator.click).toHaveBeenCalledWith({
        timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK),
      });
    });

    it('ensures cursor reset (clicking=false) and highlight cleanup (null) in finally when click fails, and strictly does not force click', async () => {
      const mockLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 200, width: 80, height: 40 }),
        click: vi.fn().mockRejectedValue(new Error('Target obscured by security captcha')),
      } as unknown as Locator;

      const evaluateCalls: Array<{ fn: unknown; arg: unknown }> = [];
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        mouse: {
          move: vi.fn().mockResolvedValue(undefined),
        },
        evaluate: vi.fn().mockImplementation((fn: unknown, arg: unknown) => {
          evaluateCalls.push({ fn, arg });
          return Promise.resolve();
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      // 验证 Fail-Fast：严禁吞掉遮挡或验证码异常，绝不尝试 force: true 强行穿透
      await expect(
        visualClickLocator(mockPage, mockLocator, '异常点击测试')
      ).rejects.toThrow('Target obscured by security captcha');

      // 验证仅调用了一次标准点击，绝无第二次 force 点击
      expect(mockLocator.click).toHaveBeenCalledTimes(1);
      expect(mockLocator.click).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK),
          position: expect.objectContaining({
            x: expect.any(Number),
            y: expect.any(Number),
          }),
        })
      );

      // 验证在 finally 中依然执行了光标恢复与高亮清理
      const lastCall = evaluateCalls[evaluateCalls.length - 1] as {
        fn: (arg: { x: number; y: number; privateKey: string }) => void;
        arg: { x: number; y: number; privateKey: string };
      };
      const mockTracker = {
        setCursor: vi.fn(),
        setHighlight: vi.fn(),
      };
      (globalThis as unknown as { window: Record<string, typeof mockTracker> }).window = {
        [TRACKER_PRIVATE_KEY]: mockTracker,
      };

      lastCall.fn(lastCall.arg);

      const [calledX, calledY, calledClicking] = mockTracker.setCursor.mock.calls[0];
      expect(calledX).toBeGreaterThanOrEqual(100);
      expect(calledX).toBeLessThanOrEqual(180);
      expect(calledY).toBeGreaterThanOrEqual(200);
      expect(calledY).toBeLessThanOrEqual(240);
      expect(calledClicking).toBe(false);
      expect(mockTracker.setHighlight).toHaveBeenCalledWith(null);
    });
  });

  describe('visualScroll', () => {
    it('dispatches wheel event and updates status without throwing', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
        mouse: {
          wheel: vi.fn().mockResolvedValue(undefined),
        },
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualScroll(mockPage, 500, '向下滚动页面');
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, 500);
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(200);
    });
  });

  describe('Top-level window guard (me-iframe isolation)', () => {
    it('strictly does not inject DOM or tracker when running inside an iframe (window !== window.top)', () => {
      const { mockDoc, mockWin, elements, shadowElements } = createMockEnvironment(true); // isIframe = true

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      // 绝不在嵌套子 iframe (如商户后台 me-iframe) 内部挂载任何指示器 DOM 与样式
      expect(elements.size).toBe(0);
      expect(shadowElements.size).toBe(0);
      expect(mockDoc.getElementById(TRACKER_HOST_ID)).toBeNull();
      expect((mockWin as unknown as Record<string, unknown>)[TRACKER_PRIVATE_KEY]).toBeUndefined();
    });

    it('safely handles cross-origin iframe security exceptions without injecting DOM', () => {
      const { mockDoc, mockWin, elements, shadowElements } = createMockEnvironment(false, true); // isCrossOrigin = true

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      expect(() => execute(mockDoc, mockWin)).not.toThrow();

      expect(elements.size).toBe(0);
      expect(shadowElements.size).toBe(0);
      expect((mockWin as unknown as Record<string, unknown>)[TRACKER_PRIVATE_KEY]).toBeUndefined();
    });

    it('returns early when TRACKER_PRIVATE_KEY is already registered to avoid re-entry DOMException', () => {
      const { mockDoc, mockWin } = createMockEnvironment(false);
      // 模拟前次已注入完成
      (mockWin as unknown as Record<string, unknown>)[TRACKER_PRIVATE_KEY] = {
        ensureMounted: vi.fn(),
      };

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      // 验证未再次创建或追加 host 节点
      expect(mockDoc.createElement).not.toHaveBeenCalled();
    });
  });

  describe('DOM Mounting Timing & documentElement Protection (Anti-Risk)', () => {
    it('strictly does NOT append host to documentElement when document.body is null during loading phase', () => {
      const { mockDoc, mockWin } = createMockEnvironment(false);

      // 模拟 addInitScript 执行时 document.body 尚未就绪的情景
      mockDoc.body = null;
      mockDoc.readyState = 'loading';

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      // 严密断言：documentElement 绝对严禁被挂载 host 节点！杜绝产生 <html> 异类子节点触发平台 DOM 树校验
      expect(mockDoc.documentElement.appendChild).not.toHaveBeenCalled();
      expect(mockDoc.getElementById(TRACKER_HOST_ID)).toBeNull();

      // 验证监听了 DOMContentLoaded 或 load 事件以便就绪后安全自愈挂载
      expect(mockDoc.addEventListener).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function), { once: true });
    });
  });

  describe('In-Page DOM mounting and takeover lifecycle (Anti-Risk Stealth & Closed ShadowRoot)', () => {
    it('isolates all indicator nodes inside Closed ShadowRoot without polluting document.body or window properties', () => {
      const { mockDoc, mockWin, shadowElements, getShadowRoot } = createMockEnvironment(false);

      // 执行注入脚本
      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      // 防风控核心验证 1：宿主 document.body 仅包含单一宿主容器，绝无 HUD、微粒或发光光晕散落
      expect(mockDoc.getElementById('__smartlink_hud__')).toBeNull();
      expect(mockDoc.getElementById('__smartlink_cursor__')).toBeNull();
      expect(mockDoc.getElementById('__smartlink_takeover_vignette__')).toBeNull();
      expect(mockDoc.getElementById(TRACKER_HOST_ID)).not.toBeNull();
      // 旧的固定特征 ID 必须绝对不存在
      expect(mockDoc.getElementById('__sl_guardian_host__')).toBeNull();

      // 防风控核心验证 2：所有视觉节点全部严格收敛于 ShadowRoot 内部
      const shadowRoot = getShadowRoot();
      expect(shadowRoot).not.toBeNull();
      expect(shadowRoot?.getElementById('__smartlink_tracker_styles__')).not.toBeNull();
      expect(shadowRoot?.getElementById('__smartlink_takeover_vignette__')).not.toBeNull();
      expect(shadowRoot?.getElementById('__smartlink_cursor__')).not.toBeNull();
      expect(shadowRoot?.getElementById('__smartlink_hud__')).not.toBeNull();
      expect(shadowRoot?.getElementById('__smartlink_highlight__')).not.toBeNull();

      // 防风控核心验证 3：window 对象零可枚举属性与零 Symbol 污染
      expect((mockWin as unknown as Record<string, unknown>).__SMARTLINK_TRACKER__).toBeUndefined();
      expect((mockWin as unknown as Record<string, unknown>).__SMARTLINK_HOVER_BOUND__).toBeUndefined();
      expect(Object.keys(mockWin)).not.toContain('__SMARTLINK_TRACKER__');
      expect(Object.keys(mockWin)).not.toContain(TRACKER_PRIVATE_KEY);
      expect(Object.getOwnPropertySymbols(mockWin)).toHaveLength(0);

      // 防风控核心验证 4：通过隐蔽私有属性成功访问内部 tracker
      const tracker = (mockWin as unknown as Record<string, MockTracker | undefined>)[TRACKER_PRIVATE_KEY];
      expect(tracker).toBeDefined();

      // 初始状态：虚拟光标必须隐藏 (opacity: 0)
      const cursor = shadowElements.get('__smartlink_cursor__');
      expect(cursor).toBeDefined();
      expect(cursor?.style.opacity).toBe('0');

      // 首次移动光标：透明度变为 1，坐标精准更新
      tracker?.setCursor(120, 240);
      expect(cursor?.style.opacity).toBe('1');
      expect(cursor?.style.left).toBe('120px');
      expect(cursor?.style.top).toBe('240px');

      // 点击状态：添加 clicking class
      tracker?.setCursor(120, 240, true);
      expect(cursor?.className).toContain('clicking');

      // 释放点击：移除 clicking class
      tracker?.setCursor(120, 240, false);
      expect(cursor?.className).not.toContain('clicking');

      // 验证高亮更新
      tracker?.setHighlight({ left: 50, top: 80, width: 200, height: 100 });
      const highlight = shadowElements.get('__smartlink_highlight__');
      expect(highlight?.style.opacity).toBe('1');
      expect(highlight?.style.left).toBe('47px');

      // 验证高亮清理
      tracker?.setHighlight(null);
      expect(highlight?.style.opacity).toBe('0');

      // 验证自愈恢复能力：清空 shadowElements 后执行 ensureMounted 重新挂载
      shadowElements.clear();
      expect(shadowRoot?.getElementById('__smartlink_hud__')).toBeNull();

      tracker?.ensureMounted();
      expect(shadowRoot?.getElementById('__smartlink_hud__')).not.toBeNull();
      expect(shadowRoot?.getElementById('__smartlink_takeover_vignette__')).not.toBeNull();
    });

    it('renders borderless ambient soft glow and synchronizes theme classes with status', () => {
      const { mockDoc, mockWin, shadowElements } = createMockEnvironment(false);

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      const tracker = (mockWin as unknown as Record<string, MockTracker | undefined>)[TRACKER_PRIVATE_KEY];
      expect(tracker).toBeDefined();

      // 模拟 HUD 内部子元素挂载
      const textElem = createMockElement('__sl_text__', shadowElements);
      const dotElem = createMockElement('__sl_dot__', shadowElements);
      shadowElements.set('__sl_text__', textElem);
      shadowElements.set('__sl_dot__', dotElem);

      const vignette = shadowElements.get('__smartlink_takeover_vignette__');
      if (!vignette) throw new Error('Vignette not mounted in shadowRoot');

      // 1. action (操作紫)
      tracker?.setStatus('执行点击操作', 'action');
      expect(textElem.textContent).toBe('执行点击操作');
      expect(dotElem.style.background).toBe('#8b5cf6');
      expect(vignette.className).toBe('theme-action');

      // 2. error (错误红)
      tracker?.setStatus('页面拦截报警', 'error');
      expect(textElem.textContent).toBe('页面拦截报警');
      expect(dotElem.style.background).toBe('#ef4444');
      expect(vignette.className).toBe('theme-error');

      // 3. warn (警告橙)
      tracker?.setStatus('等待重试中', 'warn');
      expect(textElem.textContent).toBe('等待重试中');
      expect(dotElem.style.background).toBe('#f59e0b');
      expect(vignette.className).toBe('theme-warn');

      // 4. success (成功绿)
      tracker?.setStatus('订单值守完成', 'success');
      expect(textElem.textContent).toBe('订单值守完成');
      expect(dotElem.style.background).toBe('#10b981');
      expect(vignette.className).toBe('theme-success');

      // 5. info (默认蓝)
      tracker?.setStatus('就绪中', 'info');
      expect(textElem.textContent).toBe('就绪中');
      expect(dotElem.style.background).toBe('#3b82f6');
      expect(vignette.className).toBe('theme-info');
    });

    it('generates motion trail dots when cursor moves with distance threshold and cleans up oldest node', () => {
      const { mockDoc, mockWin, shadowElements } = createMockEnvironment(false);

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      const tracker = (mockWin as unknown as Record<string, MockTracker | undefined>)[TRACKER_PRIVATE_KEY];
      expect(tracker).toBeDefined();

      // 首次移动
      tracker?.setCursor(100, 100);
      // 大距离位移，触发轨迹微粒生成
      tracker?.setCursor(200, 250);

      const trailDots = Array.from(shadowElements.values()).filter(
        (el: MockElement) => el.className === '__sl_trail_dot__'
      );
      expect(trailDots.length).toBeGreaterThan(0);
      expect(trailDots.length).toBeLessThanOrEqual(32);
    });

    it('positions HUD at bottom and activates evasion class using cached rect (Zero Layout Thrashing)', () => {
      const { mockDoc, mockWin, shadowElements } = createMockEnvironment(false);

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      const hud = shadowElements.get('__smartlink_hud__');
      expect(hud).toBeDefined();
      if (!hud) throw new Error('HUD element not found');

      // 模拟 HUD 位于底部中部的 bounding rect
      const getBoundingClientRectMock = vi.fn().mockReturnValue({
        left: 400,
        right: 800,
        top: 700,
        bottom: 750,
        width: 400,
        height: 50,
      });
      hud.getBoundingClientRect = getBoundingClientRectMock;

      const tracker = (mockWin as unknown as Record<string, MockTracker | undefined>)[TRACKER_PRIVATE_KEY];

      // 1. 光标远离 HUD (100, 100)：未触发半透明
      tracker?.setCursor(100, 100);
      expect(hud.classList.add).not.toHaveBeenCalledWith('__sl_hud_transparent__');
      expect(hud.classList.add).not.toHaveBeenCalledWith('__sl_hud_hidden__');

      // 2. 光标移动到 HUD 附近上方 50px (500, 650)：进入 80px 附近感知区，触发变半透明
      tracker?.setCursor(500, 650);
      expect(hud.classList.add).toHaveBeenCalledWith('__sl_hud_transparent__');
      expect(hud.classList.add).toHaveBeenCalledWith('__sl_hud_hidden__');

      // 3. 光标进入 HUD 内部 (500, 720)：保持半透明
      tracker?.setCursor(500, 720);
      expect(hud.classList.add).toHaveBeenCalledWith('__sl_hud_transparent__');

      // 4. 光标移开至远距离 (100, 100)：恢复高对比度实体显示
      tracker?.setCursor(100, 100);
      expect(hud.classList.remove).toHaveBeenCalledWith('__sl_hud_transparent__');
      expect(hud.classList.remove).toHaveBeenCalledWith('__sl_hud_hidden__');

      // 几何缓存断言：在连续 4 次移动中，由于读取了 cachedHudRect，getBoundingClientRect 调用次数不超过 2 次（初次挂载与初次读）
      // 杜绝了每帧触发同步重排 (Layout Thrashing)
      expect(getBoundingClientRectMock.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('enforces HUD text truncation, eliminates illegal CSS syntax, and removes will-change from particles', () => {
      // 语法合法性检验：严禁非法 shrink: 0;，强制使用标准 flex-shrink: 0;
      expect(VISUAL_TRACKER_SCRIPT).not.toMatch(/(?<![a-zA-Z-])shrink:\s*0/);
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/flex-shrink:\s*0;/);

      // HUD 文本长内容截断防护
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/max-width:\s*480px;/);
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/overflow:\s*hidden;/);
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/text-overflow:\s*ellipsis;/);
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/white-space:\s*nowrap;/);

      // CSS 样式表中底部定位（48px 边距）与半透明透视样式校验
      expect(VISUAL_TRACKER_CSS).toContain(':host');
      expect(VISUAL_TRACKER_CSS).toContain('bottom: 48px');
      expect(VISUAL_TRACKER_CSS).toContain('.__sl_hud_transparent__');
      expect(VISUAL_TRACKER_CSS).toContain('opacity: 0.6 !important');
      expect(VISUAL_TRACKER_CSS).toContain('text-shadow:');
      expect(VISUAL_TRACKER_CSS).toContain('.__sl_trail_dot__');
      expect(VISUAL_TRACKER_CSS).toContain('max-width: 480px');

      // 防风控与性能核心断言 1：样式中严禁出现极限 2147483647 外部探测层级，必须使用合理的业务顶层 999999
      expect(VISUAL_TRACKER_CSS).not.toContain('2147483647');
      expect(VISUAL_TRACKER_CSS).toContain('z-index: 999999');

      // 防风控与性能核心断言 2：微粒样式中严禁包含 will-change，避免频繁生成/销毁合成层导致 GPU 显存颠簸
      const dotStyleMatch = VISUAL_TRACKER_CSS.match(/\.__sl_trail_dot__\s*\{([^}]+)\}/);
      expect(dotStyleMatch).not.toBeNull();
      if (dotStyleMatch) {
        expect(dotStyleMatch[1]).not.toContain('will-change');
      }
    });
  });
});
