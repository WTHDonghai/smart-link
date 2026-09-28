import type { Page, Request, Response, Frame, Locator } from 'playwright';
import { createPersistentBrowserSession, type BrowserSession } from '@/src/crawler/browserManager';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import {
  BaseChannelDutyRunner,
  type DutyUnhandledOrderSummary,
  type SupportedDutyTaskType,
} from '../../dutyContracts';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import {
  isDouyinBookOrderListUrl,
  isDouyinRefundOrderListUrl,
  parseDouyinBookOrderListResponse,
  parseDouyinRefundOrderListResponse,
} from './douyinOrderParsers';
import { getDouyinOrderUrl } from '@/src/config/otaUrls';
import type { ParsedDutyTaskContext } from '../../dutyTaskContext';
import { PROCESS_ENV_KEYS } from '@/src/types/env';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  DEFAULT_DUTY_TIMING,
  humanDelay,
  getScaledTimeout,
  isProbeVisible,
} from '../../dutyTimingConfig';

/**
 * 页面级人机验证、滑块与风控拦截嗅探函数（跨顶层与所有子 Frame 深度检测）
 */
export async function checkDouyinPageRisk(page: Page): Promise<boolean> {
  if (!page) return false;
  try {
    const pageUrl = typeof page.url === 'function' ? page.url() : '';
    if (pageUrl && /(?:verify|captcha|secsdk)\.douyin\.com|secsdk|captcha/i.test(pageUrl)) {
      return true;
    }

    const frames = typeof page.frames === 'function' ? page.frames() : [page as unknown as Frame];
    for (const frame of frames) {
      try {
        const frameUrl = frame.url();
        if (frameUrl && /(?:verify|captcha|secsdk)\.douyin\.com|secsdk|captcha/i.test(frameUrl)) {
          return true;
        }
      } catch {
        // 忽略跨域或已销毁 frame
      }

      if (typeof frame.evaluate === 'function') {
        const riskFound = await frame.evaluate(() => {
          const hasCaptchaEl = Boolean(
            document.querySelector(
              'iframe[src*="captcha"], iframe[src*="verify"], iframe[src*="secsdk"], ' +
              '#captcha-verify-image, .secsdk-captcha-drag-wrapper, .captcha-verify-container, ' +
              'div[id*="captcha"], div[class*="captcha"]'
            )
          );
          if (hasCaptchaEl) return true;

          const norm = (str: string | null | undefined) => String(str || '').replace(/\s+/g, ' ').trim();
          const bodyText = norm(document.body ? document.body.innerText || document.body.textContent : '');
          const title = norm(document.title);
          const combined = `${title}\n${window.location.href}\n${bodyText.slice(0, 3000)}`;
          return /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|验证一下|拖动滑块|请完成验证|secsdk|captcha/i.test(combined);
        }).catch(() => false);

        if (riskFound === true) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 自动检测并安全关闭抖音后台提示性通知弹窗（如公告须知等）
 * 严格避让核心业务弹窗（接单、拒单、确认号填报）与安全风控验证弹窗
 */
export async function dismissDouyinNoticeModals(page: Page): Promise<boolean> {
  if (!page) return false;

  let dismissedAny = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const modalWrappers = page.locator('.byted-modal, .semi-modal, .semi-modal-wrap, div[role="dialog"]');
      const count = await modalWrappers.count().catch(() => 0);
      if (count === 0) break;

      let dismissedInThisAttempt = false;
      for (let i = 0; i < count; i++) {
        const modal = modalWrappers.nth(i);
        const isVisible = await isProbeVisible(modal, ACTION_TIMEOUT.FAST_PROBE);
        if (!isVisible) continue;

        const modalText = await modal.innerText().catch(() => '');

        // 核心安全红线 1：严禁关闭接单确认号弹窗与业务决策弹窗
        if (modalText.includes('确认号') || modalText.includes('接单') || modalText.includes('拒单')) {
          continue;
        }

        // 核心安全红线 2：严禁关闭安全风控/滑块弹窗
        if (/安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|secsdk|captcha/i.test(modalText)) {
          continue;
        }

        // 核心安全红线 3：严禁关闭取消/退款业务决策弹窗
        if (/确认取消|确认退款|同意退款|拒绝退款/i.test(modalText)) {
          continue;
        }

        const dismissBtn = modal.locator(
          'button:has-text("我知道了"), ' +
          'button:has-text("知道了"), ' +
          'button:has-text("我已阅读"), ' +
          'button:has-text("确定"), ' +
          'button:has-text("确认"), ' +
          'button:has-text("关闭"), ' +
          '.byted-modal-close, ' +
          '.semi-modal-close, ' +
          '[class*="modal-close"], ' +
          '[aria-label="Close"]'
        ).first();

        const btnVisible = await isProbeVisible(dismissBtn, ACTION_TIMEOUT.FAST_PROBE);
        if (!btnVisible) continue;

        await updateVisualTrackerStatus(page, '🛡️ 检测到提示弹窗，已自动关闭以恢复操作', 'action');
        await dismissBtn.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.SENSITIVE_FIELD) }).catch(() => {});
        await modal.waitFor({ state: 'hidden', timeout: getScaledTimeout(ACTION_TIMEOUT.ELEMENT) }).catch(() => {});
        dismissedAny = true;
        dismissedInThisAttempt = true;
        break;
      }
      if (!dismissedInThisAttempt) break;
    } catch {
      break;
    }
  }
  return dismissedAny;
}

