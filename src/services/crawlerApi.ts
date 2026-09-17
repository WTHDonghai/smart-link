import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  CollectorLogPayload,
  ProfileSyncResult,
} from '../crawler/types';

export interface CrawlerApiResponse extends HotelCrawlResult {
  logs?: CollectorLogPayload[];
}

export interface CrawlerChannelInfo {
  channelCode: string;
  defaultTargetUrl: string;
}

/**
 * 前端调用采集网关发起指定渠道的门店采集
 */
export async function executeHotelCrawl(
  request: HotelCrawlRequest
): Promise<CrawlerApiResponse> {
  const response = await fetch('/api/crawler/hotels/collect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...request,
      channelCode: request.channelCode.trim().toUpperCase(),
    }),
  });

  const data = (await response.json()) as CrawlerApiResponse;

  if (!response.ok || !data.success) {
    const errorMsg = data.error || `采集接口调用失败 (${response.status})`;
    throw new Error(errorMsg);
  }

  return data;
}

/**
 * 获取系统支持采集的渠道与默认 URL 字典
 */
export async function fetchCrawlerSupportedChannels(): Promise<CrawlerChannelInfo[]> {
  const response = await fetch('/api/crawler/channels');
  if (!response.ok) {
    throw new Error(`获取采集渠道配置失败 (${response.status})`);
  }
  const json = (await response.json()) as { success: boolean; data: CrawlerChannelInfo[] };
  return json.data || [];
}

export interface ProfileSyncResponseData {
  success: boolean;
  sourceDir: string;
  sourceProfile: string;
  targetDir: string;
  message: string;
}

/**
 * 前端请求从系统 Chrome 自动同步日常登录态到当前渠道的 Profile
 */
export async function requestSyncChromeProfile(
  channelCode?: string
): Promise<ProfileSyncResponseData> {
  const response = await fetch('/api/crawler/profile/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channelCode: (channelCode || 'MEITUAN').trim().toUpperCase() }),
  });

  const json = (await response.json()) as {
    success: boolean;
    data?: ProfileSyncResponseData;
    error?: string;
  };

  if (!response.ok || !json.success || !json.data) {
    throw new Error(json.error || `同步登录态失败 (${response.status})`);
  }

  return json.data;
}
