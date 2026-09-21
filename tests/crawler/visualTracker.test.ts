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
  TrackerStatusType,
} from '../../src/crawler/visualTracker';
import { VISUAL_TRACKER_CSS } from '../../src/crawler/visualTrackerStyles';

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
  appendChild: (child: MockElement) => MockElement;
}

interface MockDocument {
  body: MockElement;
  documentElement: MockElement;
  head: MockElement;
  readyState: string;
  getElementById: (id: string) => MockElement | null;
  createElement: (tag: string) => MockElement;
  addEventListener: (event: string, handler: unknown, options?: unknown) => void;
}

interface MockWindow {
  top?: MockWindow;
  addEventListener: (event: string, handler: unknown, options?: unknown) => void;
  __SMARTLINK_TRACKER__?: {
    ensureMounted: () => void;
    setCursor: (x: number, y: number, clicking?: boolean) => void;
    createRipple: (x: number, y: number) => void;
    setHighlight: (rect: { left: number; top: number; width: number; height: number } | null) => void;
    setStatus: (text: string, type?: TrackerStatusType) => void;
  };
}

function createMockElement(id = '', elementsMap?: Map<string, MockElement>): MockElement {
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
    appendChild: vi.fn((child: MockElement) => {
      if (child.id && elementsMap) elementsMap.set(child.id, child);
      return child;
    }),
  };
  return elem;
}

