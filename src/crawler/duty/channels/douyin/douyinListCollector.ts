import type { Page, Response, Locator, Request } from 'playwright';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import type { DutyUnhandledOrderSummary } from '../../dutyContracts';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import {
  DutyOrderStatus,
} from '../../dutyTaskContext';
import { emitDutyTaskLog, type DutyTaskLogSink } from '../../dutyTaskLogger';
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
import { assertNoDouyinPageRisk, assertNoDouyinResponseRisk, recordDouyinResponseFailure } from './douyinRiskGuard';
import { dismissDouyinNoticeModals, clickWithModalBypass } from './douyinModalGuard';

export const TAB_TEXT_NEW = '新订/变更';
export const TAB_TEXT_CANCEL = '取消/退款';

/**
 * 抖音接口响应等待超时 (毫秒)，列表与详情报文拦截共用
 * 全局基线 ACTION_TIMEOUT.NETWORK (8s) 在偶发慢尾场景（大订单列表 / 工作台后台轮询竞争 /
 * 网络抖动）下余量不足，出现间歇性 8s 内未拦截到目标响应；放宽至 15s 消化慢尾。
 * 仅作用于抖音接口响应等待，不影响其他渠道与交互时序阶梯。
 */
export const DOUYIN_API_RESPONSE_TIMEOUT_MS = 15_000;

/**
 * 等待抖音特定列表网络响应。
 * 附带全量 POST 请求路径观测诊断：超时时报错严格区分三种故障形态——
 * 1. 目标请求已发出但未收到响应（网络挂起 / 浏览器同主机连接饱和）；
 * 2. 未观察到目标请求但存在其他请求（点击被页面态忽略或接口路径变更）；
 * 3. 完全无请求发出（页面冻结 / 请求未发起）。
 */
export async function waitForDouyinListResponse(
  page: Page,
  isTargetUrl: (url: string) => boolean,
  phase: string
): Promise<Response> {
  if (typeof page.waitForResponse !== 'function') {
    throw new DutyExecutionError('当前页面环境不支持 waitForResponse', 'METHOD_NOT_SUPPORTED', false);
  }

  const observedPostPaths = new Set<string>();
  let targetRequestObserved = false;
  const onRequest = (request: Request) => {
    try {
      if (request.method() !== 'POST') return;
      const url = request.url();
      observedPostPaths.add(new URL(url).pathname);
      if (isTargetUrl(url)) {
        targetRequestObserved = true;
      }
    } catch {
      // 无效 URL 不参与诊断
    }
  };
  const canObserveRequests = typeof page.on === 'function' && typeof page.off === 'function';
  if (canObserveRequests) {
    page.on('request', onRequest);
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
      { timeout: getScaledTimeout(DOUYIN_API_RESPONSE_TIMEOUT_MS) }
    );
    if (response.status() !== 200) {
      const text = await response.text().catch((error: unknown) => {
        throw new DutyExecutionError(
          `抖音「${phase}」列表接口返回 HTTP ${response.status()}，响应体读取失败: ${error instanceof Error ? error.message : String(error)}`,
          DouyinDutyErrorCode.LIST_HTTP_ERROR,
          false,
          { cause: error }
        );
      });
      assertNoDouyinResponseRisk(text, {
        apiUrl: response.url(), httpStatus: response.status(), method: response.request().method(),
      }, `列表接口 HTTP 异常：${phase}`);
      recordDouyinResponseFailure(text, {
        apiUrl: response.url(), httpStatus: response.status(), method: response.request().method(),
      }, `列表接口 HTTP 异常：${phase}`);
      throw new DutyExecutionError(
        `抖音「${phase}」列表接口返回 HTTP ${response.status()}: ${response.url()}`,
        DouyinDutyErrorCode.LIST_HTTP_ERROR,
        false
      );
    }
    return response;
  } catch (error) {
    if (error instanceof DutyExecutionError) throw error;
    await assertNoDouyinPageRisk(page, `列表响应等待失败：${phase}`, error);

    const statusDetail = typeof lastObservedStatus === 'number'
      ? `（接口曾返回 HTTP ${lastObservedStatus}）`
      : targetRequestObserved
        ? `（目标接口请求已发出但 ${getScaledTimeout(DOUYIN_API_RESPONSE_TIMEOUT_MS)}ms 内未收到响应，疑似网络挂起或浏览器连接饱和）`
        : observedPostPaths.size > 0
          ? `（未观察到目标接口请求；期间观察到其他 POST 请求: ${Array.from(observedPostPaths).slice(0, 5).join('、')}）`
          : '（未收到任何 HTTP 响应包且无任何 POST 请求发出，请求未发起或页面冻结）';

    throw new DutyExecutionError(
      `抖音「${phase}」列表响应超时或异常: ${error instanceof Error ? error.message : String(error)} ${statusDetail}`,
      DouyinDutyErrorCode.LIST_RESPONSE_TIMEOUT,
      true,
      { cause: error }
    );
  } finally {
    if (canObserveRequests) {
      page.off('request', onRequest);
    }
  }
}

/**
 * 抖音订单列表采集器：负责列表 Tab 切换、网络响应监听、防抖与在途请求合并
 */
