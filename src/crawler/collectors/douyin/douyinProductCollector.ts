import type { Page, BrowserContext, Response } from 'playwright';
import {
  resolveTimeoutMs,
  resolveWaitMs,
  resolveWaitSeconds,
  type DiscoveredProductCandidate,
  type ProductCrawlRequest,
} from '../../types';
import type { ChannelProductCollector, ProductCollectorOptions } from '../base';
import { douyinSaleProductCollector } from './douyinSaleProductCollector';
import {
  isDouyinProductListResponseUrl,
  isDouyinCalendarRoomResponseUrl,
  parseDouyinProductResponse,
  expandDouyinProductsByPhysicalRoom,
  type DouyinProductPageParseResult,
  type DouyinParsedProduct,
} from './douyinProductMapper';
import { updateVisualTrackerStatus } from '../../visualTracker';
import { getDouyinProductUrl } from '../../../config/otaUrls';

export type DouyinProductCollectorOptions = ProductCollectorOptions;

export class DouyinProductCollector implements ChannelProductCollector {
  public readonly channelCode = 'DOUYIN';

  public resolveTargetUrl(customUrl?: string): string {
    const raw = customUrl && customUrl.trim() ? customUrl.trim() : getDouyinProductUrl();
    try {
      const parsed = new URL(raw);
      parsed.pathname = '/p/goods-list';
      if (!parsed.searchParams.has('industry')) {
        parsed.searchParams.set('industry', 'tobias');
      }
      if (!parsed.searchParams.has('menu_tab')) {
        parsed.searchParams.set('menu_tab', 'navi_product_info');
      }
      return parsed.toString();
    } catch {
      throw new Error(`非法的产品采集目标地址: ${raw}`);
    }
  }

