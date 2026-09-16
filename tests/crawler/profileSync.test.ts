import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { detectDefaultChromeSourceDir, syncChromeProfile } from '../../src/crawler/profileSync';

describe('profileSync', () => {
  const tempDirsToClean: string[] = [];

  const createTempDir = (prefix: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirsToClean.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirsToClean) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirsToClean.length = 0;

    // 清理可能在当前工作区生成的测试 channel profile
    const testProfilePath = path.resolve(process.cwd(), '.chrome-profile', 'test-unit-channel');
    if (fs.existsSync(testProfilePath)) {
      fs.rmSync(testProfilePath, { recursive: true, force: true });
    }
  });

  describe('detectDefaultChromeSourceDir', () => {
    it('should return a non-empty string with platform-appropriate Chrome path', () => {
      const detected = detectDefaultChromeSourceDir();
      expect(typeof detected).toBe('string');
      expect(detected.length).toBeGreaterThan(0);
      expect(detected.toLowerCase()).toContain('chrome');
    });
  });

  describe('syncChromeProfile fail-fast checks', () => {
    it('should throw immediately when Local State is not found in source directory', () => {
      const nonExistentDir = path.join(os.tmpdir(), 'non-existent-chrome-source-' + Date.now());
      expect(() =>
        syncChromeProfile({
          customSourceDir: nonExistentDir,
          channelId: 'test-unit-channel',
        })
      ).toThrow(/未在系统 Chrome 中找到配置文件 Local State/);
    });

    it('should throw when Local State contains malformed JSON', () => {
      const tempSource = createTempDir('chrome-source-broken-');
      fs.writeFileSync(path.join(tempSource, 'Local State'), '{ broken json ...', 'utf8');

      expect(() =>
        syncChromeProfile({
          customSourceDir: tempSource,
          channelId: 'test-unit-channel',
        })
      ).toThrow(/读取 Chrome Local State 失败/);
    });

    it('should throw when the referenced active profile directory does not exist', () => {
      const tempSource = createTempDir('chrome-source-noprofile-');
      const mockLocalState = {
        profile: {
          last_used: 'Profile 999',
        },
      };
      fs.writeFileSync(path.join(tempSource, 'Local State'), JSON.stringify(mockLocalState), 'utf8');

      expect(() =>
        syncChromeProfile({
          customSourceDir: tempSource,
          channelId: 'test-unit-channel',
        })
      ).toThrow(/未找到源 Chrome Profile 目录.*Profile 999/);
    });
  });

  describe('syncChromeProfile e2e sync logic', () => {
    it('should selectively sync cookies and preferences while excluding history and locks', () => {
      const tempSource = createTempDir('chrome-source-valid-');
      const activeProfileName = 'Profile 1';
      const sourceProfileDir = path.join(tempSource, activeProfileName);
      fs.mkdirSync(sourceProfileDir, { recursive: true });

      // 准备源 Local State
      const mockLocalState = {
        profile: {
          last_used: activeProfileName,
          info_cache: {
            [activeProfileName]: {
              name: 'SmartLink Test User',
              gaia_id: '12345678',
            },
          },
        },
      };
      fs.writeFileSync(path.join(tempSource, 'Local State'), JSON.stringify(mockLocalState), 'utf8');

      // 准备待同步的会话文件与隐私文件
      fs.writeFileSync(path.join(sourceProfileDir, 'Cookies'), 'SAMPLE_BINARY_COOKIES_DATA', 'utf8');
      fs.writeFileSync(
        path.join(sourceProfileDir, 'Preferences'),
        JSON.stringify({
          profile: {
            exit_type: 'Crashed',
            exited_cleanly: false,
          },
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(sourceProfileDir, 'History'), 'SENSITIVE_BROWSING_HISTORY', 'utf8');
      fs.writeFileSync(path.join(sourceProfileDir, 'LOCK'), 'PROCESS_LOCK_DATA', 'utf8');

      // 执行同步
      const result = syncChromeProfile({
        customSourceDir: tempSource,
        channelId: 'test-unit-channel',
      });

      expect(result.success).toBe(true);
      expect(result.sourceProfile).toBe(activeProfileName);
      expect(result.targetDir).toBe(path.resolve(process.cwd(), '.chrome-profile', 'test-unit-channel'));

      const targetDefaultDir = path.join(result.targetDir, 'Default');
      expect(fs.existsSync(targetDefaultDir)).toBe(true);

      // 验证 Cookies 成功复制
      const targetCookies = path.join(targetDefaultDir, 'Cookies');
      expect(fs.existsSync(targetCookies)).toBe(true);
      expect(fs.readFileSync(targetCookies, 'utf8')).toBe('SAMPLE_BINARY_COOKIES_DATA');

      // 验证 Preferences 被重写为干净退出
      const targetPrefs = path.join(targetDefaultDir, 'Preferences');
      expect(fs.existsSync(targetPrefs)).toBe(true);
      const parsedPrefs = JSON.parse(fs.readFileSync(targetPrefs, 'utf8'));
      expect(parsedPrefs.profile.exit_type).toBe('Normal');
      expect(parsedPrefs.profile.exited_cleanly).toBe(true);

      // 验证隐私数据被排除：History 与 LOCK 文件不得存在
      expect(fs.existsSync(path.join(targetDefaultDir, 'History'))).toBe(false);
      expect(fs.existsSync(path.join(targetDefaultDir, 'LOCK'))).toBe(false);

      // 验证目标 Local State 被规范化为 Default
      const targetLocalStatePath = path.join(result.targetDir, 'Local State');
      expect(fs.existsSync(targetLocalStatePath)).toBe(true);
      const targetLocalState = JSON.parse(fs.readFileSync(targetLocalStatePath, 'utf8'));
      expect(targetLocalState.profile.last_used).toBe('Default');
      expect(targetLocalState.profile.info_cache.Default.name).toBe('SmartLink Test User');
    });
  });
});