function createMockEnvironment(isIframe = false, isCrossOrigin = false) {
  const elements = new Map<string, MockElement>();
  const mockBody = createMockElement('body', elements);
  const mockHead = createMockElement('head', elements);

  const mockDoc: MockDocument = {
    body: mockBody,
    documentElement: mockBody,
    head: mockHead,
    readyState: 'complete',
    getElementById: vi.fn((id: string) => elements.get(id) || null),
    createElement: vi.fn((tag: string) => {
      const el = createMockElement('', elements);
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

  return { mockDoc, mockWin, elements };
}

describe('visualTracker', () => {
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
    it('calls evaluate with coordinates and waits for animation frame', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualMoveMouse(mockPage, 250, 400);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(180);
    });
  });

  describe('visualClickLocator', () => {
    it('scrolls, calculates bounding box, moves cursor, pulses and performs click', async () => {
      const mockLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 200, width: 80, height: 40 }),
        click: vi.fn().mockResolvedValue(undefined),
      } as unknown as Locator;

      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualClickLocator(mockPage, mockLocator, '点击目标按钮');
      expect(mockLocator.scrollIntoViewIfNeeded).toHaveBeenCalled();
      expect(mockLocator.boundingBox).toHaveBeenCalled();
      expect(mockLocator.click).toHaveBeenCalledWith({ timeout: 4000 });
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('falls back to direct click when bounding box is null', async () => {
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
      expect(mockLocator.click).toHaveBeenCalledWith({ timeout: 4000 });
    });

    it('ensures cursor reset (clicking=false) and highlight cleanup (null) in finally even when click throws error', async () => {
      const mockLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 200, width: 80, height: 40 }),
        click: vi.fn().mockRejectedValue(new Error('Target intercepted by overlay')),
      } as unknown as Locator;

      const evaluateCalls: Array<{ fn: unknown; arg: unknown }> = [];
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockImplementation((fn: unknown, arg: unknown) => {
          evaluateCalls.push({ fn, arg });
          return Promise.resolve();
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await expect(
        visualClickLocator(mockPage, mockLocator, '异常点击测试')
      ).rejects.toThrow('Target intercepted by overlay');

      // 验证常规点击与强制降级点击均被尝试 (2次)
      expect(mockLocator.click).toHaveBeenCalledTimes(2);

      // 验证 finally 状态清理函数被调用
      expect(evaluateCalls.length).toBeGreaterThanOrEqual(4);
      const lastCall = evaluateCalls[evaluateCalls.length - 1] as {
        fn: (arg: { x: number; y: number }) => void;
        arg: { x: number; y: number };
      };
      expect(lastCall.arg).toEqual({ x: 140, y: 220 });

      // 诚实验证回调确实将光标重置为非点击态 (clicking=false) 并清理高亮框 (null)
      const mockTracker = {
        setCursor: vi.fn(),
        setHighlight: vi.fn(),
      };
      (globalThis as unknown as { window: { __SMARTLINK_TRACKER__: typeof mockTracker } }).window = {
        __SMARTLINK_TRACKER__: mockTracker,
      };

      lastCall.fn(lastCall.arg);

      expect(mockTracker.setCursor).toHaveBeenCalledWith(140, 220, false);
      expect(mockTracker.setHighlight).toHaveBeenCalledWith(null);
    });

    it('recovers cursor and highlight in finally when regular click fails but fallback force click succeeds', async () => {
      const clickMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('Element is obscured'))
        .mockResolvedValueOnce(undefined);

      const mockLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue({ x: 50, y: 80, width: 100, height: 50 }),
        click: clickMock,
      } as unknown as Locator;

      const evaluateCalls: Array<{ fn: unknown; arg: unknown }> = [];
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockImplementation((fn: unknown, arg: unknown) => {
          evaluateCalls.push({ fn, arg });
          return Promise.resolve();
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualClickLocator(mockPage, mockLocator, '降级点击测试');

      expect(clickMock).toHaveBeenCalledTimes(2);

      const lastCall = evaluateCalls[evaluateCalls.length - 1] as {
        fn: (arg: { x: number; y: number }) => void;
        arg: { x: number; y: number };
      };
      const mockTracker = {
        setCursor: vi.fn(),
        setHighlight: vi.fn(),
      };
      (globalThis as unknown as { window: { __SMARTLINK_TRACKER__: typeof mockTracker } }).window = {
        __SMARTLINK_TRACKER__: mockTracker,
      };
      lastCall.fn(lastCall.arg);

      expect(mockTracker.setCursor).toHaveBeenCalledWith(100, 105, false);
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
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(300);
    });
  });

  describe('Top-level window guard (me-iframe isolation)', () => {
    it('strictly does not inject DOM or tracker when running inside an iframe (window !== window.top)', () => {
      const { mockDoc, mockWin, elements } = createMockEnvironment(true); // isIframe = true

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      // 绝不在嵌套子 iframe (如商户后台 me-iframe) 内部挂载任何指示器 DOM 与样式
      expect(elements.size).toBe(0);
      expect(mockDoc.getElementById('__smartlink_tracker_styles__')).toBeNull();
      expect(mockDoc.getElementById('__smartlink_takeover_vignette__')).toBeNull();
      expect(mockDoc.getElementById('__smartlink_cursor__')).toBeNull();
      expect(mockDoc.getElementById('__smartlink_hud__')).toBeNull();
      expect(mockDoc.getElementById('__smartlink_highlight__')).toBeNull();
      expect(mockWin.__SMARTLINK_TRACKER__).toBeUndefined();
    });

    it('safely handles cross-origin iframe security exceptions without injecting DOM', () => {
      const { mockDoc, mockWin, elements } = createMockEnvironment(false, true); // isCrossOrigin = true

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      expect(() => execute(mockDoc, mockWin)).not.toThrow();

      expect(elements.size).toBe(0);
      expect(mockWin.__SMARTLINK_TRACKER__).toBeUndefined();
    });
  });

  describe('In-Page DOM mounting and takeover lifecycle', () => {
    it('injects style, vignette, cursor, HUD and highlight into top-level document', () => {
      const { mockDoc, mockWin, elements } = createMockEnvironment(false); // Top-level window

      // 执行真实的注入脚本
      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      expect(mockDoc.getElementById('__smartlink_tracker_styles__')).not.toBeNull();
      expect(mockDoc.getElementById('__smartlink_takeover_vignette__')).not.toBeNull();
      expect(mockDoc.getElementById('__smartlink_cursor__')).not.toBeNull();
      expect(mockDoc.getElementById('__smartlink_hud__')).not.toBeNull();
      expect(mockDoc.getElementById('__smartlink_highlight__')).not.toBeNull();

      const tracker = mockWin.__SMARTLINK_TRACKER__;
      expect(tracker).toBeDefined();

      // 初始状态：虚拟光标必须隐藏 (opacity: 0)，防止突兀显示在可视区中
      const cursor = mockDoc.getElementById('__smartlink_cursor__');
      expect(cursor).not.toBeNull();
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
      const highlight = mockDoc.getElementById('__smartlink_highlight__');
      expect(highlight?.style.opacity).toBe('1');
      expect(highlight?.style.left).toBe('47px');

      // 验证高亮清理
      tracker?.setHighlight(null);
      expect(highlight?.style.opacity).toBe('0');

      // 验证自愈恢复能力：清空元素集合后执行 ensureMounted 重新挂载
      elements.clear();
      expect(mockDoc.getElementById('__smartlink_hud__')).toBeNull();

      tracker?.ensureMounted();
      expect(mockDoc.getElementById('__smartlink_hud__')).not.toBeNull();
      expect(mockDoc.getElementById('__smartlink_takeover_vignette__')).not.toBeNull();
    });

    it('synchronizes corner crosshairs and status dot with theme colors via CSS variables', () => {
      const { mockDoc, mockWin, elements } = createMockEnvironment(false);

      const execute = new Function('document', 'window', `${VISUAL_TRACKER_SCRIPT}`);
      execute(mockDoc, mockWin);

      const tracker = mockWin.__SMARTLINK_TRACKER__;
      expect(tracker).toBeDefined();

      // 模拟子元素查找
      const textElem = createMockElement('__sl_text__', elements);
      const dotElem = createMockElement('__sl_dot__', elements);
      elements.set('__sl_text__', textElem);
      elements.set('__sl_dot__', dotElem);

      const vignette = mockDoc.getElementById('__smartlink_takeover_vignette__');
      expect(vignette).not.toBeNull();

      // 1. action (操作紫)
      tracker?.setStatus('执行点击操作', 'action');
      expect(textElem.textContent).toBe('执行点击操作');
      expect(dotElem.style.background).toBe('#8b5cf6');
      expect(vignette?.className).toBe('theme-action');
      expect(vignette?.style['--sl-accent-color']).toBe('#8b5cf6');

      // 2. error (错误红)
      tracker?.setStatus('页面拦截报警', 'error');
      expect(textElem.textContent).toBe('页面拦截报警');
      expect(dotElem.style.background).toBe('#ef4444');
      expect(vignette?.className).toBe('theme-error');
      expect(vignette?.style['--sl-accent-color']).toBe('#ef4444');

      // 3. warn (警告橙)
      tracker?.setStatus('等待重试中', 'warn');
      expect(textElem.textContent).toBe('等待重试中');
      expect(dotElem.style.background).toBe('#f59e0b');
      expect(vignette?.className).toBe('theme-warn');
      expect(vignette?.style['--sl-accent-color']).toBe('#f59e0b');

      // 4. success (成功绿)
      tracker?.setStatus('订单值守完成', 'success');
      expect(textElem.textContent).toBe('订单值守完成');
      expect(dotElem.style.background).toBe('#10b981');
      expect(vignette?.className).toBe('theme-success');
      expect(vignette?.style['--sl-accent-color']).toBe('#10b981');

      // 5. info (默认蓝)
      tracker?.setStatus('就绪中', 'info');
      expect(textElem.textContent).toBe('就绪中');
      expect(dotElem.style.background).toBe('#3b82f6');
      expect(vignette?.className).toBe('theme-info');
      expect(vignette?.style['--sl-accent-color']).toBe('#004ac6');
    });

    it('enforces HUD text truncation and eliminates illegal CSS syntax', () => {
      // 语法合法性检验：严禁非法 shrink: 0;，强制使用标准 flex-shrink: 0;
      expect(VISUAL_TRACKER_SCRIPT).not.toMatch(/(?<![a-zA-Z-])shrink:\s*0/);
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/flex-shrink:\s*0;/);

      // HUD 文本长内容截断防护
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/max-width:\s*480px;/);
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/overflow:\s*hidden;/);
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/text-overflow:\s*ellipsis;/);
      expect(VISUAL_TRACKER_SCRIPT).toMatch(/white-space:\s*nowrap;/);

      // CSS 样式表中必须包含主题变量和四角联动定义
      expect(VISUAL_TRACKER_CSS).toContain('--sl-accent-color');
      expect(VISUAL_TRACKER_CSS).toContain('var(--sl-accent-color');
      expect(VISUAL_TRACKER_CSS).toContain('max-width: 480px');
      expect(VISUAL_TRACKER_CSS).toContain('text-overflow: ellipsis');
    });
  });
});
