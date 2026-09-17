import { describe, it, expect, beforeEach } from 'vitest';
import { LogStorageService, SEVEN_DAYS_MS, formatLogTimestamp } from '../../src/services/logStorage';
import { SystemLogEntry } from '../../src/types';

describe('LogStorageService (IndexedDB & Memory Dual-Engine)', () => {
  let storage: LogStorageService;

  beforeEach(async () => {
    storage = new LogStorageService();
    await storage.clearAllStoredLogs();
  });

  it('formats timestamp as readable standard string YYYY-MM-DD HH:mm:ss.SSS', () => {
    const fixedDate = new Date(2026, 8, 16, 14, 30, 45, 123); // 2026-09-16 14:30:45.123
    const formatted = formatLogTimestamp(fixedDate);
    expect(formatted).toBe('2026-09-16 14:30:45.123');
  });

  it('saves log entries and retrieves them correctly', async () => {
    const now = Date.now();
    const entry: SystemLogEntry = {
      id: 'log-test-1',
      timestamp: formatLogTimestamp(new Date(now)),
      createdAt: now,
      level: 'INFO',
      module: 'AUTH',
      event: 'AUTH_LOGIN_SUCCESS',
      message: '用户登录成功',
      details: '租户: test-tenant',
    };

    await storage.saveLogs([entry]);

    const count = await storage.countLogs();
    expect(count).toBe(1);

    const queried = await storage.queryLogs();
    expect(queried.length).toBe(1);
    expect(queried[0].id).toBe('log-test-1');
    expect(queried[0].module).toBe('AUTH');
    expect(queried[0].event).toBe('AUTH_LOGIN_SUCCESS');
  });

  describe('Multi-dimensional faceted query', () => {
    beforeEach(async () => {
      const now = Date.now();
      const testEntries: SystemLogEntry[] = [
        {
          id: 'log-1',
          timestamp: formatLogTimestamp(new Date(now)),
          createdAt: now,
          level: 'ERROR',
          module: 'ORDER',
          event: 'ORDER_TRANSFER_PMS_FAILED',
          channelId: 'meituan',
          orderNo: 'MT-20260916-001',
          message: '美团订单推送失败',
          details: 'PMS-ATL-K01 not found',
        },
        {
          id: 'log-2',
          timestamp: formatLogTimestamp(new Date(now - 1000)),
          createdAt: now - 1000,
          level: 'SUCCESS',
          module: 'ORDER',
          event: 'ORDER_TRANSFER_PMS_SUCCESS',
          channelId: 'douyin',
          orderNo: 'DY-20260916-002',
          message: '抖音订单推送成功',
        },
        {
          id: 'log-3',
          timestamp: formatLogTimestamp(new Date(now - 2000)),
          createdAt: now - 2000,
          level: 'WARN',
          module: 'PLAYWRIGHT',
          event: 'PLAYWRIGHT_CAPTCHA_DETECTED',
          channelId: 'fliggy',
          message: '检测到滑块验证码',
        },
      ];

      await storage.saveLogs(testEntries);
    });

    it('filters by module accurately', async () => {
      const orderLogs = await storage.queryLogs({ module: 'ORDER' });
      expect(orderLogs.length).toBe(2);
      expect(orderLogs.every((l) => l.module === 'ORDER')).toBe(true);

      const playwrightLogs = await storage.queryLogs({ module: 'PLAYWRIGHT' });
      expect(playwrightLogs.length).toBe(1);
      expect(playwrightLogs[0].id).toBe('log-3');
    });

    it('filters by level accurately', async () => {
      const errorLogs = await storage.queryLogs({ level: 'ERROR' });
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0].id).toBe('log-1');
    });

    it('filters by channelId accurately', async () => {
      const meituanLogs = await storage.queryLogs({ channelId: 'meituan' });
      expect(meituanLogs.length).toBe(1);
      expect(meituanLogs[0].orderNo).toBe('MT-20260916-001');
    });

    it('filters by event accurately', async () => {
      const failedEvents = await storage.queryLogs({ event: 'ORDER_TRANSFER_PMS_FAILED' });
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0].id).toBe('log-1');
    });

    it('filters by onlyErrors flag', async () => {
      const errAndWarn = await storage.queryLogs({ onlyErrors: true });
      expect(errAndWarn.length).toBe(2);
      expect(errAndWarn.some((l) => l.id === 'log-1')).toBe(true); // ERROR
      expect(errAndWarn.some((l) => l.id === 'log-3')).toBe(true); // WARN
      expect(errAndWarn.some((l) => l.id === 'log-2')).toBe(false); // SUCCESS
    });

    it('searches by keyword across orderNo, message, and details', async () => {
      const byOrder = await storage.queryLogs({ search: 'MT-20260916-001' });
      expect(byOrder.length).toBe(1);
      expect(byOrder[0].id).toBe('log-1');

      const byDetails = await storage.queryLogs({ search: 'PMS-ATL-K01' });
      expect(byDetails.length).toBe(1);
      expect(byDetails[0].id).toBe('log-1');
    });
  });

  describe('7-day retention & pruning mechanism (TTL)', () => {
    it('purges logs older than 7 days while strictly preserving logs within 7 days', async () => {
      const now = Date.now();
      const eightDaysAgo = now - (SEVEN_DAYS_MS + 24 * 3600 * 1000); // 8 天前 (已过期)
      const tenDaysAgo = now - (SEVEN_DAYS_MS + 3 * 24 * 3600 * 1000); // 10 天前 (已过期)
      const fiveDaysAgo = now - (5 * 24 * 3600 * 1000); // 5 天前 (仍在 7 天有效期内)
      const oneHourAgo = now - (3600 * 1000); // 1 小时前 (新鲜日志)

      const entries: SystemLogEntry[] = [
        {
          id: 'log-expired-10d',
          timestamp: formatLogTimestamp(new Date(tenDaysAgo)),
          createdAt: tenDaysAgo,
          level: 'INFO',
          message: '10 天前的历史日志',
        },
        {
          id: 'log-expired-8d',
          timestamp: formatLogTimestamp(new Date(eightDaysAgo)),
          createdAt: eightDaysAgo,
          level: 'WARN',
          message: '8 天前的历史日志',
        },
        {
          id: 'log-valid-5d',
          timestamp: formatLogTimestamp(new Date(fiveDaysAgo)),
          createdAt: fiveDaysAgo,
          level: 'INFO',
          message: '5 天前产生的有效日志',
        },
        {
          id: 'log-valid-recent',
          timestamp: formatLogTimestamp(new Date(oneHourAgo)),
          createdAt: oneHourAgo,
          level: 'SUCCESS',
          message: '1 小时前的近况日志',
        },
      ];

      await storage.saveLogs(entries);

      const totalBefore = await storage.countLogs();
      expect(totalBefore).toBe(4);

      // 执行 7 天过期数据清除
      const purgedCount = await storage.purgeLogsOlderThan7Days();

      // 严谨断言：恰好删除了 2 条超过 7 天的记录
      expect(purgedCount).toBe(2);

      const remainingLogs = await storage.queryLogs();
      expect(remainingLogs.length).toBe(2);

      // 严谨断言：过期的 2 条日志已彻底不存在
      expect(remainingLogs.some((l) => l.id === 'log-expired-10d')).toBe(false);
      expect(remainingLogs.some((l) => l.id === 'log-expired-8d')).toBe(false);

      // 严谨断言：在 7 天保留期内的日志完好无损
      expect(remainingLogs.some((l) => l.id === 'log-valid-5d')).toBe(true);
      expect(remainingLogs.some((l) => l.id === 'log-valid-recent')).toBe(true);
    });
  });

  describe('clearAllStoredLogs', () => {
    it('clears all entries in storage completely', async () => {
      await storage.saveLogs([
        {
          id: 'log-tmp',
          timestamp: formatLogTimestamp(),
          createdAt: Date.now(),
          level: 'INFO',
          message: '临时日志',
        },
      ]);
      expect(await storage.countLogs()).toBe(1);

      await storage.clearAllStoredLogs();
      expect(await storage.countLogs()).toBe(0);
      expect(await storage.queryLogs()).toEqual([]);
    });
  });
});
