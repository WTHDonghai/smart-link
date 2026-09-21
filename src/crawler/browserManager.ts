import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { injectStealthScripts, getStealthLaunchArgs } from './stealth';
import { installVisualTracker, ensureVisualTrackerInjected } from './visualTracker';
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
 * 判定 Page 实例是否存活可用
 */
function isPageAlive(page?: Page | null): boolean {
  if (!page) return false;
  return typeof page.isClosed === 'function' ? !page.isClosed() : true;
}

/**
 * 解析指定渠道的专属 Chrome Remote Debugging 端口
 * 使得同一渠道跨进程（如 CLI 重复执行、桌面端与脚本协同）能够通过 CDP 复用已开启的浏览器视窗与 Tab
 */
export function resolveChannelDebugPort(channelCode: string): number {
  const code = (channelCode || 'MEITUAN').trim().toUpperCase();
  const PORT_MAP: Record<string, number> = {
    MEITUAN: 9222,
    MEITUAN_BIZ: 9223,
    DOUYIN: 9224,
    CTRIP: 9225,
  };
  if (PORT_MAP[code]) return PORT_MAP[code];
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) & 0xffff;
  }
  return 9226 + (hash % 74);
}

/**
 * 尝试通过 CDP 连接当前渠道已在本地运行的 Chrome 实例
 */
async function tryConnectExistingBrowser(port: number): Promise<{
  browser: { close: () => Promise<void> };
  context: BrowserContext;
  page: Page;
} | null> {
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: 1200,
    });
    const contexts = browser.contexts?.() || [];
    if (contexts.length === 0) {
      await browser.close?.();
      return null;
    }
    const context = contexts[0];
    const pages = context.pages?.() || [];
    const alivePages = pages.filter((p) => isPageAlive(p));
    const page = alivePages.length > 0 ? alivePages[0] : await context.newPage();
    return { browser, context, page };
  } catch {
    return null;
  }
}

/**
 * 获取或创建渠道绑定的持久化 Chromium 会话；同一渠道只保留一个浏览器上下文并唯一绑定一个 Tab。
 */
export async function createPersistentBrowserSession(
  options: LaunchBrowserOptions
): Promise<BrowserSession> {
  const profileDir = resolveChromeProfileDir(options.channelCode);
  const existingSession = Array.from(activeBrowserSessions)
    .find((session) => session.profileDir === profileDir);

  const isHeadless = options.headless ?? (process.env[PROCESS_ENV_KEYS.playwrightHeadless] === 'true');

  // 1. 进程内已有活跃会话：直接复用 Tab 或自愈恢复
  if (existingSession) {
    if (isPageAlive(existingSession.page)) {
      if (!isHeadless) {
        try {
          await existingSession.page.bringToFront();
        } catch {
          // 忽略前台激活异常
        }
      }
      return existingSession;
    }

    const pages = existingSession.context.pages?.() || [];
    const availablePages = pages.filter((p) => isPageAlive(p));
    const restoredPage = availablePages.length > 0 ? availablePages[0] : await existingSession.context.newPage();

    if (!isHeadless) {
      try {
        await restoredPage.bringToFront();
      } catch {
        // 忽略前台激活异常
      }
    }

    existingSession.page = restoredPage;
    return existingSession;
  }

  // 2. 跨进程探测（如 CLI 重复执行、独立脚本接入）：尝试连接已在本地端口运行的同渠道 Chrome 实例
  const debugPort = resolveChannelDebugPort(options.channelCode);
  const cdpSession = await tryConnectExistingBrowser(debugPort);
  if (cdpSession) {
    if (!isHeadless) {
      try {
        await cdpSession.page.bringToFront?.();
      } catch {
        // 忽略前台激活异常
      }
    }

    const session: BrowserSession = {
      context: cdpSession.context,
      page: cdpSession.page,
      profileDir,
      channelCode: options.channelCode,
      close: async () => {
        activeBrowserSessions.delete(session);
        try {
          // 断开 CDP 连接，绝不关闭外部已运行的浏览器窗口与 Tab
          await cdpSession.browser.close();
        } catch {
          // 忽略断开异常
        }
      },
    };

    activeBrowserSessions.add(session);
    return session;
  }

  // 3. 确保 profile 目录存在
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  } else {
    // 启动前先行清理可能残留的遗留物理锁
    releaseProfileLocks(profileDir);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: isHeadless,
    channel: 'chrome',
    args: [...getStealthLaunchArgs(), `--remote-debugging-port=${debugPort}`],
    ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
    viewport: { width: 1280, height: 850 },
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

  const pages = context.pages?.() || [];
  const alivePages = pages.filter((p) => isPageAlive(p));
  const page = alivePages.length > 0 ? alivePages[0] : await context.newPage();

  // 若以可视化模式运行，将窗口置于前台激活，并确保视觉指示器与接管渲染在当前页面就绪
  if (!isHeadless) {
    try {
      await page.bringToFront();
    } catch {
      // 忽略前台激活异常
    }
    await ensureVisualTrackerInjected(page);
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