export class DouyinListCollector {
  private lastListRefreshTime = 0;
  private inFlightListPromise: Promise<DutyUnhandledOrderSummary[]> | null = null;

  /**
   * 定位抖音 Tab 元素：严格限定于 .byted-tab-bar 容器内且包含目标 label 的 TabItem
   */
  public getTabLocator(page: Page, label: string): Locator {
    return page
      .locator(`.byted-tab-bar .byted-tab-bar-item:has(.byted-tab-bar-item-label:has-text("${label}"))`)
      .first();
  }

  /**
   * 受控切换指定 Tab 并等待权威网络响应（纯 Page Action，零业务数据解析）
   * 关键时序：响应监听必须在任何页面交互（弹窗清理/Tab 校验/点击）之前挂载——
   * 弹窗关闭或页面自刷新可能在交互前就触发列表请求，若监听挂载过晚将错过响应，
   * 且随后的 Tab 点击可能被工作台客户端去重（短时间内同接口不再重发），直接导致 8s 超时。
   */
  private async switchTabAndAwaitResponse(
    page: Page,
    tabText: string,
    isTargetUrl: (url: string) => boolean
  ): Promise<Response> {
    // 1. 最先挂载响应监听：捕获弹窗清理或页面自动刷新触发的列表响应，消除监听迟到竞态
    const responsePromise = waitForDouyinListResponse(page, isTargetUrl, tabText);

    try {
      await assertNoDouyinPageRisk(page, `列表 Tab 点击前：${tabText}`);
      await dismissDouyinNoticeModals(page);

      const tabLocator = this.getTabLocator(page, tabText);
      try {
        await tabLocator.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
      } catch (error) {
        await assertNoDouyinPageRisk(page, `列表 Tab 等待失败：${tabText}`, error);
        throw new DutyExecutionError(
          `未找到可用的「${tabText}」Tab: ${error instanceof Error ? error.message : String(error)}`,
          DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
          false,
          { cause: error }
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
    } catch (error) {
      // 提前终止时显式丢弃响应监听 Promise，避免悬挂的未处理拒绝泄漏至全局
      responsePromise.catch(() => undefined);
      throw error;
    }

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
    refreshFn: (page: Page, status: DutyOrderStatus) => Promise<Response> = (p, s) => this.refreshOrderList(p, s),
    audit?: DutyTaskLogSink
  ): Promise<DutyUnhandledOrderSummary[]> {
    await assertNoDouyinPageRisk(page, `采集入口：${orderStatus}`);

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
        await assertNoDouyinPageRisk(page, `采集获得页面锁：${orderStatus}`);

        const tabLabel = orderStatus === DutyOrderStatus.CANCEL ? TAB_TEXT_CANCEL : TAB_TEXT_NEW;
        await updateVisualTrackerStatus(page, `📥 正在执行订单采集并刷新抖音「${tabLabel}」列表...`, 'action');

        // 4. 调用底层 Page Action 获取权威网络响应
        const response = await refreshFn(page, orderStatus);
        const text = await response.text().catch((error: unknown) => {
          throw new DutyExecutionError('抖音列表接口响应体读取失败', DouyinDutyErrorCode.LIST_BUSINESS_FAILED, false, { cause: error });
        });
        let parsedPayload: unknown;
        try {
          parsedPayload = JSON.parse(text);
        } catch (error) {
          assertNoDouyinResponseRisk(text, {
            apiUrl: response.url(), httpStatus: response.status(), method: response.request().method(),
          }, `列表响应非 JSON：${tabLabel}`);
          recordDouyinResponseFailure(text, {
            apiUrl: response.url(), httpStatus: response.status(), method: response.request().method(),
          }, `列表响应非 JSON：${tabLabel}`, error);
          throw new DutyExecutionError(
            `抖音「${tabLabel}」列表响应非合法 JSON`,
            DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
            false,
            { cause: error }
          );
        }

        // 仅在业务状态失败时检查列表响应，避免正常订单备注中的词扩大拦截范围。
        if (parsedPayload && typeof parsedPayload === 'object' && (parsedPayload as Record<string, unknown>).status_code !== 0) {
          assertNoDouyinResponseRisk(text, {
            apiUrl: response.url(), httpStatus: response.status(), method: response.request().method(),
          }, `列表业务状态异常：${tabLabel}`, 'status_msg');
          recordDouyinResponseFailure(text, {
            apiUrl: response.url(), httpStatus: response.status(), method: response.request().method(),
          }, `列表业务状态异常：${tabLabel}`);
        }

        // 5. 业务解析归集
        const orders = orderStatus === DutyOrderStatus.CANCEL
          ? parseDouyinRefundOrderListResponse(parsedPayload)
          : parseDouyinBookOrderListResponse(parsedPayload);

        emitDutyTaskLog('DOUYIN', audit, {
          level: 'INFO',
          event: 'DOUYIN_ORDER_COLLECT_RESULT',
          message: `[抖音订单采集] 「${tabLabel}」列表刷新完成，解析到 ${orders.length} 笔待处理订单`,
          taskActionStage: 'collect-order',
          meta: { orderStatus, tabLabel, orderCount: orders.length },
        });

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
