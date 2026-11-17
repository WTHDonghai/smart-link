import { describe, it, expect } from 'vitest';
import {
  LOG_UPLOAD_MODULE,
  buildLogUploadDateSegment,
  buildLogUploadObjectKey,
  buildLogUploadFileName,
  sanitizeLogUploadSegment,
  serializeLogsForUpload,
} from '../../src/utils/logUploadPath';
import type { SystemLogEntry } from '../../src/types';

function makeEntry(partial: Partial<SystemLogEntry>): SystemLogEntry {
  return {
    id: 'log-1',
    timestamp: '2026-11-17 18:30:45.123',
    createdAt: 1763370645123,
    level: 'INFO',
    message: '[接口调用] [GET] /orders (200) - 120ms',
    ...partial,
  };
}

describe('logUploadPath - 日志上传路径规划', () => {
  describe('buildLogUploadDateSegment', () => {
    it('按本地时区生成 yyyyMMdd 目录段', () => {
      // 本地 2026-11-17 18:30:45（构造时用本地时区组件）
      const date = new Date(2026, 10, 17, 18, 30, 45);
      expect(buildLogUploadDateSegment(date)).toBe('20261117');
    });

    it('跨年边界日期正确归位', () => {
      const date = new Date(2027, 0, 1, 0, 5, 0);
      expect(buildLogUploadDateSegment(date)).toBe('20270101');
    });

    it('缺省使用当前时间', () => {
      const today = new Date();
      const expected = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
        today.getDate()
      ).padStart(2, '0')}`;
      expect(buildLogUploadDateSegment()).toBe(expected);
    });
  });

  describe('sanitizeLogUploadSegment', () => {
    it('去除路径分隔符与非法字符', () => {
      expect(sanitizeLogUploadSegment('a/b\\c d')).toBe('a-b-c-d');
      expect(sanitizeLogUploadSegment('租户 XR-01')).toBe('XR-01');
    });

    it('去除前导连字符并截断至 64 字符', () => {
      expect(sanitizeLogUploadSegment('--abc')).toBe('abc');
      expect(sanitizeLogUploadSegment('x'.repeat(100)).length).toBe(64);
    });

    it('全非法字符时返回空串', () => {
      expect(sanitizeLogUploadSegment('///')).toBe('');
      expect(sanitizeLogUploadSegment('   ')).toBe('');
    });
  });

  describe('buildLogUploadObjectKey', () => {
    it('生成 smart-link/{tenantId}/{yyyyMMdd}/{fileName} 四段路径', () => {
      const date = new Date(2026, 10, 17, 9, 0, 0);
      const key = buildLogUploadObjectKey({
        tenantId: 'XR-01',
        date,
        fileName: 'smart-link-log-XR-01-20261117-090000000.log',
      });
      expect(key).toBe('smart-link/XR-01/20261117/smart-link-log-XR-01-20261117-090000000.log');
    });

    it('租户标识包含非法字符时被收敛', () => {
      const date = new Date(2026, 10, 17);
      const key = buildLogUploadObjectKey({
        tenantId: 'XR 01/safe',
        date,
        fileName: 'a.log',
      });
      expect(key).toBe('smart-link/XR-01-safe/20261117/a.log');
    });

    it('tenantId 为空时 Fail-Fast 抛错，禁止静默兜底路径', () => {
      expect(() =>
        buildLogUploadObjectKey({ tenantId: '', date: new Date(), fileName: 'a.log' })
      ).toThrow('日志上传路径缺少有效租户标识');
    });

    it('tenantId 全非法字符时 Fail-Fast 抛错', () => {
      expect(() =>
        buildLogUploadObjectKey({ tenantId: '///', date: new Date(), fileName: 'a.log' })
      ).toThrow('日志上传路径缺少有效租户标识');
    });

    it('fileName 为空时 Fail-Fast 抛错', () => {
      expect(() =>
        buildLogUploadObjectKey({ tenantId: 'XR-01', date: new Date(), fileName: '///' })
      ).toThrow('日志上传路径缺少有效文件名');
    });
  });

  describe('buildLogUploadFileName', () => {
    it('生成 smart-link-log-{tenantId}-{yyyyMMdd}-{HHmmssSSS}.log 文件名', () => {
      const date = new Date(2026, 10, 17, 18, 30, 45, 123);
      const name = buildLogUploadFileName({ tenantId: 'XR-01', date });
      expect(name).toMatch(/^smart-link-log-XR-01-20261117-\d{9}\.log$/);
    });

    it('同日不同毫秒生成不同文件名（防碰撞）', () => {
      const base = new Date(2026, 10, 17, 8, 0, 0, 0);
      const a = buildLogUploadFileName({ tenantId: 'XR-01', date: base });
      const b = buildLogUploadFileName({ tenantId: 'XR-01', date: new Date(base.getTime() + 1) });
      expect(a).not.toBe(b);
    });

    it('tenantId 为空时 Fail-Fast 抛错', () => {
      expect(() => buildLogUploadFileName({ tenantId: '' })).toThrow(
        '日志上传文件名缺少有效租户标识'
      );
    });
  });

  describe('serializeLogsForUpload', () => {
    it('复用导出行格式序列化日志条目', () => {
      const content = serializeLogsForUpload([
        makeEntry({ message: '第一条' }),
        makeEntry({ id: 'log-2', message: '第二条', level: 'ERROR' }),
      ]);
      expect(content).toContain('第一条');
      expect(content).toContain('第二条');
      expect(content.split('\n').length).toBe(2);
    });

    it('空日志列表返回空串', () => {
      expect(serializeLogsForUpload([])).toBe('');
    });
  });

  it('上传模块标识固定为 smart-link', () => {
    expect(LOG_UPLOAD_MODULE).toBe('smart-link');
  });
});
