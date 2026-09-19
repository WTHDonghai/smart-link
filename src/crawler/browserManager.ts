import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { injectStealthScripts, getStealthLaunchArgs } from './stealth';
import { installVisualTracker } from './visualTracker';
import { resolveChromeProfileDir } from './paths';
import { PROCESS_ENV_KEYS } from '../types/env';

export interface LaunchBrowserOptions {
  channelCode: string;
  headless?: boolean;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
  profileDir?: string;
  channelCode?: string;
}

/** 模块内活跃浏览器会话集合，用于全生命周期追踪与统一退出清场 */
const activeBrowserSessions = new Set<BrowserSession>();

/**
 * 释放 Profile 物理锁文件 (SingletonLock / LOCK / SingletonSocket / SingletonCookie)
 * 杜绝异常崩溃后遗留锁导致 Chromium 报 "Profile in use" 或产生孤儿进程残留
 */
export function releaseProfileLocks(profileDir: string): void {
  if (!profileDir || !fs.existsSync(profileDir)) return;
  const lockNames = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'LOCK', 'lockfile'];
  for (const name of lockNames) {
    const p = path.join(profileDir, name);
    try {
      if (fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink()) {
        fs.rmSync(p, { force: true, recursive: true });
      }
    } catch {
      // 忽略无法删除的情况
    }
  }

  const defaultDir = path.join(profileDir, 'Default');
  if (fs.existsSync(defaultDir)) {
    for (const name of lockNames) {
      const p = path.join(defaultDir, name);
      try {
        if (fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink()) {
          fs.rmSync(p, { force: true, recursive: true });
        }
      } catch {
        // 忽略
      }
    }
  }
}

/**
 * 获取当前活跃浏览器会话数量（用于测试与系统健康检查）
 */
export function getActiveBrowserSessionsCount(): number {
  return activeBrowserSessions.size;
}

/**
 * 获取当前活跃浏览器会话只读集合
 */
export function getActiveBrowserSessions(): ReadonlySet<BrowserSession> {
  return activeBrowserSessions;
}

/**
 * 统一清场函数：并发安全关闭所有未释放的 BrowserContext，完全清空活跃集合，释放 Profile 物理锁文件
 */
export async function closeAllBrowserSessions(): Promise<void> {
  const sessions = Array.from(activeBrowserSessions);
  activeBrowserSessions.clear();

  await Promise.allSettled(
    sessions.map(async (session) => {
      try {
        await session.close();
      } catch {
        // 忽略单个关闭异常，确保所有 session 都被尝试关闭
      } finally {
        if (session.profileDir) {
          releaseProfileLocks(session.profileDir);
        }
      }
    })
  );
}

/**
 * 启动带反爬规避与本地独立持久化 Profile 的 Chromium 浏览器上下文
 */
export async function createPersistentBrowserSession(
  options: LaunchBrowserOptions
): Promise<BrowserSession> {
  const profileDir = resolveChromeProfileDir(options.channelCode);

  // 确保 profile 目录存在
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  } else {
    // 启动前先行清理可能残留的遗留物理锁
    releaseProfileLocks(profileDir);
  }

  // 默认以可视化窗口 (Headed) 启动，让用户清晰目睹自动化操作流程，获得操作掌控感与确定性；
  // 仅在显式指定 headless: true 或环境变量 PLAYWRIGHT_HEADLESS === 'true' 时才走无头模式。
  const isHeadless = options.headless ?? (process.env[PROCESS_ENV_KEYS.playwrightHeadless] === 'true');

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: isHeadless,
    channel: 'chrome',
    args: getStealthLaunchArgs(),
    ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
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

  const session: BrowserSession = {
    context,
    page,
    profileDir,
    channelCode: options.channelCode,
    close: async () => {
      activeBrowserSessions.delete(session);
      try {
        await context.close();
      } catch {
        // 忽略关闭时的非致命异常
      } finally {
        releaseProfileLocks(profileDir);
      }
    },
  };

  // 监听底层 Context close 事件（如用户手动关闭浏览器窗口），自动注销并释放锁
  context.on?.('close', () => {
    activeBrowserSessions.delete(session);
    releaseProfileLocks(profileDir);
  });

  activeBrowserSessions.add(session);

  return session;
}
