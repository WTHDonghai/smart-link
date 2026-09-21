import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LogStorageService,
  SEVEN_DAYS_MS,
  formatLogTimestamp,
  matchesLogFilter,
  parseDateBounds,
} from '../../src/services/logStorage';
import { SystemLogEntry } from '../../src/types';

type FakeEventHandler = (event: { target: unknown }) => void;

interface FakeCursorRequest {
  onsuccess: FakeEventHandler | null;
  onerror: FakeEventHandler | null;
}

interface FakeStore {
  put: (entry: SystemLogEntry) => void;
  index: () => { openCursor: () => FakeCursorRequest };
}

interface FakeTransaction {
  error: Error;
  objectStore: () => FakeStore;
  oncomplete: (() => void) | null;
  onerror: FakeEventHandler | null;
}

interface FakeDatabase {
  transaction: () => FakeTransaction;
}

interface FakeOpenRequest {
  result: FakeDatabase;
  onupgradeneeded: FakeEventHandler | null;
  onsuccess: FakeEventHandler | null;
  onerror: FakeEventHandler | null;
}

function installFailingIndexedDBStub(): Error {
  const transactionError = new Error('simulated IndexedDB transaction failure');
  const cursorRequest: FakeCursorRequest = { onsuccess: null, onerror: null };
  const store: FakeStore = {
    put: () => undefined,
    index: () => ({ openCursor: () => cursorRequest }),
  };
  const transaction: FakeTransaction = {
    error: transactionError,
    objectStore: () => store,
    oncomplete: null,
    onerror: null,
  };
  const database: FakeDatabase = {
    transaction: () => {
      queueMicrotask(() => transaction.onerror?.({ target: transaction }));
      return transaction;
    },
  };
  const openRequest: FakeOpenRequest = {
    result: database,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
  };

  queueMicrotask(() => openRequest.onsuccess?.({ target: openRequest }));
  vi.stubGlobal('indexedDB', { open: () => openRequest } as unknown as IDBFactory);
  return transactionError;
}

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

  describe('Strict date bounds validation', () => {
    it('rejects impossible calendar dates without silently normalizing them', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const bounds = parseDateBounds('2026-02-31');

      expect(bounds).toEqual({ startMs: null, endMs: null, hasInvalidInput: true });
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[LogStorage] 日期筛选值非法，必须为有效的 YYYY-MM-DD:',
        '2026-02-31'
      );
    });

    it('keeps valid padded, unpadded, and slash-separated dates on exact local day boundaries', () => {
      const cases = [
        ['2026-09-15', 2026, 8, 15],
        ['2026-9-5', 2026, 8, 5],
        ['2026/09/15', 2026, 8, 15],
      ] as const;

      for (const [input, year, monthIndex, day] of cases) {
        const bounds = parseDateBounds(undefined, undefined, input);
        expect(bounds).toEqual({
          startMs: new Date(year, monthIndex, day, 0, 0, 0, 0).getTime(),
          endMs: new Date(year, monthIndex, day, 23, 59, 59, 999).getTime(),
          hasInvalidInput: false,
        });
      }
    });

    it('fails closed with a concrete empty result when an invalid date participates in filtering', async () => {
      const now = Date.now();
      const entry: SystemLogEntry = {
        id: 'log-invalid-date-filter',
        timestamp: formatLogTimestamp(new Date(now)),
        createdAt: now,
        level: 'INFO',
        message: '不应在非法日期筛选下返回',
      };
      await storage.saveLogs([entry]);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const bounds = parseDateBounds('2026-02-31');

      expect(matchesLogFilter(entry, undefined, bounds)).toBe(false);
      await expect(storage.queryLogs({ startDate: '2026-02-31' })).resolves.toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[LogStorage] 日期筛选值非法，必须为有效的 YYYY-MM-DD:',
        '2026-02-31'
      );
    });
  });

  describe('IndexedDB runtime failure handling', () => {
    it('rejects queryLogs and reports the original transaction error instead of using memory fallback', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const transactionError = installFailingIndexedDBStub();
      const indexedStorage = new LogStorageService();

      await expect(indexedStorage.queryLogs()).rejects.toThrow(transactionError.message);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[LogStorage] queryLogs IndexedDB 操作失败:',
        transactionError
      );
    });

    it('rejects saveLogs and reports the original transaction error instead of using memory fallback', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const transactionError = installFailingIndexedDBStub();
      const indexedStorage = new LogStorageService();
      const entry: SystemLogEntry = {
        id: 'log-idb-save-failure',
        timestamp: formatLogTimestamp(),
        createdAt: Date.now(),
        level: 'ERROR',
        message: '运行时存储失败必须显式返回',
      };

      await expect(indexedStorage.saveLogs([entry])).rejects.toThrow(transactionError.message);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[LogStorage] saveLogs IndexedDB 操作失败:',
        transactionError
      );
    });
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

    it('filters by channelId accurately (case-insensitive)', async () => {
      const meituanLogs = await storage.queryLogs({ channelId: 'meituan' });
      expect(meituanLogs.length).toBe(1);
      expect(meituanLogs[0].orderNo).toBe('MT-20260916-001');

      // 验证大写查询依然命中存储为小写的 channelId
      const upperMeituan = await storage.queryLogs({ channelId: 'MEITUAN' });
      expect(upperMeituan.length).toBe(1);
      expect(upperMeituan[0].id).toBe('log-1');

      // 验证混合大小写查询
      const mixedDouyin = await storage.queryLogs({ channelId: 'DouYin' });
      expect(mixedDouyin.length).toBe(1);
      expect(mixedDouyin[0].id).toBe('log-2');
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

    it('filters by exact orderNo with case-insensitive substring match', async () => {
      const exact = await storage.queryLogs({ orderNo: 'MT-20260916-001' });
      expect(exact.length).toBe(1);
      expect(exact[0].id).toBe('log-1');

      const partialLower = await storage.queryLogs({ orderNo: 'mt-20260916' });
      expect(partialLower.length).toBe(1);
      expect(partialLower[0].id).toBe('log-1');

      const nonExistent = await storage.queryLogs({ orderNo: 'NON_EXISTENT' });
      expect(nonExistent.length).toBe(0);
    });

    it('filters by date range (startDate & endDate) and single date', async () => {
      const d1 = new Date('2026-09-10T12:00:00.000Z').getTime();
      const d2 = new Date('2026-09-15T12:00:00.000Z').getTime();
      const d3 = new Date('2026-09-20T12:00:00.000Z').getTime();

      await storage.saveLogs([
        {
          id: 'log-d1',
          timestamp: formatLogTimestamp(new Date(d1)),
          createdAt: d1,
          level: 'INFO',
          message: 'D1 log on 2026-09-10',
        },
        {
          id: 'log-d2',
          timestamp: formatLogTimestamp(new Date(d2)),
          createdAt: d2,
          level: 'INFO',
          message: 'D2 log on 2026-09-15',
        },
        {
          id: 'log-d3',
          timestamp: formatLogTimestamp(new Date(d3)),
          createdAt: d3,
          level: 'INFO',
          message: 'D3 log on 2026-09-20',
        },
      ]);

      const date2Local = new Date(d2);
      const date2Str = `${date2Local.getFullYear()}-${String(date2Local.getMonth() + 1).padStart(2, '0')}-${String(date2Local.getDate()).padStart(2, '0')}`;
      const singleDateRes = await storage.queryLogs({ date: date2Str });
      expect(singleDateRes.some((l) => l.id === 'log-d2')).toBe(true);
      expect(singleDateRes.some((l) => l.id === 'log-d1')).toBe(false);
      expect(singleDateRes.some((l) => l.id === 'log-d3')).toBe(false);

      const date1Local = new Date(d1);
      const date1Str = `${date1Local.getFullYear()}-${String(date1Local.getMonth() + 1).padStart(2, '0')}-${String(date1Local.getDate()).padStart(2, '0')}`;
      const rangeRes = await storage.queryLogs({ startDate: date1Str, endDate: date2Str });
      expect(rangeRes.some((l) => l.id === 'log-d1')).toBe(true);
      expect(rangeRes.some((l) => l.id === 'log-d2')).toBe(true);
      expect(rangeRes.some((l) => l.id === 'log-d3')).toBe(false);

      // 验证平滑兼容非补零日期字符串与斜杠格式 (如 2026-9-15 与 2026/09/15)
      const slashDateRes = await storage.queryLogs({
        startDate: `${date1Local.getFullYear()}/${date1Local.getMonth() + 1}/${date1Local.getDate()}`,
        endDate: `${date2Local.getFullYear()}/${date2Local.getMonth() + 1}/${date2Local.getDate()}`,
      });
      expect(slashDateRes.some((l) => l.id === 'log-d1')).toBe(true);
      expect(slashDateRes.some((l) => l.id === 'log-d2')).toBe(true);
      expect(slashDateRes.some((l) => l.id === 'log-d3')).toBe(false);
    });

    it('filters by taskActionStage (case-insensitive & hyphen/underscore normalized)', async () => {
      const now = Date.now();
      await storage.saveLogs([
        {
          id: 'log-stage-claim',
          timestamp: formatLogTimestamp(new Date(now)),
          createdAt: now,
          level: 'INFO',
          taskActionStage: 'claim',
          message: '认领任务',
        },
        {
          id: 'log-stage-import',
          timestamp: formatLogTimestamp(new Date(now + 100)),
          createdAt: now + 100,
          level: 'INFO',
          taskActionStage: 'order-import-submit',
          message: '提交入单',
        },
        {
          id: 'log-stage-result',
          timestamp: formatLogTimestamp(new Date(now + 200)),
          createdAt: now + 200,
          level: 'SUCCESS',
          taskActionStage: 'result',
          message: '任务成功',
        },
      ]);

      const claimRes = await storage.queryLogs({ taskActionStage: 'claim' });
      expect(claimRes.some((l) => l.id === 'log-stage-claim')).toBe(true);
      expect(claimRes.some((l) => l.id === 'log-stage-import')).toBe(false);

      const importRes = await storage.queryLogs({ taskActionStage: 'ORDER_IMPORT_SUBMIT' });
      expect(importRes.some((l) => l.id === 'log-stage-import')).toBe(true);
      expect(importRes.some((l) => l.id === 'log-stage-claim')).toBe(false);

      const resultRes = await storage.queryLogs({ taskActionStage: 'result' });
      expect(resultRes.some((l) => l.id === 'log-stage-result')).toBe(true);
      expect(resultRes.some((l) => l.id === 'log-stage-import')).toBe(false);
    });

    it('handles inverted date range (startDate > endDate) safely returning empty array', async () => {
      const res = await storage.queryLogs({
        startDate: '2026-09-30',
        endDate: '2026-09-01',
      });
      expect(res).toEqual([]);
    });

    it('searches by keyword across apiUrl, apiParams, apiResponse, and msgType', async () => {
      const now = Date.now();
      await storage.saveLogs([
        {
          id: 'log-api-search',
          timestamp: formatLogTimestamp(new Date(now)),
          createdAt: now,
          level: 'INFO',
          module: 'API',
          apiUrl: '/toolkit/orders/import',
          apiMethod: 'POST',
          apiParams: { customKey: 'SECRET_PARAM_VAL' },
          apiResponse: { pmsOrderId: 'PMS_RESP_888' },
          msgType: 'OTA_IMPORT_ORDER',
          message: '提交入单请求',
        },
      ]);

      const byUrl = await storage.queryLogs({ search: 'orders/import' });
      expect(byUrl.some((l) => l.id === 'log-api-search')).toBe(true);

      const byParam = await storage.queryLogs({ search: 'SECRET_PARAM_VAL' });
      expect(byParam.some((l) => l.id === 'log-api-search')).toBe(true);

      const byResp = await storage.queryLogs({ search: 'PMS_RESP_888' });
      expect(byResp.some((l) => l.id === 'log-api-search')).toBe(true);

      const byMsgType = await storage.queryLogs({ search: 'OTA_IMPORT_ORDER' });
      expect(byMsgType.some((l) => l.id === 'log-api-search')).toBe(true);
    });

    it('matches orderNo when order number appears in message or details even if orderNo property is omitted', async () => {
      const now = Date.now();
      await storage.saveLogs([
        {
          id: 'log-ord-in-msg',
          timestamp: formatLogTimestamp(new Date(now)),
          createdAt: now,
          level: 'INFO',
          message: '入单处理中: 订单号 MT-99887766 处理完成',
        },
      ]);

      const res = await storage.queryLogs({ orderNo: 'MT-99887766' });
      expect(res.some((l) => l.id === 'log-ord-in-msg')).toBe(true);
    });

    it('keeps API module sniffing for entries carrying apiUrl without an explicit API module', async () => {
      const now = Date.now();
      await storage.saveLogs([
        {
          id: 'log-api-sniffed',
          timestamp: formatLogTimestamp(new Date(now)),
          createdAt: now,
          level: 'INFO',
          module: 'ORDER',
          apiUrl: '/toolkit/orders/import',
          message: '隐式 API 调用',
        },
        {
          id: 'log-plain-order',
          timestamp: formatLogTimestamp(new Date(now + 10)),
          createdAt: now + 10,
          level: 'INFO',
          module: 'ORDER',
          message: '纯业务日志',
        },
      ]);

      const res = await storage.queryLogs({ module: 'API' });
      expect(res.some((l) => l.id === 'log-api-sniffed')).toBe(true);
      expect(res.some((l) => l.id === 'log-plain-order')).toBe(false);
    });

    it('composes module and taskActionStage filters with AND semantics', async () => {
      const now = Date.now();
      await storage.saveLogs([
        {
          id: 'log-order-claim',
          timestamp: formatLogTimestamp(new Date(now)),
          createdAt: now,
          level: 'INFO',
          module: 'ORDER',
          taskActionStage: 'claim',
          message: '订单认领',
        },
        {
          id: 'log-duty-claim',
          timestamp: formatLogTimestamp(new Date(now + 10)),
          createdAt: now + 10,
          level: 'INFO',
          module: 'DUTY_TASK',
          taskActionStage: 'claim',
          message: '值守认领',
        },
        {
          id: 'log-order-result',
          timestamp: formatLogTimestamp(new Date(now + 20)),
          createdAt: now + 20,
          level: 'INFO',
          module: 'ORDER',
          taskActionStage: 'result',
          message: '订单结果',
        },
      ]);

      const res = await storage.queryLogs({ module: 'ORDER', taskActionStage: 'claim' });
      expect(res.map((l) => l.id)).toEqual(['log-order-claim']);
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
