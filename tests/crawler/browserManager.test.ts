import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  createPersistentBrowserSession,
  closeAllBrowserSessions,
  getActiveBrowserSessionsCount,
  getActiveBrowserSessions,
  releaseProfileLocks,
} from '../../src/crawler/browserManager';
import { resolveChromeProfileDir } from '../../src/crawler/paths';
import { chromium } from 'playwright';

vi.mock('playwright', () => {
  return {
    chromium: {
      launchPersistentContext: vi.fn(),
      connectOverCDP: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    },
  };
});

function createMockContext(failOnClose = false) {
  const closeCallbacks: Array<() => void> = [];
  return {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    pages: vi.fn().mockReturnValue([]),
    newPage: vi.fn().mockResolvedValue({
      bringToFront: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
    }),
    close: vi.fn().mockImplementation(async () => {
      if (failOnClose) {
        throw new Error('Chromium 进程关闭超时异常');
      }
      closeCallbacks.forEach((cb) => cb());
    }),
    on: vi.fn().mockImplementation((event: string, cb: () => void) => {
      if (event === 'close') {
        closeCallbacks.push(cb);
      }
    }),
    emitClose: () => {
      closeCallbacks.forEach((cb) => cb());
    },
  };
}

describe('browserManager', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await closeAllBrowserSessions();
  });

  afterEach(async () => {
    await closeAllBrowserSessions();
  });

  it('should launch persistent context with ignoreDefaultArgs including --use-mock-keychain to preserve Keychain cookies', async () => {
    const mockContext = createMockContext();
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as unknown as never);

    const session = await createPersistentBrowserSession({
      channelCode: 'MEITUAN',
      headless: true,
    });

    expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);

    const [calledProfileDir, calledOptions] = vi.mocked(chromium.launchPersistentContext).mock.calls[0];
    expect(calledProfileDir).toBe(resolveChromeProfileDir('MEITUAN'));
    expect(calledOptions?.channel).toBe('chrome');
    expect(calledOptions?.headless).toBe(true);

    // 核心断言：必须声明忽略 --enable-automation, --use-mock-keychain 与 --password-store=basic
    expect(calledOptions?.ignoreDefaultArgs).toEqual(
      expect.arrayContaining(['--enable-automation', '--use-mock-keychain', '--password-store=basic'])
    );
    expect(calledOptions?.viewport).toBeNull();

    await session.close();
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it('should respect SMARTLINK_USER_DATA_DIR env variable when set in Electron environment', async () => {
    const customUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-user-data-'));
    process.env.SMARTLINK_USER_DATA_DIR = customUserData;

    const mockContext = createMockContext();
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as unknown as never);

    try {
      const session = await createPersistentBrowserSession({
        channelCode: 'MEITUAN_BIZ',
        headless: true,
      });

      const [calledProfileDir] = vi.mocked(chromium.launchPersistentContext).mock.calls[0];
      expect(calledProfileDir).toBe(path.resolve(customUserData, '.chrome-profile', 'meituan_biz'));

      await session.close();
    } finally {
      delete process.env.SMARTLINK_USER_DATA_DIR;
      if (fs.existsSync(customUserData)) {
        fs.rmSync(customUserData, { recursive: true, force: true });
      }
    }
  });

  describe('activeBrowserSessions 自动登记与注销机制', () => {
    it('同一 profile 已有活跃会话时复用渠道绑定页面', async () => {
      const mockContext = createMockContext();
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as unknown as never);

      const session = await createPersistentBrowserSession({
        channelCode: 'MEITUAN',
        headless: true,
      });

      const reusedSession = await createPersistentBrowserSession({
        channelCode: 'MEITUAN',
        headless: true,
      });

      expect(reusedSession).toBe(session);
      expect(reusedSession.page).toBe(session.page);
      expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
      await session.close();
      expect(getActiveBrowserSessionsCount()).toBe(0);
    });

    it('同一渠道多次获取会话时必须绑定并复用同一个 Tab (Page)，不创建重复 Tab', async () => {
      const mockPage = {
        bringToFront: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        isClosed: vi.fn().mockReturnValue(false),
      };
      const mockContext = {
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as unknown as never);

      const session1 = await createPersistentBrowserSession({ channelCode: 'MEITUAN', headless: false });
      expect(session1.page).toBe(mockPage);

      const session2 = await createPersistentBrowserSession({ channelCode: 'MEITUAN', headless: false });
      expect(session2).toBe(session1);
      expect(session2.page).toBe(mockPage);
      // 核心断言：未开辟新 Tab（newPage 未被额外调用）
      expect(mockContext.newPage).not.toHaveBeenCalled();
      // 核心断言：在非 headless 模式下被激活置顶
      expect(mockPage.bringToFront).toHaveBeenCalled();
      await session1.close();
    });

    it('当渠道绑定的 Tab 被手动关闭后，再次请求时能够自动自愈重新绑定新 Tab，不返回已关闭的 Page', async () => {
      const firstClosedPage = {
        bringToFront: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        isClosed: vi.fn().mockReturnValue(false),
      };
      const healedPage = {
        bringToFront: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        isClosed: vi.fn().mockReturnValue(false),
      };
      const mockContext = {
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([firstClosedPage]),
        newPage: vi.fn().mockResolvedValue(healedPage),
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as unknown as never);

      const session = await createPersistentBrowserSession({ channelCode: 'MEITUAN', headless: true });
      expect(session.page).toBe(firstClosedPage);

      // 模拟用户手动关闭了第一个 Tab
      firstClosedPage.isClosed.mockReturnValue(true);
      mockContext.pages.mockReturnValue([]);

      // 再次获取渠道会话，必须自愈
      const healedSession = await createPersistentBrowserSession({ channelCode: 'MEITUAN', headless: true });
      expect(healedSession).toBe(session);
      // 核心断言：自动重新绑定为新 Tab，绝不返回已关闭的 Page 实例
      expect(healedSession.page).toBe(healedPage);
      expect(mockContext.newPage).toHaveBeenCalledTimes(1);

      await session.close();
    });

    it('跨进程场景：当本地端口已有运行中浏览器时，通过 CDP 直接复用已有的浏览器视窗与 Tab，不重复启动新进程', async () => {
      const existingTab = {
        bringToFront: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        isClosed: vi.fn().mockReturnValue(false),
      };
      const cdpContext = {
        pages: vi.fn().mockReturnValue([existingTab]),
        newPage: vi.fn(),
      };
      const cdpBrowser = {
        contexts: vi.fn().mockReturnValue([cdpContext]),
        close: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(chromium.connectOverCDP).mockResolvedValueOnce(cdpBrowser as unknown as never);

      const session = await createPersistentBrowserSession({ channelCode: 'MEITUAN', headless: false });
      // 核心断言：直接复用已有浏览器的 Tab，不重新调用 launchPersistentContext
      expect(session.page).toBe(existingTab);
      expect(chromium.launchPersistentContext).not.toHaveBeenCalled();
      expect(existingTab.bringToFront).toHaveBeenCalled();

      // 关闭会话时仅断开 CDP，不杀死外部浏览器
      await session.close();
      expect(cdpBrowser.close).toHaveBeenCalledTimes(1);
    });

    it('会话启动时自动加入集合，调用 session.close() 后自动从集合移除并释放锁文件', async () => {
      const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-session-test-'));
      process.env.SMARTLINK_USER_DATA_DIR = tempUserData;

      try {
        const mockContext = createMockContext();
        vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as unknown as never);

        expect(getActiveBrowserSessionsCount()).toBe(0);

        const session = await createPersistentBrowserSession({
          channelCode: 'MEITUAN',
          headless: true,
        });

        // 断言：登记生效，集合数确切为 1
        expect(getActiveBrowserSessionsCount()).toBe(1);
        expect(getActiveBrowserSessions().has(session)).toBe(true);

        // 模拟 Profile 目录下生成了 Chromium 锁文件
        const profileDir = resolveChromeProfileDir('MEITUAN');
        const lockFile = path.join(profileDir, 'SingletonLock');
        const levelDbLock = path.join(profileDir, 'LOCK');
        fs.writeFileSync(lockFile, '12345');
        fs.writeFileSync(levelDbLock, 'lock');
        expect(fs.existsSync(lockFile)).toBe(true);
        expect(fs.existsSync(levelDbLock)).toBe(true);

        // 关闭会话
        await session.close();

        // 核心断言：集合数确切归零，锁文件被彻底清除
        expect(getActiveBrowserSessionsCount()).toBe(0);
        expect(mockContext.close).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(lockFile)).toBe(false);
        expect(fs.existsSync(levelDbLock)).toBe(false);
      } finally {
        delete process.env.SMARTLINK_USER_DATA_DIR;
        if (fs.existsSync(tempUserData)) {
          fs.rmSync(tempUserData, { recursive: true, force: true });
        }
      }
    });

    it('当 Chromium Context 触发底层 close 事件（如用户直接关闭视窗），自动从集合注销', async () => {
      const mockContext = createMockContext();
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as unknown as never);

      const session = await createPersistentBrowserSession({
        channelCode: 'CTRIP',
        headless: true,
      });

      expect(getActiveBrowserSessionsCount()).toBe(1);

      // 模拟外部触发 Context close 事件
      mockContext.emitClose();

      // 核心断言：自动注销，无需手动调用 session.close()
      expect(getActiveBrowserSessionsCount()).toBe(0);
      expect(getActiveBrowserSessions().has(session)).toBe(false);
    });
  });

  describe('closeAllBrowserSessions 批量回收与清场', () => {
    it('并发安全关闭所有未释放的 BrowserContext，清空活跃集合并释放物理锁', async () => {
      const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-close-all-'));
      process.env.SMARTLINK_USER_DATA_DIR = tempUserData;

      try {
        const mockContext1 = createMockContext();
        const mockContext2 = createMockContext();

        vi.mocked(chromium.launchPersistentContext)
          .mockResolvedValueOnce(mockContext1 as unknown as never)
          .mockResolvedValueOnce(mockContext2 as unknown as never);

        const s1 = await createPersistentBrowserSession({ channelCode: 'MEITUAN', headless: true });
        const s2 = await createPersistentBrowserSession({ channelCode: 'DOUYIN', headless: true });

        expect(getActiveBrowserSessionsCount()).toBe(2);

        // 创建各渠道锁文件
        const lock1 = path.join(s1.profileDir!, 'SingletonLock');
        const lock2 = path.join(s2.profileDir!, 'LOCK');
        fs.writeFileSync(lock1, 'pid-1');
        fs.writeFileSync(lock2, 'pid-2');
        expect(fs.existsSync(lock1)).toBe(true);
        expect(fs.existsSync(lock2)).toBe(true);

        // 执行批量清场
        await closeAllBrowserSessions();

        // 核心断言：两个 Context 均被关闭，集合清空，锁文件删除
        expect(mockContext1.close).toHaveBeenCalledTimes(1);
        expect(mockContext2.close).toHaveBeenCalledTimes(1);
        expect(getActiveBrowserSessionsCount()).toBe(0);
        expect(fs.existsSync(lock1)).toBe(false);
        expect(fs.existsSync(lock2)).toBe(false);
      } finally {
        delete process.env.SMARTLINK_USER_DATA_DIR;
        if (fs.existsSync(tempUserData)) {
          fs.rmSync(tempUserData, { recursive: true, force: true });
        }
      }
    });

    it('当个别 Context 关闭抛出异常时，实现异常隔离，确保其他 Context 正常关闭且集合清空', async () => {
      const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-close-err-'));
      process.env.SMARTLINK_USER_DATA_DIR = tempUserData;

      try {
        const failingContext = createMockContext(true); // 抛出异常
        const normalContext = createMockContext(false);

        vi.mocked(chromium.launchPersistentContext)
          .mockResolvedValueOnce(failingContext as unknown as never)
          .mockResolvedValueOnce(normalContext as unknown as never);

        const s1 = await createPersistentBrowserSession({ channelCode: 'FAILING_CH', headless: true });
        const s2 = await createPersistentBrowserSession({ channelCode: 'NORMAL_CH', headless: true });

        expect(getActiveBrowserSessionsCount()).toBe(2);

        const lock1 = path.join(s1.profileDir!, 'SingletonLock');
        const lock2 = path.join(s2.profileDir!, 'SingletonLock');
        fs.writeFileSync(lock1, 'fail');
        fs.writeFileSync(lock2, 'normal');

        // closeAllBrowserSessions 必须吞吐异常不崩溃，保证 Fail-Safe 资源清理
        await expect(closeAllBrowserSessions()).resolves.not.toThrow();

        // 核心断言：正常 Context 依然被执行关闭，所有会话被清空，物理锁全部移除
        expect(failingContext.close).toHaveBeenCalledTimes(1);
        expect(normalContext.close).toHaveBeenCalledTimes(1);
        expect(getActiveBrowserSessionsCount()).toBe(0);
        expect(fs.existsSync(lock1)).toBe(false);
        expect(fs.existsSync(lock2)).toBe(false);
      } finally {
        delete process.env.SMARTLINK_USER_DATA_DIR;
        if (fs.existsSync(tempUserData)) {
          fs.rmSync(tempUserData, { recursive: true, force: true });
        }
      }
    });

    it('当会话来自外部 CDP 连接 (isExternalCdp: true) 时，关闭会话绝不调用 releaseProfileLocks 误删锁文件', async () => {
      const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-cdp-lock-'));
      process.env.SMARTLINK_USER_DATA_DIR = tempUserData;

      try {
        const mockExternalBrowser = { close: vi.fn().mockResolvedValue(undefined) };
        const mockExternalContext = createMockContext();
        const mockExternalPage = {
          bringToFront: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn().mockResolvedValue(undefined),
          isClosed: vi.fn().mockReturnValue(false),
        };
        mockExternalContext.pages.mockReturnValue([mockExternalPage]);

        vi.mocked(chromium.connectOverCDP).mockResolvedValueOnce({
          ...mockExternalBrowser,
          contexts: () => [mockExternalContext],
        } as unknown as never);

        const session = await createPersistentBrowserSession({ channelCode: 'MEITUAN', headless: true });
        expect(session.isExternalCdp).toBe(true);

        fs.mkdirSync(session.profileDir!, { recursive: true });
        const lockFile = path.join(session.profileDir!, 'SingletonLock');
        fs.writeFileSync(lockFile, 'external-pid');
        expect(fs.existsSync(lockFile)).toBe(true);

        await closeAllBrowserSessions();

        // 核心断言：CDP browser close 被调用，活跃会话清空，但外部锁文件被完整保留
        expect(mockExternalBrowser.close).toHaveBeenCalledTimes(1);
        expect(getActiveBrowserSessionsCount()).toBe(0);
        expect(fs.existsSync(lockFile)).toBe(true);
      } finally {
        delete process.env.SMARTLINK_USER_DATA_DIR;
        if (fs.existsSync(tempUserData)) {
          fs.rmSync(tempUserData, { recursive: true, force: true });
        }
      }
    });
  });

  describe('releaseProfileLocks 独立锁清理机制', () => {
    it('精确清理各类 SingletonLock、LOCK、SingletonSocket 与 Default 子目录锁文件', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
      const defaultDir = path.join(tempDir, 'Default');
      fs.mkdirSync(defaultDir, { recursive: true });

      const files = [
        path.join(tempDir, 'SingletonLock'),
        path.join(tempDir, 'SingletonSocket'),
        path.join(tempDir, 'SingletonCookie'),
        path.join(tempDir, 'LOCK'),
        path.join(tempDir, 'lockfile'),
        path.join(defaultDir, 'LOCK'),
      ];

      for (const f of files) {
        fs.writeFileSync(f, 'content');
        expect(fs.existsSync(f)).toBe(true);
      }

      // 保留正常数据文件，验证不误删
      const regularFile = path.join(tempDir, 'Preferences');
      fs.writeFileSync(regularFile, '{"key":"value"}');

      releaseProfileLocks(tempDir);

      for (const f of files) {
        expect(fs.existsSync(f)).toBe(false);
      }
      expect(fs.existsSync(regularFile)).toBe(true);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
