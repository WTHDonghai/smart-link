import type { Page, Request, Response, Frame, Locator, FrameLocator } from 'playwright';
import { createPersistentBrowserSession, type BrowserSession } from '../browserManager';
import { updateVisualTrackerStatus, visualClickLocator } from '../visualTracker';
import type { DutyClaimedTask, SystemLogEntry } from '../../types';
import type {
  ChannelDutyRunner,
  DutyTaskExecutionResult,
  DutyUnhandledOrderSummary,
} from './dutyContracts';
import {
  MeituanDutyErrorCode,
  DutyExecutionError,
} from './meituanDutyContracts';
import {
  isMeituanListUrl,
  isMeituanOrderTabListUrl,
  isMeituanDetailUrl,
  isMeituanSensitiveUrl,
  parseMeituanOrderListResponse,
  parseMeituanSensitiveResponse,
  mergeSensitiveDataIntoRawDetail,
} from './meituanOrderParsers';
import { getMeituanOrderUrl } from '../../config/otaUrls';
import { dispatchDutyTask } from './dutyTaskDispatcher';
import { PROCESS_ENV_KEYS } from '../../types/env';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  DEFAULT_DUTY_TIMING,
  getScaledDelayRange,
  getScaledTimeout,
  isProbeVisible,
  isElementVisible,
  isModalVisible,
} from './dutyTimingConfig';

/**
 * 页面级人机验证、滑块与风控拦截嗅探函数（跨顶层与所有子 Frame 深度检测）
 */
