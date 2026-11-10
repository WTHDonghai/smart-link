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

/**
 * 取消指定渠道进行中的采集作业：主进程关闭该渠道浏览器会话，
 * 在途页面操作立即失败收敛；返回 false 表示当前无作业在跑（可能已自然结束）。
 */
export async function cancelChannelCollection(channelCode: string): Promise<{ cancelled: boolean; reason?: string }> {
  const code = channelCode.trim().toUpperCase();
  if (!code) {
    throw new Error('取消采集缺少渠道编码');
  }
  return getCrawlerApi().cancelChannelJob(code);
}

