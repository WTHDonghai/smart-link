import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  CollectorLogPayload,
} from '../crawler/types';

export interface CrawlerApiResponse extends HotelCrawlResult {
  logs?: CollectorLogPayload[];
}

export interface CrawlerChannelInfo {
  channelId: string;
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
    body: JSON.stringify(request),
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
