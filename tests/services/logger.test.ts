import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoggerService } from '../../src/services/logger';
import { logStorage } from '../../src/services/logStorage';
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
      expect(info.event).toBe('INFO');

      const warn = logger.warn('Low disk warning');
      expect(warn.level).toBe('WARN');
      expect(warn.event).toBe('WARN');

      const error = logger.error('Database connection timeout', { module: 'SYSTEM' });
      expect(error.level).toBe('ERROR');
      expect(error.event).toBe('ERROR');

      const success = logger.success('Sync complete', { module: 'HOTEL' });
      expect(success.level).toBe('SUCCESS');
      expect(success.event).toBe('SUCCESS');

      const playwright = logger.playwright('Chromium page loaded', { channelId: 'meituan' });
      expect(playwright.level).toBe('PLAYWRIGHT');
      expect(playwright.module).toBe('PLAYWRIGHT');
      expect(playwright.event).toBe('PLAYWRIGHT_EVENT');
      expect(playwright.channelId).toBe('meituan');
    });

    it('keeps the playwright event name stable regardless of the caller module', () => {
      const entry = logger.playwright('Auth page loaded', { module: 'AUTH' });

      expect(entry.event).toBe('PLAYWRIGHT_EVENT');
      expect(entry.module).toBe('AUTH');
    });

    it('automatically resolves and normalizes taskActionStage at point of emission', () => {
      const entry1 = logger.track('DUTY_TASK_CLAIM', {
        message: '认领任务 task-001',
      });
      expect(entry1.taskActionStage).toBe('claim');

      const entry2 = logger.track('ORDER_IMPORT_SUBMIT', {
        taskActionStage: 'ORDER_IMPORT_SUBMIT',
        message: '提交入单',
      });
      expect(entry2.taskActionStage).toBe('order-import-submit');
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

  describe('storage failure handling', () => {
    it('re-queues buffered entries when persistence fails so they are not silently dropped', async () => {
      const saveSpy = vi
        .spyOn(logStorage, 'saveLogs')
        .mockRejectedValueOnce(new Error('IndexedDB unavailable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      logger.track('ORDER_POLL_SUCCESS', {
        module: 'ORDER',
        orderNo: 'MT-RETRY-1',
        message: '待重试日志',
      });

      await logger.flushStorage();

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[LoggerService] 日志持久化失败，已保留待重试:',
        expect.any(Error)
      );

      saveSpy.mockResolvedValueOnce(undefined);
      await logger.flushStorage();

      expect(saveSpy).toHaveBeenCalledTimes(2);
      const retriedEntries = saveSpy.mock.calls[1][0];
      expect(retriedEntries.length).toBe(1);
      expect(retriedEntries[0].orderNo).toBe('MT-RETRY-1');
    });
  });

  describe('persist idempotency', () => {
    it('persists an externally built entry only once per entry id', async () => {
      const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
      const entry: SystemLogEntry = {
        id: 'duty-log-3000-zzzzz',
        timestamp: '2026-09-18 17:30:00.000',
        createdAt: 3000,
        level: 'INFO',
        module: 'DUTY_TASK',
        orderNo: 'MT-889900',
        message: '值守任务认领',
      };

      logger.persist(entry);
      logger.persist(entry);
      logger.persist({ ...entry });
      await logger.flushStorage();

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const savedEntries = saveSpy.mock.calls[0][0];
      expect(savedEntries).toHaveLength(1);
      expect(savedEntries[0].id).toBe('duty-log-3000-zzzzz');
    });

    it('accepts the same id again after clearAll resets the idempotency ledger', async () => {
      const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
      const entry: SystemLogEntry = {
        id: 'duty-log-4000-yyyyy',
        timestamp: '2026-09-18 17:31:00.000',
        createdAt: 4000,
        level: 'INFO',
        message: '清空后重新投递',
      };

      logger.persist(entry);
      await logger.flushStorage();
      await logger.clearAll();
      logger.persist(entry);
      await logger.flushStorage();

      expect(saveSpy).toHaveBeenCalledTimes(2);
    });
  });
});