export class DouyinDutyRunner extends BaseChannelDutyRunner {
  public readonly channelCode = 'DOUYIN';
  public override readonly supportedTaskTypes: readonly SupportedDutyTaskType[] = ['OTA_COLLECT_ORDER'];
  private session: BrowserSession | null = null;
  private explicitTargetUrl?: string;
  private lastListRefreshTimes = new Map<'book' | 'refund', number>();

  // 在途请求合并门禁 (按 tab 分流独立合并)
  private inFlightListPromises = new Map<'book' | 'refund', Promise<DutyUnhandledOrderSummary[]>>();

  // 任务互斥锁 (Task Mutex Lock) 保证单页面交互操作串行化
  private taskMutex: Promise<void> = Promise.resolve();

  constructor(targetUrl?: string) {
    super();
    if (targetUrl && targetUrl.trim()) {
      this.explicitTargetUrl = targetUrl.trim();
    }
  }

  public get targetUrl(): string {
    return this.explicitTargetUrl || getDouyinOrderUrl();
  }

  private async dismissNoticeModals(page: Page): Promise<boolean> {
    return dismissDouyinNoticeModals(page);
  }

  /**
   * 互斥锁封装：确保同一时刻只有一个页面交互动作在驱动 Playwright Page
   */
  private async runWithMutex<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.taskMutex;
    let release: () => void = () => {};
    this.taskMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => {});
    try {
      return await action();
    } finally {
      release();
    }
  }

  private getActivePage(operation: string): Page {
    if (!this.running || !this.session) {
      throw new DutyExecutionError(
        `抖音值守执行器未运行，无法${operation}`,
        'RUNNER_NOT_RUNNING',
        false
      );
    }
    if (this.session.page.isClosed?.()) {
      throw new DutyExecutionError(
        `抖音浏览器页面已关闭，无法${operation}`,
        DouyinDutyErrorCode.TARGET_PAGE_NOT_READY,
        false
      );
    }
    return this.session.page;
  }

  /**
   * 页面就绪门禁：等待商户后台核心骨架挂载，并执行冷启动沉淀缓冲 (3~8 秒)
   */
  public async waitForPageReady(page: Page, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_DUTY_TIMING.action.PAGE_CONTAINER_READY;

    if (await checkDouyinPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    await updateVisualTrackerStatus(page, '⏳ 正在等待抖音商家后台骨架加载就绪...', 'action');

    const coreContainer = page.locator(
      '.byted-tab-bar, .byted-tab-bar-item, #filterSection, #core-layout-outlet, div[class*="tab-bar"]'
    ).first();

    try {
      if (typeof coreContainer?.waitFor === 'function') {
        await coreContainer.waitFor({ state: 'attached', timeout: getScaledTimeout(timeout) });
      }
    } catch (error) {
      if (await checkDouyinPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
      throw new DutyExecutionError(
        `抖音商家后台页面元素加载超时 (${timeout}ms): ${error instanceof Error ? error.message : String(error)}`,
        DouyinDutyErrorCode.TARGET_PAGE_NOT_READY,
        true
      );
    }

    // 冷启动沉淀缓冲 (Settling Delay)：3 秒到 8 秒拟人随机缓冲，确保前端事件完全 Binding
    await updateVisualTrackerStatus(page, '⏳ 页面骨架已呈现，正在等待前端事件与数据稳定 (3~8s)...', 'action');
    await humanDelay(page, ...HUMAN_DELAY.SETTLING);

    // 清理可能弹出的常规通知浮层
    await this.dismissNoticeModals(page).catch(() => false);

    await updateVisualTrackerStatus(page, '✅ 页面元素加载完毕，订单监听就绪', 'success');
  }

  public async start(): Promise<void> {
    if (this.running) return;

    this.session = await createPersistentBrowserSession({
      channelCode: this.channelCode,
      headless: process.env[PROCESS_ENV_KEYS.playwrightHeadless] === 'true',
    });

    const page = this.session.page;

    await updateVisualTrackerStatus(page, '🤖 正在打开配置的抖音订单值守页面...', 'action');
    await page.goto(this.targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: getScaledTimeout(DEFAULT_DUTY_TIMING.action.PAGE_NAVIGATION),
    });

    try {
      await page.bringToFront();
    } catch {
      // 忽略前置聚焦失败
    }

    await this.waitForPageReady(page);

    this.running = true;

    await updateVisualTrackerStatus(page, '🛡️ 抖音订单值守已激活，正在复用渠道绑定页面...', 'success');
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        // 忽略关闭异常
      }
      this.session = null;
    }
  }

  /**
   * 等待用户手动关闭浏览器；仅在诊断/验收 CLI 中使用
   */
  public async waitForBrowserClose(): Promise<void> {
    const session = this.session;
    if (!session) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const close = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      session.context.once('close', close);
      session.page.once('close', close);
    });
  }

  /**
   * 获取指定 Tab 标签元素 Locator
   */
  public getTabLocator(page: Page, label: string): Locator {
    return page.locator(
      `.byted-tab-bar-item:has-text("${label}"), ` +
      `div[class*="tab-bar-item"]:has-text("${label}"), ` +
      `div[role="tab"]:has-text("${label}")`
    ).first();
  }

  /**
   * 等待抖音特定列表网络响应
   */
  private async waitForDouyinListResponse(
    page: Page,
    isTargetUrl: (url: string) => boolean,
    phase: string
  ): Promise<Response> {
    if (typeof page.waitForResponse !== 'function') {
      throw new DutyExecutionError('当前页面环境不支持 waitForResponse', 'METHOD_NOT_SUPPORTED', false);
    }

    const observedPaths = new Set<string>();
    const onRequest = (request: Request) => {
      try {
        if (isTargetUrl(request.url())) {
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
        (res) => isTargetUrl(res.url()) && res.request().method() === 'POST',
        { timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }
      );
      if (response.status() !== 200) {
        throw new DutyExecutionError(
          `抖音${phase}列表接口返回 HTTP ${response.status()}: ${response.url()}`,
          DouyinDutyErrorCode.LIST_HTTP_ERROR,
          false
        );
      }
      return response;
    } catch (error) {
      if (error instanceof DutyExecutionError) throw error;
      if (await checkDouyinPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
      const evidence = observedPaths.size
        ? `已观察到请求路径: ${Array.from(observedPaths).join(', ')}`
        : '未观察到目标列表请求';
      throw new DutyExecutionError(
        `抖音${phase}列表响应超时或异常: ${error instanceof Error ? error.message : String(error)}；${evidence}`,
        DouyinDutyErrorCode.LIST_RESPONSE_TIMEOUT,
        true
      );
    } finally {
      if (canObserveRequests) {
        page.off('request', onRequest);
      }
    }
  }

  /**
   * 刷新「新订/变更」列表并返回解析后的新订单概要
   */
  public async refreshBookOrderList(page: Page): Promise<DutyUnhandledOrderSummary[]> {
    if (await checkDouyinPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    await this.dismissNoticeModals(page);

    const tabLocator = this.getTabLocator(page, '新订/变更');
    try {
      await tabLocator.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      if (await checkDouyinPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
      throw new DutyExecutionError(
        `未找到可用的「新订/变更」Tab: ${error instanceof Error ? error.message : String(error)}`,
        DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    await updateVisualTrackerStatus(page, '📥 正在点击「新订/变更」Tab 并等待接口响应...', 'action');
    const responsePromise = this.waitForDouyinListResponse(
      page,
      isDouyinBookOrderListUrl,
      '新订/变更'
    );

    try {
      await tabLocator.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
    } catch (clickErr) {
      if (await this.dismissNoticeModals(page)) {
        await tabLocator.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
      } else {
        throw clickErr;
      }
    }

    const response = await responsePromise;
    const text = await response.text().catch(() => '');
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(text);
    } catch {
      throw new DutyExecutionError(
        '抖音「新订/变更」列表响应非合法 JSON',
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
    if (await checkDouyinPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    await this.dismissNoticeModals(page);

    const tabLocator = this.getTabLocator(page, '取消/退款');
    try {
      await tabLocator.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      if (await checkDouyinPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
      throw new DutyExecutionError(
        `未找到可用的「取消/退款」Tab: ${error instanceof Error ? error.message : String(error)}`,
        DouyinDutyErrorCode.LIST_TRIGGER_UNAVAILABLE,
        false
      );
    }

    await updateVisualTrackerStatus(page, '📥 正在点击「取消/退款」Tab 并等待接口响应...', 'action');
    const responsePromise = this.waitForDouyinListResponse(
      page,
      isDouyinRefundOrderListUrl,
      '取消/退款'
    );

    try {
      await tabLocator.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
    } catch (clickErr) {
      if (await this.dismissNoticeModals(page)) {
        await tabLocator.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
      } else {
        throw clickErr;
      }
    }

    const response = await responsePromise;
    const text = await response.text().catch(() => '');
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(text);
    } catch {
      throw new DutyExecutionError(
        '抖音「取消/退款」列表响应非合法 JSON',
        DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
        false
      );
    }

    return parseDouyinRefundOrderListResponse(parsedPayload);
  }

  /**
   * 刷新抖音指定 Tab 的订单列表（按中台指令严格单 Tab 采集，绝不同时刷新两类 Tab）
   */
  public async refreshOrderList(
    page: Page,
    targetTab: 'book' | 'refund' = 'book'
  ): Promise<DutyUnhandledOrderSummary[]> {
    if (targetTab === 'refund') {
      return await this.refreshRefundOrderList(page);
    }
    return await this.refreshBookOrderList(page);
  }

  /**
   * 页面操作：刷新抖音待处理列表并返回待处理订单概要（权威网络响应为唯一源，带防抖补偿与请求合并）
   * 一次只能采集一个 Tab，绝不交叉采集；支持传入 'book' | 'refund' 或中台 DutyTaskContext
   */
  public async collectUnhandledOrders(
    tabOrContext: 'book' | 'refund' | ParsedDutyTaskContext | Record<string, unknown> = 'book'
  ): Promise<DutyUnhandledOrderSummary[]> {
    const page = this.getActivePage('采集待处理订单');

    if (await checkDouyinPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    let currentTab: 'book' | 'refund' = 'book';
    if (typeof tabOrContext === 'string') {
      currentTab = tabOrContext === 'refund' ? 'refund' : 'book';
    } else if (tabOrContext && typeof tabOrContext === 'object') {
      interface TargetPayload {
        payload?: TargetPayload;
        task?: { msgType?: string };
        tab?: string;
        orderType?: string;
        cancelOrder?: boolean;
        action?: string;
        targetMsgTypes?: unknown;
        [key: string]: unknown;
      }
      const candidate = tabOrContext as TargetPayload;
      const payload = candidate.payload || candidate;
      const task = candidate.task;

      // 依据中台 targetMsgTypes 契约、任务消息类型或显式参数路由至对应 Tab
      const targetMsgTypes = Array.isArray(payload.targetMsgTypes)
        ? (payload.targetMsgTypes as string[])
        : [];
      const isExplicitRefundTarget =
        targetMsgTypes.includes('OTA_CANCEL_ORDER') && !targetMsgTypes.includes('OTA_IMPORT_ORDER');

      const isRefund = Boolean(
        isExplicitRefundTarget ||
        task?.msgType === 'OTA_CONFIRM_CANCEL' ||
        payload?.cancelOrder === true ||
        payload?.action === 'cancel' ||
        payload?.tab === 'refund' ||
        payload?.tab === 'cancel' ||
        payload?.orderType === 'refund' ||
        payload?.orderType === 'cancel'
      );
      currentTab = isRefund ? 'refund' : 'book';
    }

    // 1. 在途请求合并门禁 (按 tab 分流独立合并)：若已有正在刷新的在途 Promise，直接复用其结果
    const existingPromise = this.inFlightListPromises.get(currentTab);
    if (existingPromise) {
      return await existingPromise;
    }

    const promise = (async () => {
      // 2. 3 秒防抖等待补偿：针对当前 Tab 判定是否需要等待
      const now = performance.now();
      const lastTime = this.lastListRefreshTimes.get(currentTab) || 0;
      const elapsed = lastTime > 0 ? now - lastTime : Infinity;
      const debounceThreshold = DEFAULT_DUTY_TIMING.system.REFRESH_DEBOUNCE;
      if (elapsed < debounceThreshold) {
        const remainMs = Math.ceil(debounceThreshold - elapsed);
        await humanDelay(page, remainMs, remainMs + 500);
      }

      // 3. 进入任务互斥锁，执行单页面交互与网络拦截
      return this.runWithMutex(async () => {
        if (await checkDouyinPageRisk(page)) {
          await updateVisualTrackerStatus(page, '⚠️ 抖音提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
          throw new DutyExecutionError(
            '抖音页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
            DouyinDutyErrorCode.RISK_VERIFICATION_REQUIRED,
            false
          );
        }

        const tabLabel = currentTab === 'refund' ? '取消/退款' : '新订/变更';
        await updateVisualTrackerStatus(page, `📥 正在执行订单采集并刷新抖音「${tabLabel}」列表...`, 'action');

        const orders = await this.refreshOrderList(page, currentTab);

        await updateVisualTrackerStatus(
          page,
          `📥 抖音「${tabLabel}」列表已刷新，权威网络接口共解析到 ${orders.length} 笔待处理订单`,
          orders.length > 0 ? 'success' : 'info'
        );

        this.lastListRefreshTimes.set(currentTab, performance.now());
        return orders;
      });
    })().finally(() => {
      this.inFlightListPromises.delete(currentTab);
    });

    this.inFlightListPromises.set(currentTab, promise);
    return await promise;
  }

  public async inspectOrderDetail(otaOrderId: string): Promise<Record<string, unknown>> {
    throw new DutyExecutionError(
      `抖音订单「${otaOrderId}」详情抓取暂未实装`,
      'NOT_IMPLEMENTED',
      false
    );
  }

  public async confirmImport?(confirmNo: string, otaOrderId: string): Promise<void> {
    throw new DutyExecutionError(
      `抖音订单「${otaOrderId}」确认号「${confirmNo}」回填暂未实装`,
      'NOT_IMPLEMENTED',
      false
    );
  }

  public async confirmCancel?(otaOrderId: string): Promise<void> {
    throw new DutyExecutionError(
      `抖音订单「${otaOrderId}」取消确认暂未实装`,
      'NOT_IMPLEMENTED',
      false
    );
  }
}
