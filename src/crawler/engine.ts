import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  ProductCrawlRequest,
  ProductCrawlResult,
  CollectorLogPayload,
} from './types';
import { PROCESS_ENV_KEYS } from '../types/env';
import { hotelCollectorRegistry } from './registry';
import { meituanProductCollector } from './collectors/meituan/meituanProductCollector';
import { createPersistentBrowserSession } from './browserManager';
import { dutyOrchestrationEngine } from './duty/dutyOrchestrationEngine';

export class HotelCollectionEngine {
  private activeChannelJobs = new Set<string>();

  /**
   * 检查指定渠道是否正在执行自动化作业（门店或产品采集）
   */
  public isChannelActive(channelCode: string): boolean {
    const code = (channelCode || '').trim().toUpperCase();
    return this.activeChannelJobs.has(`CHANNEL_SESSION_${code}`);
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

    if (dutyOrchestrationEngine.isChannelActive(code)) {
      const dutyBusyMsg = `渠道「${code}」当前正在执行自动化订单值守，请先停止值守后再执行门店采集。`;
      log({ level: 'ERROR', message: `[CrawlerEngine] ${dutyBusyMsg}` });
      throw new Error(dutyBusyMsg);
    }

    const channelJobKey = `CHANNEL_SESSION_${code}`;
    if (this.activeChannelJobs.has(channelJobKey)) {
      const busyMsg = `渠道「${code}」当前已有正在执行的自动化作业（门店或产品采集），请等待当前作业完成后再试。`;
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

    this.activeChannelJobs.add(channelJobKey);

    const targetUrl = request.targetUrl?.trim() || collector.resolveTargetUrl();
    log({
      level: 'INFO',
      message: `[CrawlerEngine] 采集目标地址: ${targetUrl}`,
    });

    try {
      const isHeadless = request.headless ?? (process.env[PROCESS_ENV_KEYS.playwrightHeadless] === 'true');
      log({
        level: 'PLAYWRIGHT',
        message: `[CrawlerEngine] 唤起${isHeadless ? '后台无头' : '可视化前台'}浏览器窗口，启动自动化操作流程...`,
      });

      const session = await createPersistentBrowserSession({
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
      this.activeChannelJobs.delete(channelJobKey);
    }
  }

  /**
   * 执行指定渠道和酒店的产品采集流水线
   */
  public async collectProducts(
    request: ProductCrawlRequest,
    onLog?: (log: CollectorLogPayload) => void
  ): Promise<ProductCrawlResult> {
    const startedAt = Date.now();
    const log = onLog || (() => {});

    const code = (request.channelCode || '').trim().toUpperCase();
    if (!code) {
      const emptyMsg = '必须指定采集渠道编码 channelCode';
      log({ level: 'ERROR', message: `[CrawlerEngine] ${emptyMsg}` });
      throw new Error(emptyMsg);
    }

    const extUnitCode = (request.extUnitCode || '').trim();
    if (!extUnitCode) {
      const emptyMsg = '必须指定外部门店编码 extUnitCode';
      log({ level: 'ERROR', message: `[CrawlerEngine] ${emptyMsg}` });
      throw new Error(emptyMsg);
    }

    if (dutyOrchestrationEngine.isChannelActive(code)) {
      const dutyBusyMsg = `渠道「${code}」当前正在执行自动化订单值守，请先停止值守后再执行产品采集。`;
      log({ level: 'ERROR', message: `[CrawlerEngine] ${dutyBusyMsg}` });
      throw new Error(dutyBusyMsg);
    }

    const channelJobKey = `CHANNEL_SESSION_${code}`;
    if (this.activeChannelJobs.has(channelJobKey)) {
      const busyMsg = `渠道「${code}」当前已有正在执行的自动化作业（门店或产品采集），请等待当前作业完成后再试。`;
      log({ level: 'ERROR', message: `[CrawlerEngine] ${busyMsg}` });
      throw new Error(busyMsg);
    }

    log({
      level: 'PLAYWRIGHT',
      message: `[CrawlerEngine] 收到渠道「${code}」门店「${request.otaHotelName || extUnitCode}」产品采集任务，启动流水线...`,
    });

    this.activeChannelJobs.add(channelJobKey);

    try {
      // [TODO]: 赢编码，后续接入更多渠道，需要进行清理
      if (code !== 'MEITUAN' && code !== 'MEITUAN_BIZ') {
        throw new Error(`渠道「${code}」暂未开放产品自动化采集适配器。`);
      }

      const session = await createPersistentBrowserSession({
        channelCode: code,
        headless: request.headless,
      });

      const products = await meituanProductCollector.collect(
        session.page,
        session.context,
        request,
        { onLog: log }
      );

      const durationMs = Date.now() - startedAt;
      log({
        level: products.length > 0 ? 'SUCCESS' : 'WARN',
        message: `[CrawlerEngine] 渠道「${code}」门店「${request.otaHotelName || extUnitCode}」产品采集完成，共获取 ${products.length} 项商品 (耗时: ${(durationMs / 1000).toFixed(1)}s)`,
      });

      return {
        success: true,
        channelCode: code,
        extUnitCode,
        products,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log({
        level: 'ERROR',
        message: `[CrawlerEngine] 产品采集流水线执行失败: ${errorMsg}`,
      });

      return {
        success: false,
        channelCode: code,
        extUnitCode,
        products: [],
        error: errorMsg,
      };
    } finally {
      this.activeChannelJobs.delete(channelJobKey);
    }
  }
}

export const hotelCollectionEngine = new HotelCollectionEngine();
