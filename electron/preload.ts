import { contextBridge, ipcRenderer } from 'electron';
import type { HotelCrawlRequest, HotelCrawlResult } from '../src/crawler/types';

/**
 * 桌面端预加载 API 契约
 * 与 src/services/crawlerBridge.ts 中的 ElectronCrawlerApi 保持 1:1 严格对齐
 */
export interface ElectronCrawlerApi {
  collectHotels(request: HotelCrawlRequest): Promise<HotelCrawlResult>;
  syncProfile?(channelCode?: string): Promise<{ success: boolean; message?: string }>;
}

export interface ElectronDutyApi {
  startDuty(channelCode: string): Promise<{ success: boolean; message?: string }>;
  stopDuty(channelCode: string): Promise<{ success: boolean; message?: string }>;
  getStatus(): Promise<{
    channels: Record<string, { channelCode: string; status: 'STOPPED' | 'STARTING' | 'RUNNING' | 'DEGRADED'; lastStartedAt?: number; error?: string }>;
    coordinatorStatus: 'STOPPED' | 'IDLE' | 'CLAIMING' | 'EXECUTING' | 'REPORTING' | 'CLAIM_BACKOFF' | 'DEGRADED';
  }>;
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
  getStatus: () => {
    return ipcRenderer.invoke('duty:status');
  },
};

// 安全隔离注入至渲染进程主世界
contextBridge.exposeInMainWorld('electron', {
  crawler: crawlerApi,
  duty: dutyApi,
});
