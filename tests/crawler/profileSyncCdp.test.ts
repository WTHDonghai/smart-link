import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  isMeituanCookieDomain,
  filterMeituanCookies,
  syncChromeSessionViaCDP,
} from '../../src/crawler/profileSync';

describe('profileSync CDP (Scheme B)', () => {
  const tempDirsToClean: string[] = [];
  let testUserDataDir: string;

  const createTempDir = (prefix: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirsToClean.push(dir);
    return dir;
  };

  beforeEach(() => {
    testUserDataDir = createTempDir('test-cdp-profile-sync-');
    process.env.SMARTLINK_USER_DATA_DIR = testUserDataDir;
  });

  afterEach(() => {
    delete process.env.SMARTLINK_USER_DATA_DIR;
    vi.restoreAllMocks();
    for (const dir of tempDirsToClean) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirsToClean.length = 0;
  });

  describe('Domain and Cookie Whitelisting (Zero Leakage)', () => {
    it('should accurately identify Meituan and Dianping domains', () => {
      expect(isMeituanCookieDomain('meituan.com')).toBe(true);
      expect(isMeituanCookieDomain('.meituan.com')).toBe(true);
      expect(isMeituanCookieDomain('eb.meituan.com')).toBe(true);
      expect(isMeituanCookieDomain('sub.hotel.meituan.com')).toBe(true);
      expect(isMeituanCookieDomain('dianping.com')).toBe(true);
      expect(isMeituanCookieDomain('.dianping.com')).toBe(true);
      expect(isMeituanCookieDomain('v.dianping.com')).toBe(true);
    });

    it('should strictly reject non-Meituan domains and lookalikes', () => {
      expect(isMeituanCookieDomain('google.com')).toBe(false);
      expect(isMeituanCookieDomain('github.com')).toBe(false);
      expect(isMeituanCookieDomain('fake-meituan.com')).toBe(false);
      expect(isMeituanCookieDomain('notmeituan.com')).toBe(false);
      expect(isMeituanCookieDomain('evil-dianping.com')).toBe(false);
      expect(isMeituanCookieDomain('')).toBe(false);
    });

    it('should filter out all external cookies and retain only Meituan ones', () => {
      const mixedCookies = [
        { name: 'session_id', value: 'secret_mt_123', domain: '.meituan.com' },
        { name: 'google_token', value: 'goog_private_abc', domain: '.google.com' },
        { name: 'github_user', value: 'gh_secret_456', domain: 'github.com' },
        { name: 'poi_id', value: '998877', domain: 'eb.meituan.com' },
        { name: 'dp_token', value: 'dp_auth_token', domain: '.dianping.com' },
        { name: 'phishing', value: 'hack', domain: 'fake-meituan.com' },
      ];

      const filtered = filterMeituanCookies(mixedCookies);

      expect(filtered).toHaveLength(3);
      expect(filtered.map((c) => c.name)).toEqual(['session_id', 'poi_id', 'dp_token']);
      expect(filtered.every((c) => c.domain.includes('meituan.com') || c.domain.includes('dianping.com'))).toBe(true);
    });
  });

  describe('syncChromeSessionViaCDP Fail-Fast Checks', () => {
    it('should throw immediately with developer guide when CDP port is not open', async () => {
      // 故意连接一个未占用的本地高位端口
      const nonExistentPort = 65431;

      await expect(
        syncChromeSessionViaCDP({
          channelCode: 'MEITUAN',
          port: nonExistentPort,
          timeoutMs: 300,
        })
      ).rejects.toThrow(
        /无法连接到本地 Chrome 调试端口.*65431[\s\S]*--remote-debugging-port=65431/
      );
    });

    it('should throw when connected Chrome has no browser contexts', async () => {
      const mockBrowser = {
        contexts: vi.fn().mockReturnValue([]),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(mockBrowser as unknown as Browser);

      await expect(
        syncChromeSessionViaCDP({
          channelCode: 'MEITUAN',
          port: 9222,
        })
      ).rejects.toThrow(/未找到任何活跃的 BrowserContext/);

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should throw when no Meituan login cookies are present in Chrome contexts', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://www.google.com'),
        title: vi.fn().mockResolvedValue('Google Search'),
        evaluate: vi.fn().mockResolvedValue(false),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        cookies: vi.fn().mockResolvedValue([
          { name: 'google_id', value: '123', domain: '.google.com', path: '/' },
        ]),
      };
      const mockBrowser = {
        contexts: vi.fn().mockReturnValue([mockContext]),
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(mockBrowser as unknown as Browser);

      await expect(
        syncChromeSessionViaCDP({
          channelCode: 'MEITUAN',
          port: 9222,
        })
      ).rejects.toThrow(/未在 Chrome 实例中检测到任何美团有效登录态 Cookies/);

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe('syncChromeSessionViaCDP E2E Extraction & Injection', () => {
    it('should prioritize focused Meituan tab and cleanly inject cookies to target profile', async () => {
      // 模拟多标签页环境：一个后台美团标签，一个当前聚焦的美团商家后台标签，一个非美团标签
      const bgMeituanPage = {
        url: vi.fn().mockReturnValue('https://i.meituan.com/index'),
        title: vi.fn().mockResolvedValue('美团移动端'),
        evaluate: vi.fn().mockImplementation((fn: () => unknown) => {
          const fnStr = fn.toString();
          if (fnStr.includes('hasFocus')) return Promise.resolve(false);
          if (fnStr.includes('visibilityState')) return Promise.resolve(false);
          return Promise.resolve(false);
        }),
      };

      const focusedMeituanPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/home'),
        title: vi.fn().mockResolvedValue('美团酒店商家中心'),
        evaluate: vi.fn().mockImplementation((fn: () => unknown) => {
          const fnStr = fn.toString();
          if (fnStr.includes('hasFocus')) return Promise.resolve(true);
          if (fnStr.includes('visibilityState')) return Promise.resolve(true);
          return Promise.resolve(true);
        }),
      };

      const otherPage = {
        url: vi.fn().mockReturnValue('https://github.com/pulls'),
        title: vi.fn().mockResolvedValue('GitHub Pull Requests'),
        evaluate: vi.fn().mockResolvedValue(false),
      };

      const sourceContext = {
        pages: vi.fn().mockReturnValue([bgMeituanPage, focusedMeituanPage, otherPage]),
        cookies: vi.fn().mockResolvedValue([
          { name: 'token', value: 'MT_AUTH_TOKEN_ABC', domain: '.meituan.com', path: '/' },
          { name: 'bsid', value: 'BUSINESS_ID_XYZ', domain: 'eb.meituan.com', path: '/' },
          { name: 'gh_session', value: 'LEAKED_GITHUB_VAL', domain: 'github.com', path: '/' },
          { name: 'google_pref', value: 'LEAKED_GOOGLE_VAL', domain: '.google.com', path: '/' },
        ]),
      };

      const mockConnectedBrowser = {
        contexts: vi.fn().mockReturnValue([sourceContext]),
        close: vi.fn().mockResolvedValue(undefined),
      };

      vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue(
        mockConnectedBrowser as unknown as Awaited<ReturnType<typeof chromium.connectOverCDP>>
      );

      // 监听目标 Profile 写入
      const targetCookiesAdded: unknown[] = [];
      const mockTargetContext = {
        addCookies: vi.fn().mockImplementation(async (cookies) => {
          targetCookiesAdded.push(...cookies);
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      vi.spyOn(chromium, 'launchPersistentContext').mockResolvedValue(
        mockTargetContext as unknown as BrowserContext
      );

      const result = await syncChromeSessionViaCDP({
        channelCode: 'MEITUAN',
        port: 9222,
      });

      // 验证返回报告
      expect(result.success).toBe(true);
      expect(result.sourceProfile).toBe('https://eb.meituan.com/ebooking/home');
      expect(result.message).toContain('同步 2 个美团登录态 Cookies');
      expect(result.message).toContain('聚焦');
      expect(result.message).toContain('美团酒店商家中心');

      // 验证断开 CDP 连接（绝不退出日常 Chrome）
      expect(mockConnectedBrowser.close).toHaveBeenCalled();

      // 验证写入 Cookies：严禁泄漏 GitHub / Google Cookie
      expect(targetCookiesAdded).toHaveLength(2);
      expect(targetCookiesAdded).toEqual([
        { name: 'token', value: 'MT_AUTH_TOKEN_ABC', domain: '.meituan.com', path: '/' },
        { name: 'bsid', value: 'BUSINESS_ID_XYZ', domain: 'eb.meituan.com', path: '/' },
      ]);
      expect(mockTargetContext.close).toHaveBeenCalled();
    });
  });
});
