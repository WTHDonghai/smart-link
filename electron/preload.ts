import { contextBridge, ipcRenderer } from 'electron';
import type { HotelCrawlRequest, HotelCrawlResult, ProfileSyncResult } from '../src/crawler/types';
import type { SystemLogEntry, StationIdentity, PlatformAuthTokens } from '../src/types';

/**
 * 桌面端预加载 API 契约
 * 与 src/services/crawlerBridge.ts 中的 ElectronCrawlerApi 保持 1:1 严格对齐
 */
export interface ElectronCrawlerApi {
  collectHotels(request: HotelCrawlRequest): Promise<HotelCrawlResult>;
  syncProfile?(channelCode?: string): Promise<ProfileSyncResult>;
}

export interface ElectronDutyApi {
  startDuty(channelCode: string): Promise<{ success: boolean; message?: string }>;
  stopDuty(channelCode: string): Promise<{ success: boolean; message?: string }>;
  getStatus(since?: number): Promise<{
    channels: Record<string, { channelCode: string; status: 'STOPPED' | 'STARTING' | 'RUNNING' | 'DEGRADED'; lastStartedAt?: number; error?: string }>;
    coordinatorStatus: 'STOPPED' | 'IDLE' | 'CLAIMING' | 'EXECUTING' | 'REPORTING' | 'CLAIM_BACKOFF' | 'DEGRADED';
    station?: StationIdentity | null;
    logs?: SystemLogEntry[];
  }>;
  syncTokens?(tokens: PlatformAuthTokens): Promise<{ success: boolean; message?: string }>;
  clearTokens?(): Promise<{ success: boolean; message?: string }>;
  onLog?(callback: (entry: SystemLogEntry) => void): () => void;
}

const crawlerApi: ElectronCrawlerApi = {
  collectHotels: (request: HotelCrawlRequest): Promise<HotelCrawlResult> => {
    return ipcRenderer.invoke('crawler:collect-hotels', request);
  },
  syncProfile: (channelCode?: string) => {
    return ipcRenderer.invoke('crawler:sync-profile', channelCode);
  },
};

const dutyApi: ElectronDutyApi = {
  startDuty: (channelCode: string) => {
    return ipcRenderer.invoke('duty:start', channelCode);
  },
  stopDuty: (channelCode: string) => {
    return ipcRenderer.invoke('duty:stop', channelCode);
  },
  getStatus: (since?: number) => {
    return ipcRenderer.invoke('duty:status', since);
  },
  syncTokens: (tokens: PlatformAuthTokens) => {
    return ipcRenderer.invoke('duty:sync-tokens', tokens);
  },
  clearTokens: () => {
    return ipcRenderer.invoke('duty:clear-tokens');
  },
  onLog: (callback: (entry: SystemLogEntry) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: SystemLogEntry) => callback(entry);
    ipcRenderer.on('duty:log-entry', listener);
    return () => {
      ipcRenderer.removeListener('duty:log-entry', listener);
    };
  },
};

const exposedEnv: Record<string, string> = {
  platformBaseUrl: process.env.VITE_PLATFORM_BASE_URL || '',
};

for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('VITE_') && typeof value === 'string') {
    exposedEnv[key] = value;
  }
}

// 安全隔离注入至渲染进程主世界
contextBridge.exposeInMainWorld('electron', {
  crawler: crawlerApi,
  duty: dutyApi,
  env: exposedEnv,
});
