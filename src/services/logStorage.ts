import { SystemLogEntry, LogFilterParams } from '../types';
import { compileLogQuery, evaluateLogQuery, LogDateBounds } from '../utils/logQuery';

export const LOG_DB_NAME = 'SmartLink_LogDB';
export const LOG_STORE_NAME = 'logs';
export const LOG_DB_VERSION = 1;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const TIME_RANGE_DURATION_MS: Record<'1D' | '3D' | '7D', number> = {
  '1D': 24 * 60 * 60 * 1000,
  '3D': 3 * 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
};

interface ParsedDateBounds extends LogDateBounds {
  hasInvalidInput: boolean;
}

function reportInvalidDate(value: string): void {
  console.error('[LogStorage] 日期筛选值非法，必须为有效的 YYYY-MM-DD:', value);
}

function parseCalendarDate(dateValue: string): LogDateBounds | null {
  const datePart = normalizeDateString(dateValue);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);

  if (!match) {
    reportInvalidDate(dateValue);
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(0);
  start.setFullYear(year, month - 1, day);
  start.setHours(0, 0, 0, 0);

  if (
    start.getFullYear() !== year ||
    start.getMonth() !== month - 1 ||
    start.getDate() !== day
  ) {
    reportInvalidDate(dateValue);
    return null;
  }

  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function readIndexedDBEventError(event: Event): unknown {
  const target = event.target as { error?: unknown } | null;
  return target?.error ?? new Error('IndexedDB 操作未提供错误详情');
}

function reportIndexedDBOperationError(operation: string, error: unknown): unknown {
  console.error(`[LogStorage] ${operation} IndexedDB 操作失败:`, error);
  return error;
}

/**
 * 格式化日志时间为人类友好的标准本地化字符串 "YYYY-MM-DD HH:mm:ss.SSS"
 */
export function formatLogTimestamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}.${ms}`;
}

/**
 * 规范化日期字符串为 YYYY-MM-DD 格式，平滑兼容 1-9 单数字月份/日期与斜杠分隔符
 */
export function normalizeDateString(dateStr: string): string {
  const clean = dateStr.trim();
  const datePart = clean.includes('T') ? clean.split('T')[0] : clean.split(' ')[0];
  const parts = datePart.split(/[-/]/);
  if (parts.length === 3 && parts[0].length === 4) {
    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return datePart;
}

/**
 * 解析日期过滤边界（毫秒时间戳）
 * 严格支持 YYYY-MM-DD 与 ISO 字符串，统一收敛为本地天起始 00:00:00.000 与天截止 23:59:59.999
 */
export function parseDateBounds(
  startDate?: string,
  endDate?: string,
  singleDate?: string
): ParsedDateBounds {
  let startMs: number | null = null;
  let endMs: number | null = null;

  if (singleDate && singleDate.trim()) {
    const parsed = parseCalendarDate(singleDate);
    if (!parsed) {
      return { startMs: null, endMs: null, hasInvalidInput: true };
    }
    return { ...parsed, hasInvalidInput: false };
  } else {
    if (startDate && startDate.trim()) {
      const parsed = parseCalendarDate(startDate);
      if (parsed) {
        startMs = parsed.startMs;
      }
    }
    if (endDate && endDate.trim()) {
      const parsed = parseCalendarDate(endDate);
      if (parsed) {
        endMs = parsed.endMs;
      }
    }
  }

  const hasInvalidInput =
    (!!startDate?.trim() && startMs === null) || (!!endDate?.trim() && endMs === null);
  if (hasInvalidInput) {
    return { startMs: null, endMs: null, hasInvalidInput: true };
  }

  return { startMs, endMs, hasInvalidInput: false };
}

/**
 * 解析过滤条件中的日期与时间范围边界，统一供内存引擎与 IndexedDB 游标使用
 */
export function resolveQueryBounds(filter?: LogFilterParams): ParsedDateBounds {
  const bounds = parseDateBounds(filter?.startDate, filter?.endDate, filter?.date);
  if (bounds.hasInvalidInput) {
    return bounds;
  }

  let startBound = bounds.startMs;
  const endBound = bounds.endMs;

  if (filter?.timeRange && filter.timeRange !== 'ALL') {
    const cutoff = Date.now() - TIME_RANGE_DURATION_MS[filter.timeRange];
    startBound = startBound !== null ? Math.max(startBound, cutoff) : cutoff;
  }

  return { startMs: startBound, endMs: endBound, hasInvalidInput: false };
}

/**
 * 统一多维日志过滤断言纯函数
 * 所有维度统一编译为 liqe 查询表达式，由单一 AST 引擎裁决
 */
export function matchesLogFilter(
  entry: SystemLogEntry,
  filter?: LogFilterParams,
  bounds?: LogDateBounds & { hasInvalidInput?: boolean }
): boolean {
  if (bounds?.hasInvalidInput) return false;
  if (!filter) return true;
  return evaluateLogQuery(entry, compileLogQuery(filter, bounds));
}

/**
 * 内存备用存储，用于在非浏览器环境（如单测、Node.js、无 IndexedDB 权限）下保障系统零崩溃、平滑执行
 */
class MemoryLogStorage {
  private logs: SystemLogEntry[] = [];

  async saveLogs(entries: SystemLogEntry[]): Promise<void> {
    const map = new Map<string, SystemLogEntry>();
    for (const log of this.logs) {
      map.set(log.id, log);
    }
    for (const entry of entries) {
      map.set(entry.id, entry);
    }
    this.logs = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  async queryLogs(filter?: LogFilterParams, options?: { limit?: number; offset?: number }): Promise<SystemLogEntry[]> {
    let result = [...this.logs];

    if (filter) {
      const activeBounds = resolveQueryBounds(filter);

      if (activeBounds.hasInvalidInput) {
        return [];
      }

      if (
        activeBounds.startMs !== null &&
        activeBounds.endMs !== null &&
        activeBounds.startMs > activeBounds.endMs
      ) {
        return [];
      }

      result = result.filter((l) => matchesLogFilter(l, filter, activeBounds));
    }

    result.sort((a, b) => b.createdAt - a.createdAt);

    const offset = options?.offset || 0;
    const limit = options?.limit !== undefined ? options.limit : result.length;
    return result.slice(offset, offset + limit);
  }

  async purgeLogsBefore(cutoffTimestamp: number): Promise<number> {
    const beforeCount = this.logs.length;
    this.logs = this.logs.filter((l) => l.createdAt >= cutoffTimestamp);
    return beforeCount - this.logs.length;
  }

  async countLogs(): Promise<number> {
    return this.logs.length;
  }

  async clearAll(): Promise<void> {
    this.logs = [];
  }
}

export class LogStorageService {
  private dbInstance: IDBDatabase | null = null;
  private memoryFallback: MemoryLogStorage = new MemoryLogStorage();
  private isIndexedDBAvailable: boolean;

  constructor() {
    this.isIndexedDBAvailable = typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  }

  /**
   * 初始化数据库，创建对象仓库与多维索引
   */
  async initDB(): Promise<IDBDatabase | null> {
    if (!this.isIndexedDBAvailable) {
      return null;
    }

    if (this.dbInstance) {
      return this.dbInstance;
    }

    return new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(LOG_DB_NAME, LOG_DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
            const store = db.createObjectStore(LOG_STORE_NAME, { keyPath: 'id' });
            // 创建支持 7 天范围淘汰与多维筛选的索引
            store.createIndex('createdAt', 'createdAt', { unique: false });
            store.createIndex('level', 'level', { unique: false });
            store.createIndex('module', 'module', { unique: false });
            store.createIndex('event', 'event', { unique: false });
            store.createIndex('channelId', 'channelId', { unique: false });
            store.createIndex('orderNo', 'orderNo', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.dbInstance = (event.target as IDBOpenDBRequest).result;
          resolve(this.dbInstance);
        };

        request.onerror = (event) => {
          this.isIndexedDBAvailable = false;
          reportIndexedDBOperationError('initDB', readIndexedDBEventError(event));
          resolve(null);
        };
      } catch (error: unknown) {
        this.isIndexedDBAvailable = false;
        reportIndexedDBOperationError('initDB', error);
        resolve(null);
      }
    });
  }

  /**
   * 批量持久化日志条目
   */
  async saveLogs(entries: SystemLogEntry[]): Promise<void> {
    if (!entries || entries.length === 0) return;

    const db = await this.initDB();
    if (!db || !this.isIndexedDBAvailable) {
      await this.memoryFallback.saveLogs(entries);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(LOG_STORE_NAME, 'readwrite');
        const store = tx.objectStore(LOG_STORE_NAME);

        for (const entry of entries) {
          store.put(entry);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = (event) => {
          reject(reportIndexedDBOperationError('saveLogs', readIndexedDBEventError(event)));
        };
      } catch (error: unknown) {
        reject(reportIndexedDBOperationError('saveLogs', error));
      }
    });
  }

  /**
   * 多维查询日志
   */
  async queryLogs(filter?: LogFilterParams, options?: { limit?: number; offset?: number }): Promise<SystemLogEntry[]> {
    const bounds = resolveQueryBounds(filter);
    if (bounds.hasInvalidInput) {
      return [];
    }

    const db = await this.initDB();
    if (!db || !this.isIndexedDBAvailable) {
      return this.memoryFallback.queryLogs(filter, options);
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(LOG_STORE_NAME, 'readonly');
        const store = tx.objectStore(LOG_STORE_NAME);
        const index = store.index('createdAt');

        const results: SystemLogEntry[] = [];

        let keyRange: IDBKeyRange | null = null;
        const startBound = bounds.startMs;
        const endBound = bounds.endMs;

        // 边界保护：若起始边界大于截止边界，直接返回空结果，避免 IndexedDB IDBKeyRange.bound 抛出 DataError
        if (startBound !== null && endBound !== null && startBound > endBound) {
          return resolve([]);
        }

        if (startBound !== null && endBound !== null) {
          keyRange = IDBKeyRange.bound(startBound, endBound);
        } else if (startBound !== null) {
          keyRange = IDBKeyRange.lowerBound(startBound);
        } else if (endBound !== null) {
          keyRange = IDBKeyRange.upperBound(endBound);
        }

        const cursorRequest = keyRange
          ? index.openCursor(keyRange, 'prev')
          : index.openCursor(null, 'prev');

        const activeBounds: LogDateBounds = { startMs: startBound, endMs: endBound };

        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const entry = cursor.value as SystemLogEntry;

            if (matchesLogFilter(entry, filter, activeBounds)) {
              results.push(entry);
            }

            const targetLimit = options?.limit ? (options.offset || 0) + options.limit : undefined;
            if (targetLimit && results.length >= targetLimit) {
              const offset = options?.offset || 0;
              const limit = options?.limit || results.length;
              resolve(results.slice(offset, offset + limit));
              return;
            }

            cursor.continue();
          } else {
            const offset = options?.offset || 0;
            const limit = options?.limit !== undefined ? options.limit : results.length;
            resolve(results.slice(offset, offset + limit));
          }
        };

        tx.onerror = (event) => {
          reject(reportIndexedDBOperationError('queryLogs', readIndexedDBEventError(event)));
        };

        cursorRequest.onerror = (event) => {
          reject(reportIndexedDBOperationError('queryLogs', readIndexedDBEventError(event)));
        };
      } catch (error: unknown) {
        reject(reportIndexedDBOperationError('queryLogs', error));
      }
    });
  }

  /**
   * 物理批量删除指定毫秒时间戳之前的所有过期日志（核心 7 天淘汰算法）
   * @param cutoffTimestamp 截止毫秒时间戳
   * @returns 成功删除的记录条数
   */
  async purgeLogsBefore(cutoffTimestamp: number): Promise<number> {
    const db = await this.initDB();
    if (!db || !this.isIndexedDBAvailable) {
      return this.memoryFallback.purgeLogsBefore(cutoffTimestamp);
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(LOG_STORE_NAME, 'readwrite');
        const store = tx.objectStore(LOG_STORE_NAME);
        const index = store.index('createdAt');

        const range = IDBKeyRange.upperBound(cutoffTimestamp, true);
        const request = index.openCursor(range);

        let deletedCount = 0;

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            resolve(deletedCount);
          }
        };

        request.onerror = (event) => {
          reject(reportIndexedDBOperationError('purgeLogsBefore', readIndexedDBEventError(event)));
        };
        tx.onerror = (event) => {
          reject(reportIndexedDBOperationError('purgeLogsBefore', readIndexedDBEventError(event)));
        };
      } catch (error: unknown) {
        reject(reportIndexedDBOperationError('purgeLogsBefore', error));
      }
    });
  }

  /**
   * 自动清除早于当前时刻 7 天前的所有历史日志
   */
  async purgeLogsOlderThan7Days(): Promise<number> {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    return this.purgeLogsBefore(cutoff);
  }

  /**
   * 获取持久化日志总数
   */
  async countLogs(): Promise<number> {
    const db = await this.initDB();
    if (!db || !this.isIndexedDBAvailable) {
      return this.memoryFallback.countLogs();
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(LOG_STORE_NAME, 'readonly');
        const store = tx.objectStore(LOG_STORE_NAME);
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (event) => {
          reject(reportIndexedDBOperationError('countLogs', readIndexedDBEventError(event)));
        };
        tx.onerror = (event) => {
          reject(reportIndexedDBOperationError('countLogs', readIndexedDBEventError(event)));
        };
      } catch (error: unknown) {
        reject(reportIndexedDBOperationError('countLogs', error));
      }
    });
  }

  /**
   * 清空全部持久化日志
   */
  async clearAllStoredLogs(): Promise<void> {
    const db = await this.initDB();
    if (!db || !this.isIndexedDBAvailable) {
      return this.memoryFallback.clearAll();
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(LOG_STORE_NAME, 'readwrite');
        const store = tx.objectStore(LOG_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = (event) => {
          reject(reportIndexedDBOperationError('clearAllStoredLogs', readIndexedDBEventError(event)));
        };
        tx.onerror = (event) => {
          reject(reportIndexedDBOperationError('clearAllStoredLogs', readIndexedDBEventError(event)));
        };
      } catch (error: unknown) {
        reject(reportIndexedDBOperationError('clearAllStoredLogs', error));
      }
    });
  }
}

export const logStorage = new LogStorageService();