  public async collect(
    page: Page,
    context: BrowserContext,
    request: ProductCrawlRequest,
    options: DouyinProductCollectorOptions = {}
  ): Promise<DiscoveredProductCandidate[]> {
    const log = options.onLog || (() => {});
    const hotelName = (request.otaHotelName || '').trim();
    const extUnitCode = (request.extUnitCode || '').trim();

    if (!extUnitCode) {
      throw new Error('抖音产品采集缺少外部门店编码 extUnitCode。');
    }
    if (!hotelName) {
      throw new Error('抖音产品采集缺少门店名称 otaHotelName，无法驱动页面原生门店筛选。');
    }

    const targetUrl = this.resolveTargetUrl(request.targetUrl);
    const timeoutMs = resolveTimeoutMs(request, 30);
    const waitSeconds = resolveWaitSeconds(request, 3);
    const waitMs = resolveWaitMs(request, 3000);

    log({
      level: 'PLAYWRIGHT',
      message: `[DouyinProductCollector] 启动抖音两阶段产品采集流水线: 门店「${hotelName}」(${extUnitCode})`,
    });

    // =========================================================================
    // 阶段一：采集预售房型与销售 SKU 快照 (GET /life/hotel/query_sale_product)
    // =========================================================================
    log({
      level: 'PLAYWRIGHT',
      message: '[DouyinProductCollector] 阶段 1/2: 正在获取抖音预售房型与销售SKU绑定快照...',
    });

    const preSaleBindings = await douyinSaleProductCollector.collect(page, context, request, {
      onLog: log,
    });

    if (!preSaleBindings || preSaleBindings.length === 0) {
      throw new Error('抖音预售房型快照为空，无法建立商品到物理房型的映射。');
    }

    log({
      level: 'INFO',
      message: `[DouyinProductCollector] 预售房型快照获取成功，共 ${preSaleBindings.length} 个 SKU 绑定关系。`,
    });

    // =========================================================================
    // 阶段二：访问商品管理页面，操作原生门店筛选并拦截商品列表
    // =========================================================================
    log({
      level: 'PLAYWRIGHT',
      message: `[DouyinProductCollector] 阶段 2/2: 正在打开商品管理页面: ${targetUrl}`,
    });

    const capturedPages: DouyinProductPageParseResult[] = [];
    let interceptError: Error | null = null;

    const responseHandler = async (response: Response) => {
      try {
        const url = response.url();

        // 显式拒绝日历房商品接口
        if (isDouyinCalendarRoomResponseUrl(url)) {
          log({
            level: 'WARN',
            message: '[DouyinProductCollector] 忽略日历房商品接口，严禁将日历房作为产品主数据源。',
          });
          return;
        }

        if (isDouyinProductListResponseUrl(url) && response.ok()) {
          const bodyText = await response.text();
          if (bodyText && bodyText.trim()) {
            try {
              const parsedJson = JSON.parse(bodyText);
              const pageResult = parseDouyinProductResponse(parsedJson, extUnitCode);
              capturedPages.push(pageResult);
              log({
                level: 'PLAYWRIGHT',
                message: `[DouyinProductCollector] 成功拦截到商品管理接口响应: cursor=${pageResult.cursor} 条数=${pageResult.products.length} 总数=${pageResult.total}`,
              });
            } catch (err) {
              interceptError = err instanceof Error ? err : new Error(String(err));
            }
          }
        }
      } catch {
        // 请求销毁安全忽略
      }
    };

    page.on('response', responseHandler);

    try {
      await updateVisualTrackerStatus(page, '🤖 正在打开抖音商品管理页面...', 'action');

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

      // 等待页面基础渲染
      await updateVisualTrackerStatus(page, `🔍 正在执行门店「${hotelName}」筛选...`, 'action');
      log({
        level: 'PLAYWRIGHT',
        message: `[DouyinProductCollector] 操作原生门店筛选器，目标门店: ${hotelName}`,
      });

      // 1. 打开门店选择器浮层 (寻找包含 '按省市' 标签的输入框)
      const filterLabel = page.locator('.ps-dimension-filter__label:has-text("按省市")');
      const filterContainer = page.locator('.byted-form-container').filter({ has: filterLabel });
      const storeInput = filterContainer.locator('input').first();

      if (await storeInput.isVisible({ timeout: 10000 }).catch(() => false)) {
        await storeInput.click();
      } else if (await filterLabel.isVisible({ timeout: 5000 }).catch(() => false)) {
        await filterLabel.click();
      } else {
        // 兜底尝试查找通用门店选择框
        const fallbackInput = page.locator('input[placeholder*="按省市"], input[placeholder*="选择门店"]').first();
        if (await fallbackInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await fallbackInput.click();
        }
      }

      // 2. 清除已有选择
      const clearBtn = page.locator('button:has-text("清除")').first();
      if (await clearBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await clearBtn.click();
        await page.waitForTimeout(300);
      }

      // 3. 在门店搜索框输入 hotelName
      const searchInput = page.locator('input[placeholder="门店名/门店ID/备注名/备注编号"]').first();
      await searchInput.waitFor({ state: 'visible', timeout: 8000 });
      await searchInput.fill(hotelName);
      await page.waitForTimeout(600);

      // 4. 精准匹配唯一门店并勾选
      const exactMatchItem = page.locator('.ps-list-item').filter({
        has: page.locator(`[title="${hotelName}"]`),
      });

      const matchCount = await exactMatchItem.count();
      if (matchCount === 0) {
        throw new Error(`抖音门店选择器中未搜索到匹配的酒店「${hotelName}」，请核对商家中心门店名称。`);
      }
      if (matchCount > 1) {
        throw new Error(`抖音门店选择器中搜索到 ${matchCount} 家同名酒店「${hotelName}」，存在歧义，已阻断采集。`);
      }

      const checkbox = exactMatchItem.first().locator('input[type="checkbox"], label.byted-checkbox').first();
      await checkbox.click();
      await page.waitForTimeout(300);

      // 5. 点击“确认”关闭选择器
      const confirmBtn = page.locator('button:has-text("确认")').first();
      await confirmBtn.click();
      await page.waitForTimeout(500);

      // 6. 点击主界面的“查询”按钮触发列表请求
      const queryBtn = page.locator('button:has-text("查询")').first();
      await queryBtn.click();

      // 7. 等待首屏商品响应到达
      log({
        level: 'PLAYWRIGHT',
        message: `[DouyinProductCollector] 已触发门店查询，等待首屏商品数据拦截 (${waitSeconds} 秒)...`,
      });
      await updateVisualTrackerStatus(page, '🔍 正在拦截抖音商品管理列表响应...', 'info');
      await page.waitForTimeout(waitMs);

      if (interceptError) {
        throw interceptError;
      }

      if (capturedPages.length === 0) {
        throw new Error('抖音商品管理接口未拦截到有效商品数据包，请确认账号具备该门店商品权限。');
      }

      // 8. 处理分页逻辑 (Cursor Pagination)
      const firstPage = capturedPages[0];
      const totalExpected = firstPage.total;
      let totalCollected = capturedPages.reduce((acc, p) => acc + p.products.length, 0);

      log({
        level: 'INFO',
        message: `[DouyinProductCollector] 首屏拦截完成，当前已采集 ${totalCollected} / 总数 ${totalExpected} 项商品`,
      });

      // 如果存在多页商品，循环点击“下一页”
      let maxPages = 20; // 保护防止死循环
      while (totalCollected < totalExpected && maxPages > 0) {
        maxPages--;
        const nextPageBtn = page.locator('.byted-pager-item .byted-icon-right, .byted-pager-next').first();
        const isNextVisible = await nextPageBtn.isVisible().catch(() => false);
        const isNextDisabled = await nextPageBtn.evaluate((el) => {
          return (
            el.classList.contains('byted-pager-item-disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            (el as HTMLButtonElement).disabled === true
          );
        }).catch(() => true);

        if (!isNextVisible || isNextDisabled) {
          log({
            level: 'WARN',
            message: `[DouyinProductCollector] 下一页按钮不可用或已达末页 (已获取: ${totalCollected} / 预期: ${totalExpected})`,
          });
          break;
        }

        const pagesBeforeClick = capturedPages.length;
        await nextPageBtn.click();
        await page.waitForTimeout(Math.max(2000, waitMs));

        if (interceptError) {
          throw interceptError;
        }

        if (capturedPages.length > pagesBeforeClick) {
          totalCollected = capturedPages.reduce((acc, p) => acc + p.products.length, 0);
          log({
            level: 'PLAYWRIGHT',
            message: `[DouyinProductCollector] 翻页成功，累计采集 ${totalCollected} / ${totalExpected} 项商品`,
          });
        } else {
          log({
            level: 'WARN',
            message: '[DouyinProductCollector] 点击下一页后未拦截到新数据包，停止翻页。',
          });
          break;
        }
      }

      // 9. 汇总全部商品并进行 1:N 物理房型展开
      const allRawProducts: DouyinParsedProduct[] = [];
      const seenProductIds = new Set<string>();

      for (const pageItem of capturedPages) {
        for (const prod of pageItem.products) {
          if (!seenProductIds.has(prod.otaRoomTypeId)) {
            seenProductIds.add(prod.otaRoomTypeId);
            allRawProducts.push(prod);
          }
        }
      }

      const candidates = expandDouyinProductsByPhysicalRoom(
        allRawProducts,
        preSaleBindings,
        extUnitCode
      );

      log({
        level: candidates.length > 0 ? 'SUCCESS' : 'WARN',
        message: `[DouyinProductCollector] 抖音产品采集完成：源商品 ${allRawProducts.length} 个，按物理房型展开后得到 ${candidates.length} 个产品映射项。`,
      });

      return candidates;
    } finally {
      page.off('response', responseHandler);
    }
  }
}

export const douyinProductCollector = new DouyinProductCollector();
