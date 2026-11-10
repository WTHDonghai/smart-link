import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  LogStorageService,
  LOG_DB_NAME,
  LOG_STORE_NAME,
} from '../../src/services/logStorage';
import type { SystemLogEntry } from '../../src/types';

/**
 * 使用 fake-indexeddb 提供的真实 IndexedDB 语义验证：
 * v1 -> v2 迁移、Agent 嵌套 keyPath 索引与时间线查询、查询作用域隔离。
 */

let storageCounter = 0;

function buildAgentEntry(
  id: string,
  agent: { traceId: string; runId: string; sequence: number },
  createdAt = 1780000000000
): SystemLogEntry {
  return {
    id,
    timestamp: '2026-11-02 10:00:00.000',
    createdAt,
    level: 'INFO',
    message: `[AGENT_EVENT] ${id}`,
    meta: { agent: { ...agent } },
  };
}

function buildPlainEntry(id: string, createdAt = 1780000000000): SystemLogEntry {
  return {
    id,
    timestamp: '2026-11-02 10:00:00.000',
    createdAt,
    level: 'INFO',
    message: `[SYS_EVENT] ${id}`,
  };
}

/** 还原 v1 时代的数据库结构（logs store + 六个基础索引）并写入一条存量日志 */
async function seedLegacyV1Database(legacyEntry: SystemLogEntry): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(LOG_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
        const store = db.createObjectStore(LOG_STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('level', 'level', { unique: false });
        store.createIndex('module', 'module', { unique: false });
        store.createIndex('event', 'event', { unique: false });
        store.createIndex('channelId', 'channelId', { unique: false });
        store.createIndex('orderNo', 'orderNo', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(LOG_STORE_NAME, 'readwrite');
      tx.objectStore(LOG_STORE_NAME).put(legacyEntry);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readStoreIndexNames(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOG_DB_NAME);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(LOG_STORE_NAME, 'readonly');
      const names = [...tx.objectStore(LOG_STORE_NAME).indexNames];
      db.close();
      resolve(names);
    };
    request.onerror = () => reject(request.error);
  });
}

