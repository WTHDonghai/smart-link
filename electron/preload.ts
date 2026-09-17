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

const crawlerApi: ElectronCrawlerApi = {
  collectHotels: (request: HotelCrawlRequest): Promise<HotelCrawlResult> => {
    return ipcRenderer.invoke('crawler:collect-hotels', request);
  },
  syncProfile: (channelCode?: string) => {
    return ipcRenderer.invoke('crawler:sync-profile', channelCode);
  },
};

// 安全隔离注入至渲染进程主世界
contextBridge.exposeInMainWorld('electron', {
  crawler: crawlerApi,
});
