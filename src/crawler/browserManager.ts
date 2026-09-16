import path from 'node:path';
import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { injectStealthScripts, getStealthLaunchArgs } from './stealth';

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

  const isHeadless = options.headless ?? (process.env.PLAYWRIGHT_HEADLESS !== 'false');

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: isHeadless,
    channel: 'chrome',
    args: getStealthLaunchArgs(),
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    ignoreHTTPSErrors: true,
  });

  // 注入反爬脚本
  await injectStealthScripts(context);

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

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
