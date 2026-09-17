import { SystemLogEntry, LogFilterParams } from '../types';

export const LOG_DB_NAME = 'SmartLink_LogDB';
export const LOG_STORE_NAME = 'logs';
export const LOG_DB_VERSION = 1;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
      if (filter.level && filter.level !== 'ALL') {
        result = result.filter((l) => l.level === filter.level);
      }
      if (filter.module && filter.module !== 'ALL') {
        result = result.filter((l) => l.module === filter.module);
      }
      if (filter.event && filter.event !== 'ALL') {
        result = result.filter((l) => l.event === filter.event);
      }
      if (filter.channelId && filter.channelId !== 'ALL') {
        result = result.filter((l) => l.channelId === filter.channelId);
      }
      if (filter.orderNo) {
        result = result.filter((l) => l.orderNo === filter.orderNo);
      }
      if (filter.onlyErrors) {
        result = result.filter((l) => l.level === 'ERROR' || l.level === 'WARN');
      }
      if (filter.timeRange && filter.timeRange !== 'ALL') {
        const now = Date.now();
        const durationMap: Record<'1D' | '3D' | '7D', number> = {
          '1D': 24 * 60 * 60 * 1000,
          '3D': 3 * 24 * 60 * 60 * 1000,
          '7D': 7 * 24 * 60 * 60 * 1000,
        };
        const cutoff = now - durationMap[filter.timeRange];
        result = result.filter((l) => l.createdAt >= cutoff);
      }
      if (filter.search && filter.search.trim()) {
        const s = filter.search.toLowerCase().trim();
        result = result.filter(
          (l) =>
            l.message.toLowerCase().includes(s) ||
            (l.details && l.details.toLowerCase().includes(s)) ||
            (l.orderNo && l.orderNo.toLowerCase().includes(s)) ||
            (l.channelId && l.channelId.toLowerCase().includes(s)) ||
            (l.event && l.event.toLowerCase().includes(s))
        );
      }
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

        request.onerror = () => {
          this.isIndexedDBAvailable = false;
          resolve(null);
        };
      } catch {
        this.isIndexedDBAvailable = false;
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
        tx.onerror = () => {
          this.memoryFallback.saveLogs(entries).then(resolve, reject);
        };
      } catch {
        this.memoryFallback.saveLogs(entries).then(resolve, reject);
      }
    });
  }

  /**
   * 多维查询日志
   */
  async queryLogs(filter?: LogFilterParams, options?: { limit?: number; offset?: number }): Promise<SystemLogEntry[]> {
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
        if (filter?.timeRange && filter.timeRange !== 'ALL') {
          const now = Date.now();
          const durationMap: Record<'1D' | '3D' | '7D', number> = {
            '1D': 24 * 60 * 60 * 1000,
            '3D': 3 * 24 * 60 * 60 * 1000,
            '7D': 7 * 24 * 60 * 60 * 1000,
          };
          const cutoff = now - durationMap[filter.timeRange];
          keyRange = IDBKeyRange.lowerBound(cutoff);
        }

        const cursorRequest = keyRange
          ? index.openCursor(keyRange, 'prev')
          : index.openCursor(null, 'prev');

        const searchKeyword = filter?.search?.toLowerCase().trim();

        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const entry = cursor.value as SystemLogEntry;

            let matches = true;

            if (filter?.level && filter.level !== 'ALL' && entry.level !== filter.level) {
              matches = false;
            }
            if (matches && filter?.module && filter.module !== 'ALL' && entry.module !== filter.module) {
              matches = false;
            }
            if (matches && filter?.event && filter.event !== 'ALL' && entry.event !== filter.event) {
              matches = false;
            }
            if (matches && filter?.channelId && filter.channelId !== 'ALL' && entry.channelId !== filter.channelId) {
              matches = false;
            }
            if (matches && filter?.orderNo && entry.orderNo !== filter.orderNo) {
              matches = false;
            }
            if (matches && filter?.onlyErrors && entry.level !== 'ERROR' && entry.level !== 'WARN') {
              matches = false;
            }
            if (matches && searchKeyword) {
              const inMsg = entry.message.toLowerCase().includes(searchKeyword);
              const inDetails = entry.details ? entry.details.toLowerCase().includes(searchKeyword) : false;
              const inOrderNo = entry.orderNo ? entry.orderNo.toLowerCase().includes(searchKeyword) : false;
              const inChannel = entry.channelId ? entry.channelId.toLowerCase().includes(searchKeyword) : false;
              const inEvent = entry.event ? entry.event.toLowerCase().includes(searchKeyword) : false;
              if (!inMsg && !inDetails && !inOrderNo && !inChannel && !inEvent) {
                matches = false;
              }
            }

            if (matches) {
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

        cursorRequest.onerror = () => {
          this.memoryFallback.queryLogs(filter, options).then(resolve, reject);
        };
      } catch {
        this.memoryFallback.queryLogs(filter, options).then(resolve, reject);
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

        request.onerror = () => {
          this.memoryFallback.purgeLogsBefore(cutoffTimestamp).then(resolve, reject);
        };
      } catch {
        this.memoryFallback.purgeLogsBefore(cutoffTimestamp).then(resolve, reject);
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
        req.onerror = () => {
          this.memoryFallback.countLogs().then(resolve, reject);
        };
      } catch {
        this.memoryFallback.countLogs().then(resolve, reject);
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
        req.onerror = () => {
          this.memoryFallback.clearAll().then(resolve, reject);
        };
      } catch {
        this.memoryFallback.clearAll().then(resolve, reject);
      }
    });
  }
}

export const logStorage = new LogStorageService();
