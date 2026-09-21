import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateState } from '../../src/types/update';
import type { AppUpdateDescriptor } from '../../src/types/update';
import {
  DESKTOP_UPDATE_CHECK_INTERVAL_MS,
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
    });

    const state = await service.check();

    expect(updater.checkCount).toBe(1);
    expect(state).toEqual<AppUpdateState>({
      canUpdate: true,
      status: 'available',
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
      progressPercent: null,
      message: '',
    });
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
});
