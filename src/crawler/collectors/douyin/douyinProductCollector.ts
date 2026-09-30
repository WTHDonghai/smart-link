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
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  humanDelay,
  getScaledTimeout,
  isElementVisible,
} from '@/src/crawler/duty/dutyTimingConfig';

export type DouyinProductCollectorOptions = ProductCollectorOptions;

/**
 * 抖音商品管理页面元素选择器定义
 * 
 * 刚性准则：严格遵循「DOM 结构 + CSS 样式/类名 + 元素文本」三要素结合原则，
 * 绝不使用单一脆弱的纯文本或裸标签选择器，防止跨区域误触或样式漂移。
 */
export const DOUYIN_PRODUCT_SELECTORS = {
  // 1. 门店维度筛选触发容器：表单容器 + 维度过滤标签 + 文本“按省市”
  STORE_FILTER_CONTAINER: 'div.byted-form-container:has(span.ps-dimension-filter__label:has-text("按省市"))',
  // 门店维度筛选标签：表单容器 + 维度过滤标签类名 + 文本“按省市”
  STORE_FILTER_LABEL: 'div.byted-form-container span.ps-dimension-filter__label:has-text("按省市")',
  // 门店触发输入框：表单容器内输入控件 (直达“按省市”容器内的输入框)
  STORE_TRIGGER_INPUT: 'div.byted-form-container:has(span.ps-dimension-filter__label:has-text("按省市")) input.byted-input, div.byted-form-container:has(span.ps-dimension-filter__label:has-text("按省市")) input',
  // 展开后的门店选择面板与搜索输入框：面板容器 + 输入控件类名 + placeholder 文本
  STORE_PANEL: 'div.ps-select-panel',
  STORE_SEARCH_INPUT: 'div.ps-select-panel input.byted-input[placeholder*="门店名"], div.ps-select-panel input[placeholder="门店名/门店ID/备注名/备注编号"]',
  // 清除按钮：面板容器 + 按钮类名 + 文本“清除”
  STORE_CLEAR_BUTTON: 'div.ps-select-panel button.byted-btn:has-text("清除"), div.ps-select-panel button:has-text("清除")',
  // 门店项勾选框：面板容器 + 列表项 + 复选框结构
  STORE_LIST_ITEM: 'div.ps-select-panel div.ps-list-item',
  STORE_CHECKBOX: 'label.byted-checkbox input[type="checkbox"], label.byted-checkbox, input[type="checkbox"]',
  // 确认按钮：面板容器 + 主要按钮类名 + 文本“确认”（必须限定在 ps-select-panel 内部，防误触外层主界面确认按钮）
  STORE_CONFIRM_BUTTON: 'div.ps-select-panel button.byted-btn-type-primary:has-text("确认"), div.ps-select-panel button.byted-btn:has-text("确认"), div.ps-select-panel button:has-text("确认")',
  // 主界面查询按钮：表单容器 + 主要操作按钮类名 + 文本“查询”
  MAIN_QUERY_BUTTON: 'form.byted-form button.byted-btn-type-primary:has-text("查询"), div.byted-form-container button.byted-btn-type-primary:has-text("查询"), form.byted-form button:has-text("查询")',
  // 分页下一页按钮：分页器列表 + 下一页类名/图标类名 + 非禁用伪类
  PAGER_NEXT_BUTTON: 'ul.byted-pager li.byted-pager-next:not(.byted-pager-item-disabled), ul.byted-pager li.byted-pager-item:has(.byted-icon-right):not(.byted-pager-item-disabled), .byted-pager-item:has(.byted-icon-right):not(.byted-pager-item-disabled)',
} as const;

export class DouyinProductCollector implements ChannelProductCollector {
  public readonly channelCode = 'DOUYIN';

