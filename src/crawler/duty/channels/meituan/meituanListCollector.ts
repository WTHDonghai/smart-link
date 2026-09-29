import type { Page, Request, Response } from 'playwright';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import type { DutyUnhandledOrderSummary } from '../../dutyContracts';
import {
  MeituanDutyErrorCode,
  DutyExecutionError,
} from './meituanDutyContracts';
import {
  isMeituanListUrl,
  isMeituanOrderTabListUrl,
  parseMeituanOrderListResponse,
} from './meituanOrderParsers';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  DEFAULT_DUTY_TIMING,
  humanDelay,
  getScaledTimeout,
} from '../../dutyTimingConfig';
import { assertNoMeituanPageRisk } from './meituanRiskGuard';
import { dismissMeituanNoticeModals, clickWithModalBypass } from './meituanModalGuard';
import { getMeituanOrderScope } from './meituanCardLocator';

/**
 * 等待美团特定列表网络响应
 */
export async function waitForMeituanListResponse(
  page: Page,
  phase: string,
  acceptAllOrdersList = false
): Promise<Response> {
  if (typeof page.waitForResponse !== 'function') {
    throw new DutyExecutionError('当前页面环境不支持 waitForResponse', 'METHOD_NOT_SUPPORTED', false);
  }

  const observedPaths = new Set<string>();
  const isListUrl = acceptAllOrdersList ? isMeituanOrderTabListUrl : isMeituanListUrl;
  const onRequest = (request: Request) => {
    try {
      if (isListUrl(request.url())) {
        observedPaths.add(new URL(request.url()).pathname);
      }
    } catch {
      // 无效 URL 不参与诊断
    }
  };
  const canObserveRequests = typeof page.on === 'function' && typeof page.off === 'function';
  if (canObserveRequests) {
    page.on('request', onRequest);
  }

  try {
    const response = await page.waitForResponse(
      (res) => isListUrl(res.url()),
      { timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }
    );
    if (response.status() !== 200) {
      throw new DutyExecutionError(
        `美团${phase}列表接口返回 HTTP ${response.status()}: ${response.url()}`,
        MeituanDutyErrorCode.LIST_HTTP_ERROR,
        false
      );
    }
    return response;
  } catch (error) {
    if (error instanceof DutyExecutionError) throw error;
    await assertNoMeituanPageRisk(page);
    const evidence = observedPaths.size
      ? `已观察到请求路径: ${Array.from(observedPaths).join(', ')}`
      : '未观察到 task/list 请求';
    throw new DutyExecutionError(
      `美团${phase}列表响应超时或异常: ${error instanceof Error ? error.message : String(error)}；${evidence}`,
      MeituanDutyErrorCode.LIST_RESPONSE_TIMEOUT,
      true
    );
  } finally {
    if (canObserveRequests) {
      page.off('request', onRequest);
    }
  }
}

/**
 * 美团订单列表采集器：负责列表 Tab 切换、网络响应监听、防抖与在途请求合并
 */
export class MeituanListCollector {
  private lastListRefreshTime = 0;
  private inFlightListPromise: Promise<DutyUnhandledOrderSummary[]> | null = null;

