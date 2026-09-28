import type { Page, Response } from 'playwright';
import { createPersistentBrowserSession } from '@/src/crawler/browserManager';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import {
  BaseChannelDutyRunner,
  type DutyUnhandledOrderSummary,
  type DutyActionDryRunOptions,
  type DutyActionVerificationResult,
} from '../../dutyContracts';
import {
  MeituanDutyErrorCode,
  DutyExecutionError,
} from './meituanDutyContracts';
import { getMeituanOrderUrl } from '@/src/config/otaUrls';
import { PROCESS_ENV_KEYS } from '@/src/types/env';
import {
  HUMAN_DELAY,
  DEFAULT_DUTY_TIMING,
  humanDelay,
  getScaledTimeout,
} from '../../dutyTimingConfig';
import { checkMeituanPageRisk, assertNoMeituanPageRisk } from './meituanRiskGuard';
import { dismissMeituanNoticeModals } from './meituanModalGuard';
import { getMeituanOrderScope } from './meituanCardLocator';
import { MeituanListCollector } from './meituanListCollector';
import { MeituanDetailInspector } from './meituanDetailInspector';
import { MeituanActionExecutor } from './meituanActionExecutor';

export { checkMeituanPageRisk, assertNoMeituanPageRisk, dismissMeituanNoticeModals, humanDelay };

/**
 * 美团外卖/酒旅商家后台自动化值守执行器 (门面模式)
 * 聚合协调列表采集、详情解密、接单回填与取消确认等领域子处理器
 */
export class MeituanDutyRunner extends BaseChannelDutyRunner {
  public readonly channelCode = 'MEITUAN';

  private readonly listCollector = new MeituanListCollector();
  private readonly detailInspector = new MeituanDetailInspector();
  private readonly actionExecutor = new MeituanActionExecutor();

  constructor(targetUrl?: string) {
    super(targetUrl);
  }

  public get targetUrl(): string {
    return this.explicitTargetUrl || getMeituanOrderUrl();
  }

  private async dismissNoticeModals(page: Page): Promise<boolean> {
    return dismissMeituanNoticeModals(page, getMeituanOrderScope(page));
  }

  /**
   * 页面就绪门禁：等待商户后台骨架与核心容器挂载，并执行冷启动沉淀缓冲 (3~8 秒)
   */
  public async waitForPageReady(page: Page, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_DUTY_TIMING.action.PAGE_CONTAINER_READY;

    await assertNoMeituanPageRisk(page);

    await updateVisualTrackerStatus(page, '⏳ 正在等待商户后台骨架与元素加载就绪...', 'action');

    const scope = getMeituanOrderScope(page);
    // 探测商户后台 iframe、Tab 容器或主列表骨架
    const coreContainer = scope.locator(
      '#me-iframe-container, .tab-container, .mtd-tabs-item, .mtd-list-item, .detail-container, body'
    ).first();

    try {
      if (typeof coreContainer?.waitFor === 'function') {
        await coreContainer.waitFor({ state: 'attached', timeout: getScaledTimeout(timeout) });
      }
    } catch (error) {
      await assertNoMeituanPageRisk(page);
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

  /**
   * 通过受控 Tab 切换刷新列表，并返回最终的待确认订单列表响应
   */
  public async refreshOrderList(page: Page): Promise<Response> {
    return this.listCollector.refreshOrderList(page);
  }

  /**
   * 页面操作：刷新美团待处理列表并返回待处理订单概要（权威网络响应为唯一源，带防抖补偿与请求合并）
   */
  public async collectUnhandledOrders(): Promise<DutyUnhandledOrderSummary[]> {
    const page = this.getActivePage('采集待处理订单');
    return this.listCollector.collectUnhandledOrders(
      page,
      (fn) => this.runWithMutex(fn),
      (p) => this.refreshOrderList(p)
    );
  }

  /**
   * 页面操作：在美团后台页面定位订单卡片并内联展开/点击，抓取详情原始数据（回写明文客人姓名）
   * 遵循 Fail-Fast 原则：100% 权威网络接口为源，智能跳过电话解密，只返回原始数据，零 DOM 业务数据拼接！
   */
  public async inspectOrderDetail(otaOrderId: string): Promise<Record<string, unknown>> {
    const page = this.getActivePage('查看订单详情');
    return this.runWithMutex(async () => {
      return this.detailInspector.inspectOrderDetail(page, otaOrderId, {
        refreshOrderList: (p) => this.refreshOrderList(p),
      });
    });
  }

  /**
   * 页面操作：在美团后台回填确认号（基于订单卡片/详情内联交互，防串单严格校验，支持安全演练 dryRun）
   */
  public async confirmImport(
    confirmNo: string,
    otaOrderId: string,
    options: DutyActionDryRunOptions & { dryRun: true }
  ): Promise<DutyActionVerificationResult>;
  public async confirmImport(
    confirmNo: string,
    otaOrderId: string,
    options?: DutyActionDryRunOptions
  ): Promise<DutyActionVerificationResult | void>;
  public async confirmImport(
    confirmNo: string,
    otaOrderId: string,
    options?: DutyActionDryRunOptions
  ): Promise<DutyActionVerificationResult | void> {
    if (!this.confirmImportEnabled && !options?.dryRun) {
      throw new DutyExecutionError(
        '已关闭订单确认号回填开关，禁止在渠道后台执行确认号回填（开发调试保护模式）',
        'CONFIRM_IMPORT_DISABLED',
        false
      );
    }

    const page = this.getActivePage(options?.dryRun ? '演练回填确认号' : '回填确认号');
    return this.runWithMutex(async () => {
      return this.actionExecutor.confirmImport(page, confirmNo, otaOrderId, {
        ...options,
        refreshOrderList: (p) => this.refreshOrderList(p),
      });
    });
  }

  /**
   * 页面操作：在美团后台确认取消（我已知晓，支持安全演练 dryRun）
   */
  public async confirmCancel(
    otaOrderId: string,
    options: DutyActionDryRunOptions & { dryRun: true }
  ): Promise<DutyActionVerificationResult>;
  public async confirmCancel(
    otaOrderId: string,
    options?: DutyActionDryRunOptions
  ): Promise<DutyActionVerificationResult | void>;
  public async confirmCancel(
    otaOrderId: string,
    options?: DutyActionDryRunOptions
  ): Promise<DutyActionVerificationResult | void> {
    const page = this.getActivePage(options?.dryRun ? '演练确认取消' : '确认取消');
    return this.runWithMutex(async () => {
      return this.actionExecutor.confirmCancel(page, otaOrderId, {
        ...options,
        refreshOrderList: (p) => this.refreshOrderList(p),
      });
    });
  }
}
