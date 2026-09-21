import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  ProfileSyncResult,
  CollectorLogPayload,
  ProductCrawlRequest,
  ProductCrawlResult,
} from '../crawler/types';
import type { CrawlerBridgeApi } from '../types';

export interface CrawlerApiResponse extends HotelCrawlResult {
  logs?: CollectorLogPayload[];
}

function getCrawlerApi(): CrawlerBridgeApi {
  const host = window.host;
  if (!host?.crawler) {
    throw new Error('自动化采集功能仅支持桌面端');
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

export async function collectProductsByHotel(
  request: ProductCrawlRequest
): Promise<ProductCrawlResult> {
  const code = (request.channelCode || '').trim().toUpperCase();
  if (!code) {
    throw new Error('采集渠道编码 channelCode 不能为空');
  }
  const extUnitCode = (request.extUnitCode || '').trim();
  if (!extUnitCode) {
    throw new Error('产品采集缺少外部门店编码 extUnitCode');
  }

  const result = await getCrawlerApi().collectProducts({
    ...request,
    channelCode: code,
    extUnitCode,
  });

  if (!result.success) {
    throw new Error(result.error || `「${code}」产品采集失败`);
  }

  return result;
}

