import type { Page, BrowserContext, Response } from 'playwright';
import type { ChannelHotelCollector } from '../base';
import type { DiscoveredHotelCandidate, CollectorOptions } from '../../types';
import {
  DEFAULT_MEITUAN_CATALOG_URL,
  resolveMeituanTargetUrl,
  extractMeituanStoresFromResponses,
  normalizeMeituanHotelCandidates,
  RawMeituanStoreItem,
} from './meituanStoreMapper';

export class MeituanHotelCollector implements ChannelHotelCollector {
  public readonly channelId = 'meituan';
  public readonly channelCode = 'MEITUAN';
  public readonly defaultTargetUrl = DEFAULT_MEITUAN_CATALOG_URL;

  public resolveTargetUrl(customUrl?: string): string {
    return resolveMeituanTargetUrl(customUrl);
  }

  public async collect(
    page: Page,
    _context: BrowserContext,
    options: CollectorOptions
  ): Promise<DiscoveredHotelCandidate[]> {
    const targetUrl = this.resolveTargetUrl(options.targetUrl);
    const log = options.onLog || (() => {});

    log({
      level: 'PLAYWRIGHT',
      message: `[Meituan:Collector] 开始准备导航至美团门店目标地址: ${targetUrl}`,
    });

    const capturedResponses: unknown[] = [];

    // 1. 注册网络监听器（用于捕获 /accountpoi/poiInfos 等核心 JSON 数据包）
    const responseHandler = async (response: Response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        const isJson = contentType.includes('application/json') || url.includes('/accountpoi/poiInfos');

        if (
          isJson &&
          (url.includes('meituan.com') || url.includes('me.meituan.com')) &&
          !/\.(png|jpg|jpeg|gif|svg|ico|css|js|woff2?|map)($|\?)/i.test(url)
        ) {
          const bodyText = await response.text();
          if (bodyText && bodyText.trim()) {
            try {
              const parsed = JSON.parse(bodyText);
              capturedResponses.push(parsed);
            } catch {
              // 忽略非标准 JSON
            }
          }
        }
      } catch {
        // 网络请求已销毁或已取消，安全忽略
      }
    };

    page.on('response', responseHandler);

    try {
      // 2. 页面导航
      log({
        level: 'PLAYWRIGHT',
        message: `[Meituan:Collector] 正在访问页面: ${targetUrl}...`,
      });

      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: options.timeoutMs,
      });

      // 3. 严格 Fail-Fast 检测登录态重定向
      const currentUrl = page.url();
      if (
        currentUrl.includes('passport.meituan.com') ||
        currentUrl.includes('/login') ||
        currentUrl.includes('/auth')
      ) {
        log({
          level: 'ERROR',
          message: `[Meituan:Collector] 检测到美团商家登录态失效，页面被重定向至登录页: ${currentUrl}`,
        });
        throw new Error(
          '美团商家账号登录态已失效或尚未登录。请在弹出的浏览器窗口中扫码或输入账号完成登录后再试。(LOGIN_REQUIRED)'
        );
      }

      // 4. 等待页面首屏接口渲染与网络静默
      const waitTime = Math.max(2000, options.waitMs);
      log({
        level: 'PLAYWRIGHT',
        message: `[Meituan:Collector] 页面已加载，等待后台网络接口响应 (${waitTime}ms)...`,
      });
      await page.waitForTimeout(waitTime);

      // 5. 尝试从网络捕获中提取门店数据
      let extracted = extractMeituanStoresFromResponses(capturedResponses);
      log({
        level: 'PLAYWRIGHT',
        message: `[Meituan:Collector] 网络接口监听提取到 ${extracted.length} 家门店候选。`,
      });

      // 6. 若网络接口未捕获到足够数据，执行 DOM 下拉抽屉的主动探测与提取
      if (extracted.length === 0) {
        log({
          level: 'PLAYWRIGHT',
          message: '[Meituan:Collector] 启动 DOM 下拉列表交互提取策略...',
        });

        const domStores = await this.scrapeStoresFromDropdown(page, log);
        if (domStores.length > 0) {
          extracted = domStores;
          log({
            level: 'PLAYWRIGHT',
            message: `[Meituan:Collector] 成功通过 DOM 下拉提取到 ${domStores.length} 家门店。`,
          });
        }
      }

      // 7. 规范化与去重
      const candidates = normalizeMeituanHotelCandidates(extracted, this.channelId, this.channelCode);

      log({
        level: 'SUCCESS',
        message: `[Meituan:Collector] 美团门店采集完成，共清洗出 ${candidates.length} 家有效门店候选。`,
      });

      return candidates;
    } finally {
      page.off('response', responseHandler);
    }
  }

  /**
   * 模拟点击顶部门店切换器并提取下拉中的供应商与门店列表
   */
  private async scrapeStoresFromDropdown(
    page: Page,
    log: (payload: { level: 'PLAYWRIGHT' | 'INFO' | 'WARN' | 'ERROR'; message: string }) => void
  ): Promise<RawMeituanStoreItem[]> {
    try {
      // 寻找门店选择下拉触发器
      const trigger = page.locator('.me-poi-select .poi-select, .poi-select-wrap, [class*="poi-select"]').first();
      const hasTrigger = await trigger.isVisible({ timeout: 3000 }).catch(() => false);

      if (!hasTrigger) {
        log({
          level: 'WARN',
          message: '[Meituan:Collector] 未能定位到顶部门店选择控件，跳过 DOM 模拟点击。',
        });
        return [];
      }

      await trigger.click();
      await page.waitForTimeout(1000);

      // 在浏览器上下文中提取展开的门店树
      const stores = await page.evaluate(() => {
        const results: Array<{ poiId: string; partnerId: string; name: string }> = [];
        const rows = Array.from(document.querySelectorAll('.poi-select-item, [class*="poi-drop"] li, [class*="poi-select-item"]'));

        for (const row of rows) {
          const text = (row.textContent || '').trim();
          const idMatch = text.match(/\b\d{5,}\b/);
          if (idMatch) {
            const poiId = idMatch[0];
            const nameEl = row.querySelector('.ellipsis__real-box, [class*="left"], [class*="name"]') || row;
            let name = (nameEl.textContent || '')
              .replace(/\b\d{5,}\b/g, '')
              .replace(/授权|已经到底了/g, '')
              .trim();

            if (poiId && name) {
              results.push({
                poiId,
                partnerId: '',
                name,
              });
            }
          }
        }
        return results;
      });

      return stores.map((s) => ({
        poiId: s.poiId,
        partnerId: s.partnerId,
        name: s.name,
        source: 'store-dropdown-dom',
      }));
    } catch (e) {
      log({
        level: 'WARN',
        message: `[Meituan:Collector] DOM 下拉列表提取遇到非致命异常: ${e instanceof Error ? e.message : String(e)}`,
      });
      return [];
    }
  }
}
