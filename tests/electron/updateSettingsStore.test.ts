import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getUpdateSettingsFile,
  loadUpdateSettings,
  saveUpdateSettings,
  parseUpdateSettings,
} from '../../electron/updateSettingsStore';
import { logger } from '../../src/services/logger';

describe('updateSettingsStore', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-update-settings-test-'));
    tempFile = path.join(tempDir, 'update-settings.json');
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('should return default settings file under standard userData dir', () => {
    const file = getUpdateSettingsFile();
    expect(file).toContain('update-settings.json');
    expect(path.isAbsolute(file)).toBe(true);
  });

  it('should default autoInstallEnabled to true when file is missing', () => {
    const settings = loadUpdateSettings(tempFile);
    expect(settings.autoInstallEnabled).toBe(true);
  });

  it('should save and load settings correctly', () => {
    saveUpdateSettings({ autoInstallEnabled: false }, tempFile);
    expect(fs.existsSync(tempFile)).toBe(true);

    const loaded = loadUpdateSettings(tempFile);
    expect(loaded.autoInstallEnabled).toBe(false);
  });

  it('should persist file with 0o600 mode', () => {
    saveUpdateSettings({ autoInstallEnabled: true }, tempFile);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(tempFile).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('should return failure result when write fails', () => {
    const dirAsFile = path.join(tempDir, 'blocked.json');
    fs.mkdirSync(dirAsFile);
    const result = saveUpdateSettings({ autoInstallEnabled: false }, dirAsFile);
    expect(result.success).toBe(false);
    expect(result.error).toContain('写入更新设置失败');
  });

  it('should return default settings for corrupted JSON and log warn', () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    fs.writeFileSync(tempFile, 'not-json-at-all', 'utf-8');
    const settings = loadUpdateSettings(tempFile);
    expect(settings.autoInstallEnabled).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('should return default settings for blank file content', () => {
    fs.writeFileSync(tempFile, '', 'utf-8');
    const settings = loadUpdateSettings(tempFile);
    expect(settings.autoInstallEnabled).toBe(true);
  });

  describe('parseUpdateSettings 结构校验', () => {
    it('合法载荷通过校验', () => {
      expect(parseUpdateSettings({ version: 1, autoInstallEnabled: false })).toEqual({
        autoInstallEnabled: false,
      });
      expect(parseUpdateSettings({ version: 1, autoInstallEnabled: true })).toEqual({
        autoInstallEnabled: true,
      });
    });

    it('version 缺失或不为 1 时判无效', () => {
      expect(parseUpdateSettings({ autoInstallEnabled: true })).toBeNull();
      expect(parseUpdateSettings({ version: 2, autoInstallEnabled: true })).toBeNull();
    });

    it('autoInstallEnabled 非布尔时判无效', () => {
      expect(parseUpdateSettings({ version: 1, autoInstallEnabled: 'yes' })).toBeNull();
      expect(parseUpdateSettings({ version: 1 })).toBeNull();
    });

    it('载荷为 null、数组或原始类型时判无效', () => {
      expect(parseUpdateSettings(null)).toBeNull();
      expect(parseUpdateSettings([])).toBeNull();
      expect(parseUpdateSettings(42)).toBeNull();
    });
  });
});
