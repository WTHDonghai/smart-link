import type { Page, BrowserContext, Response } from 'playwright';
import {
  resolveTimeoutMs,
  resolveWaitMs,
  resolveWaitSeconds,
  type CollectorLogPayload,
  type ProductCrawlRequest,
} from '../../types';
import {
  isDouyinSaleProductResponseUrl,
  parseDouyinSaleProductResponse,
  type DouyinSaleProductRoomBinding,
} from './douyinSaleProductMapper';
import { updateVisualTrackerStatus } from '../../visualTracker';

export const DOUYIN_SALE_PRODUCT_PAGE_URL = 'https://life.douyin.com/p/travel-goods/hotel/saleproduct/list';

export interface DouyinSaleProductCollectorOptions {
  onLog?: (log: CollectorLogPayload) => void;
}

export class DouyinSaleProductCollector {
  public resolveTargetUrl(customUrl?: string): string {
    if (!customUrl || !customUrl.trim()) {
      return DOUYIN_SALE_PRODUCT_PAGE_URL;
    }
    try {
      const parsed = new URL(customUrl.trim());
      parsed.pathname = '/p/travel-goods/hotel/saleproduct/list';
      parsed.hash = '';
      parsed.search = '';
      return parsed.toString();
    } catch {
      throw new Error(`非法的抖音预售房型目标地址: ${customUrl}`);
    }
  }

  public async collect(
    page: Page,
    _context: BrowserContext,
    request: ProductCrawlRequest,
    options: DouyinSaleProductCollectorOptions = {}
  ): Promise<DouyinSaleProductRoomBinding[]> {
    const log = options.onLog || (() => {});
    const targetUrl = this.resolveTargetUrl(request.targetUrl);
    const timeoutMs = resolveTimeoutMs(request, 30);
    const waitSeconds = resolveWaitSeconds(request, 3);
    const waitMs = resolveWaitMs(request, 3000);

    log({
      level: 'PLAYWRIGHT',
      message: `[DouyinSaleProductCollector] 开始采集抖音预售房型与销售SKU快照，页面: ${targetUrl}`,
    });

    const captureHolder: {
      bindings: DouyinSaleProductRoomBinding[] | null;
      error: Error | null;
    } = {
      bindings: null,
      error: null,
    };

    const responseHandler = async (response: Response) => {
      try {
        const url = response.url();
        if (isDouyinSaleProductResponseUrl(url) && response.ok()) {
          const bodyText = await response.text();
          if (bodyText && bodyText.trim()) {
            try {
              const parsed = JSON.parse(bodyText);
              const bindings = parseDouyinSaleProductResponse(parsed);
              captureHolder.bindings = bindings;
              log({
                level: 'PLAYWRIGHT',
                message: `[DouyinSaleProductCollector] 成功拦截到预售房型接口响应，已解析 ${bindings.length} 个 SKU 绑定关系。`,
              });
            } catch (err) {
              captureHolder.error = err instanceof Error ? err : new Error(String(err));
            }
          }
        }
      } catch {
        // 请求上下文销毁或关闭
      }
    };

    page.on('response', responseHandler);

    try {
      await updateVisualTrackerStatus(page, '🤖 正在加载抖音预售房型管理页面...', 'action');

      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      // 检查登录态
      const currentUrl = page.url();
      if (
        currentUrl.includes('/login') ||
        currentUrl.includes('passport.douyin.com') ||
        currentUrl.includes('passport.snssdk.com')
      ) {
        throw new Error('抖音商家账号登录态已过期，请先在控制台或浏览器中登录抖音账号。');
      }

      log({
        level: 'PLAYWRIGHT',
        message: `[DouyinSaleProductCollector] 预售房型页面已加载，等待接口拦截完成 (${waitSeconds} 秒)...`,
      });

      await updateVisualTrackerStatus(page, '🔍 正在拦截抖音预售房型与销售SKU关系数据...', 'info');
      await page.waitForTimeout(waitMs);

      if (captureHolder.error) {
        throw captureHolder.error;
      }

      const bindings = captureHolder.bindings;
      if (!bindings || bindings.length === 0) {
        throw new Error('抖音预售房型接口未拦截到有效房型关系数据，请确认商家账号已具备相关房型权限。');
      }

      log({
        level: 'SUCCESS',
        message: `[DouyinSaleProductCollector] 预售房型快照采集完成，有效 SKU 绑定数: ${bindings.length}。`,
      });

      return bindings;
    } finally {
      page.off('response', responseHandler);
    }
  }
}

export const douyinSaleProductCollector = new DouyinSaleProductCollector();
