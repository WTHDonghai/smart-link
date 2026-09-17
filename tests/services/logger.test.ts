import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoggerService } from '../../src/services/logger';
import { SystemLogEntry } from '../../src/types';

describe('LoggerService (Telemetry & Structured Logging)', () => {
  let logger: LoggerService;

  beforeEach(async () => {
    logger = new LoggerService();
    await logger.clearAll();
  });

  describe('track & basic logging', () => {
    it('creates structured log entry with timestamp and createdAt', () => {
      const entry = logger.track('AUTH_LOGIN_SUCCESS', {
        module: 'AUTH',
        level: 'SUCCESS',
        message: '用户通过扫码成功授权',
        details: '租户: tenant-998',
        meta: { tenantId: 'tenant-998' },
      });

      expect(entry.id).toMatch(/^log-\d+-[a-z0-9]+$/);
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(typeof entry.createdAt).toBe('number');
      expect(entry.level).toBe('SUCCESS');
      expect(entry.module).toBe('AUTH');
      expect(entry.event).toBe('AUTH_LOGIN_SUCCESS');
      expect(entry.message).toBe('用户通过扫码成功授权');
      expect(entry.details).toBe('租户: tenant-998');
      expect(entry.meta).toEqual({ tenantId: 'tenant-998' });
    });

    it('dispatches log entries to subscribed listeners in real time', () => {
      const received: SystemLogEntry[] = [];
      const unsubscribe = logger.subscribe((log) => {
        received.push(log);
      });

      logger.info('信息日志 1', { module: 'SYSTEM' });
      logger.warn('警告日志 2', { module: 'ORDER' });

      expect(received.length).toBe(2);
      expect(received[0].message).toBe('信息日志 1');
      expect(received[0].level).toBe('INFO');
      expect(received[1].message).toBe('警告日志 2');
      expect(received[1].level).toBe('WARN');

      unsubscribe();
      logger.info('退订后的日志');
      expect(received.length).toBe(2); // 未增加
    });

    it('provides ergonomic shortcuts for standard log levels', () => {
      const info = logger.info('System ready', { module: 'SYSTEM' });
      expect(info.level).toBe('INFO');
      expect(info.module).toBe('SYSTEM');

      const warn = logger.warn('Low disk warning');
      expect(warn.level).toBe('WARN');

      const error = logger.error('Database connection timeout', { module: 'SYSTEM' });
      expect(error.level).toBe('ERROR');

      const success = logger.success('Sync complete', { module: 'HOTEL' });
      expect(success.level).toBe('SUCCESS');

      const playwright = logger.playwright('Chromium page loaded', { channelId: 'meituan' });
      expect(playwright.level).toBe('PLAYWRIGHT');
      expect(playwright.module).toBe('PLAYWRIGHT');
      expect(playwright.channelId).toBe('meituan');
    });
  });

  describe('startTiming (Automated Duration Tracker)', () => {
    it('automatically records durationMs upon invocation of finish callback', async () => {
      const finish = logger.startTiming('ORDER_TRANSFER_PMS', {
        module: 'ORDER',
        channelId: 'meituan',
        orderNo: 'MT-20260916-888',
      });

      // 模拟微量延时
      await new Promise((resolve) => setTimeout(resolve, 20));

      const finalEntry = finish({
        level: 'SUCCESS',
        message: '订单直推 PMS 成功',
        details: 'PMS-NO: 20260916-PMS-01',
      });

      expect(finalEntry.event).toBe('ORDER_TRANSFER_PMS');
      expect(finalEntry.module).toBe('ORDER');
      expect(finalEntry.orderNo).toBe('MT-20260916-888');
      expect(finalEntry.level).toBe('SUCCESS');
      expect(typeof finalEntry.durationMs).toBe('number');
      expect(finalEntry.durationMs).toBeGreaterThanOrEqual(15);
    });
  });

  describe('query and purge integration', () => {
    it('queries tracked logs from storage correctly', async () => {
      logger.track('ORDER_POLL_SUCCESS', {
        module: 'ORDER',
        orderNo: 'DY-999',
        message: '拉取到新订单',
      });

      // 强制刷新缓冲区落库
      await logger.flushStorage();

      const results = await logger.queryLogs({ orderNo: 'DY-999' });
      expect(results.length).toBe(1);
      expect(results[0].orderNo).toBe('DY-999');
    });
  });
});
