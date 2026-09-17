import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  ProfileSyncResult,
} from '../crawler/types';
import {
  executeHotelCrawl,
  requestSyncChromeProfile,
  type CrawlerApiResponse,
  type ProfileSyncResponseData,
} from './crawlerApi';

export interface ElectronCrawlerApi {
  collectHotels(request: HotelCrawlRequest): Promise<HotelCrawlResult>;
  syncProfile?(channelCode?: string): Promise<ProfileSyncResult>;
}

interface WindowWithElectron {
  electron?: {
    crawler?: ElectronCrawlerApi;
  };
}

/**
 * 统一采集通信网关 (Unified Crawler Bridge)
 * 抹平 Electron IPC 与 Vite HTTP 差异，上层业务统一通过大写 channelCode 发起采集
 */
export async function collectHotelsByChannel(
  channelCode: string,
  options: Omit<HotelCrawlRequest, 'channelCode'> = {}
): Promise<CrawlerApiResponse> {
  const code = channelCode.trim().toUpperCase();
  if (!code) {
    throw new Error('采集渠道编码 channelCode 不能为空');
  }

  const request: HotelCrawlRequest = {
    ...options,
    channelCode: code,
  };

  // 1. 若处于 Electron 桌面原生上下文，优先直走 IPC
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithElectron;
    if (win.electron?.crawler?.collectHotels) {
      const result = await win.electron.crawler.collectHotels(request);
      if (!result.success) {
        throw new Error(result.error || `「${code}」渠道采集失败`);
      }
      return {
        ...result,
        channelCode: code,
      };
    }
  }

  // 2. 默认走本地 Vite HTTP 采集服务
  return executeHotelCrawl(request);
}

/**
 * 统一 Chrome 登录态同步网关 (Unified Profile Sync Bridge)
 * 优先调用 Electron IPC，回退至本地 HTTP 网关
 */
export async function syncChromeProfileByChannel(
  channelCode = 'MEITUAN'
): Promise<ProfileSyncResponseData> {
  const code = (channelCode || 'MEITUAN').trim().toUpperCase();

  // 1. 若处于 Electron 桌面原生上下文，优先直走 IPC
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithElectron;
    if (win.electron?.crawler?.syncProfile) {
      const result = await win.electron.crawler.syncProfile(code);
      if (!result.success) {
        throw new Error(result.message || `同步「${code}」Chrome 登录态失败`);
      }
      return result;
    }
  }

  // 2. 默认走本地 Vite HTTP 采集服务
  return requestSyncChromeProfile(code);
}

