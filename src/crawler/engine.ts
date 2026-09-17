import type { HotelCrawlRequest, HotelCrawlResult, CollectorLogPayload } from './types';
import { hotelCollectorRegistry } from './registry';
import { createPersistentBrowserSession } from './browserManager';

export class HotelCollectionEngine {
  private activeChannelJobs = new Set<string>();

  /**
   * 检查指定渠道是否正在执行门店采集流水线
   */
  public isChannelActive(channelCode: string): boolean {
    return this.activeChannelJobs.has(channelCode.trim().toUpperCase());
  }

  /**
   * 执行指定渠道的门店采集总流水线
   */
  public async collectHotels(
    request: HotelCrawlRequest,
    onLog?: (log: CollectorLogPayload) => void
  ): Promise<HotelCrawlResult> {
    const startedAt = Date.now();
    const log = onLog || (() => {});

    const code = (request.channelCode || '').trim().toUpperCase();
    if (!code) {
      const emptyMsg = '必须指定采集渠道编码 channelCode';
      log({ level: 'ERROR', message: `[CrawlerEngine] ${emptyMsg}` });
      throw new Error(emptyMsg);
    }

    if (this.activeChannelJobs.has(code)) {
      const busyMsg = `渠道「${code}」门店采集任务正在执行中，请勿重复发起。`;
      log({ level: 'ERROR', message: `[CrawlerEngine] ${busyMsg}` });
      throw new Error(busyMsg);
    }

    log({
      level: 'PLAYWRIGHT',
      message: `[CrawlerEngine] 收到渠道「${code}」门店采集任务，启动流水线...`,
    });

    const collector = hotelCollectorRegistry.get(code);
    if (!collector) {
      const errorMsg = `渠道「${code}」暂未注册门店自动化采集适配器。`;
      log({ level: 'ERROR', message: `[CrawlerEngine] ${errorMsg}` });
      throw new Error(errorMsg);
    }

    this.activeChannelJobs.add(code);

    const targetUrl = collector.defaultTargetUrl;
    log({
      level: 'INFO',
      message: `[CrawlerEngine] 采集目标地址: ${targetUrl}`,
    });

    let session;
    try {
      const isHeadless = request.headless ?? (process.env.PLAYWRIGHT_HEADLESS === 'true');
      log({
        level: 'PLAYWRIGHT',
        message: `[CrawlerEngine] 唤起${isHeadless ? '后台无头' : '可视化前台'}浏览器窗口，启动自动化操作流程...`,
      });

      session = await createPersistentBrowserSession({
        channelCode: code,
        headless: request.headless,
      });

      const hotels = await collector.collect(session.page, session.context, {
        channelCode: code,
        targetUrl,
        waitMs: request.waitMs ?? 3000,
        timeoutMs: request.timeoutMs ?? 30000,
        onLog: log,
      });

      // 在可视化模式下保留短暂展示，让用户亲眼目睹采集完成的最终页面与数据状态
      if (!isHeadless) {
        try {
          await session.page.waitForTimeout(1500);
        } catch {
          // 忽略等待异常
        }
      }

      const durationMs = Date.now() - startedAt;

      log({
        level: 'SUCCESS',
        message: `[CrawlerEngine] 渠道「${code}」门店采集成功，共获取 ${hotels.length} 家有效门店 (耗时: ${(durationMs / 1000).toFixed(1)}s)`,
      });

      return {
        success: true,
        channelCode: code,
        hotels,
        diagnostics: {
          targetUrl,
          source: `${code}-crawler`,
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
        channelCode: code,
        hotels: [],
        error: errorMsg,
        diagnostics: {
          targetUrl,
          source: `${code}-crawler`,
          scannedCount: 0,
          discoveredCount: 0,
          verifiedEmpty: false,
          durationMs,
          warnings: [errorMsg],
        },
      };
    } finally {
      this.activeChannelJobs.delete(code);
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
