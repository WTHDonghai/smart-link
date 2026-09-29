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
   * 刷新「新订/变更」列表并返回解析后的新订单概要
   */
  public async refreshBookOrderList(page: Page): Promise<DutyUnhandledOrderSummary[]> {
    await assertNoDouyinPageRisk(page);
    await dismissDouyinNoticeModals(page);

    const tabLocator = this.getTabLocator(page, TAB_TEXT_NEW);
    try {
      await tabLocator.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      await assertNoDouyinPageRisk(page);
      throw new DutyExecutionError(
        `未找到可用的「${TAB_TEXT_NEW}」Tab: ${error instanceof Error ? error.message : String(error)}`,
        DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    // 严密防御：点击前校验真实文本，杜绝误中相邻 Tab（如「今日待入住」）
    const actualText = typeof tabLocator?.innerText === 'function'
      ? (await tabLocator.innerText().catch(() => '')).trim()
      : '';
    if (actualText && !actualText.includes('新订') && !actualText.includes('变更')) {
      throw new DutyExecutionError(
        `Tab 元素文本校验失败：预期为「${TAB_TEXT_NEW}」，实际定位到「${actualText}」，已阻断误触`,
        DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    await updateVisualTrackerStatus(page, `📥 正在点击「${TAB_TEXT_NEW}」Tab 并等待接口响应...`, 'action');
    const responsePromise = waitForDouyinListResponse(
      page,
      isDouyinBookOrderListUrl,
      TAB_TEXT_NEW
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

    const response = await responsePromise;
    const text = await response.text().catch(() => '');
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(text);
    } catch {
      throw new DutyExecutionError(
        `抖音「${TAB_TEXT_NEW}」列表响应非合法 JSON`,
        DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
        false
      );
    }

    return parseDouyinBookOrderListResponse(parsedPayload);
  }

  /**
   * 刷新「取消/退款」列表并返回解析后的取消/退款订单概要
   */
  public async refreshRefundOrderList(page: Page): Promise<DutyUnhandledOrderSummary[]> {
    await assertNoDouyinPageRisk(page);
    await dismissDouyinNoticeModals(page);

    const tabLocator = this.getTabLocator(page, TAB_TEXT_CANCEL);
    try {
      await tabLocator.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      await assertNoDouyinPageRisk(page);
      throw new DutyExecutionError(
        `未找到可用的「${TAB_TEXT_CANCEL}」Tab: ${error instanceof Error ? error.message : String(error)}`,
        DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    // 严密防御：点击前校验真实文本，杜绝误中相邻 Tab
    const actualText = typeof tabLocator?.innerText === 'function'
      ? (await tabLocator.innerText().catch(() => '')).trim()
      : '';
    if (actualText && !actualText.includes('取消') && !actualText.includes('退款')) {
      throw new DutyExecutionError(
        `Tab 元素文本校验失败：预期为「${TAB_TEXT_CANCEL}」，实际定位到「${actualText}」，已阻断误触`,
        DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    await updateVisualTrackerStatus(page, `📥 正在点击「${TAB_TEXT_CANCEL}」Tab 并等待接口响应...`, 'action');
    const responsePromise = waitForDouyinListResponse(
      page,
      isDouyinRefundOrderListUrl,
      TAB_TEXT_CANCEL
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

    const response = await responsePromise;
    const text = await response.text().catch(() => '');
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(text);
    } catch {
      throw new DutyExecutionError(
        `抖音「${TAB_TEXT_CANCEL}」列表响应非合法 JSON`,
        DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
        false
      );
    }

    return parseDouyinRefundOrderListResponse(parsedPayload);
  }

  /**
   * 刷新抖音指定订单状态的列表（按中台指令严格单列表采集，绝不同时刷新两类 Tab）
   */
  public async refreshOrderList(
    page: Page,
    orderStatus: DutyOrderStatus = DutyOrderStatus.NEW
  ): Promise<DutyUnhandledOrderSummary[]> {
    if (orderStatus === DutyOrderStatus.CANCEL) {
      return await this.refreshRefundOrderList(page);
    }
    return await this.refreshBookOrderList(page);
  }

  /**
   * 页面操作：刷新抖音待处理列表并返回待处理订单概要
   * 职责收敛：风控门禁 -> 频控防抖 -> 在互斥锁下执行列表刷新与结果解析
   * 直接接收外层已解析的 orderStatus，消除内层重复解析
   */
  public async collectUnhandledOrders(
    page: Page,
    orderStatus: DutyOrderStatus = DutyOrderStatus.NEW,
    runWithMutex: <T>(action: () => Promise<T>) => Promise<T>
  ): Promise<DutyUnhandledOrderSummary[]> {
    await assertNoDouyinPageRisk(page);

    const tabLabel = orderStatus === DutyOrderStatus.CANCEL ? TAB_TEXT_CANCEL : TAB_TEXT_NEW;

    // 1. 频控防抖补偿：若距离上次刷新不足 REFRESH_DEBOUNCE (3s)，补齐等待时间防止触发抖音风控
    const now = performance.now();
    const elapsed = this.lastListRefreshTime > 0 ? now - this.lastListRefreshTime : Infinity;
    const debounceThreshold = DEFAULT_DUTY_TIMING.system.REFRESH_DEBOUNCE;
    if (elapsed < debounceThreshold) {
      const remainMs = Math.ceil(debounceThreshold - elapsed);
      await humanDelay(page, remainMs, remainMs + DEFAULT_DUTY_TIMING.system.CLAIM_IDLE_JITTER_SPREAD);
    }

    // 2. 在互斥锁保护下执行单页面 Tab 交互与网络拦截
    return await runWithMutex(async () => {
      await assertNoDouyinPageRisk(page);

      await updateVisualTrackerStatus(page, `📥 正在执行订单采集并刷新抖音「${tabLabel}」列表...`, 'action');

      const orders = await this.refreshOrderList(page, orderStatus);

      await updateVisualTrackerStatus(
        page,
        `📥 抖音「${tabLabel}」列表已刷新，权威网络接口共解析到 ${orders.length} 笔待处理订单`,
        orders.length > 0 ? 'success' : 'info'
      );

      this.lastListRefreshTime = performance.now();
      return orders;
    });
  }
}
