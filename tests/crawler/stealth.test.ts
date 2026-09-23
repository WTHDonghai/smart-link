import { describe, it, expect, vi } from 'vitest';
import { injectStealthScripts, getStealthLaunchArgs } from '../../src/crawler/stealth';
import type { BrowserContext } from 'playwright';

describe('stealth', () => {
  it('returns appropriate chromium launch arguments and excludes blacklisted args', () => {
    const args = getStealthLaunchArgs();
    expect(args).toContain('--disable-blink-features=AutomationControlled');
    expect(args).toContain('--disable-infobars');
    // 关键刚性约束：绝不包含破坏隔离与容易被特征标记的黑名单参数
    expect(args).not.toContain('--disable-features=IsolateOrigins,site-per-process');
  });

  it('registers stealth evasions via addInitScript and ensures un-tampered prototypes & complete chrome object', async () => {
    let initScriptCallback: (() => void) | null = null;
    const mockContext = {
      addInitScript: vi.fn().mockImplementation((cb: () => void) => {
        initScriptCallback = cb;
        return Promise.resolve();
      }),
    } as unknown as BrowserContext;

    await injectStealthScripts(mockContext);
    expect(mockContext.addInitScript).toHaveBeenCalledTimes(1);
    expect(initScriptCallback).toBeTypeOf('function');

    // 模拟环境执行
    const fakeNavigatorProto: Record<string, unknown> = {};
    const fakeNavigator = Object.create(fakeNavigatorProto);
    fakeNavigator.webdriver = true; // 模拟可能残留的实例自有属性
    const originalQuery = vi.fn().mockResolvedValue({ state: 'denied' });
    fakeNavigator.permissions = {
      query: originalQuery,
    };

    const originalNavigator = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: fakeNavigator,
        configurable: true,
        writable: true,
      });

      // 执行注入回调
      initScriptCallback!();

      // 1. 验证 Function.prototype.toString 绝未被手写包装污染（原生函数 prototype 属性不存在）
      expect(Function.prototype.toString.hasOwnProperty('prototype')).toBe(false);

      // 2. 验证实例自有属性 webdriver 被彻底清理，且未在原型链上手写 JS Getter
      expect(fakeNavigator.hasOwnProperty('webdriver')).toBe(false);
      expect(fakeNavigatorProto.hasOwnProperty('webdriver')).toBe(false);

      // 3. 验证 window.chrome 存在且 loadTimes 提供完备的浮点时间戳对象
      const chromeObj = (globalThis as unknown as {
        chrome?: {
          loadTimes?: () => {
            requestTime: number;
            startLoadTime: number;
            commitLoadTime: number;
            finishDocumentLoadTime: number;
            finishLoadTime: number;
            firstPaintTime: number;
            navigationType: string;
          };
          csi?: () => { startE: number; onloadT: number; pageT: number };
        };
      }).chrome;
      expect(chromeObj).toBeDefined();
      expect(typeof chromeObj?.loadTimes).toBe('function');
      const loadTimes = chromeObj!.loadTimes!();
      expect(typeof loadTimes.requestTime).toBe('number');
      expect(loadTimes.requestTime).toBeGreaterThan(0);
      expect(loadTimes.startLoadTime).toBeGreaterThanOrEqual(loadTimes.requestTime);
      expect(loadTimes.commitLoadTime).toBeGreaterThanOrEqual(loadTimes.startLoadTime);
      expect(loadTimes.finishDocumentLoadTime).toBeGreaterThanOrEqual(loadTimes.commitLoadTime);
      expect(loadTimes.finishLoadTime).toBeGreaterThanOrEqual(loadTimes.finishDocumentLoadTime);
      expect(loadTimes.firstPaintTime).toBeGreaterThanOrEqual(loadTimes.commitLoadTime);
      expect(loadTimes.navigationType).toBe('Other');

      // 4. 验证 permissions.query 对 notifications 返回 prompt，其他权限透传原生 query
      const notifRes = await fakeNavigator.permissions.query({ name: 'notifications' });
      expect(notifRes.state).toBe('prompt');
      await fakeNavigator.permissions.query({ name: 'camera' as PermissionName });
      expect(originalQuery).toHaveBeenCalledWith({ name: 'camera' });
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    }
  });
});

