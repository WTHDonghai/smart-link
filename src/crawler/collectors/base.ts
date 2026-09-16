import type { Page, BrowserContext } from 'playwright';
import type { DiscoveredHotelCandidate, CollectorOptions } from '../types';

/**
 * 渠道酒店采集器抽象接口 (Channel Hotel Collector Contract)
 * 所有 OTA 渠道（美团、抖音、携程等）的酒店候选采集器均须实现此接口，实现多渠道平滑插拔与横向扩展。
 */
export interface ChannelHotelCollector {
  /** 渠道唯一标识符，如 'meituan', 'douyin', 'ctrip' */
  readonly channelId: string;

  /** 渠道业务编码，如 'MEITUAN', 'DOUYIN', 'CTRIP' */
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
