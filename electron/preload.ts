import { contextBridge, ipcRenderer } from 'electron';
import type { HotelCrawlRequest, HotelCrawlResult, ProfileSyncResult } from '../src/crawler/types';
import type { SystemLogEntry, StationIdentity } from '../src/types';

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
  onLog: (callback: (entry: SystemLogEntry) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: SystemLogEntry) => callback(entry);
    ipcRenderer.on('duty:log-entry', listener);
    return () => {
      ipcRenderer.removeListener('duty:log-entry', listener);
    };
  },
};

// 安全隔离注入至渲染进程主世界
contextBridge.exposeInMainWorld('electron', {
  crawler: crawlerApi,
  duty: dutyApi,
  env: {
    platformBaseUrl: process.env.VITE_PLATFORM_BASE_URL || '',
  },
});
