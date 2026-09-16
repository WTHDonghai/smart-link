import path from 'node:path';
import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { injectStealthScripts, getStealthLaunchArgs } from './stealth';
import { installVisualTracker } from './visualTracker';

export interface LaunchBrowserOptions {
  channelId: string;
  headless?: boolean;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/**
 * 启动带反爬规避与本地独立持久化 Profile 的 Chromium 浏览器上下文
 */
export async function createPersistentBrowserSession(
  options: LaunchBrowserOptions
): Promise<BrowserSession> {
  const profileDir = path.resolve(process.cwd(), '.chrome-profile', options.channelId);

  // 确保 profile 目录存在
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  // 默认以可视化窗口 (Headed) 启动，让用户清晰目睹自动化操作流程，获得操作掌控感与确定性；
  // 仅在显式指定 headless: true 或环境变量 PLAYWRIGHT_HEADLESS === 'true' 时才走无头模式。
  const isHeadless = options.headless ?? (process.env.PLAYWRIGHT_HEADLESS === 'true');

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: isHeadless,
    channel: 'chrome',
    args: getStealthLaunchArgs(),
    viewport: { width: 1280, height: 850 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    ignoreHTTPSErrors: true,
  });

  // 注入反爬脚本
  await injectStealthScripts(context);

  // 注入大模型接管风格的视觉自动化轨迹与状态 HUD (在可视化模式下)
  if (!isHeadless) {
    await installVisualTracker(context);
  }

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  // 若以可视化模式运行，将窗口置于前台激活
  if (!isHeadless) {
    try {
      await page.bringToFront();
    } catch {
      // 忽略前台激活异常
    }
  }

  return {
    context,
    page,
    close: async () => {
      try {
        await context.close();
      } catch {
        // 忽略关闭时的非致命异常
      }
    },
  };
}
