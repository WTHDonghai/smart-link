import type { BrowserContext, Page } from 'playwright';

/**
 * 注入反爬规避脚本 (Stealth Evasions)
 * 针对国内 OTA 平台（美团、抖音等）常见的自动化检测手段进行规避：
 * 1. 保持原生 webdriver 状态（由 --disable-blink-features=AutomationControlled 原生置为 false，并清理实例自有属性）
 * 2. 模拟真实 Chrome 环境的 window.chrome 对象及逼真的 loadTimes 时间戳
 * 3. 规范中文语言栈 (navigator.languages) 在原型链上的定义
 * 4. 规避权限查询异常 (Permissions API)
 */
export async function injectStealthScripts(target: BrowserContext | Page): Promise<void> {
  await target.addInitScript(() => {
    // 1. 消除 navigator.webdriver 实例自有属性（由启动参数原生置为 false，坚决不手写原型链 Getter 避免 Reflect.apply 探针检测）
    try {
      if (Object.prototype.hasOwnProperty.call(navigator, 'webdriver')) {
        delete (navigator as unknown as { webdriver?: unknown }).webdriver;
      }
    } catch {
      // 忽略属性删除异常
    }

    // 2. 伪装 Chrome 专有 runtime 对象，并提供逼真的 loadTimes 时间戳
    if (!(window as unknown as { chrome?: unknown }).chrome) {
      const nowSeconds = Date.now() / 1000;
      const startLoad = nowSeconds - 0.65;
      Object.defineProperty(window, 'chrome', {
        value: {
          app: { isInstalled: false },
          webstore: {},
          runtime: {
            OnInstalledReason: {},
            OnRestartRequiredReason: {},
            PlatformArch: {},
            PlatformNaclArch: {},
            PlatformOs: {},
            RequestUpdateCheckStatus: {},
          },
          csi: () => ({
            startE: Math.round(startLoad * 1000),
            onloadT: Math.round(nowSeconds * 1000),
            pageT: Math.round((nowSeconds - startLoad) * 1000),
            tran: 15,
          }),
          loadTimes: () => ({
            requestTime: startLoad,
            startLoadTime: startLoad + 0.05,
            commitLoadTime: startLoad + 0.12,
            finishDocumentLoadTime: startLoad + 0.38,
            finishLoadTime: startLoad + 0.45,
            firstPaintTime: startLoad + 0.25,
            firstPaintAfterLoadTime: 0,
            navigationType: 'Other',
            wasFetchedViaSpdy: true,
            wasNpnNegotiated: true,
            npnNegotiatedProtocol: 'h2',
            wasAlternateProtocolAvailable: false,
            connectionInfo: 'h2',
          }),
        },
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    // 3. 模拟真实语言栈（规范在原型链上定义，保留原生属性特征）
    try {
      const proto = Object.getPrototypeOf(navigator);
      if (proto && !navigator.languages?.includes('zh-CN')) {
        Object.defineProperty(proto, 'languages', {
          get: () => ['zh-CN', 'zh', 'en-US', 'en'],
          configurable: true,
          enumerable: true,
        });
      }
    } catch {
      // 忽略无法覆写异常
    }

    // 4. 规避权限查询异常
    if (navigator.permissions && navigator.permissions.query) {
      const originalQuery = navigator.permissions.query;
      const queryProxy = function query(parameters: PermissionDescriptor) {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({
            state: 'prompt',
            name: 'notifications',
            onchange: null,
          } as unknown as PermissionStatus);
        }
        return originalQuery.call(navigator.permissions, parameters);
      };
      navigator.permissions.query = queryProxy;
    }
  });
}

/**
 * 获取用于防封禁的 Chromium 启动参数
 */
export function getStealthLaunchArgs(): string[] {
  return [
    '--disable-blink-features=AutomationControlled',
    '--no-default-browser-check',
    '--no-first-run',
    '--disable-infobars',
    '--window-size=1280,900',
  ];
}