  public resolveTargetUrl(customUrl?: string, currentUrl?: string): string {
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
      if (currentUrl) {
        try {
          const current = new URL(currentUrl);
          const ROUTE_CONTEXT_PARAMS = [
            'groupid',
            'life_biz_view_id',
            'life_account_biz_ids',
            'root_life_account_id',
          ];
          for (const key of ROUTE_CONTEXT_PARAMS) {
            if (!parsed.searchParams.has(key) && current.searchParams.has(key)) {
              parsed.searchParams.set(key, current.searchParams.get(key) || '');
            }
          }
        } catch {
          // 安全忽略 currentUrl 解析异常
        }
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

    const targetUrl = this.resolveTargetUrl(request.targetUrl, page.url());
    const timeoutMs = resolveTimeoutMs(request, 30);
    const waitSeconds = resolveWaitSeconds(request, 3);
    const waitMs = resolveWaitMs(request, 3);

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
        const method = response.request?.()?.method?.().toUpperCase();
        if (method === 'OPTIONS') {
          return;
        }

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

      // 1. 打开门店选择器浮层 (DOM: byted-form-container + CSS: ps-dimension-filter__label + Text: "按省市")
      const filterLabel = page.locator(DOUYIN_PRODUCT_SELECTORS.STORE_FILTER_LABEL).first();
      const storeInput = page.locator(DOUYIN_PRODUCT_SELECTORS.STORE_TRIGGER_INPUT).first();
      const searchInput = page.locator(DOUYIN_PRODUCT_SELECTORS.STORE_SEARCH_INPUT).first();

      // 等待门店选择器控件可见并留出 React 状态水合缓冲
      await storeInput.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.PAGE_CONTAINER_READY) });
      await humanDelay(page, ...HUMAN_DELAY.SHORT);

      let popupOpened = await isElementVisible(searchInput, ACTION_TIMEOUT.PROBE);
      if (!popupOpened) {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (await isElementVisible(storeInput, ACTION_TIMEOUT.ELEMENT)) {
            await storeInput.click();
          } else if (await isElementVisible(filterLabel, ACTION_TIMEOUT.ELEMENT)) {
            await filterLabel.click();
          }
          popupOpened = await isElementVisible(searchInput, ACTION_TIMEOUT.QUICK_ACTION);
          if (popupOpened) break;
          await humanDelay(page, 500, 1000);
        }
      }

      if (!popupOpened) {
        throw new Error('未能展开抖音原生门店筛选器浮层。');
      }

      // 2. 清除已有选择 (DOM: ps-select-panel + CSS: byted-btn + Text: "清除")
      const clearBtn = page.locator(DOUYIN_PRODUCT_SELECTORS.STORE_CLEAR_BUTTON).first();
      if (await isElementVisible(clearBtn, ACTION_TIMEOUT.CLICK)) {
        await clearBtn.click();
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
      }

      // 3. 在门店搜索框输入 hotelName (DOM: ps-select-panel + CSS: byted-input + Text/Attr: placeholder 门店名)
      await searchInput.fill(hotelName);
      await humanDelay(page, ...HUMAN_DELAY.SHORT);

      // 4. 精准匹配唯一门店并勾选 (DOM: ps-select-panel > ps-list-item + CSS: byted-checkbox + Text/Attr: title)
      const storeItemScope = page.locator(DOUYIN_PRODUCT_SELECTORS.STORE_LIST_ITEM).filter({
        has: page.locator('input[type="checkbox"]'),
      });

      const normalizedName = hotelName.replace(/（/g, '(').replace(/）/g, ')');
      const baseName = hotelName.split(/[（(]/)[0].trim();

      let matchItem = storeItemScope.filter({
        has: page.locator(`[title="${hotelName}"]`),
      });

      let matchCount = await matchItem.count();
      if (matchCount === 0 && normalizedName !== hotelName) {
        // 尝试全半角小括号归一化匹配 (如 "酒店名(分店)" vs "酒店名（分店）")
        matchItem = storeItemScope.filter({
          has: page.locator(`[title="${normalizedName}"]`),
        });
        matchCount = await matchItem.count();
      }

      if (matchCount === 0) {
        // 允许带省市后缀匹配 (如 "酒店名(江苏省)")
        matchItem = storeItemScope.filter({
          has: page.locator(`[title^="${hotelName}"], [title^="${normalizedName}"]`),
        });
        matchCount = await matchItem.count();
      }

      if (matchCount === 0 && baseName) {
        // 允许按主体名称前缀匹配
        matchItem = storeItemScope.filter({
          has: page.locator(`[title^="${baseName}"]`),
        });
        matchCount = await matchItem.count();
      }

      if (matchCount === 0) {
        throw new Error(`抖音门店选择器中未搜索到匹配的酒店「${hotelName}」，请核对商家中心门店名称。`);
      }
      if (matchCount > 1) {
        throw new Error(`抖音门店选择器中搜索到 ${matchCount} 家同名酒店「${hotelName}」，存在歧义，已阻断采集。`);
      }

      const checkbox = matchItem.first().locator(DOUYIN_PRODUCT_SELECTORS.STORE_CHECKBOX).first();
      await checkbox.click();
      await humanDelay(page, ...HUMAN_DELAY.SHORT);

      // 5. 点击“确认”关闭选择器 (DOM: ps-select-panel + CSS: byted-btn-type-primary + Text: "确认")
      const confirmBtn = page.locator(DOUYIN_PRODUCT_SELECTORS.STORE_CONFIRM_BUTTON).first();
      await confirmBtn.click();
      await humanDelay(page, ...HUMAN_DELAY.SHORT);

      // 6. 点击主界面的“查询”按钮触发列表请求 (DOM: form.byted-form + CSS: byted-btn-type-primary + Text: "查询")
      const queryBtn = page.locator(DOUYIN_PRODUCT_SELECTORS.MAIN_QUERY_BUTTON).first();
      await queryBtn.click();

      // 7. 等待首屏商品响应到达
      log({
        level: 'PLAYWRIGHT',
        message: `[DouyinProductCollector] 已触发门店查询，等待首屏商品数据拦截 (${waitSeconds} 秒)...`,
      });
      await page.waitForTimeout(waitMs);

      // 若网络响应稍慢，额外提供最多 3 秒容错轮询缓冲
      const productDeadline = Date.now() + 3000;
      while (Date.now() < productDeadline && capturedPages.length === 0 && !interceptError) {
        await page.waitForTimeout(200);
      }

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
        // 分页下一页 (DOM: ul.byted-pager + CSS: li.byted-pager-next / .byted-icon-right + 伪类: :not(.byted-pager-item-disabled))
        const nextPageBtn = page.locator(DOUYIN_PRODUCT_SELECTORS.PAGER_NEXT_BUTTON).first();
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
        await page.waitForTimeout(Math.max(ACTION_TIMEOUT.QUICK_ACTION, waitMs));

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
