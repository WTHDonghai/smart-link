import type { Page, BrowserContext, Response } from 'playwright';
import type { DiscoveredProductCandidate, ProductCrawlRequest, CollectorLogPayload } from '../../types';
import { parseMeituanProductCandidates } from './meituanProductMapper';
import { updateVisualTrackerStatus } from '../../visualTracker';
import { getMeituanProductUrl } from '../../../config/otaUrls';

export interface MeituanProductCollectorOptions {
  onLog?: (log: CollectorLogPayload) => void;
}

export class MeituanProductCollector {
  public readonly channelCode = 'MEITUAN';

  public resolveTargetUrl(customUrl?: string, poiId?: string, partnerId?: string): string {
    const raw = customUrl && customUrl.trim() ? customUrl.trim() : getMeituanProductUrl();
    try {
      const parsed = new URL(raw);
      if (poiId && poiId.trim() && !parsed.searchParams.has('poiId')) {
        parsed.searchParams.set('poiId', poiId.trim());
      }
      if (partnerId && partnerId.trim() && partnerId.trim() !== '0' && !parsed.searchParams.has('partnerId')) {
        parsed.searchParams.set('partnerId', partnerId.trim());
      }
      return parsed.toString();
    } catch {
      throw new Error(`非法的产品采集目标地址: ${raw}`);
    }
  }

  public async collect(
    page: Page,
    _context: BrowserContext,
    request: ProductCrawlRequest,
    options: MeituanProductCollectorOptions = {}
  ): Promise<DiscoveredProductCandidate[]> {
    const log = options.onLog || (() => {});
    const poiId = (request.poiId || request.extUnitCode || '').trim();
    const partnerId = (request.partnerId || '').trim();
    const targetUrl = this.resolveTargetUrl(request.targetUrl, poiId, partnerId);
    const timeoutMs = request.timeoutMs ?? 30000;
    const waitMs = request.waitMs ?? 3000;

    log({
      level: 'PLAYWRIGHT',
      message: `[MeituanProductCollector] 启动美团产品采集，目标地址: ${targetUrl} (门店: ${request.otaHotelName || request.extUnitCode} / ${request.extUnitCode})`,
    });

    const capturedResponses: unknown[] = [];

    // 1. 网络监听器：纯接口响应拦截，从真实页面网络流中捕获商品接口数据（坚决不伪造或主动构造接口调用）
    const responseHandler = async (response: Response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        const isJson =
          contentType.includes('application/json') ||
          url.includes('/goods/') ||
          url.includes('/product/');
        const isStaticAsset = /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff2?|map)($|\?)/i.test(url);

        // queryListAndTag 才是需要拦截的接口
        const isTarget = url.includes('/queryListAndTag')

        if (response.ok() && isJson && isTarget && !isStaticAsset) {
          const bodyText = await response.text();
          if (bodyText && bodyText.trim()) {
            try {
              const parsed = JSON.parse(bodyText);
              capturedResponses.push(parsed);
              log({
                level: 'PLAYWRIGHT',
                message: `[MeituanProductCollector] 成功拦截到美团产品接口响应: ${new URL(url).pathname}`,
              });
            } catch {
              // 忽略非合法 JSON
            }
          }
        }
      } catch {
        // 请求已关闭或销毁，安全忽略
      }
    };

    page.on('response', responseHandler);

    try {
      await updateVisualTrackerStatus(page, `🤖 正在加载美团房型与产品管理页面...`, 'action');

      // 2. 导航至目标页面
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      // 3. 检查登录态
      const currentUrl = page.url();
      if (
        currentUrl.includes('passport.meituan.com') ||
        currentUrl.includes('/login') ||
        currentUrl.includes('/auth')
      ) {
        throw new Error('美团商家账号登录态已过期，请先在控制台或浏览器中登录美团账号。');
      }

      // 4. 等待网络数据响应与稳定（纯通过网络拦截从返回中获取信息）
      log({
        level: 'PLAYWRIGHT',
        message: `[MeituanProductCollector] 页面已加载，等待接口拦截响应 (${waitMs}ms)...`,
      });
      await updateVisualTrackerStatus(page, '🔍 正在通过接口拦截获取美团房型与商品数据...', 'info');
      await page.waitForTimeout(waitMs);

      // 5. 采集完成解析前，检查 capturedResponses 是否为空（遵循 Fail-Fast 原则，坚决杜绝静默返回 0 项商品并标为成功）
      if (capturedResponses.length === 0) {
        throw new Error('美团产品接口未拦截到有效商品数据包，请确认美团账号已登录并具备该门店权限。');
      }

      // 6. 解析并清洗收集到的商品响应
      const candidates = parseMeituanProductCandidates(
        capturedResponses,
        request.extUnitCode,
        this.channelCode
      );

      log({
        level: candidates.length > 0 ? 'SUCCESS' : 'WARN',
        message: `[MeituanProductCollector] 美团产品采集完成，获取到 ${candidates.length} 个房型商品候选。`,
      });

      return candidates;
    } finally {
      page.off('response', responseHandler);
    }
  }
}

export const meituanProductCollector = new MeituanProductCollector();