describe('LogStorageService Agent 追踪索引与 v1 -> v2 迁移（真实 IndexedDB 语义）', () => {
  let storage: LogStorageService;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    storageCounter += 1;
    storage = new LogStorageService({ allowMemoryFallback: false });
  });

  it('全新库直接以 v2 建库并创建 Agent 追踪索引', async () => {
    await storage.initDB();

    const indexNames = await readStoreIndexNames();
    expect(indexNames).toContain('agentTraceId');
    expect(indexNames).toContain('agentRunSeq');
    expect(indexNames).toContain('createdAt');
  });

  it('v1 存量库升级到 v2：数据保留、无 meta.agent 的旧日志不进入追踪索引', async () => {
    const legacy = buildPlainEntry('legacy-1', 1780000000000);
    await seedLegacyV1Database(legacy);

    await storage.initDB();

    const indexNames = await readStoreIndexNames();
    expect(indexNames).toContain('agentTraceId');
    expect(indexNames).toContain('agentRunSeq');

    // 存量数据仍然可查
    const all = await storage.queryLogs(undefined, { pageSize: 100 });
    expect(all.items.map((item) => item.id)).toEqual(['legacy-1']);

    // 旧日志不属于任何追踪
    const traceOfLegacy = await storage.queryLogsByTrace('trace-any');
    expect(traceOfLegacy.items).toEqual([]);
  });

  it('按 traceId 跨 run 查询：按 runId + sequence 升序排列并支持游标分页', async () => {
    await storage.initDB();
    await storage.saveLogs([
      buildAgentEntry('a-runB-2', { traceId: 'T1', runId: 'run-B', sequence: 2 }, 1780000000004),
      buildAgentEntry('a-runA-1', { traceId: 'T1', runId: 'run-A', sequence: 1 }, 1780000000001),
      buildAgentEntry('other-trace-1', { traceId: 'T2', runId: 'run-C', sequence: 1 }, 1780000000005),
      buildAgentEntry('a-runB-1', { traceId: 'T1', runId: 'run-B', sequence: 1 }, 1780000000003),
      buildAgentEntry('a-runA-2', { traceId: 'T1', runId: 'run-A', sequence: 2 }, 1780000000002),
      buildAgentEntry('a-runB-3', { traceId: 'T1', runId: 'run-B', sequence: 3 }, 1780000000006),
      buildPlainEntry('plain-2', 1780000000007),
    ]);

    const full = await storage.queryLogsByTrace('T1');
    expect(full.items.map((item) => item.id)).toEqual([
      'a-runA-1',
      'a-runA-2',
      'a-runB-1',
      'a-runB-2',
      'a-runB-3',
    ]);
    expect(full.hasMore).toBe(false);
    expect(full.totalScanned).toBe(5);

    // 分页：pageSize=2
    const page1 = await storage.queryLogsByTrace('T1', { pageSize: 2 });
    expect(page1.items.map((item) => item.id)).toEqual(['a-runA-1', 'a-runA-2']);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toEqual({ runId: 'run-A', sequence: 2 });

    const page2 = await storage.queryLogsByTrace('T1', {
      pageSize: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items.map((item) => item.id)).toEqual(['a-runB-1', 'a-runB-2']);
    expect(page2.hasMore).toBe(true);

    const page3 = await storage.queryLogsByTrace('T1', {
      pageSize: 2,
      cursor: page2.nextCursor,
    });
    expect(page3.items.map((item) => item.id)).toEqual(['a-runB-3']);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeUndefined();
  });

  it('按 runId 查询单 run 时间线：sequence 升序并支持游标分页', async () => {
    await storage.initDB();
    await storage.saveLogs([
      buildAgentEntry('r-3', { traceId: 'T1', runId: 'run-X', sequence: 3 }),
      buildAgentEntry('r-1', { traceId: 'T1', runId: 'run-X', sequence: 1 }),
      buildAgentEntry('r-2', { traceId: 'T1', runId: 'run-X', sequence: 2 }),
      buildAgentEntry('other-run', { traceId: 'T1', runId: 'run-Y', sequence: 1 }),
    ]);

    const page1 = await storage.queryRunTimeline('run-X', { pageSize: 2 });
    expect(page1.items.map((item) => item.id)).toEqual(['r-1', 'r-2']);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toEqual({ runId: 'run-X', sequence: 2 });

    const page2 = await storage.queryRunTimeline('run-X', {
      pageSize: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items.map((item) => item.id)).toEqual(['r-3']);
    expect(page2.hasMore).toBe(false);
  });

  it('追踪时间线查询与系统日志查询使用独立作用域，互不取消', async () => {
    await storage.initDB();
    await storage.saveLogs([
      buildAgentEntry('a-1', { traceId: 'T1', runId: 'run-A', sequence: 1 }),
      buildPlainEntry('p-1'),
    ]);

    // 同时发起：若共享 activeQueryId，先发起的追踪查询会被后发起的系统查询中止并返回空
    const [traceResult, systemResult] = await Promise.all([
      storage.queryLogsByTrace('T1'),
      storage.queryLogs(undefined, { pageSize: 10 }),
    ]);

    expect(traceResult.items.map((item) => item.id)).toEqual(['a-1']);
    expect(systemResult.items.length).toBe(2);
  });

  it('缺少 traceId / runId 时立即拒绝', async () => {
    await expect(storage.queryLogsByTrace('  ')).rejects.toThrow(
      '[LogStorage] 查询 Agent 追踪时间线必须提供 traceId'
    );
    await expect(storage.queryRunTimeline('')).rejects.toThrow(
      '[LogStorage] 查询 Agent run 时间线必须提供 runId'
    );
  });
});
