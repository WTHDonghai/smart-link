import type { Page, Response, Locator } from 'playwright';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import type { DutyUnhandledOrderSummary } from '../../dutyContracts';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import {
  DutyOrderStatus,
} from '../../dutyTaskContext';
import {
  isDouyinBookOrderListUrl,
  isDouyinRefundOrderListUrl,
  parseDouyinBookOrderListResponse,
  parseDouyinRefundOrderListResponse,
} from './douyinOrderParsers';
import {
  ACTION_TIMEOUT,
  DEFAULT_DUTY_TIMING,
  humanDelay,
  getScaledTimeout,
} from '../../dutyTimingConfig';
import { assertNoDouyinPageRisk } from './douyinRiskGuard';
import { dismissDouyinNoticeModals, clickWithModalBypass } from './douyinModalGuard';

export const TAB_TEXT_NEW = '新订/变更';
export const TAB_TEXT_CANCEL = '取消/退款';

/**
 * 等待抖音特定列表网络响应
 */
export async function waitForDouyinListResponse(
  page: Page,
  isTargetUrl: (url: string) => boolean,
  phase: string
): Promise<Response> {
  if (typeof page.waitForResponse !== 'function') {
    throw new DutyExecutionError('当前页面环境不支持 waitForResponse', 'METHOD_NOT_SUPPORTED', false);
  }

  let lastObservedStatus: number | undefined;

  try {
    const response = await page.waitForResponse(
      (res) => {
        if (isTargetUrl(res.url())) {
          lastObservedStatus = res.status();
          return res.request().method() === 'POST';
        }
        return false;
      },
      { timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }
    );
    if (response.status() !== 200) {
      throw new DutyExecutionError(
        `抖音「${phase}」列表接口返回 HTTP ${response.status()}: ${response.url()}`,
        DouyinDutyErrorCode.LIST_HTTP_ERROR,
        false
      );
    }
    return response;
  } catch (error) {
    if (error instanceof DutyExecutionError) throw error;
    await assertNoDouyinPageRisk(page);

    const statusDetail = typeof lastObservedStatus === 'number'
      ? `（接口曾返回 HTTP ${lastObservedStatus}）`
      : '（未收到任何 HTTP 响应包，请求未发起或网络挂起）';

    throw new DutyExecutionError(
      `抖音「${phase}」列表响应超时或异常: ${error instanceof Error ? error.message : String(error)} ${statusDetail}`,
      DouyinDutyErrorCode.LIST_RESPONSE_TIMEOUT,
      true
    );
  }
}

/**
 * 抖音订单列表采集器：负责列表 Tab 切换、网络响应监听、防抖与在途请求合并
 */
export class DouyinListCollector {
  private lastListRefreshTime = 0;
  private inFlightListPromise: Promise<DutyUnhandledOrderSummary[]> | null = null;

  /**
   * 基于【DOM 结构 + CSS 样式 + 文本】三重精准约束定位抖音 Tab 元素
   *
   * 1. DOM 结构约束：
   *    - 父级限定于 .byted-tab-bar / .semi-tabs 导航条内；
   *    - 项级严格限定于 .byted-tab-bar-item / .semi-tabs-tab 单个 Tab 项容器，彻底杜绝误中包含全部 Tab 的父级导航容器；
   *    - 标签级限定于内部 .byted-tab-bar-item-label / .semi-tabs-tab-title。
   *
   * 2. CSS 样式约束：
   *    - 使用严格完整类名 .byted-tab-bar-item，坚决杜绝模糊通配 [class*="tab-bar-item"] 误中父级容器；
   *    - 精准匹配样式变体 .byted-tab-bar-item-type-line。
   *
   * 3. 文本约束：
   *    - 文本匹配必须限定在单个 Tab 内部的 label 元素上，杜绝父级多 Tab 聚合文本干扰。
   */
  public getTabLocator(page: Page, label: string): Locator {
    return page
      .locator(
        // 1. 结构化严格组合：TabBar 容器 -> Tab 项 -> 包含目标文本的 Label 标签
        `.byted-tab-bar .byted-tab-bar-item:has(.byted-tab-bar-item-label:has-text("${label}")), ` +
        `.byted-tab-bar-item:has(.byted-tab-bar-item-label:has-text("${label}")), ` +
        // 2. 文本叶子标签容器：点击中心绝对对准文字核心区域，杜绝外层坐标偏移
        `.byted-tab-bar .byted-tab-bar-item .byted-tab-bar-item-label:has-text("${label}"), ` +
        `.byted-tab-bar-item-label:has-text("${label}"), ` +
        // 3. Semi Design 标准组件层级备选
        `.semi-tabs-tab:has(.semi-tabs-tab-title:has-text("${label}")), ` +
        `.semi-tabs-tab-title:has-text("${label}")`
      )
      .first();
  }

