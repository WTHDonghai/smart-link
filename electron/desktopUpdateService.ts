import { randomUUID } from 'node:crypto';
import * as electronUpdater from 'electron-updater';
import type { AppUpdateDescriptor, AppUpdateState } from '../src/types/update';
import { logger } from '../src/services/logger';

export interface UpdateInfoLike {
  version?: unknown;
}

export interface DownloadProgressLike {
  percent?: unknown;
}

export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: (payload: unknown) => void): unknown;
  checkForUpdates(): Promise<{ updateInfo: UpdateInfoLike }>;
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  downloadUpdate(): Promise<Array<string>>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
}

export interface DesktopUpdateTeardown {
  (timeoutMs?: number): Promise<{
    completed: boolean;
    timedOut: boolean;
    failureReasons: string[];
  }>;
}

export interface DesktopUpdateScheduler {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(timer: unknown): void;
}

export interface DesktopUpdateServiceOptions {
  canUpdate: boolean;
  currentVersion: string;
  teardownApplicationResources: DesktopUpdateTeardown;
  updater?: AutoUpdaterLike;
  onState?: (state: AppUpdateState) => void;
  scheduler?: DesktopUpdateScheduler;
  readDescriptor: (input: { checkId: string }) => Promise<AppUpdateDescriptor | null>;
  /** 自动安装总开关（关闭时退化为手动模式，仅角标提醒） */
  autoInstallEnabled?: boolean;
  /** 前台判定：用户正在操作应用（窗口聚焦 + 近期有输入）时弹窗交由用户决策 */
  isUserPresent?: () => boolean;
  /** 采集互斥检查：存在活跃采集作业时自动安装顺延，避免中断手工作业 */
  hasActiveCollectionJobs?: () => boolean;
}

export const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** 前台判定：弹窗挂起等待用户决策的超时，超时按「晚点安装」降级 */
export const UPDATE_CONFIRM_TIMEOUT_MS = 10 * 60 * 1000;
const CLEAN_INSTALL_MESSAGE = '更新包已就绪，正在停止值守任务并安装新版本。';
type ElectronUpdaterModule = typeof electronUpdater;
const electronUpdaterWithDefault = electronUpdater as ElectronUpdaterModule & {
  default?: ElectronUpdaterModule;
};

function normalizeVersion(info: UpdateInfoLike | undefined): string {
  const version = typeof info?.version === 'string' ? info.version.trim() : '';
  if (!version) {
    throw new Error('更新源返回的版本号缺失');
  }
  return version;
}

