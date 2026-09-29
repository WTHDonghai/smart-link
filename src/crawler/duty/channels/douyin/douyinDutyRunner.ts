import type { Page } from 'playwright';
import { createPersistentBrowserSession } from '@/src/crawler/browserManager';
import { updateVisualTrackerStatus } from '@/src/crawler/visualTracker';
import {
  BaseChannelDutyRunner,
  type DutyUnhandledOrderSummary,
  type DutyActionDryRunOptions,
  type DutyActionVerificationResult,
} from '../../dutyContracts';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import {
  DutyOrderStatus,
  type ParsedDutyTaskContext,
} from '../../dutyTaskContext';
import { getDouyinOrderUrl } from '@/src/config/otaUrls';
import { PROCESS_ENV_KEYS } from '@/src/types/env';
import {
  HUMAN_DELAY,
  DEFAULT_DUTY_TIMING,
  humanDelay,
  getScaledTimeout,
} from '../../dutyTimingConfig';
import { checkDouyinPageRisk, assertNoDouyinPageRisk } from './douyinRiskGuard';
import { dismissDouyinNoticeModals } from './douyinModalGuard';
import { getDouyinOrderScope } from './douyinCardLocator';
import { DouyinListCollector } from './douyinListCollector';
import { DouyinDetailInspector } from './douyinDetailInspector';
import { DouyinActionExecutor } from './douyinActionExecutor';

export { checkDouyinPageRisk, assertNoDouyinPageRisk, dismissDouyinNoticeModals, humanDelay };

/**
 * 抖音商家后台自动化值守执行器 (门面模式)
 * 聚合协调列表采集、详情解析、接单回填与取消确认等领域子处理器
 */
export class DouyinDutyRunner extends BaseChannelDutyRunner {
  public readonly channelCode = 'DOUYIN';

  private readonly listCollector = new DouyinListCollector();
  private readonly detailInspector = new DouyinDetailInspector();
  private readonly actionExecutor = new DouyinActionExecutor();

  constructor(targetUrl?: string) {
    super(targetUrl);
  }

  public get targetUrl(): string {
    return this.explicitTargetUrl || getDouyinOrderUrl();
  }

  private async dismissNoticeModals(page: Page): Promise<boolean> {
    return dismissDouyinNoticeModals(page, getDouyinOrderScope(page));
  }

  /**
   * 页面就绪门禁：等待商户后台骨架与核心容器挂载，并执行冷启动沉淀缓冲 (3~8 秒)
   */
  public async waitForPageReady(page: Page, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_DUTY_TIMING.action.PAGE_CONTAINER_READY;

    await assertNoDouyinPageRisk(page);

    await updateVisualTrackerStatus(page, '⏳ 正在等待抖音商家后台骨架与元素加载就绪...', 'action');

    const scope = getDouyinOrderScope(page);
    const coreContainer = scope.locator(
      '#core-layout-outlet, .byted-tab-bar, .byted-tab-bar-item, #filterSection, div[class*="tab-bar"], body'
    ).first();

    try {
      if (typeof coreContainer?.waitFor === 'function') {
        await coreContainer.waitFor({ state: 'attached', timeout: getScaledTimeout(timeout) });
      }
    } catch (error) {
      await assertNoDouyinPageRisk(page);
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

    await updateVisualTrackerStatus(page, '🤖 正在导航至抖音商家后台待处理订单页面...', 'action');
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    const isAlreadyAtTarget = Boolean(
      currentUrl && currentUrl.includes(this.targetUrl)
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

    await updateVisualTrackerStatus(page, '🛡️ 抖音订单值守已激活，正在复用渠道绑定页面...', 'success');
  }

  /**
   * 刷新「新订/变更」列表并返回解析后的新订单概要
   */
  public async refreshBookOrderList(page: Page): Promise<DutyUnhandledOrderSummary[]> {
    return this.listCollector.refreshBookOrderList(page);
  }

  /**
   * 刷新「取消/退款」列表并返回解析后的取消/退款订单概要
   */
  public async refreshRefundOrderList(page: Page): Promise<DutyUnhandledOrderSummary[]> {
    return this.listCollector.refreshRefundOrderList(page);
  }

  /**
   * 刷新抖音指定 Tab 的订单列表（按中台指令严格单 Tab 采集，绝不同时刷新两类 Tab）
   */
  public async refreshOrderList(
    page: Page,
    orderStatus: DutyOrderStatus = DutyOrderStatus.NEW
  ): Promise<DutyUnhandledOrderSummary[]> {
    return this.listCollector.refreshOrderList(page, orderStatus);
  }

  /**
   * 解析上下文或参数得到确切的订单状态枚举 (DutyOrderStatus)
   * 优先复用外层统一解析的 context.orderStatus，避免重复解析
   */
  private resolveDutyOrderStatus(
    context?: ParsedDutyTaskContext | DutyOrderStatus
  ): DutyOrderStatus {
    if (!context) {
      return DutyOrderStatus.NEW;
    }
    if (typeof context === 'string') {
      return context;
    }
    return context.orderStatus;
  }

  /**
   * 页面操作：刷新抖音待处理列表并返回待处理订单概要（权威网络响应为唯一源，带防抖补偿与请求合并）
   */
  public async collectUnhandledOrders(
    context?: ParsedDutyTaskContext | DutyOrderStatus
  ): Promise<DutyUnhandledOrderSummary[]> {
    const page = this.getActivePage('采集待处理订单');
    const orderStatus = this.resolveDutyOrderStatus(context);
    return this.listCollector.collectUnhandledOrders(
      page,
      orderStatus,
      (fn) => this.runWithMutex(fn)
    );
  }

  /**
   * 页面操作：在抖音后台页面定位订单卡片并展开详情，抓取详情原始数据
   * 遵循 Fail-Fast 原则：100% 权威网络接口为源，只返回原始数据，零 DOM 业务数据拼接！
   */
  public async inspectOrderDetail(otaOrderId: string): Promise<Record<string, unknown>> {
    const page = this.getActivePage('查看订单详情');
    return this.runWithMutex(async () => {
      return this.detailInspector.inspectOrderDetail(page, otaOrderId, {
        refreshOrderList: (p) => this.refreshOrderList(p),
        getCachedOrderRaw: (id) => this.listCollector.getCachedOrderRaw(id),
      });
    });
  }

  /**
   * 页面操作：在抖音后台回填确认号（基于订单卡片交互，防串单严格校验，支持安全演练 dryRun）
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
        refreshOrderList: (p, tab) => this.refreshOrderList(p, tab),
      });
    });
  }

  /**
   * 页面操作：在抖音后台确认取消（我知道了/同意退款，支持安全演练 dryRun）
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
        refreshOrderList: (p, tab) => this.refreshOrderList(p, tab),
      });
    });
  }
}
