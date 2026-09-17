import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  resolveUserDataDir,
  resolveChromeProfileDir,
  detectDefaultChromeSourceDir,
  APP_USER_DATA_NAME,
} from '../../src/crawler/paths';

describe('paths', () => {
  describe('resolveUserDataDir', () => {
    it('should prioritize SMARTLINK_USER_DATA_DIR when set', () => {
      const customDir = '/custom/isolated/user-data';
      const resolved = resolveUserDataDir({
        env: { SMARTLINK_USER_DATA_DIR: customDir },
        platform: 'darwin',
      });
      expect(resolved).toBe(customDir);
    });

    it('should resolve to Application Support on macOS', () => {
      const home = '/Users/testuser';
      const resolved = resolveUserDataDir({
        env: {},
        platform: 'darwin',
        homeDir: home,
      });
      // 在 macOS 下应包含 Library/Application Support
      expect(resolved).toContain(path.join(home, 'Library/Application Support'));
      expect(resolved.toLowerCase()).toContain(APP_USER_DATA_NAME.toLowerCase());
    });

    it('should resolve to APPDATA on Windows', () => {
      const appData = 'C:\\Users\\testuser\\AppData\\Roaming';
      const resolved = resolveUserDataDir({
        env: { APPDATA: appData },
        platform: 'win32',
        homeDir: 'C:\\Users\\testuser',
      });
      expect(resolved).toBe(path.join(appData, APP_USER_DATA_NAME));
    });

    it('should resolve to XDG_CONFIG_HOME or ~/.config on Linux', () => {
      const home = '/home/testuser';
      const resolved = resolveUserDataDir({
        env: {},
        platform: 'linux',
        homeDir: home,
      });
      expect(resolved).toBe(path.join(home, '.config', APP_USER_DATA_NAME));

      const customXdg = '/custom/xdg/config';
      const resolvedWithXdg = resolveUserDataDir({
        env: { XDG_CONFIG_HOME: customXdg },
        platform: 'linux',
        homeDir: home,
      });
      expect(resolvedWithXdg).toBe(path.join(customXdg, APP_USER_DATA_NAME));
    });
  });

  describe('resolveChromeProfileDir', () => {
    it('should append .chrome-profile/<lowercaseCode> to resolved user data directory', () => {
      const customDir = '/var/data/smartlink';
      const profileDir = resolveChromeProfileDir('MEITUAN', {
        env: { SMARTLINK_USER_DATA_DIR: customDir },
      });
      expect(profileDir).toBe(path.resolve(customDir, '.chrome-profile', 'meituan'));
    });

    it('should handle mixed-case and whitespace in channel codes', () => {
      const customDir = '/var/data/smartlink';
      const profileDir = resolveChromeProfileDir('  DOUYIN  ', {
        env: { SMARTLINK_USER_DATA_DIR: customDir },
      });
      expect(profileDir).toBe(path.resolve(customDir, '.chrome-profile', 'douyin'));
    });
  });

  describe('detectDefaultChromeSourceDir', () => {
    it('should return macOS Google Chrome path on darwin', () => {
      const home = '/Users/tester';
      const detected = detectDefaultChromeSourceDir({
        platform: 'darwin',
        homeDir: home,
      });
      expect(detected).toBe(path.join(home, 'Library/Application Support/Google/Chrome'));
    });

    it('should return Windows Google Chrome path on win32', () => {
      const localAppData = 'C:\\Users\\tester\\AppData\\Local';
      const detected = detectDefaultChromeSourceDir({
        platform: 'win32',
        env: { LOCALAPPDATA: localAppData },
      });
      expect(detected).toBe(path.join(localAppData, 'Google/Chrome/User Data'));
    });

    it('should return Linux google-chrome path on linux', () => {
      const home = '/home/tester';
      const detected = detectDefaultChromeSourceDir({
        platform: 'linux',
        homeDir: home,
      });
      expect(detected).toBe(path.join(home, '.config/google-chrome'));
    });
  });
});