function normalizeProgress(progress: DownloadProgressLike | undefined): number | null {
  const percent = Number(progress?.percent);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.min(100, Math.max(0, percent));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveAutoUpdater(): AutoUpdaterLike {
  const electronUpdaterModule = electronUpdaterWithDefault.default ?? electronUpdater;
  return electronUpdaterModule.autoUpdater as unknown as AutoUpdaterLike;
}

function createDefaultScheduler(): DesktopUpdateScheduler {
  return {
    setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
    clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
  };
}

export class DesktopUpdateService {
  private readonly updater: AutoUpdaterLike;
  private readonly canUpdate: boolean;
  private readonly currentVersion: string;
  private readonly teardownApplicationResources: DesktopUpdateTeardown;
  private readonly onState: (state: AppUpdateState) => void;
  private readonly readDescriptor: (input: { checkId: string }) => Promise<AppUpdateDescriptor | null>;
  private readonly scheduler: DesktopUpdateScheduler;
  private readonly autoInstallEnabled: boolean;
  private readonly isUserPresent: () => boolean;
  private readonly hasActiveCollectionJobs: () => boolean;
  private currentState: AppUpdateState;
  private availableVersion = '';
  private operation: Promise<AppUpdateState> | null = null;
  private periodicTimer: unknown = null;
  private descriptor: AppUpdateDescriptor | null = null;
  /** 弹窗挂起上下文：仅持超时定时器，超时按「晚点安装」降级 */
  private pendingConfirm: { timer: NodeJS.Timeout } | null = null;
  /** 本轮检查已弹过窗且用户选择顺延的目标版本，避免同一版本反复打扰 */
  private deferredVersion = '';

  constructor(options: DesktopUpdateServiceOptions) {
    this.canUpdate = options.canUpdate;
    this.currentVersion = options.currentVersion;
    this.teardownApplicationResources = options.teardownApplicationResources;
    this.onState = options.onState || (() => undefined);
    this.readDescriptor = options.readDescriptor;
    this.scheduler = options.scheduler || createDefaultScheduler();
    this.updater = options.updater || resolveAutoUpdater();
    this.autoInstallEnabled = options.autoInstallEnabled ?? true;
    this.isUserPresent = options.isUserPresent || (() => false);
    this.hasActiveCollectionJobs = options.hasActiveCollectionJobs || (() => false);
    this.currentState = this.createState(options.canUpdate ? 'idle' : 'unavailable');

    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowDowngrade = false;
    this.registerUpdaterListeners();
  }

  state(): AppUpdateState {
    return { ...this.currentState };
  }

  async check(): Promise<AppUpdateState> {
    if (!this.canUpdate) {
      return this.unavailableState();
    }
    if (this.operation) {
      return this.operation;
    }

    const checkOperation = this.runCheck({ checkId: randomUUID() });
    this.operation = checkOperation;
    try {
      return await checkOperation;
    } finally {
      // runCheck 成功分支可能已把 operation 换成自动安装流程（evaluateAutoInstall），
      // 仅当仍指向本次检查时才清理，避免误清安装互斥
      if (this.operation === checkOperation) {
        this.operation = null;
      }
    }
  }

  async install(): Promise<AppUpdateState> {
    if (!this.canUpdate) {
      return this.unavailableState();
    }
    if (this.operation) {
      return this.operation;
    }
    if (this.currentState.status !== 'available' || !this.availableVersion) {
      const error = new Error('当前没有已确认的新版本，请先检查更新');
      this.setState(this.errorState(error.message));
      logger.error('[系统更新] 安装请求被拒绝', {
        module: 'SYSTEM',
        details: error.message,
      });
      return this.currentState;
    }

    this.operation = this.runInstall();
    return await this.operation;
  }

  /**
   * 弹窗「立刻安装」：清除确认挂起态并走与手动安装一致的下载安装链路。
   * 无挂起弹窗时等价于手动 install()（侧边栏角标点击复用）。
   */
  async confirmInstall(): Promise<AppUpdateState> {
    if (!this.canUpdate) {
      return this.unavailableState();
    }
    this.clearPendingConfirm();
    return await this.install();
  }

  /**
   * 弹窗「晚点安装」：本轮放弃，回到 available 等待下一轮周期检查重新决策。
   * 记录 deferredVersion 防止同一版本在挂起窗口内反复弹窗。
   */
  deferInstall(): AppUpdateState {
    if (!this.canUpdate) {
      return this.unavailableState();
    }
    this.clearPendingConfirm();
    this.deferredVersion = this.availableVersion;
    logger.info('[系统更新] 用户选择晚点安装，等待下一轮检查', {
      module: 'SYSTEM',
      meta: { currentVersion: this.currentVersion, targetVersion: this.availableVersion },
    });
    return this.state();
  }

  /** 清除弹窗挂起态（决策完成或超时），确认倒计时归零并回到 available */
  private clearPendingConfirm(): void {
    if (!this.pendingConfirm) {
      return;
    }
    clearTimeout(this.pendingConfirm.timer);
    this.pendingConfirm = null;
    this.setState({
      ...this.createState('available'),
      targetVersion: this.availableVersion,
    });
  }

  /**
   * 更新检查确认 available 后的自动安装决策入口：
   * - 自动安装关闭 → 维持手动模式
   * - 用户正在前台操作 → 挂起确认弹窗，等待 IPC 决策或超时顺延
   * - 无人值守且无采集作业 → 直接触发安装
   * - 无人值守但有采集作业 → 记日志顺延至下一轮检查
   */
  private evaluateAutoInstall(): void {
    if (!this.autoInstallEnabled) {
      return;
    }
    if (this.currentState.status !== 'available') {
      return;
    }

    if (this.isUserPresent()) {
      if (this.availableVersion === this.deferredVersion || this.pendingConfirm) {
        return;
      }
      this.beginConfirmWindow();
      return;
    }

    if (this.hasActiveCollectionJobs()) {
      logger.info('[系统更新] 检测到采集作业进行中，自动安装顺延至下一轮检查', {
        module: 'SYSTEM',
        meta: { currentVersion: this.currentVersion, targetVersion: this.availableVersion },
      });
      return;
    }

    logger.info('[系统更新] 无人值守，自动开始安装', {
      module: 'SYSTEM',
      meta: { currentVersion: this.currentVersion, targetVersion: this.availableVersion },
    });
    this.operation = this.runInstall();
    this.operation.catch(() => undefined);
  }

  /** 挂起确认弹窗：推送 pendingConfirmation 状态并启动超时降级定时器 */
  private beginConfirmWindow(): void {
    const deadline = Date.now() + UPDATE_CONFIRM_TIMEOUT_MS;
    this.setState({
      ...this.createState('available', {
        pendingConfirmation: true,
        confirmDeadlineAt: deadline,
      }),
      targetVersion: this.availableVersion,
    });
    logger.info('[系统更新] 用户正在操作，挂起安装确认弹窗', {
      module: 'SYSTEM',
      meta: { currentVersion: this.currentVersion, targetVersion: this.availableVersion },
    });

    const timer = setTimeout(() => {
      logger.info('[系统更新] 确认弹窗超时无决策，按晚点安装顺延', {
        module: 'SYSTEM',
        meta: { currentVersion: this.currentVersion, targetVersion: this.availableVersion },
      });
      this.deferInstall();
    }, UPDATE_CONFIRM_TIMEOUT_MS);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.pendingConfirm = { timer };
  }

  startPeriodicChecks(intervalMs = DESKTOP_UPDATE_CHECK_INTERVAL_MS): void {
    if (!this.canUpdate || this.periodicTimer) {
      return;
    }

    this.periodicTimer = this.scheduler.setInterval(() => {
      void this.check();
    }, intervalMs);
  }

  stopPeriodicChecks(): void {
    if (!this.periodicTimer) {
      return;
    }

    this.scheduler.clearInterval(this.periodicTimer);
    this.periodicTimer = null;
  }

  private unavailableState(): AppUpdateState {
    const state = this.createState('unavailable');
    this.setState(state);
    return state;
  }

  private createState(
    status: AppUpdateState['status'],
    confirm: { pendingConfirmation: boolean; confirmDeadlineAt: number | null } = {
      pendingConfirmation: false,
      confirmDeadlineAt: null,
    }
  ): AppUpdateState {
    return {
      canUpdate: this.canUpdate,
      status,
      currentVersion: this.currentVersion,
      targetVersion: '',
      progressPercent: null,
      message: '',
      pendingConfirmation: confirm.pendingConfirmation,
      confirmDeadlineAt: confirm.confirmDeadlineAt,
    };
  }

  private errorState(message: string): AppUpdateState {
    return {
      ...this.createState('error'),
      targetVersion: this.availableVersion,
      message,
    };
  }

  private setState(next: AppUpdateState): void {
    this.currentState = { ...next, currentVersion: this.currentVersion };
    this.onState(this.currentState);
  }

  private registerUpdaterListeners(): void {
    if (!this.canUpdate) {
      return;
    }

    this.updater.on('update-available', (payload) => {
      try {
        this.availableVersion = normalizeVersion(payload as UpdateInfoLike);
        this.setState({
          ...this.createState('available'),
          targetVersion: this.availableVersion,
        });
        logger.info('[系统更新] 发现新版本', {
          module: 'SYSTEM',
          details: `新版本: ${this.availableVersion}`,
          meta: { currentVersion: this.currentVersion, targetVersion: this.availableVersion },
        });
      } catch (error) {
        this.setState(this.errorState('更新源版本信息无效'));
        logger.error('[系统更新] 更新源版本信息无效', {
          module: 'SYSTEM',
          details: errorMessage(error),
        });
      }
    });

    this.updater.on('update-not-available', () => {
      this.availableVersion = '';
      this.setState(this.createState('idle'));
      logger.info('[系统更新] 已确认当前是最新版本', {
        module: 'SYSTEM',
        meta: { currentVersion: this.currentVersion },
      });
    });

    this.updater.on('download-progress', (payload) => {
      const percent = normalizeProgress(payload as DownloadProgressLike);
      this.setState({
        ...this.createState('downloading'),
        targetVersion: this.availableVersion,
        progressPercent: percent,
      });
    });

    this.updater.on('update-downloaded', (payload) => {
      this.availableVersion = normalizeVersion(payload as UpdateInfoLike);
      const installInProgress = this.currentState.status === 'downloading';
      this.setState({
        ...this.createState(installInProgress ? 'downloading' : 'available'),
        targetVersion: this.availableVersion,
        progressPercent: 100,
        message: installInProgress ? CLEAN_INSTALL_MESSAGE : '',
      });
    });

    this.updater.on('error', (payload) => {
      this.setState(this.errorState('检查或下载更新失败，请稍后重试'));
      logger.error('[系统更新] 更新引擎发生异常', {
        module: 'SYSTEM',
        details: errorMessage(payload),
      });
    });
  }

  private async runCheck(input: { checkId: string }): Promise<AppUpdateState> {
    this.setState(this.createState('checking'));
    logger.info('[系统更新] 正在检查新版本', {
      module: 'SYSTEM',
      meta: { currentVersion: this.currentVersion },
    });

    try {
      const descriptor = await this.readDescriptor(input);
      if (!descriptor) {
        this.descriptor = null;
        this.availableVersion = '';
        this.setState(this.createState('idle'));
        logger.info('[系统更新] 平台确认当前是最新版本', {
          module: 'SYSTEM',
          meta: { currentVersion: this.currentVersion, checkId: input.checkId },
        });
        return this.state();
      }

      this.descriptor = descriptor;
      this.availableVersion = descriptor.version;
      this.updater.setFeedURL({ provider: 'generic', url: descriptor.feedUrl });
      const result = await this.updater.checkForUpdates();
      const feedVersion = normalizeVersion(result?.updateInfo);
      if (feedVersion !== descriptor.version) {
        throw new Error('平台更新版本与更新源 latest.yml 不一致');
      }
      // update-available 事件先于 checkForUpdates resolve 到达（状态已置 available），
      // 此 if 是描述符路径的状态兜底；自动安装决策必须独立于它执行
      if (this.currentState.status === 'checking') {
        this.setState({
          ...this.createState('available'),
          targetVersion: this.availableVersion,
        });
      }
      // 新版本确认后进入自动安装决策（弹窗 / 静默 / 顺延）
      this.evaluateAutoInstall();
      logger.info('[系统更新] 更新检查完成', {
        module: 'SYSTEM',
        details: `平台目标版本: ${descriptor.version}`,
        meta: {
          currentVersion: this.currentVersion,
          checkId: input.checkId,
          feedVersion,
          feedUrl: descriptor.feedUrl,
        },
      });
      return this.state();
    } catch (error) {
      const message = '检查更新失败，请稍后重试';
      this.descriptor = null;
      this.availableVersion = '';
      this.setState(this.errorState(message));
      logger.error('[系统更新] 检查更新失败', {
        module: 'SYSTEM',
        details: errorMessage(error),
      });
      return this.state();
    }
  }

  private async runInstall(): Promise<AppUpdateState> {
    const descriptor = this.descriptor;
    if (!descriptor || descriptor.version !== this.availableVersion) {
      throw new Error('更新描述符缺失或与目标版本不一致');
    }
    const targetVersion = this.availableVersion;
    this.setState({
      ...this.createState('downloading'),
      targetVersion,
      progressPercent: 0,
    });

    try {
      logger.info('[系统更新] 开始下载更新包', {
        module: 'SYSTEM',
        meta: { currentVersion: this.currentVersion, targetVersion },
      });
      this.updater.setFeedURL({ provider: 'generic', url: descriptor.feedUrl });
      await this.updater.downloadUpdate();

      this.setState({
        ...this.createState('installing'),
        targetVersion,
        progressPercent: 100,
        message: CLEAN_INSTALL_MESSAGE,
      });
      const teardown = await this.teardownApplicationResources(10000);
      if (!teardown.completed || teardown.failureReasons.length > 0) {
        throw new Error(teardown.failureReasons.join('; ') || '应用资源回收超时');
      }

      logger.info('[系统更新] 正在安装新版本', {
        module: 'SYSTEM',
        meta: { currentVersion: this.currentVersion, targetVersion },
      });
      this.updater.quitAndInstall(true, true);
      return this.state();
    } catch (error) {
      const message = '更新下载或安装准备失败，当前应用仍在运行';
      this.setState({
        ...this.errorState(message),
        targetVersion,
      });
      logger.error('[系统更新] 更新安装流程失败', {
        module: 'SYSTEM',
        details: errorMessage(error),
        meta: { currentVersion: this.currentVersion, targetVersion },
      });
      return this.state();
    } finally {
      this.operation = null;
    }
  }
}
