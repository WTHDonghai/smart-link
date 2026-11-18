import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateState } from '../../src/types/update';
import type { AppUpdateDescriptor } from '../../src/types/update';
import {
  DESKTOP_UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CONFIRM_TIMEOUT_MS,
  DesktopUpdateService,
  type DesktopUpdateScheduler,
  type AutoUpdaterLike,
  type UpdateInfoLike,
} from '../../electron/desktopUpdateService';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../src/services/logger', () => ({
  logger: loggerMock,
}));

function createUpdateState(overrides: Partial<AppUpdateState>): AppUpdateState {
  return {
    canUpdate: true,
    status: 'idle',
    currentVersion: '1.0.0',
    targetVersion: '',
    progressPercent: null,
    message: '',
    pendingConfirmation: false,
    confirmDeadlineAt: null,
    ...overrides,
  };
}

class FakeUpdater implements AutoUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  checkCount = 0;
  downloadCount = 0;
  checkInfoVersion = '1.1.0';
  feedUrls: Array<string> = [];
  quitArgs: Array<boolean> | null = null;
  readonly states: Array<AppUpdateState> = [];
  private listeners = new Map<string, Array<(payload: unknown) => void>>();

  on(event: string, listener: (payload: unknown) => void): unknown {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) || []) {
      listener(payload);
    }
  }

  async checkForUpdates(): Promise<{ updateInfo: UpdateInfoLike }> {
    this.checkCount += 1;
    this.emit('update-available', { version: this.checkInfoVersion });
    return { updateInfo: { version: this.checkInfoVersion } };
  }

  setFeedURL(options: { provider: 'generic'; url: string }): void {
    this.feedUrls.push(options.url);
  }

  async downloadUpdate(): Promise<Array<string>> {
    this.downloadCount += 1;
    this.emit('download-progress', { percent: 50 });
    this.emit('update-downloaded', { version: '1.1.0' });
    return ['Smart Link Auto-Setup-1.1.0-x64.exe'];
  }

  hasListener(event: string): boolean {
    return this.listeners.has(event);
  }

  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void {
    this.quitArgs = [isSilent, isForceRunAfter];
  }
}

class FakeScheduler implements DesktopUpdateScheduler {
  intervals: Array<number> = [];
  handlers: Array<() => void> = [];
  clearedTimers: Array<unknown> = [];

  setInterval(handler: () => void, intervalMs: number): unknown {
    this.intervals.push(intervalMs);
    this.handlers.push(handler);
    return { id: this.intervals.length };
  }

  clearInterval(timer: unknown): void {
    this.clearedTimers.push(timer);
  }
}

function createTeardown(result?: Partial<{
  completed: boolean;
  timedOut: boolean;
  failureReasons: string[];
}>) {
  const teardown = vi.fn(async () => ({
      completed: true,
      timedOut: false,
      failureReasons: [],
      ...result,
  }));
  return { teardown };
}

function createDescriptorReader(
  descriptor: AppUpdateDescriptor | null = {
    version: '1.1.0',
    feedUrl: 'https://updates.example.test/windows/x64/1.1.0/',
  }
) {
  return vi.fn(async () => descriptor);
}