export async function checkMeituanPageRisk(page: Page): Promise<boolean> {
  if (!page) return false;
  try {
    // 1. 检查页面 URL 本身是否包含风控/验证重定向
    const pageUrl = typeof page.url === 'function' ? page.url() : '';
    if (pageUrl && /(?:verify|captcha|yoda|secsdk)\.meituan\.com|yoda/i.test(pageUrl)) {
      return true;
    }

    // 2. 检查顶层及所有子 Frame
    const frames = typeof page.frames === 'function' ? page.frames() : [page as unknown as Frame];
    for (const frame of frames) {
      try {
        const frameUrl = frame.url();
        if (frameUrl && /(?:verify|captcha|yoda|secsdk)\.meituan\.com|yoda/i.test(frameUrl)) {
          return true;
        }
      } catch {
        // 忽略跨域或已销毁 frame
      }

      if (typeof frame.evaluate === 'function') {
        const riskFound = await frame.evaluate(() => {
          // A. 检查风控 iframe、容器或滑块 DOM 节点
          const hasCaptchaEl = Boolean(
            document.querySelector(
              'iframe[src*="captcha"], iframe[src*="verify"], iframe[src*="yoda"], iframe[src*="secsdk"], ' +
              '#yodaBox, #yodaContainer, .yoda-captcha, .yoda-dialog, .yoda-modal, [data-test="captcha"], ' +
              '.secsdk-captcha-drag-wrapper, .geetest_holder, #waf_nc_wrapper, .waf-nc-wrapper, ' +
              'div[id*="yoda"], div[class*="yoda"]'
            )
          );
          if (hasCaptchaEl) return true;

          // B. 嗅探页面主体、标题与特征文本
          const norm = (str: string | null | undefined) => String(str || '').replace(/\s+/g, ' ').trim();
          const bodyText = norm(document.body ? document.body.innerText || document.body.textContent : '');
          const title = norm(document.title);
          const url = String(window.location.href || '');
          const combined = `${title}\n${url}\n${bodyText.slice(0, 3000)}`;
          return /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|验证一下|拖动滑块|请完成验证|yoda|captcha|secsdk/i.test(combined);
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
 * 拟真人随机延迟函数，以毫秒为单位（默认 3000~8000 毫秒），确保接口调用完毕并规避风控
 * @param page Playwright Page
 * @param minMs 最小等待毫秒数
 * @param maxMs 最大等待毫秒数
 */
export async function humanDelay(
  page: Page,
  minMs: number = HUMAN_DELAY.SETTLING[0],
  maxMs: number = HUMAN_DELAY.SETTLING[1]
): Promise<void> {
  const [scaledMin, scaledMax] = getScaledDelayRange(minMs, maxMs);
  const delay = Math.floor(Math.random() * Math.max(1, scaledMax - scaledMin + 1)) + scaledMin;
  if (page && typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(delay);
  } else {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * 自动检测并安全关闭美团后台提示性通知弹窗（如“联系客人”虚拟号说明、商家规则须知、系统公告等）
 * 严格避让核心业务弹窗（接单确认号填报）与安全风控验证弹窗。
 *
 * @param page Playwright Page
 * @param preferredScope 优先探查的作用域（通常为 iframe scope 或顶层 page）
 * @returns 是否成功关闭了至少一个提示弹窗
 */
export async function dismissMeituanNoticeModals(
  page: Page,
  preferredScope?: Page | FrameLocator
): Promise<boolean> {
  if (!page) return false;

  const scopes: (Page | FrameLocator)[] = [];
  if (preferredScope) {
    scopes.push(preferredScope);
  }
  if (!scopes.includes(page)) {
    scopes.push(page);
  }

  let dismissedAny = false;

  for (const scope of scopes) {
    if (!scope || typeof scope.locator !== 'function') continue;

    // 支持连续关闭可能叠加的多层通知公告弹窗（最多尝试 3 次）
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const modalWrappers = scope.locator('.mtd-modal-wrapper, .mtd-modal');
        const count = typeof modalWrappers.count === 'function'
          ? await modalWrappers.count().catch(() => 0)
          : 1;

        if (count === 0) break;

        let dismissedInThisAttempt = false;

        for (let i = 0; i < count; i++) {
          const modal = typeof modalWrappers.nth === 'function'
            ? modalWrappers.nth(i)
            : modalWrappers;

          const isVisible = await isProbeVisible(modal, ACTION_TIMEOUT.FAST_PROBE);
          if (!isVisible) continue;

          const modalText = await modal.innerText().catch(() => '');

          // 核心安全红线 1：严禁关闭接单确认号弹窗与业务输入弹窗
          if (modalText.includes('酒店确认号') || modalText.includes('确认接受')) {
            continue;
          }

          // 核心安全红线 2：严禁关闭安全风控/滑块弹窗（由专用风控嗅探器接管）
          if (/安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|yoda|captcha|secsdk/i.test(modalText)) {
            continue;
          }

          // 核心安全红线 3：严禁关闭危险业务决策弹窗（取消订单/拒绝接单/退款审核等）
          if (/确认取消|确认拒绝|拒绝接单|退款审核/i.test(modalText)) {
            continue;
          }

          // 寻找符合白名单的知晓/关闭按钮
          const dismissBtn = modal.locator(
            'button:has-text("我知道了"), ' +
            'button:has-text("知道了"), ' +
            'button:has-text("我已阅读"), ' +
            'button:has-text("确定"), ' +
            'button:has-text("确认"), ' +
            'button:has-text("关闭"), ' +
            '.mtd-btn:has-text("我知道了"), ' +
            '.mtd-btn:has-text("知道了"), ' +
            '.mtd-btn:has-text("确定"), ' +
            '.mtd-btn:has-text("确认"), ' +
            '.mtd-btn:has-text("关闭"), ' +
            ':text-is("我知道了"), ' +
            ':text-is("知道了"), ' +
            '.mtd-modal-close, ' +
            '[class*="modal-close"]'
          ).first();

          const btnVisible = await isProbeVisible(dismissBtn, ACTION_TIMEOUT.FAST_PROBE);
          if (!btnVisible) {
            continue;
          }

          const title = (await modal.locator('.mtd-modal-title').innerText().catch(() => '')) || '通知公告';
          await updateVisualTrackerStatus(page, `🛡️ 检测到提示弹窗「${title.trim()}」，已自动关闭以恢复操作`, 'action');

          await dismissBtn.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.SENSITIVE_FIELD) }).catch(() => {});
          await modal.waitFor({ state: 'hidden', timeout: getScaledTimeout(ACTION_TIMEOUT.ELEMENT) }).catch(() => {});
          dismissedAny = true;
          dismissedInThisAttempt = true;
          // 一旦成功关闭一个可见弹窗，跳出内层遍历重新扫描，防止 DOM 列表索引变化
          break;
        }

        if (!dismissedInThisAttempt) {
          // 当前轮次未发现任何可关闭的可见通知弹窗，结束外层尝试
          break;
        }
      } catch {
        break;
      }
    }
  }

  return dismissedAny;
}



export class MeituanDutyRunner implements ChannelDutyRunner {
  public readonly channelCode = 'MEITUAN';
  private session: BrowserSession | null = null;
  private running = false;
  private explicitTargetUrl?: string;
  private lastListRefreshTime = 0;
  public confirmImportEnabled = true;

  // 在途请求合并门禁 (In-flight Promise Coalescing)
  private inFlightListPromise: Promise<DutyUnhandledOrderSummary[]> | null = null;

  // 任务互斥锁 (Task Mutex Lock) 保证单页面交互操作串行化
  private taskMutex: Promise<void> = Promise.resolve();

  constructor(targetUrl?: string) {
    if (targetUrl && targetUrl.trim()) {
      this.explicitTargetUrl = targetUrl.trim();
    }
  }

  public setConfirmImportEnabled(enabled: boolean): void {
    this.confirmImportEnabled = Boolean(enabled);
  }

  public get targetUrl(): string {
    return this.explicitTargetUrl || getMeituanOrderUrl();
  }

  private getOrderScope(page: Page) {
    if (typeof page.url === 'function' && page.url().includes('/ebooking/merchant/ebIframe')) {
      return page.frameLocator('#me-iframe-container');
    }
    return page;
  }

  /**
   * 自动探测并清理非业务通知类阻挡弹窗（如“联系客人”等）
   */
  private async dismissNoticeModals(page: Page): Promise<boolean> {
    return dismissMeituanNoticeModals(page, this.getOrderScope(page));
  }

  public isRunning(): boolean {
    return this.running;
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
        `美团值守执行器未运行，无法${operation}`,
        'RUNNER_NOT_RUNNING',
        false
      );
    }
    if (this.session.page.isClosed?.()) {
      throw new DutyExecutionError(
        `美团浏览器页面已关闭，无法${operation}`,
        MeituanDutyErrorCode.TARGET_PAGE_NOT_READY,
        false
      );
    }
    return this.session.page;
  }

  /**
   * 页面就绪门禁：等待商户后台骨架与核心容器挂载，并执行冷启动沉淀缓冲 (3~8 秒)
   */
  public async waitForPageReady(page: Page, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_DUTY_TIMING.action.PAGE_CONTAINER_READY;

    if (await checkMeituanPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    await updateVisualTrackerStatus(page, '⏳ 正在等待商户后台骨架与元素加载就绪...', 'action');

    const scope = this.getOrderScope(page);
    // 探测商户后台 iframe、Tab 容器或主列表骨架
    const coreContainer = scope.locator(
      '#me-iframe-container, .tab-container, .mtd-tabs-item, .mtd-list-item, .detail-container, body'
    ).first();

    try {
      if (typeof coreContainer?.waitFor === 'function') {
        await coreContainer.waitFor({ state: 'attached', timeout: getScaledTimeout(timeout) });
      }
    } catch (error) {
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
      throw new DutyExecutionError(
        `美团商家后台页面元素加载超时 (${timeout}ms): ${error instanceof Error ? error.message : String(error)}`,
        MeituanDutyErrorCode.TARGET_PAGE_NOT_READY,
        true
      );
    }

    // 冷启动沉淀缓冲 (Settling Delay)：3 秒到 8 秒拟人随机缓冲，确保 Vue/React 事件完全 Binding
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

    await updateVisualTrackerStatus(page, '🤖 正在导航至美团商家后台待处理订单页面...', 'action');
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    const isAlreadyAtTarget = Boolean(
      currentUrl && (currentUrl.includes('dealorder') || currentUrl.includes(this.targetUrl))
    );
    if (!isAlreadyAtTarget) {
      await page.goto(this.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: getScaledTimeout(DEFAULT_DUTY_TIMING.action.PAGE_NAVIGATION),
      });
    }
    try {
      await page.bringToFront();
    } catch {
      // 忽略前置聚焦失败
    }

    // 页面就绪门禁：等待核心骨架挂载与 3-8s 沉淀缓冲，确保后续任务不会因过早定位点击而失败
    await this.waitForPageReady(page);

    this.running = true;

    await updateVisualTrackerStatus(page, '🛡️ 美团订单值守已激活，正在复用渠道绑定页面...', 'success');
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
   * 页面操作：刷新美团待处理列表并返回待处理订单概要（权威网络响应为唯一源，带防抖补偿与请求合并）
   */
  public async collectUnhandledOrders(): Promise<DutyUnhandledOrderSummary[]> {
    const page = this.getActivePage('采集待处理订单');

    if (await checkMeituanPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    // 1. 在途请求合并门禁 (Request Coalescing)：若已有正在刷新的在途 Promise，直接复用其结果
    if (this.inFlightListPromise) {
      return await this.inFlightListPromise;
    }

    this.inFlightListPromise = (async () => {
      // 1. 3 秒防抖等待补偿：若距离上次刷新不足 REFRESH_DEBOUNCE，等待补齐延迟后再触发交互，绝不直接返回空数组！
      // 采用高精度单调时钟 performance.now()，彻底防御 NTP 校时与系统时钟跳变风险
      const now = performance.now();
      const elapsed = this.lastListRefreshTime > 0 ? now - this.lastListRefreshTime : Infinity;
      const debounceThreshold = DEFAULT_DUTY_TIMING.system.REFRESH_DEBOUNCE;
      if (elapsed < debounceThreshold) {
        const remainMs = Math.ceil(debounceThreshold - elapsed);
        await humanDelay(page, remainMs, remainMs + 500);
      }

      // 2. 进入任务互斥锁，执行单页面交互与网络拦截
      return this.runWithMutex(async () => {
        if (await checkMeituanPageRisk(page)) {
          await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
          throw new DutyExecutionError(
            '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
            MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
            false
          );
        }

        await updateVisualTrackerStatus(page, '📥 正在执行订单采集并刷新待确认订单列表...', 'action');

        // 3. 通过受控 Tab 切换触发刷新，并等待最终的待确认列表响应
        const listResponse = await this.refreshOrderList(page);
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

        // 4. 记录权威网络响应成功时间 (Fail-Fast: 绝无 DOM 拼接兜底！)
        this.lastListRefreshTime = performance.now();
        return orders;
      });
    })().finally(() => {
      this.inFlightListPromise = null;
    });

    return await this.inFlightListPromise;
  }

  /**
   * 通过受控 Tab 切换刷新列表，并返回最终的待确认订单列表响应
   * @param page Playwright Page
   */
  public async refreshOrderList(page: Page): Promise<Response> {
    if (await checkMeituanPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    // 动作前置浮层清理：自动排除并关闭阻塞 Tab 点击的非业务提示弹窗（如“联系客人”等）
    await this.dismissNoticeModals(page);

    const getTab = (label: string, active = false) => this
      .getOrderScope(page)
      .locator(`.tab-container .mtd-tabs-item${active ? '.mtd-tab-active' : ''}:has-text("${label}")`);

    const pendingTab = getTab('待确认订单');

    try {
      await pendingTab.waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
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
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
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
      const pendingResponse = this.waitForMeituanListResponse(page, '待确认订单最终列表');
      await this.dismissNoticeModals(page);
      try {
        await pendingTab.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
      } catch (clickErr) {
        if (await this.dismissNoticeModals(page)) {
          await pendingTab.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
        } else {
          throw clickErr;
        }
      }
      const response = await pendingResponse;
      await getTab('待确认订单', true).waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }).catch(async () => {
        if (await checkMeituanPageRisk(page)) {
          await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
          throw new DutyExecutionError(
            '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
            MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
            false
          );
        }
      });
      return response;
    }

    await updateVisualTrackerStatus(page, '📥 正在通过「全部订单」刷新待确认列表...', 'action');
    // 只作为前一列表的生命周期屏障；不读取、不解析该响应。
    const allOrdersResponse = this.waitForMeituanListResponse(page, '全部订单切换屏障', true);
    await this.dismissNoticeModals(page);
    try {
      await allOrdersTab.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
    } catch (clickErr) {
      if (await this.dismissNoticeModals(page)) {
        await allOrdersTab.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
      } else {
        throw clickErr;
      }
    }
    try {
      await getTab('全部订单', true).waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) });
    } catch (error) {
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
      // 容错类名变体（如 mtd-tabs-item-active），等待网络响应即可
    }
    await allOrdersResponse;
    await humanDelay(page, ...HUMAN_DELAY.SHORT);

    // 仅在最终触发待确认列表前挂响应监听，避免消费“全部订单”请求。
    const pendingResponse = this.waitForMeituanListResponse(page, '待确认订单最终列表');
    await this.dismissNoticeModals(page);
    try {
      await pendingTab.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
    } catch (clickErr) {
      if (await this.dismissNoticeModals(page)) {
        await pendingTab.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.CLICK) });
      } else {
        throw clickErr;
      }
    }
    const response = await pendingResponse;
    await getTab('待确认订单', true).waitFor({ state: 'visible', timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }).catch(async () => {
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
    });
    return response;
  }

  private async waitForMeituanListResponse(
    page: Page,
    phase: string,
    acceptAllOrdersList = false
  ): Promise<Response> {
    if (typeof page.waitForResponse !== 'function') {
      throw new DutyExecutionError('当前页面环境不支持 waitForResponse', 'METHOD_NOT_SUPPORTED', false);
    }

    const observedPaths = new Set<string>();
    const isTargetListUrl = (url: string) =>
      acceptAllOrdersList ? isMeituanOrderTabListUrl(url) : isMeituanListUrl(url);
    const onRequest = (request: Request) => {
      try {
        if (isTargetListUrl(request.url())) {
          observedPaths.add(new URL(request.url()).pathname);
        }
      } catch {
        // 无效 URL 不参与诊断。
      }
    };
    const canObserveRequests = typeof page.on === 'function' && typeof page.off === 'function';
    if (canObserveRequests) {
      page.on('request', onRequest);
    }

    try {
      const response = await page.waitForResponse(
        (res) => (acceptAllOrdersList ? isMeituanOrderTabListUrl(res.url()) : isMeituanListUrl(res.url())),
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
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }
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
   * 在美团商户后台列表中精确定位目标订单卡片
   * 兼容美团真实 DOM 特征（左侧列表卡片不含订单号文本，订单号展示于右侧详情面板中）
   */
  private async locateOrderCard(
    page: Page,
    scope: Page | ReturnType<Page['frameLocator']>,
    otaOrderId: string
  ): Promise<Locator | null> {
    const items = scope.locator(
      '.mtd-list-item.list-item-container, .list-item-container, .list-item-wrap, tr.order-row'
    );
    const count = typeof items.count === 'function' ? await items.count().catch(() => 0) : 0;
    // 列表中有多笔订单：逐个点击候选卡片探查右侧详情是否与目标订单号匹配
    if (count > 0 && typeof items.nth === 'function') {
      await dismissMeituanNoticeModals(page, scope);
      for (let i = 0; i < count; i++) {
        const candidate = items.nth(i);
        if (!await isElementVisible(candidate)) continue;
        await candidate.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.QUICK_ACTION) }).catch(() => {});
        await humanDelay(page, ...HUMAN_DELAY.MEDIUM);

        const matches = await isProbeVisible(
          scope
            .locator(
              `.detail-container:has-text("${otaOrderId}"), ` +
              `.right-content:has-text("${otaOrderId}"), ` +
              `.order-detail:has-text("${otaOrderId}"), ` +
              `.detail-header:has-text("${otaOrderId}")`
            )
            .first()
        );

        if (matches) {
          return candidate;
        }
      }
    }
    return null;
  }

  /**
   * 页面操作：在美团后台页面定位订单卡片并内联展开/点击，抓取详情原始数据（回写明文客人姓名）
   * 前置条件：待确认订单列表就绪（通过 refreshOrderList 刷新确保停留在「待确认订单」Tab 且渲染最新 DOM）
   * 遵循 Fail-Fast 原则：100% 权威网络接口为源，智能跳过电话解密，只返回原始数据，零 DOM 业务数据拼接！
   */
  public async inspectOrderDetail(otaOrderId: string): Promise<Record<string, unknown>> {
    const page = this.getActivePage('查看订单详情');

    if (await checkMeituanPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    return this.runWithMutex(async () => {
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }

      await updateVisualTrackerStatus(page, `🔍 正在定位订单「${otaOrderId}」卡片并展示详情...`, 'action');

      const scope = this.getOrderScope(page);

      // 1. 前置就绪校验：若订单卡片未在当前页面直接可见，先执行待确认列表刷新确保停留在「待确认订单」Tab 且渲染最新列表
      let orderCard = await this.locateOrderCard(page, scope, otaOrderId);

      if (!orderCard) {
        await updateVisualTrackerStatus(page, `🔄 待确认列表中未直接发现订单「${otaOrderId}」，正在刷新待确认列表...`, 'action');
        await this.refreshOrderList(page);
        await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
        orderCard = await this.locateOrderCard(page, scope, otaOrderId);
      }

      if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
        if (await checkMeituanPageRisk(page)) {
          await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
          throw new DutyExecutionError(
            '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
            MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
            false
          );
        }
        throw new DutyExecutionError(
          `待确认列表中未找到美团订单「${otaOrderId}」卡片，订单可能已被处理或取消`,
          MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND,
          false
        );
      }

      // 2. 挂载本次查看详情专属的单次网络响应监听
      const capturedRef: {
        rawDetail: unknown | null;
        sensitive: { guestName?: string; guestMobile?: string } | null;
      } = {
        rawDetail: null,
        sensitive: null,
      };

      const onResponse = async (res: { url: () => string; status: () => number; text: () => Promise<string> }) => {
        try {
          const url = res.url();
          if (res.status() === 200) {
            if (isMeituanDetailUrl(url, otaOrderId)) {
              const text = await res.text().catch(() => '');
              if (text) {
                try {
                  capturedRef.rawDetail = JSON.parse(text);
                } catch {
                  // 忽略非合法 JSON
                }
              }
            } else if (isMeituanSensitiveUrl(url)) {
              const text = await res.text().catch(() => '');
              if (text) {
                try {
                  const parsed = JSON.parse(text);
                  const sensitive = parseMeituanSensitiveResponse(parsed);
                  if (sensitive) {
                    capturedRef.sensitive = {
                      guestName: sensitive.guestName || capturedRef.sensitive?.guestName,
                      guestMobile: sensitive.guestMobile || capturedRef.sensitive?.guestMobile,
                    };
                  }
                } catch {
                  // 忽略非合法 JSON
                }
              }
            }
          }
        } catch {
          // 忽略响应监听内解析异常
        }
      };

      const onFn = (page as { on?: (event: string, handler: typeof onResponse) => void }).on;
      const offFn = (page as { off?: (event: string, handler: typeof onResponse) => void }).off;
      const removeListenerFn = (
        page as { removeListener?: (event: string, handler: typeof onResponse) => void }
      ).removeListener;

      if (typeof onFn === 'function') {
        onFn.call(page, 'response', onResponse);
      }

      const detailResponsePromise = typeof page.waitForResponse === 'function'
        ? page
            .waitForResponse(
              (res) => isMeituanDetailUrl(res.url(), otaOrderId) && res.status() === 200,
              { timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }
            )
            .then(async (res) => {
              try {
                const text = await res.text();
                return JSON.parse(text);
              } catch {
                return null;
              }
            })
            .catch(() => null)
        : Promise.resolve(null);

      try {
        // 3. 点击订单卡片触发右侧详情展示与网络拦截（美团真实 DOM 中左侧卡片为整体可点击项，无独立“详情”按钮）
        await visualClickLocator(page, orderCard, `点击订单「${otaOrderId}」卡片展示详情`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);

        // 4. 姓名脱敏解除交互（基于美团详情页真实 DOM 结构精准定位，无二次确认弹窗）
        // 真实 DOM 结构:
        // <p class="detail-info-item">
        //   <span class="info-key">客人姓名</span>
        //   <span class="info-content">
        //     <span class="guest-name">
        //       <span class="display-name">王***</span>
        //       <span class="btn-text" style="cursor: pointer;">查看姓名</span>
        //     </span>
        //   </span>
        // </p>
        try {
          const revealNameBtn = scope.locator(
            '.detail-info-item .guest-name .btn-text, ' +
            '.guest-name .btn-text, ' +
            '.display-name + .btn-text, ' +
            'p.detail-info-item:has(.info-key:has-text("客人姓名")) .btn-text, ' +
            'p.detail-info-item:has(.info-key:has-text("客人姓名")) span.btn-text, ' +
            '.guest-name [class*="btn"], ' +
            '[data-test="reveal-guest-name"], .reveal-name-btn'
          ).first();

          if (await isElementVisible(revealNameBtn, ACTION_TIMEOUT.SENSITIVE_FIELD)) {
            await visualClickLocator(page, revealNameBtn, '点击查看真实客人姓名');
            await humanDelay(page, ...HUMAN_DELAY.SENSITIVE_REVEAL);
          }
        } catch {
          // 容错姓名脱敏交互
        }

        // 5. 智能跳过电话解密 (Smart Skip Phone Privacy)
        // 若姓名解密报文或原始详情已同步包含明文手机号，强制跳过点击“查看电话”，规避 1 秒双重敏感解密风控！
        const rawPayloadTemp = (capturedRef.rawDetail || {}) as Record<string, unknown>;
        const rawDataObj = ((rawPayloadTemp.data && typeof rawPayloadTemp.data === 'object')
          ? ((rawPayloadTemp.data as Record<string, unknown>).orderDetail ||
             (rawPayloadTemp.data as Record<string, unknown>).order ||
             rawPayloadTemp.data)
          : rawPayloadTemp) as Record<string, unknown>;
        const rawMobile = String(rawDataObj.guestMobile || rawDataObj.phone || rawDataObj.mobile || '');
        const resolvedPhone = Boolean(
          (capturedRef.sensitive?.guestMobile && !capturedRef.sensitive.guestMobile.includes('*')) ||
          (rawMobile && !rawMobile.includes('*'))
        );

        if (!resolvedPhone) {
          try {
            // 真实 DOM 结构: p.detail-info-item:has(.info-key:has-text("联系客人")) a[href="javascript:;"]
            const revealPhoneBtn = scope.locator(
              'p.detail-info-item:has(.info-key:has-text("联系客人")) a, ' +
              '.detail-info-item:has(.info-key:has-text("联系客人")) a, ' +
              '.detail-info-item:has(.info-key:has-text("联系客人")) [class*="btn"], ' +
              '[data-test="reveal-guest-phone"]'
            ).first();

            if (await isElementVisible(revealPhoneBtn, ACTION_TIMEOUT.SENSITIVE_FIELD)) {
              await visualClickLocator(page, revealPhoneBtn, '点击查看真实联系电话');
              await humanDelay(page, ...HUMAN_DELAY.SENSITIVE_REVEAL);
              // 关键保障：点击“联系客人”展示电话后，美团常弹出“联系客人（虚拟号说明）”提示弹窗，立即关闭以防遮挡
              await this.dismissNoticeModals(page).catch(() => false);
            }
          } catch {
            // 容错电话解密交互
          }
        }

        // 6. 等待网络详情拦截 (100% 权威网络源，零 DOM 业务数据拼接)
        const rawDetail = (await detailResponsePromise) || capturedRef.rawDetail;
        if (!rawDetail) {
          if (await checkMeituanPageRisk(page)) {
            await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
            throw new DutyExecutionError(
              '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
              MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
              false
            );
          }
          throw new DutyExecutionError(
            `美团订单「${otaOrderId}」详情接口网络响应超时`,
            MeituanDutyErrorCode.ORDER_DETAIL_TIMEOUT,
            true
          );
        }

        // 7. 将解密敏感信息（明文客人姓名/电话）融合回原始报文，直接返回原始数据（由解析器统一解析转换）
        const mergedRaw = mergeSensitiveDataIntoRawDetail(rawDetail, capturedRef.sensitive);
        return mergedRaw as Record<string, unknown>;
      } finally {
        if (typeof offFn === 'function') {
          offFn.call(page, 'response', onResponse);
        } else if (typeof removeListenerFn === 'function') {
          removeListenerFn.call(page, 'response', onResponse);
        }
        // 确保本次订单详情查看完毕后清理任何残留的非业务提示弹窗
        await this.dismissNoticeModals(page).catch(() => false);
      }
    });
  }

  /**
   * 页面操作：在美团后台回填确认号（基于订单卡片/详情内联交互，防串单严格校验）
   */
  public async confirmImport(confirmNo: string, otaOrderId: string): Promise<void> {
    if (!this.confirmImportEnabled) {
      throw new DutyExecutionError(
        '已关闭订单确认号回填开关，禁止在渠道后台执行确认号回填（开发调试保护模式）',
        'CONFIRM_IMPORT_DISABLED',
        false
      );
    }

    const page = this.getActivePage('回填确认号');

    if (await checkMeituanPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new DutyExecutionError(
        '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
        MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
        false
      );
    }

    const cleanConfirmNo = String(confirmNo || '').trim();
    if (!cleanConfirmNo) {
      throw new DutyExecutionError('确认号不能为空', MeituanDutyErrorCode.CONFIRM_INPUT_NOT_FOUND, false);
    }

    return this.runWithMutex(async () => {
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new DutyExecutionError(
          '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
          MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
          false
        );
      }

      await updateVisualTrackerStatus(page, `📝 正在订单「${otaOrderId}」卡片内回填确认号「${cleanConfirmNo}」...`, 'action');

      const scope = this.getOrderScope(page);

      // 1. 定位目标订单卡片，若不可见先刷新待确认列表
      let orderCard = await this.locateOrderCard(page, scope, otaOrderId);
      if (!orderCard) {
        await this.refreshOrderList(page);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
        orderCard = await this.locateOrderCard(page, scope, otaOrderId);
      }

      if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
        if (await checkMeituanPageRisk(page)) {
          await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
          throw new DutyExecutionError(
            '美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证',
            MeituanDutyErrorCode.RISK_VERIFICATION_REQUIRED,
            false
          );
        }
        throw new DutyExecutionError(
          `未找到美团订单「${otaOrderId}」卡片，无法回填确认号`,
          MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND,
          false
        );
      }

      // 2. 确保右侧详情已就绪展示该订单；若未展示，点击卡片切换详情
      const isCurrentDetail = await isProbeVisible(
        scope.locator(`.detail-header:has-text("${otaOrderId}")`).first()
      );
      if (!isCurrentDetail) {
        await visualClickLocator(page, orderCard, `点击订单「${otaOrderId}」卡片激活详情展示`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
      }

      // 3. 定位详情头部「接受」接单操作按钮并点击，触发展开模态确认对话框
      // 真实 DOM 结构:
      // <div class="detail-container">
      //   <div class="detail-header">
      //     <div class="header-container">
      //       <div class="btn-wrap">
      //         <div class="btn-container">
      //           <button type="button" class="mtd-btn op-btn mtd-btn-primary"><span> 接受 </span></button>
      //         </div>
      //       </div>
      //     </div>
      //   </div>
      // </div>
      const acceptBtn = scope.locator(
        '.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受"), ' +
        '.detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受"), ' +
        '.btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受")'
      ).first();

      if (!await isElementVisible(acceptBtn)) {
        throw new DutyExecutionError(
          `订单「${otaOrderId}」未找到「接受」接单操作按钮`,
          MeituanDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
          false
        );
      }

      await visualClickLocator(page, acceptBtn, `点击订单「${otaOrderId}」接受按钮弹出确认回填框`);
      await humanDelay(page, ...HUMAN_DELAY.SHORT);

      // 4. 等待并严格限定「确认号回填」模态弹窗（必须包含“酒店确认号”，杜绝匹配到页面其他业务弹窗）
      // 真实 DOM 结构:
      // <div class="mtd-modal-wrapper mtd-modal-center">
      //   <div class="mtd-modal">
      //     <div class="mtd-modal-content">
      //       <div class="modal-container">
      //         <div class="modal-container-content">
      //           <div style="margin-left: 18px;">
      //             <span>酒店确认号：</span>
      //             <div data-v-3fd065c0="" class="mtd-input-wrapper"><input type="text" placeholder="非必填" class="mtd-input"></div>
      //             <span class="text-accent">多确认号，用“,”隔开</span>
      //           </div>
      //         </div>
      //         <div class="modal-container-footer">
      //           <div class="btn-group">
      //             <button type="button" class="mtd-btn btn-item"><span>取消</span></button>
      //             <button data-v-3fd065c0="" type="button" class="mtd-btn btn-item mtd-btn-primary"><span> 确认接受 </span></button>
      //           </div>
      //         </div>
      //       </div>
      //     </div>
      //   </div>
      // </div>
      const dialog = scope.locator(
        '.mtd-modal-wrapper:not([style*="display: none"]) .modal-container:has-text("酒店确认号"), ' +
        '.modal-container:has-text("酒店确认号")'
      ).first();

      if (!await isModalVisible(dialog)) {
        throw new DutyExecutionError(
          `订单「${otaOrderId}」未弹出或未找到「酒店确认号」接单弹窗`,
          MeituanDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
          false
        );
      }

      // 5. 严格限定在接单弹窗内部定位「酒店确认号」输入框，执行防串单校验与读回校验
      const targetInput = dialog.locator(
        '.modal-container-content div:has(span:has-text("酒店确认号")) input.mtd-input, ' +
        '.modal-container-content input.mtd-input'
      ).first();

      if (!await isElementVisible(targetInput)) {
        throw new DutyExecutionError(
          `订单「${otaOrderId}」接单弹窗内未找到酒店确认号输入框`,
          MeituanDutyErrorCode.CONFIRM_INPUT_NOT_FOUND,
          false
        );
      }

      const currentValue = (await targetInput.inputValue().catch(() => '')).trim();
      if (currentValue && currentValue !== cleanConfirmNo) {
        throw new DutyExecutionError(
          `订单「${otaOrderId}」输入框已存在其他确认号「${currentValue}」，系统已停止覆盖以防串单`,
          MeituanDutyErrorCode.CONFIRM_INPUT_ALREADY_FILLED,
          false
        );
      }

      if (currentValue !== cleanConfirmNo) {
        if (typeof targetInput.pressSequentially === 'function') {
          await targetInput.click().catch(() => {});
          await targetInput.pressSequentially(cleanConfirmNo, {
            delay: 35 + Math.floor(Math.random() * 40),
          });
        } else {
          await targetInput.fill(cleanConfirmNo);
        }
        const readBack = (await targetInput.inputValue().catch(() => '')).trim();
        if (readBack !== cleanConfirmNo) {
          throw new DutyExecutionError(
            `订单「${otaOrderId}」确认号填入后读回校验不一致 (写入: ${cleanConfirmNo}, 读回: ${readBack})`,
            MeituanDutyErrorCode.CONFIRM_VALUE_MISMATCH,
            false
          );
        }
      }

      // 6. 严格限定在接单弹窗底部（.modal-container-footer）定位「确认接受」按钮并点击，杜绝误触其他弹窗
      const dialogConfirmBtn = dialog.locator(
        '.modal-container-footer button.mtd-btn.btn-item.mtd-btn-primary:has-text("确认接受")'
      ).first();

      if (!await isElementVisible(dialogConfirmBtn)) {
        throw new DutyExecutionError(
          `订单「${otaOrderId}」接单弹窗内未找到「确认接受」操作按钮`,
          MeituanDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
          false
        );
      }

      await visualClickLocator(page, dialogConfirmBtn, `点击弹窗「确认接受」按钮确认订单「${otaOrderId}」`);
      await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
    });
  }

  /**
   * 页面操作：在美团后台确认取消（我已知晓）
   */
  public async confirmCancel(otaOrderId: string): Promise<void> {
    if (!otaOrderId || !otaOrderId.trim()) {
      throw new DutyExecutionError('otaOrderId 不能为空', MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND, false);
    }
    const cleanOrderId = otaOrderId.trim();
    const page = this.getActivePage('确认取消');

    return this.runWithMutex(async () => {
      await updateVisualTrackerStatus(page, `🛑 在美团后台确认取消订单「${cleanOrderId}」（我已知晓）...`, 'action');
      const scope = this.getOrderScope(page);

      // 1. 定位订单卡片
      let orderCard = await this.locateOrderCard(page, scope, cleanOrderId);
      if (!orderCard) {
        await this.refreshOrderList(page);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
        orderCard = await this.locateOrderCard(page, scope, cleanOrderId);
      }

      if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
        throw new DutyExecutionError(
          `未在美团订单列表中找到已取消订单「${cleanOrderId}」卡片`,
          MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND,
          true
        );
      }

      // 2. 检查右侧详情是否已就绪展示该订单；若未展示，点击卡片切换详情
      const isCurrentDetail = await isProbeVisible(
        scope.locator(`.detail-header:has-text("${cleanOrderId}")`).first()
      );
      if (!isCurrentDetail) {
        await visualClickLocator(page, orderCard, `点击订单「${cleanOrderId}」卡片激活详情展示`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
      }

      // 3. 定位详情头部操作按钮区域中的「我已知晓」按钮
      // DOM 结构层级: .detail-container -> .detail-header -> .btn-wrap -> .btn-container -> button.mtd-btn.op-btn.mtd-btn-primary
      // 样式类: mtd-btn op-btn mtd-btn-primary
      // 文本: 我已知晓
      const ackBtn = scope.locator(
        '.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓"), ' +
        '.detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓"), ' +
        '.btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓")'
      ).first();

      if (!await isElementVisible(ackBtn)) {
        throw new DutyExecutionError(
          `订单「${cleanOrderId}」详情头部未找到「我已知晓」确认取消操作按钮`,
          MeituanDutyErrorCode.CONFIRM_SUBMIT_NOT_FOUND,
          false
        );
      }

      // 4. 点击「我已知晓」执行取消确认
      await visualClickLocator(page, ackBtn, `点击「我已知晓」按钮确认取消订单「${cleanOrderId}」`);
      await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
    });
  }

  /**
   * 统一任务执行入口：将任务委托给顶层通用任务编排调度器 dispatchDutyTask
   */
  public async executeTask(
    task: DutyClaimedTask,
    onLog?: (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => void
  ): Promise<DutyTaskExecutionResult> {
    return dispatchDutyTask(task, this, onLog, { confirmImportEnabled: this.confirmImportEnabled });
  }
}
