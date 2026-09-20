import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  detectDefaultChromeSourceDir,
  syncChromeProfile,
  listChromeProfiles,
  resolveTargetProfile,
  isSqliteDatabase,
} from '../../src/crawler/profileSync';

describe('profileSync', () => {
  const tempDirsToClean: string[] = [];
  let testUserDataDir: string;

  const createTempDir = (prefix: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirsToClean.push(dir);
    return dir;
  };

  beforeEach(() => {
    testUserDataDir = createTempDir('test-profile-sync-user-data-');
    process.env.SMARTLINK_USER_DATA_DIR = testUserDataDir;
  });

  afterEach(() => {
    delete process.env.SMARTLINK_USER_DATA_DIR;
    for (const dir of tempDirsToClean) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirsToClean.length = 0;
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
      expect(result.targetDir).toBe(path.resolve(testUserDataDir, '.chrome-profile', 'test-unit-channel'));

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

    it('should respect SMARTLINK_USER_DATA_DIR env variable for target directory', () => {
      const customUserData = createTempDir('electron-user-data-');
      process.env.SMARTLINK_USER_DATA_DIR = customUserData;

      const sourceRoot = createTempDir('chrome-source-env-');
      const activeProfileName = 'Profile 1';
      const localStateContent = {
        profile: {
          last_used: activeProfileName,
          info_cache: {},
        },
      };
      fs.writeFileSync(path.join(sourceRoot, 'Local State'), JSON.stringify(localStateContent), 'utf8');
      const profileDir = path.join(sourceRoot, activeProfileName);
      fs.mkdirSync(profileDir, { recursive: true });

      try {
        const result = syncChromeProfile({
          customSourceDir: sourceRoot,
          channelCode: 'MEITUAN',
        });

        expect(result.success).toBe(true);
        expect(result.targetDir).toBe(path.resolve(customUserData, '.chrome-profile', 'meituan'));
        expect(fs.existsSync(result.targetDir)).toBe(true);
      } finally {
        delete process.env.SMARTLINK_USER_DATA_DIR;
      }
    });

    it('should throw when an invalid custom profile is requested', () => {
      const sourceRoot = createTempDir('chrome-source-invalid-profile-');
      const localStateContent = {
        profile: {
          last_used: 'Profile 1',
          info_cache: {
            'Profile 1': { name: 'Active User' },
          },
        },
      };
      fs.writeFileSync(path.join(sourceRoot, 'Local State'), JSON.stringify(localStateContent), 'utf8');
      fs.mkdirSync(path.join(sourceRoot, 'Profile 1'), { recursive: true });

      expect(() =>
        syncChromeProfile({
          customSourceDir: sourceRoot,
          customSourceProfile: 'NonExistentProfile',
        })
      ).toThrow(/未找到指定的源 Chrome Profile.*NonExistentProfile/);
    });

    it('should correctly switch to and sync a non-default profile when requested by name or id', () => {
      const sourceRoot = createTempDir('chrome-source-switch-profile-');
      const localStateContent = {
        profile: {
          last_used: 'Default',
          info_cache: {
            Default: { name: 'Default Account' },
            'Profile 7': { name: 'Merchant Admin' },
          },
        },
      };
      fs.writeFileSync(path.join(sourceRoot, 'Local State'), JSON.stringify(localStateContent), 'utf8');
      fs.mkdirSync(path.join(sourceRoot, 'Default'), { recursive: true });
      fs.mkdirSync(path.join(sourceRoot, 'Profile 7'), { recursive: true });

      // 通过数字 "7" 切换到 Profile 7
      const result = syncChromeProfile({
        customSourceDir: sourceRoot,
        customSourceProfile: '7',
        channelCode: 'MEITUAN',
      });

      expect(result.success).toBe(true);
      expect(result.sourceProfile).toBe('Profile 7');
      expect(result.message).toContain('Profile 7 (Merchant Admin)');
    });
  });

  describe('listChromeProfiles and resolveTargetProfile', () => {
    it('should list all profiles and mark the active one', () => {
      const sourceRoot = createTempDir('chrome-source-list-');
      const localStateContent = {
        profile: {
          last_used: 'Profile 7',
          info_cache: {
            Default: { name: 'Master User', user_name: 'master@example.com' },
            'Profile 7': { name: 'Work Profile', user_name: 'work@example.com' },
            'Profile 12': { name: 'Test Account', user_name: 'test@example.com' },
          },
        },
      };
      fs.writeFileSync(path.join(sourceRoot, 'Local State'), JSON.stringify(localStateContent), 'utf8');
      fs.mkdirSync(path.join(sourceRoot, 'Default'), { recursive: true });
      fs.mkdirSync(path.join(sourceRoot, 'Profile 7'), { recursive: true });
      fs.mkdirSync(path.join(sourceRoot, 'Profile 12'), { recursive: true });

      const profiles = listChromeProfiles(sourceRoot);
      expect(profiles).toHaveLength(3);

      // 活跃的 Profile 7 应排在第一个
      expect(profiles[0].id).toBe('Profile 7');
      expect(profiles[0].isActive).toBe(true);
      expect(profiles[0].email).toBe('work@example.com');

      expect(profiles.find((p) => p.id === 'Default')?.isActive).toBe(false);
    });

    it('should resolve profiles by id, number, name, and partial match', () => {
      const mockProfiles = [
        { id: 'Default', name: 'Personal User', isActive: false, dirPath: '/path/Default' },
        { id: 'Profile 7', name: 'Meituan Operator', email: 'op@meituan.com', isActive: true, dirPath: '/path/Profile 7' },
        { id: 'Profile 12', name: 'Developer Mode', email: 'dev@example.com', isActive: false, dirPath: '/path/Profile 12' },
      ];

      // 1. 默认取当前活跃
      expect(resolveTargetProfile(mockProfiles)?.id).toBe('Profile 7');

      // 2. 按纯数字
      expect(resolveTargetProfile(mockProfiles, '7')?.id).toBe('Profile 7');
      expect(resolveTargetProfile(mockProfiles, '12')?.id).toBe('Profile 12');

      // 3. 按 ID
      expect(resolveTargetProfile(mockProfiles, 'profile 7')?.id).toBe('Profile 7');
      expect(resolveTargetProfile(mockProfiles, 'Default')?.id).toBe('Default');

      // 4. 按名称匹配
      expect(resolveTargetProfile(mockProfiles, 'Meituan Operator')?.id).toBe('Profile 7');
      expect(resolveTargetProfile(mockProfiles, 'developer')?.id).toBe('Profile 12');
      expect(resolveTargetProfile(mockProfiles, 'op@meituan.com')?.id).toBe('Profile 7');

      // 5. 不存在返回 null
      expect(resolveTargetProfile(mockProfiles, 'non-existent')).toBeNull();
    });

    it('should accurately detect valid SQLite databases', () => {
      const tempDir = createTempDir('sqlite-test-');
      const fakeSqlite = path.join(tempDir, 'fake.db');
      fs.writeFileSync(fakeSqlite, 'Just plain text file', 'utf8');
      expect(isSqliteDatabase(fakeSqlite)).toBe(false);

      const realSqlite = path.join(tempDir, 'real.db');
      const buf = Buffer.alloc(100);
      buf.write('SQLite format 3\0', 0, 'utf8');
      fs.writeFileSync(realSqlite, buf);
      expect(isSqliteDatabase(realSqlite)).toBe(true);
    });
  });
});
