import { afterEach, vi } from 'vitest';
import { loadProjectEnv } from '../src/config/envLoader';
import type { HostBridgeApi } from '../src/types';

Object.assign(process.env, loadProjectEnv('test', process.cwd()));

const desktopHost: HostBridgeApi = {
  crawler: {
    collectHotels: () => Promise.reject(new Error('测试未预期调用门店采集')),
    syncProfile: () => Promise.reject(new Error('测试未预期调用登录态同步')),
  },
  duty: {
    startDuty: () => Promise.reject(new Error('测试未预期启动值守')),
    stopDuty: () => Promise.reject(new Error('测试未预期停止值守')),
    stopAllDuty: () => Promise.reject(new Error('测试未预期停止全部值守')),
    getStatus: () => Promise.reject(new Error('测试未预期查询值守状态')),
    syncTokens: () => Promise.reject(new Error('测试未预期同步 Token')),
    clearTokens: () => Promise.reject(new Error('测试未预期清除 Token')),
    takePendingLogs: () => Promise.resolve([]),
    onLog: () => () => undefined,
  },
  env: {},
};

class LocalStorageMock implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const mockStorage = new LocalStorageMock();

if (typeof (globalThis as unknown as { Storage?: unknown }).Storage === 'undefined') {
  Object.defineProperty(globalThis, 'Storage', {
    value: LocalStorageMock,
    writable: true,
  });
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    writable: true,
  });
}

if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
  });
}

if (typeof window !== 'undefined') {
  window.host = desktopHost;
}

afterEach(() => {
  if (typeof window !== 'undefined') {
    window.host = desktopHost;
  }
  mockStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