  /**
   * 受控切换指定 Tab 并等待权威网络响应（纯 Page Action，零业务数据解析）
   */
  private async switchTabAndAwaitResponse(
    page: Page,
    tabText: string,
    isTargetUrl: (url: string) => boolean
  ): Promise<Response> {
    await assertNoDouyinPageRisk(page);
    await dismissDouyinNoticeModals(page);

    const tabLocator = this.getTabLocator(page, tabText);
    try {
      await tabLocator.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      await assertNoDouyinPageRisk(page);
      throw new DutyExecutionError(
        `未找到可用的「${tabText}」Tab: ${error instanceof Error ? error.message : String(error)}`,
        DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    // 严密防御：点击前校验真实文本，杜绝误中相邻 Tab（如「今日待入住」）
    const actualText = typeof tabLocator?.innerText === 'function'
      ? (await tabLocator.innerText().catch(() => '')).trim()
      : '';
    const isNewTab = tabText === TAB_TEXT_NEW;
    const isValidTab = isNewTab
      ? actualText.includes('新订') || actualText.includes('变更')
      : actualText.includes('取消') || actualText.includes('退款');
    if (actualText && !isValidTab) {
      throw new DutyExecutionError(
        `Tab 元素文本校验失败：预期为「${tabText}」，实际定位到「${actualText}」，已阻断误触`,
        DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    await updateVisualTrackerStatus(page, `📥 正在点击「${tabText}」Tab 并等待接口响应...`, 'action');
    const responsePromise = waitForDouyinListResponse(
      page,
      isTargetUrl,
      tabText
    );

    // 优先点击内层文字 label 容器，确保点击坐标 100% 精确落在文字中心，杜绝边缘拉伸偏离
    const textLabel = typeof tabLocator?.locator === 'function'
      ? tabLocator.locator('.byted-tab-bar-item-label, .semi-tabs-tab-title, span').first()
      : null;
    const isTextVisible = textLabel && typeof textLabel.isVisible === 'function'
      ? await textLabel.isVisible().catch(() => false)
      : false;
    const clickTarget = (isTextVisible && textLabel) ? textLabel : tabLocator;

    await clickWithModalBypass(page, clickTarget, (p) => dismissDouyinNoticeModals(p), {
      timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK),
    });

    return await responsePromise;
  }

  /**
   * 刷新「新订/变更」列表并返回权威网络响应 (Page Action)
   */
  public async refreshBookOrderList(page: Page): Promise<Response> {
    return this.switchTabAndAwaitResponse(page, TAB_TEXT_NEW, isDouyinBookOrderListUrl);
  }

  /**
   * 刷新「取消/退款」列表并返回权威网络响应 (Page Action)
   */
  public async refreshRefundOrderList(page: Page): Promise<Response> {
    return this.switchTabAndAwaitResponse(page, TAB_TEXT_CANCEL, isDouyinRefundOrderListUrl);
  }

  /**
   * 刷新抖音指定订单状态的列表并返回权威网络响应 (对标美团 refreshOrderList: 纯 Page Action)
   */
  public async refreshOrderList(
    page: Page,
    orderStatus: DutyOrderStatus = DutyOrderStatus.NEW
  ): Promise<Response> {
    if (orderStatus === DutyOrderStatus.CANCEL) {
      return await this.refreshRefundOrderList(page);
    }
    return await this.refreshBookOrderList(page);
  }

  /**
   * 页面操作：刷新抖音待处理列表并返回待处理订单概要（权威网络响应为唯一源，带防抖补偿与请求合并）
   * 职责收敛：在途合并 -> 风控门禁 -> 频控防抖 -> 在互斥锁下执行列表刷新 -> 响应提取与业务解析
   */
  public async collectUnhandledOrders(
    page: Page,
    orderStatus: DutyOrderStatus = DutyOrderStatus.NEW,
    runWithMutex: <T>(action: () => Promise<T>) => Promise<T>,
    refreshFn: (page: Page, status: DutyOrderStatus) => Promise<Response> = (p, s) => this.refreshOrderList(p, s)
  ): Promise<DutyUnhandledOrderSummary[]> {
    await assertNoDouyinPageRisk(page);

    // 1. 在途请求合并门禁 (Request Coalescing)：若已有正在刷新的在途 Promise，直接复用其结果
    if (this.inFlightListPromise) {
      return await this.inFlightListPromise;
    }

    this.inFlightListPromise = (async () => {
      // 2. 频控防抖补偿：若距离上次刷新不足 REFRESH_DEBOUNCE (3s)，补齐等待时间防止触发抖音风控
      const now = performance.now();
      const elapsed = this.lastListRefreshTime > 0 ? now - this.lastListRefreshTime : Infinity;
      const debounceThreshold = DEFAULT_DUTY_TIMING.system.REFRESH_DEBOUNCE;
      if (elapsed < debounceThreshold) {
        const remainMs = Math.ceil(debounceThreshold - elapsed);
        await humanDelay(page, remainMs, remainMs + DEFAULT_DUTY_TIMING.system.CLAIM_IDLE_JITTER_SPREAD);
      }

      // 3. 在互斥锁保护下执行单页面 Tab 交互与网络拦截
      return await runWithMutex(async () => {
        await assertNoDouyinPageRisk(page);

        const tabLabel = orderStatus === DutyOrderStatus.CANCEL ? TAB_TEXT_CANCEL : TAB_TEXT_NEW;
        await updateVisualTrackerStatus(page, `📥 正在执行订单采集并刷新抖音「${tabLabel}」列表...`, 'action');

        // 4. 调用底层 Page Action 获取权威网络响应
        const response = await refreshFn(page, orderStatus);
        const text = await response.text().catch(() => '');
        let parsedPayload: unknown;
        try {
          parsedPayload = JSON.parse(text);
        } catch {
          throw new DutyExecutionError(
            `抖音「${tabLabel}」列表响应非合法 JSON`,
            DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
            false
          );
        }

        // 5. 业务解析归集
        const orders = orderStatus === DutyOrderStatus.CANCEL
          ? parseDouyinRefundOrderListResponse(parsedPayload)
          : parseDouyinBookOrderListResponse(parsedPayload);

        await updateVisualTrackerStatus(
          page,
          `📥 抖音「${tabLabel}」列表已刷新，权威网络接口共解析到 ${orders.length} 笔待处理订单`,
          orders.length > 0 ? 'success' : 'info'
        );

        this.lastListRefreshTime = performance.now();
        return orders;
      });
    })().finally(() => {
      this.inFlightListPromise = null;
    });

    return await this.inFlightListPromise;
  }
}