describe('DesktopUpdateService', () => {
  let updater: FakeUpdater;

  beforeEach(() => {
    vi.clearAllMocks();
    updater = new FakeUpdater();
  });

  it('marks an unpackaged runtime unavailable and never contacts the update feed', async () => {
    const { teardown: teardownMock } = createTeardown();
    const service = new DesktopUpdateService({
      canUpdate: false,
      currentVersion: '1.0.0',
      teardownApplicationResources: teardownMock,
      updater,
      readDescriptor: createDescriptorReader(null),
    });

    const state = await service.check();

    expect(state.canUpdate).toBe(false);
    expect(state.status).toBe('unavailable');
    expect(updater.checkCount).toBe(0);
    expect(updater.feedUrls).toEqual([]);
    expect(loggerMock.info).not.toHaveBeenCalled();
  });

  it('transitions to available when the feed reports a new version', async () => {
    const { teardown: teardownMock } = createTeardown();
    const service = new DesktopUpdateService({
      canUpdate: true,
      currentVersion: '1.0.0',
      teardownApplicationResources: teardownMock,
      updater,
      readDescriptor: createDescriptorReader(),
      readAutoInstallEnabled: () => false,
    });

    const state = await service.check();

    expect(updater.checkCount).toBe(1);
    expect(state).toEqual<AppUpdateState>(createUpdateState({
      status: 'available',
      targetVersion: '1.1.0',
    }));
    expect(updater.feedUrls).toEqual([
      'https://updates.example.test/windows/x64/1.1.0/',
    ]);
  });

  it('reports idle when the platform descriptor says there is no update', async () => {
    const { teardown: teardownMock } = createTeardown();
    const service = new DesktopUpdateService({
      canUpdate: true,
      currentVersion: '1.0.0',
      teardownApplicationResources: teardownMock,
      updater,
      readDescriptor: createDescriptorReader(null),
    });

    const state = await service.check();

    expect(state.status).toBe('idle');
    expect(updater.checkCount).toBe(0);
    expect(updater.feedUrls).toEqual([]);
  });

  it('fails when the platform version differs from latest.yml', async () => {
    const { teardown: teardownMock } = createTeardown();
    const service = new DesktopUpdateService({
      canUpdate: true,
      currentVersion: '1.0.0',
      teardownApplicationResources: teardownMock,
      updater,
      readDescriptor: createDescriptorReader({
        version: '1.2.0',
        feedUrl: 'https://updates.example.test/windows/x64/1.2.0/',
      }),
    });
    updater.checkInfoVersion = '1.1.0';

    const state = await service.check();

    expect(updater.feedUrls).toEqual([
      'https://updates.example.test/windows/x64/1.2.0/',
    ]);
    expect(state.status).toBe('error');
    expect(state.message).toBe('检查更新失败，请稍后重试');
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[系统更新] 检查更新失败',
      expect.objectContaining({
        details: '平台更新版本与更新源 latest.yml 不一致',
      })
    );
  });

  it('downloads the confirmed installer, stops runtime first, then requests a forced restart install', async () => {
    const { teardown: teardownMock } = createTeardown();
    const service = new DesktopUpdateService({
      canUpdate: true,
      currentVersion: '1.0.0',
      teardownApplicationResources: teardownMock,
      updater,
      onState: (state) => updater.states.push(state),
      readDescriptor: createDescriptorReader(),
      readAutoInstallEnabled: () => false,
    });
    await service.check();
    updater.states.length = 0;

    const state = await service.install();

    expect(updater.states.map((state) => state.status)).toEqual([
      'downloading',
      'downloading',
      'downloading',
      'installing',
    ]);
    expect(updater.states.map((state) => state.progressPercent)).toEqual([
      0,
      50,
      100,
      100,
    ]);
    expect(updater.downloadCount).toBe(1);
    expect(updater.feedUrls).toEqual([
      'https://updates.example.test/windows/x64/1.1.0/',
      'https://updates.example.test/windows/x64/1.1.0/',
    ]);
    expect(teardownMock).toHaveBeenCalledWith(10000);
    expect(updater.quitArgs).toEqual([true, true]);
    expect(state.status).toBe('installing');
    expect(state.targetVersion).toBe('1.1.0');
    expect(state.progressPercent).toBe(100);
  });

  it('captures updater engine errors without leaving an unhandled event', () => {
    const { teardown: teardownMock } = createTeardown();
    const service = new DesktopUpdateService({
      canUpdate: true,
      currentVersion: '1.0.0',
      teardownApplicationResources: teardownMock,
      updater,
      readDescriptor: createDescriptorReader(),
    });

    expect(updater.hasListener('error')).toBe(true);
    updater.emit('error', new Error('HTTP 404'));

    const state = service.state();
    expect(state.status).toBe('error');
    expect(state.message).toBe('检查或下载更新失败，请稍后重试');
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[系统更新] 更新引擎发生异常',
      expect.objectContaining({
        details: 'HTTP 404',
      })
    );
  });

  it('starts one hourly runtime check and clears it on stop', async () => {
    const scheduler = new FakeScheduler();
    const service = new DesktopUpdateService({
      canUpdate: true,
      currentVersion: '1.0.0',
      teardownApplicationResources: vi.fn(),
      updater,
      scheduler,
      readDescriptor: createDescriptorReader(),
    });

    service.startPeriodicChecks();
    service.startPeriodicChecks();

    expect(scheduler.intervals).toEqual([DESKTOP_UPDATE_CHECK_INTERVAL_MS]);
    expect(scheduler.handlers).toHaveLength(1);

    scheduler.handlers[0]();
    await vi.waitFor(() => {
      expect(updater.checkCount).toBe(1);
    });

    const timer = scheduler.handlers.length;
    service.stopPeriodicChecks();
    expect(scheduler.clearedTimers).toEqual([{ id: timer }]);
  });

  it('does not schedule runtime checks when the app cannot update', () => {
    const scheduler = new FakeScheduler();
    const service = new DesktopUpdateService({
      canUpdate: false,
      currentVersion: '1.0.0',
      teardownApplicationResources: vi.fn(),
      updater,
      scheduler,
      readDescriptor: createDescriptorReader(null),
    });

    service.startPeriodicChecks();

    expect(scheduler.intervals).toEqual([]);
    expect(scheduler.handlers).toEqual([]);
  });

  it('rejects installation before an update has been confirmed', async () => {
    const { teardown: teardownMock } = createTeardown();
    const service = new DesktopUpdateService({
      canUpdate: true,
      currentVersion: '1.0.0',
      teardownApplicationResources: teardownMock,
      updater,
      readDescriptor: createDescriptorReader(null),
    });

    const state = await service.install();

    expect(state.status).toBe('error');
    expect(state.message).toBe('当前没有已确认的新版本，请先检查更新');
    expect(updater.downloadCount).toBe(0);
    expect(teardownMock).not.toHaveBeenCalled();
  });

  it('reports a failed teardown instead of replacing a running installer session', async () => {
    const { teardown: teardownMock } = createTeardown({
      completed: false,
      timedOut: true,
      failureReasons: ['资源回收超时 10000ms'],
    });
    const service = new DesktopUpdateService({
      canUpdate: true,
      currentVersion: '1.0.0',
      teardownApplicationResources: teardownMock,
      updater,
      readDescriptor: createDescriptorReader(),
      readAutoInstallEnabled: () => false,
    });
    await service.check();

    const state = await service.install();

    expect(updater.quitArgs).toBeNull();
    expect(state.status).toBe('error');
    expect(state.message).toBe('更新下载或安装准备失败，当前应用仍在运行');
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[系统更新] 更新安装流程失败',
      expect.objectContaining({
        details: '资源回收超时 10000ms',
      })
    );
  });

  describe('自动安装决策 (evaluateAutoInstall)', () => {
    it('用户在场时挂起确认弹窗而不自动安装，状态携带 pendingConfirmation 与截止时间', async () => {
      const { teardown: teardownMock } = createTeardown();
      const service = new DesktopUpdateService({
        canUpdate: true,
        currentVersion: '1.0.0',
        teardownApplicationResources: teardownMock,
        updater,
        readDescriptor: createDescriptorReader(),
        isUserPresent: () => true,
      });

      const state = await service.check();

      expect(state.status).toBe('available');
      expect(state.pendingConfirmation).toBe(true);
      expect(state.confirmDeadlineAt).not.toBeNull();
      // 未触发下载：决策权在用户
      expect(updater.downloadCount).toBe(0);
      expect(teardownMock).not.toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        '[系统更新] 用户正在操作，挂起安装确认弹窗',
        expect.objectContaining({
          meta: expect.objectContaining({ targetVersion: '1.1.0' }),
        })
      );
    });

    it('无人值守且无采集作业时直接自动安装，走完整下载与静默安装链路', async () => {
      const { teardown: teardownMock } = createTeardown();
      const service = new DesktopUpdateService({
        canUpdate: true,
        currentVersion: '1.0.0',
        teardownApplicationResources: teardownMock,
        updater,
        readDescriptor: createDescriptorReader(),
        isUserPresent: () => false,
        hasActiveCollectionJobs: () => false,
      });

      await service.check();
      // evaluateAutoInstall 异步启动 runInstall，等待其推进
      await vi.waitFor(() => {
        expect(updater.quitArgs).not.toBeNull();
      });

      expect(updater.downloadCount).toBe(1);
      expect(teardownMock).toHaveBeenCalledWith(10000);
      expect(updater.quitArgs).toEqual([true, true]);
      expect(service.state().status).toBe('installing');
      expect(loggerMock.info).toHaveBeenCalledWith(
        '[系统更新] 无人值守，自动开始安装',
        expect.objectContaining({
          meta: expect.objectContaining({ targetVersion: '1.1.0' }),
        })
      );
    });

    it('无人值守但采集作业进行中时顺延，不触发安装', async () => {
      const { teardown: teardownMock } = createTeardown();
      const service = new DesktopUpdateService({
        canUpdate: true,
        currentVersion: '1.0.0',
        teardownApplicationResources: teardownMock,
        updater,
        readDescriptor: createDescriptorReader(),
        isUserPresent: () => false,
        hasActiveCollectionJobs: () => true,
      });

      const state = await service.check();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(state.status).toBe('available');
      expect(state.pendingConfirmation).toBe(false);
      expect(updater.downloadCount).toBe(0);
      expect(teardownMock).not.toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        '[系统更新] 检测到采集作业进行中，自动安装顺延至下一轮检查',
        expect.anything()
      );
    });

    it('自动安装开关关闭时保持手动模式，用户在场也不弹窗', async () => {
      const { teardown: teardownMock } = createTeardown();
      const service = new DesktopUpdateService({
        canUpdate: true,
        currentVersion: '1.0.0',
        teardownApplicationResources: teardownMock,
        updater,
        readDescriptor: createDescriptorReader(),
        readAutoInstallEnabled: () => false,
        isUserPresent: () => true,
      });

      const state = await service.check();

      expect(state.status).toBe('available');
      expect(state.pendingConfirmation).toBe(false);
      expect(state.confirmDeadlineAt).toBeNull();
      expect(updater.downloadCount).toBe(0);
    });

    it('开关动态切换立即生效：关闭后检查不再弹窗，重新开启后恢复弹窗', async () => {
      const { teardown: teardownMock } = createTeardown();
      let autoInstallEnabled = false;
      const service = new DesktopUpdateService({
        canUpdate: true,
        currentVersion: '1.0.0',
        teardownApplicationResources: teardownMock,
        updater,
        readDescriptor: createDescriptorReader(),
        readAutoInstallEnabled: () => autoInstallEnabled,
        isUserPresent: () => true,
      });

      // 开关关闭：手动模式，不弹窗
      await service.check();
      expect(service.state().pendingConfirmation).toBe(false);

      // 设置界面实时开启：下一次检查恢复弹窗决策
      autoInstallEnabled = true;
      await service.check();
      expect(service.state().pendingConfirmation).toBe(true);
    });

    it('deferInstall 清除挂起态并记录顺延版本，同轮重复检查不再弹窗', async () => {
      const { teardown: teardownMock } = createTeardown();
      let userPresent = true;
      const service = new DesktopUpdateService({
        canUpdate: true,
        currentVersion: '1.0.0',
        teardownApplicationResources: teardownMock,
        updater,
        readDescriptor: createDescriptorReader(),
        isUserPresent: () => userPresent,
      });

      await service.check();
      expect(service.state().pendingConfirmation).toBe(true);

      const deferred = service.deferInstall();
      expect(deferred.pendingConfirmation).toBe(false);
      expect(deferred.confirmDeadlineAt).toBeNull();
      expect(deferred.status).toBe('available');

      // 同版本再次检查（周期触发）不重复弹窗
      await service.check();
      const rechecked = service.state();
      expect(rechecked.pendingConfirmation).toBe(false);

      // 新版本到来时恢复弹窗：描述符与更新源版本同步变更，顺延记录只针对旧版本
      updater.checkInfoVersion = '1.2.0';
      const serviceNewVersion = new DesktopUpdateService({
        canUpdate: true,
        currentVersion: '1.0.0',
        teardownApplicationResources: teardownMock,
        updater,
        readDescriptor: createDescriptorReader({
          version: '1.2.0',
          feedUrl: 'https://updates.example.test/windows/x64/1.2.0/',
        }),
        isUserPresent: () => userPresent,
      });
      const newer = await serviceNewVersion.check();
      expect(newer.status).toBe('available');
      expect(newer.targetVersion).toBe('1.2.0');
      expect(newer.pendingConfirmation).toBe(true);
    });

    it('confirmInstall 清除挂起态并立即执行安装链路', async () => {
      const { teardown: teardownMock } = createTeardown();
      const service = new DesktopUpdateService({
        canUpdate: true,
        currentVersion: '1.0.0',
        teardownApplicationResources: teardownMock,
        updater,
        readDescriptor: createDescriptorReader(),
        isUserPresent: () => true,
      });
      await service.check();
      expect(service.state().pendingConfirmation).toBe(true);

      const state = await service.confirmInstall();

      expect(state.status).toBe('installing');
      expect(updater.downloadCount).toBe(1);
      expect(updater.quitArgs).toEqual([true, true]);
    });

    it('弹窗超时无决策时自动按晚点安装顺延，清除挂起态', async () => {
      vi.useFakeTimers();
      try {
        const { teardown: teardownMock } = createTeardown();
        const service = new DesktopUpdateService({
          canUpdate: true,
          currentVersion: '1.0.0',
          teardownApplicationResources: teardownMock,
          updater,
          readDescriptor: createDescriptorReader(),
          isUserPresent: () => true,
        });

        const checkPromise = service.check();
        await vi.advanceTimersByTimeAsync(0);
        const confirmed = await checkPromise;
        expect(confirmed.pendingConfirmation).toBe(true);

        await vi.advanceTimersByTime(UPDATE_CONFIRM_TIMEOUT_MS);

        const state = service.state();
        expect(state.pendingConfirmation).toBe(false);
        expect(state.status).toBe('available');
        expect(updater.downloadCount).toBe(0);
        expect(loggerMock.info).toHaveBeenCalledWith(
          '[系统更新] 确认弹窗超时无决策，按晚点安装顺延',
          expect.anything()
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('canUpdate 为 false 时 confirmInstall 与 deferInstall 均返回 unavailable', async () => {
      const service = new DesktopUpdateService({
        canUpdate: false,
        currentVersion: '1.0.0',
        teardownApplicationResources: vi.fn(),
        updater,
        readDescriptor: createDescriptorReader(null),
      });

      const confirmed = await service.confirmInstall();
      const deferred = service.deferInstall();
      expect(confirmed.status).toBe('unavailable');
      expect(deferred.status).toBe('unavailable');
    });
  });
});
