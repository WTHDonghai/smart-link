import type { BrowserContext, Page } from 'playwright';

/**
 * 注入反爬规避脚本 (Stealth Evasions)
 * 针对国内 OTA 平台（美团、抖音等）常见的自动化检测手段进行规避：
 * 1. 移除 navigator.webdriver 标记
 * 2. 模拟真实 Chrome 环境的 window.chrome 对象
 * 3. 补齐中文语言栈 (navigator.languages) 与常用插件列表
 * 4. 伪装 WebGL 渲染管线
 * 5. 修复 Permissions API 检测
 */
export async function injectStealthScripts(target: BrowserContext | Page): Promise<void> {
  await target.addInitScript(() => {
    // 1. 消除 navigator.webdriver 特征
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });

    // 2. 伪装 Chrome 专有 runtime 对象
    if (!(window as unknown as { chrome?: unknown }).chrome) {
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
          csi: () => {},
          loadTimes: () => {},
        },
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    // 3. 模拟真实语言栈
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });

    // 4. 模拟常用浏览器插件 (PDF 等)
    try {
      const fakePlugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      Object.defineProperty(navigator, 'plugins', {
        get: () => fakePlugins,
        configurable: true,
      });
    } catch {
      // 忽略无法覆写异常
    }

    // 5. 规避权限查询异常
    if (navigator.permissions && navigator.permissions.query) {
      const originalQuery = navigator.permissions.query;
      navigator.permissions.query = (parameters: PermissionDescriptor) => {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({
            state: 'prompt',
            name: 'notifications',
            onchange: null,
          } as unknown as PermissionStatus);
        }
        return originalQuery.call(navigator.permissions, parameters);
      };
    }
  });
}

/**
 * 获取用于防封禁的 Chromium 启动参数
 */
export function getStealthLaunchArgs(): string[] {
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-default-browser-check',
    '--no-first-run',
    '--disable-infobars',
    '--window-size=1280,900',
  ];
}
