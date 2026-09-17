import type { Page, BrowserContext } from 'playwright';
import type { DiscoveredHotelCandidate, CollectorOptions } from '../types';

/**
 * 渠道酒店采集器抽象接口 (Channel Hotel Collector Contract)
 */
export interface ChannelHotelCollector {
  /** 渠道业务唯一编码（全大写），如 'MEITUAN', 'MEITUAN_BIZ', 'DOUYIN', 'CTRIP' */
  readonly channelCode: string;

  /** 渠道默认的门店/调价目标 URL */
  readonly defaultTargetUrl: string;

  /**
   * 将用户输入的 URL 规范化/收敛为该渠道的实际采集 Target URL
   */
  resolveTargetUrl(customUrl?: string): string;

  /**
   * 执行针对该渠道的实际页面采集与接口嗅探
   * @param page 当前 Playwright 页面
   * @param context 当前浏览器会话上下文
   * @param options 采集超时与日志回调选项
   */
  collect(
    page: Page,
    context: BrowserContext,
    options: CollectorOptions
  ): Promise<DiscoveredHotelCandidate[]>;
}
