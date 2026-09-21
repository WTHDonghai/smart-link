import { contextBridge, ipcRenderer } from 'electron';
import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  ProductCrawlRequest,
  ProductCrawlResult,
} from '../src/crawler/types';
import type {
  HostBridgeApi,
  CrawlerBridgeApi,
  DutyBridgeApi,
  PlatformAuthTokens,
  SystemLogEntry,
} from '../src/types';
import type { AppUpdateState } from '../src/types/update';
import { selectAppEnv } from '../src/types/env';

const HOST_LOG_CHANNEL = 'host:log-entry';

const crawlerApi: CrawlerBridgeApi = {
  collectHotels: (request: HotelCrawlRequest): Promise<HotelCrawlResult> => {
    return ipcRenderer.invoke('crawler:collect-hotels', request);
  },
  collectProducts: (request: ProductCrawlRequest): Promise<ProductCrawlResult> => {
    return ipcRenderer.invoke('crawler:collect-products', request);
  },
  syncProfile: (channelCode?: string) => {
    return ipcRenderer.invoke('crawler:sync-profile', channelCode);
  },
};

const dutyApi: DutyBridgeApi = {
  startDuty: (channelCode: string) => {
    return ipcRenderer.invoke('duty:start', channelCode);
  },
  stopDuty: (channelCode: string) => {
    return ipcRenderer.invoke('duty:stop', channelCode);
  },
  stopAllDuty: () => {
    return ipcRenderer.invoke('duty:stop-all');
  },
  teardownApp: () => {
    return ipcRenderer.invoke('app:teardown');
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
  takePendingLogs: (): Promise<SystemLogEntry[]> => {
    return ipcRenderer.invoke('host:pending-logs');
  },
  onLog: (callback: (entry: SystemLogEntry) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: SystemLogEntry) => callback(entry);
    ipcRenderer.on(HOST_LOG_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(HOST_LOG_CHANNEL, listener);
    };
  },
};

const platformApi = {
  request: (options: import('../src/types').PlatformBridgeRequestOptions): Promise<import('../src/types').PlatformBridgeResponse> => {
    return ipcRenderer.invoke('platform:request', options);
  },
};

const exposedEnv = selectAppEnv(process.env);

const updateApi: HostBridgeApi['update'] = {
  getState: () => ipcRenderer.invoke('app-update:get-state'),
  checkForUpdate: () => ipcRenderer.invoke('app-update:check'),
  installUpdate: () => ipcRenderer.invoke('app-update:install'),
  onUpdateState: (callback: (state: AppUpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppUpdateState) => callback(state);
    ipcRenderer.on('host:update-state', listener);
    return () => {
      ipcRenderer.removeListener('host:update-state', listener);
    };
  },
};

// 安全隔离注入至渲染进程主世界
contextBridge.exposeInMainWorld('host', {
  crawler: crawlerApi,
  duty: dutyApi,
  update: updateApi,
  env: exposedEnv,
  platform: platformApi,
});
