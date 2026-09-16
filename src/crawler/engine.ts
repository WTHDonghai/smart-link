import type { HotelCrawlRequest, HotelCrawlResult, CollectorLogPayload } from './types';
import { hotelCollectorRegistry } from './registry';
import { createPersistentBrowserSession } from './browserManager';

export class HotelCollectionEngine {
  /**
   * 执行指定渠道的门店采集总流水线
   */
  public async collectHotels(
    request: HotelCrawlRequest,
    onLog?: (log: CollectorLogPayload) => void
  ): Promise<HotelCrawlResult> {
    const startedAt = Date.now();
    const log = onLog || (() => {});

    log({
      level: 'PLAYWRIGHT',
      message: `[CrawlerEngine] 收到渠道「${request.channelId}」门店采集任务，启动流水线...`,
    });

    const collector = hotelCollectorRegistry.get(request.channelId);
    if (!collector) {
      const errorMsg = `渠道「${request.channelId}」暂未注册门店自动化采集适配器。`;
      log({ level: 'ERROR', message: `[CrawlerEngine] ${errorMsg}` });
      throw new Error(errorMsg);
    }

    const targetUrl = collector.resolveTargetUrl(request.targetUrl);
    log({
      level: 'INFO',
      message: `[CrawlerEngine] 采集目标地址解析完成: ${targetUrl}`,
    });

    let session;
    try {
      log({
        level: 'PLAYWRIGHT',
        message: `[CrawlerEngine] 启动带有反爬规避与本地 Profile 的浏览器引擎 (${request.headless !== false ? 'Headless' : 'Headed'})...`,
      });

      session = await createPersistentBrowserSession({
        channelId: collector.channelId,
        headless: request.headless,
      });

      const hotels = await collector.collect(session.page, session.context, {
        channelId: collector.channelId,
        channelCode: collector.channelCode,
        targetUrl,
        waitMs: request.waitMs ?? 3000,
        timeoutMs: request.timeoutMs ?? 30000,
        onLog: log,
      });

      const durationMs = Date.now() - startedAt;

      log({
        level: 'SUCCESS',
        message: `[CrawlerEngine] 渠道「${collector.channelId}」门店采集成功，共获取 ${hotels.length} 家有效门店 (耗时: ${(durationMs / 1000).toFixed(1)}s)`,
      });

      return {
        success: true,
        channelId: collector.channelId,
        channelCode: collector.channelCode,
        hotels,
        diagnostics: {
          targetUrl,
          source: `${collector.channelId}-crawler`,
          scannedCount: hotels.length,
          discoveredCount: hotels.length,
          verifiedEmpty: hotels.length === 0,
          durationMs,
          warnings: [],
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorMsg = error instanceof Error ? error.message : String(error);

      log({
        level: 'ERROR',
        message: `[CrawlerEngine] 门店采集流水线执行失败: ${errorMsg}`,
      });

      return {
        success: false,
        channelId: collector.channelId,
        channelCode: collector.channelCode,
        hotels: [],
        error: errorMsg,
        diagnostics: {
          targetUrl,
          source: `${collector.channelId}-crawler`,
          scannedCount: 0,
          discoveredCount: 0,
          verifiedEmpty: false,
          durationMs,
          warnings: [errorMsg],
        },
      };
    } finally {
      if (session) {
        log({
          level: 'PLAYWRIGHT',
          message: '[CrawlerEngine] 释放浏览器上下文与会话资源。',
        });
        await session.close();
      }
    }
  }
}

export const hotelCollectionEngine = new HotelCollectionEngine();