  /**
   * 通过受控 Tab 切换刷新列表，并返回最终的待确认订单列表响应
   */
  public async refreshOrderList(page: Page): Promise<Response> {
    await assertNoMeituanPageRisk(page);

    const scope = getMeituanOrderScope(page);
    // 动作前置浮层清理：自动排除并关闭阻塞 Tab 点击的非业务提示弹窗（如“联系客人”等）
    await dismissMeituanNoticeModals(page, scope);

    const getTab = (label: string, active = false) =>
      scope.locator(`.tab-container .mtd-tabs-item${active ? '.mtd-tab-active' : ''}:has-text("${label}")`);

    const pendingTab = getTab('待确认订单');

    try {
      await pendingTab.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      await assertNoMeituanPageRisk(page);
      throw new DutyExecutionError(
        `未找到可用的「待确认订单」Tab: ${error instanceof Error ? error.message : String(error)}`,
        MeituanDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    const allOrdersTab = getTab('全部订单');

    try {
      await allOrdersTab.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      await assertNoMeituanPageRisk(page);
      throw new DutyExecutionError(
        `未找到可用的「全部订单」Tab: ${error instanceof Error ? error.message : String(error)}`,
        MeituanDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    const allOrdersClassName = (await allOrdersTab.getAttribute('class')) || '';
    const allOrdersAriaSelected = await allOrdersTab.getAttribute('aria-selected');
    const allOrdersActive =
      allOrdersClassName.split(/\s+/).some((cls) => cls.includes('active') || cls.includes('selected')) ||
      allOrdersAriaSelected === 'true';

    if (allOrdersActive) {
      await updateVisualTrackerStatus(page, '📥 已在「全部订单」，正在切换到待确认列表...', 'action');
      const pendingResponse = waitForMeituanListResponse(page, '待确认订单最终列表');
      await dismissMeituanNoticeModals(page, scope);
      await clickWithModalBypass(page, pendingTab, (p) => dismissMeituanNoticeModals(p, scope), {
        timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK),
      });
      const response = await pendingResponse;
      await getTab('待确认订单', true)
        .waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) })
        .catch(async () => {
          await assertNoMeituanPageRisk(page);
        });
      return response;
    }

    await updateVisualTrackerStatus(page, '📥 正在通过「全部订单」刷新待确认列表...', 'action');
    // 只作为前一列表的生命周期屏障；不读取、不解析该响应
    const allOrdersResponse = waitForMeituanListResponse(page, '全部订单切换屏障', true);
    await dismissMeituanNoticeModals(page, scope);
    await clickWithModalBypass(page, allOrdersTab, (p) => dismissMeituanNoticeModals(p, scope), {
      timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK),
    });
    try {
      await getTab('全部订单', true).waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch {
      await assertNoMeituanPageRisk(page);
      // 容错类名变体（如 mtd-tabs-item-active），等待网络响应即可
    }
    await allOrdersResponse;
    await humanDelay(page, ...HUMAN_DELAY.SHORT);

    // 仅在最终触发待确认列表前挂响应监听，避免消费“全部订单”请求
    const pendingResponse = waitForMeituanListResponse(page, '待确认订单最终列表');
    await dismissMeituanNoticeModals(page, scope);
    await clickWithModalBypass(page, pendingTab, (p) => dismissMeituanNoticeModals(p, scope), {
      timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK),
    });
    const response = await pendingResponse;
    await getTab('待确认订单', true)
      .waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) })
      .catch(async () => {
        await assertNoMeituanPageRisk(page);
      });
    return response;
  }

  /**
   * 刷新美团待处理列表并返回待处理订单概要（权威网络响应为唯一源，带防抖补偿与请求合并）
   */
  public async collectUnhandledOrders(
    page: Page,
    runWithMutex: <T>(action: () => Promise<T>) => Promise<T>,
    refreshFn: (page: Page) => Promise<Response> = (p) => this.refreshOrderList(p)
  ): Promise<DutyUnhandledOrderSummary[]> {
    await assertNoMeituanPageRisk(page);

    // 1. 在途请求合并门禁 (Request Coalescing)：若已有正在刷新的在途 Promise，直接复用其结果
    if (this.inFlightListPromise) {
      return await this.inFlightListPromise;
    }

    this.inFlightListPromise = (async () => {
      // 3 秒防抖等待补偿：若距离上次刷新不足 REFRESH_DEBOUNCE，等待补齐延迟后再触发交互，绝不直接返回空数组
      const now = performance.now();
      const elapsed = this.lastListRefreshTime > 0 ? now - this.lastListRefreshTime : Infinity;
      const debounceThreshold = DEFAULT_DUTY_TIMING.system.REFRESH_DEBOUNCE;
      if (elapsed < debounceThreshold) {
        const remainMs = Math.ceil(debounceThreshold - elapsed);
        await humanDelay(page, remainMs, remainMs + DEFAULT_DUTY_TIMING.system.CLAIM_IDLE_JITTER_SPREAD);
      }

      // 进入任务互斥锁，执行单页面交互与网络拦截
      return runWithMutex(async () => {
        await assertNoMeituanPageRisk(page);

        await updateVisualTrackerStatus(page, '📥 正在执行订单采集并刷新待确认订单列表...', 'action');

        // 通过受控 Tab 切换触发刷新，并等待最终的待确认列表响应
        const listResponse = await refreshFn(page);
        const text = await listResponse.text().catch(() => '');
        let parsedPayload: unknown;
        try {
          parsedPayload = JSON.parse(text);
        } catch {
          throw new DutyExecutionError('美团列表响应非合法 JSON', MeituanDutyErrorCode.LIST_BUSINESS_FAILED, false);
        }
        const orders = parseMeituanOrderListResponse(parsedPayload);

        await updateVisualTrackerStatus(
          page,
          `📥 待确认列表已刷新，权威网络接口共解析到 ${orders.length} 笔待处理订单`,
          orders.length > 0 ? 'success' : 'info'
        );

        // 记录权威网络响应成功时间 (Fail-Fast: 绝无 DOM 拼接兜底！)
        this.lastListRefreshTime = performance.now();
        return orders;
      });
    })().finally(() => {
      this.inFlightListPromise = null;
    });

    return await this.inFlightListPromise;
  }
}
