import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getDutyAutostartFile,
  loadDutyAutostart,
  saveDutyAutostart,
  parseDutyAutostartSnapshot,
} from '../../../src/crawler/duty/dutyAutostartStore';
import { logger } from '../../../src/services/logger';

describe('dutyAutostartStore', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-autostart-test-'));
    tempFile = path.join(tempDir, 'duty-autostart.json');
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

  it('should return default autostart file under standard userData dir', () => {
    const file = getDutyAutostartFile();
    expect(file).toContain('duty-autostart.json');
    expect(path.isAbsolute(file)).toBe(true);
  });

  it('should save and load autostart snapshot correctly', () => {
    saveDutyAutostart(
      { channels: ['MEITUAN', 'DOUYIN'], meituanBizSplitEnabled: true },
      tempFile
    );
    expect(fs.existsSync(tempFile)).toBe(true);

    const loaded = loadDutyAutostart(tempFile);
    expect(loaded.channels).toEqual(['MEITUAN', 'DOUYIN']);
    expect(loaded.meituanBizSplitEnabled).toBe(true);
  });

  it('should normalize channel codes to uppercase and deduplicate on save', () => {
    saveDutyAutostart(
      { channels: ['meituan', 'DOUYIN', 'meituan'], meituanBizSplitEnabled: false },
      tempFile
    );

    const loaded = loadDutyAutostart(tempFile);
    expect(loaded.channels).toEqual(['MEITUAN', 'DOUYIN']);
    expect(loaded.meituanBizSplitEnabled).toBe(false);
  });

  it('should return empty snapshot when file does not exist', () => {
    const loaded = loadDutyAutostart(tempFile);
    expect(loaded.channels).toEqual([]);
    expect(loaded.meituanBizSplitEnabled).toBe(false);
  });

  it('should return empty snapshot for blank file content', () => {
    fs.writeFileSync(tempFile, '', 'utf-8');
    const loaded = loadDutyAutostart(tempFile);
    expect(loaded.channels).toEqual([]);
    expect(loaded.meituanBizSplitEnabled).toBe(false);
  });

  it('should return empty snapshot and keep channels empty for corrupted JSON', () => {
    fs.writeFileSync(tempFile, '{invalid-json', 'utf-8');
    const loaded = loadDutyAutostart(tempFile);
    expect(loaded.channels).toEqual([]);
    expect(loaded.meituanBizSplitEnabled).toBe(false);
  });

  describe('parseDutyAutostartSnapshot 结构校验', () => {
    it('合法载荷通过校验并规范化渠道码', () => {
      const snapshot = parseDutyAutostartSnapshot({
        version: 1,
        channels: [' meituan ', 'DOUYIN'],
        meituanBizSplitEnabled: true,
      });
      expect(snapshot).toEqual({ channels: ['MEITUAN', 'DOUYIN'], meituanBizSplitEnabled: true });
    });

    it('version 缺失或不为 1 时判无效', () => {
      expect(parseDutyAutostartSnapshot({ channels: ['MEITUAN'], meituanBizSplitEnabled: false })).toBeNull();
      expect(parseDutyAutostartSnapshot({ version: 2, channels: ['MEITUAN'], meituanBizSplitEnabled: false })).toBeNull();
    });

    it('channels 非数组或含非字符串条目时判无效', () => {
      expect(parseDutyAutostartSnapshot({ version: 1, channels: 'MEITUAN', meituanBizSplitEnabled: false })).toBeNull();
      expect(parseDutyAutostartSnapshot({ version: 1, channels: [123], meituanBizSplitEnabled: false })).toBeNull();
      expect(parseDutyAutostartSnapshot({ version: 1, channels: [''], meituanBizSplitEnabled: false })).toBeNull();
    });

    it('meituanBizSplitEnabled 非布尔时判无效', () => {
      expect(parseDutyAutostartSnapshot({ version: 1, channels: ['MEITUAN'], meituanBizSplitEnabled: 'yes' })).toBeNull();
    });

    it('载荷为 null、数组或原始类型时判无效', () => {
      expect(parseDutyAutostartSnapshot(null)).toBeNull();
      expect(parseDutyAutostartSnapshot([1, 2])).toBeNull();
      expect(parseDutyAutostartSnapshot('text')).toBeNull();
    });
  });

  it('should persist file with 0o600 mode', () => {
    saveDutyAutostart({ channels: ['MEITUAN'], meituanBizSplitEnabled: false }, tempFile);
    // Windows 不支持 POSIX 权限位，仅在 POSIX 平台断言
    if (process.platform !== 'win32') {
      const mode = fs.statSync(tempFile).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('should return failure result when write fails', () => {
    // 目标路径是目录，写入必然失败
    const dirAsFile = path.join(tempDir, 'blocked.json');
    fs.mkdirSync(dirAsFile);
    const result = saveDutyAutostart({ channels: ['MEITUAN'], meituanBizSplitEnabled: false }, dirAsFile);
    expect(result.success).toBe(false);
    expect(result.error).toContain('写入值守自恢复清单失败');
  });

  it('should not swallow load errors silently: corrupted file logs warn via logger', () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    fs.writeFileSync(tempFile, 'not-json-at-all', 'utf-8');
    loadDutyAutostart(tempFile);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(String(message)).toContain('[值守恢复]');
  });
});
