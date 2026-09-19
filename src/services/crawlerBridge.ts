import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  ProfileSyncResult,
  CollectorLogPayload,
} from '../crawler/types';
import type { CrawlerBridgeApi } from '../types';

export interface CrawlerApiResponse extends HotelCrawlResult {
  logs?: CollectorLogPayload[];
}

function getCrawlerApi(): CrawlerBridgeApi {
  const host = window.host;
  if (!host?.crawler) {
    throw new Error('门店采集仅支持桌面端');
  }

  return host.crawler;
}

export async function collectHotelsByChannel(
  channelCode: string,
  options: Omit<HotelCrawlRequest, 'channelCode'> = {}
): Promise<CrawlerApiResponse> {
  const code = channelCode.trim().toUpperCase();
  if (!code) {
    throw new Error('采集渠道编码 channelCode 不能为空');
  }

  const result = await getCrawlerApi().collectHotels({
    ...options,
    channelCode: code,
  });

  if (!result.success) {
    throw new Error(result.error || `「${code}」渠道采集失败`);
  }

  return {
    ...result,
    channelCode: code,
  };
}

export async function syncChromeProfileByChannel(
  channelCode = 'MEITUAN'
): Promise<ProfileSyncResult> {
  const code = channelCode.trim().toUpperCase();
  const result = await getCrawlerApi().syncProfile(code);

  if (!result.success) {
    throw new Error(result.error || `同步「${code}」Chrome 登录态失败`);
  }

  return result;
}
