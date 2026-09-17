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

    // 核心断言：必须声明忽略 --use-mock-keychain 与 --password-store=basic
    expect(calledOptions?.ignoreDefaultArgs).toEqual(
      expect.arrayContaining(['--use-mock-keychain', '--password-store=basic'])
    );

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
