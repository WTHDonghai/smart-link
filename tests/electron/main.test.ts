const { mockIpcMain, ipcHandlers, appListeners, windowEvents } = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const appListeners = new Map<string, (...args: unknown[]) => void>();
  const windowEvents = new Map<string, (...args: unknown[]) => void>();
  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    }),
  };
  return { mockIpcMain, ipcHandlers, appListeners, windowEvents };
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow } from 'electron';

vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn().mockReturnValue('/mock/user/data'),
      getAppPath: vi.fn().mockReturnValue('/mock/app/path'),
      isPackaged: false,
      whenReady: vi.fn().mockResolvedValue(undefined),
      requestSingleInstanceLock: vi.fn().mockReturnValue(true),
      on: vi.fn().mockImplementation((event: string, listener: (...args: unknown[]) => void) => {
        appListeners.set(event, listener);
      }),
      quit: vi.fn(),
      exit: vi.fn(),
    },
    BrowserWindow: vi.fn().mockImplementation(() => ({
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          windowEvents.set(event, listener);
        }),
      },
      on: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    })),
    ipcMain: mockIpcMain,
    session: {
      defaultSession: {
        setPermissionRequestHandler: vi.fn(),
      },
    },
    shell: {
      openExternal: vi.fn(),
    },
  };
});

import {
  teardownApplicationResources,
  resetTeardownStateForTest,
  registerDutyIpcHandlers,
  registerCrawlerIpcHandlers,
  resolveProcessEnvironment,
  createMainWindow,
} from '../../electron/main';
import * as platformAuthModule from '../../src/services/platformAuth';
import { hotelCollectionEngine } from '../../src/crawler/engine';
import { dutyOrchestrationEngine } from '../../src/crawler/duty/dutyOrchestrationEngine';
import * as browserManager from '../../src/crawler/browserManager';
import { remarkTemplateManager } from '../../src/crawler/duty/remarkTemplateManager';
import { logger } from '../../src/services/logger';
import { PROCESS_ENV_KEYS } from '../../src/types/env';
import type { PlatformAuthTokens } from '../../src/types';

describe('Electron main 资源回收与退出调度 (teardownApplicationResources)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    appListeners.clear();
    mockIpcMain.handle.mockImplementation((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    });
    resetTeardownStateForTest();
  });

  afterEach(() => {
    resetTeardownStateForTest();
  });

  describe('按序清理 (Sequential Cleanup)', () => {
    it('严格按序执行：1. 停止值守任务 -> 2. 关闭所有浏览器会话', async () => {
      const executionOrder: string[] = [];

      vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockImplementation(async () => {
        executionOrder.push('stopAllDuty');
        return { success: true, error: undefined };
      });

      vi.spyOn(browserManager, 'closeAllBrowserSessions').mockImplementation(async () => {
        executionOrder.push('closeAllBrowserSessions');
      });
      const flushStorageSpy = vi.spyOn(logger, 'flushStorage').mockResolvedValue();

      await teardownApplicationResources();

      // 精准断言调用顺序
      expect(executionOrder).toEqual(['stopAllDuty', 'closeAllBrowserSessions']);

      // 精准断言各清理模块调用次数确切为 1
      expect(dutyOrchestrationEngine.stopAllDuty).toHaveBeenCalledTimes(1);
      expect(browserManager.closeAllBrowserSessions).toHaveBeenCalledTimes(1);
      expect(flushStorageSpy).not.toHaveBeenCalled();
    });
  });

  describe('幂等性防护与防重入 (Idempotency)', () => {
    it('多次并发调用 teardown 时，仅触发一次真实的底层资源回收', async () => {
      const stopAllSpy = vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockResolvedValue({
        success: true,
        error: undefined,
      });
      const closeSessionsSpy = vi.spyOn(browserManager, 'closeAllBrowserSessions').mockResolvedValue();

      // 模拟并发多处同时触发退出（如快捷键、窗口关闭、IPC 指令同时发生）
      await Promise.all([
        teardownApplicationResources(),
        teardownApplicationResources(),
        teardownApplicationResources(),
        teardownApplicationResources(),
      ]);

      // 核心断言：各清理模块执行次数仅为 1 次，彻底杜绝重入
      expect(stopAllSpy).toHaveBeenCalledTimes(1);
      expect(closeSessionsSpy).toHaveBeenCalledTimes(1);
    });

    it('teardown 完成后再调用，直接返回已完成状态，不再重复清理', async () => {
      const stopAllSpy = vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockResolvedValue({
        success: true,
        error: undefined,
      });

      await teardownApplicationResources();
      expect(stopAllSpy).toHaveBeenCalledTimes(1);

      await teardownApplicationResources();
      expect(stopAllSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('超时熔断保护 (Timeout Circuit-Breaker)', () => {
    it('当某个清理操作挂起无响应时，熔断机制保障整体退出在指定超时内顺利返回', async () => {
      // 模拟值守引擎停止时由于外部网络挂起，长时间无返回
      vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockImplementation(() => {
        return new Promise(() => {
          // 永久挂起
        });
      });

      vi.spyOn(browserManager, 'closeAllBrowserSessions').mockResolvedValue();

      const startTime = Date.now();
      // 传入 50ms 超时阈值
      const result = await teardownApplicationResources(50);
      const elapsed = Date.now() - startTime;

      // 核心断言：在熔断阈值附近返回（允许正常系统调度时延），绝不无限等待
      expect(elapsed).toBeGreaterThanOrEqual(45);
      expect(elapsed).toBeLessThan(500);
      expect(result).toEqual({
        completed: false,
        timedOut: true,
        failureReasons: ['资源回收超时 50ms'],
      });
    });
  });

  describe('异常容错隔离 (Fail-Safe on Cleanup)', () => {
    it('当值守引擎抛错时，异常被隔离，后续浏览器清理与日志刷新依然正常执行', async () => {
      vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockRejectedValue(
        new Error('值守停止网络通信失败')
      );
      const closeSessionsSpy = vi.spyOn(browserManager, 'closeAllBrowserSessions').mockResolvedValue();

      await expect(teardownApplicationResources()).resolves.toEqual({
        completed: true,
        timedOut: false,
        failureReasons: ['值守停止网络通信失败'],
      });

      expect(closeSessionsSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('IPC 处理器注册 (duty:stop-all 与 app:teardown)', () => {
    it('正确注册 duty:stop-all 处理器并调度 stopAllDuty', async () => {
      registerDutyIpcHandlers();

      expect(ipcHandlers.has('duty:stop-all')).toBe(true);

      const stopSpy = vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockResolvedValueOnce({
        success: true,
        error: undefined,
      });

      const handler = ipcHandlers.get('duty:stop-all')!;
      const result = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent)) as {
        success: boolean;
        error: string;
      };

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('任一 Token 持久化路径失败时 IPC 不返回成功', async () => {
      registerDutyIpcHandlers();
      const handler = ipcHandlers.get('duty:sync-tokens')!;
      const tokens = {
        accessToken: 'ipc-access-token',
        refreshToken: 'ipc-refresh-token',
        expiresAt: Date.now() + 3600000,
        tokenType: 'bearer',
        platformBaseUrl: 'https://test-pms.hotel.com',
        tenantId: 'IPC_TOKEN',
        authenticatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as PlatformAuthTokens;

      const saveStorageSpy = vi.spyOn(platformAuthModule, 'saveTokensToStorage');
      const writeFileSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('disk is full');
      });

      const storageFailure = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent, tokens)) as {
        success: boolean;
        error: string;
      };
      expect(storageFailure.success).toBe(false);
      expect(saveStorageSpy).toHaveBeenCalledTimes(1);
      expect(storageFailure.error).toBe('写入平台凭证文件失败: disk is full');

      writeFileSpy.mockRestore();
      vi.spyOn(platformAuthModule, 'saveTokensToStorage').mockImplementation(() => {
        throw new Error('renderer storage denied');
      });

      const storageThrow = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent, tokens)) as {
        success: boolean;
        error: string;
      };
      expect(storageThrow).toEqual({ success: false, error: 'renderer storage denied' });
    });

    it('正确注册 app:teardown 处理器并调度 teardownApplicationResources', async () => {
      registerDutyIpcHandlers();

      expect(ipcHandlers.has('app:teardown')).toBe(true);

      const stopSpy = vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockResolvedValueOnce({
        success: true,
        error: undefined,
      });
      const closeSessionsSpy = vi.spyOn(browserManager, 'closeAllBrowserSessions').mockResolvedValueOnce();

      const handler = ipcHandlers.get('app:teardown')!;
      const result = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent)) as {
        success: boolean;
      };

      expect(result.success).toBe(true);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(closeSessionsSpy).toHaveBeenCalledTimes(1);
    });

    it('正确处理 duty:update-template-cache 消息并分发至 update/invalidate', async () => {
      registerDutyIpcHandlers();

      expect(ipcHandlers.has('duty:update-template-cache')).toBe(true);
      const handler = ipcHandlers.get('duty:update-template-cache')!;

      const updateSpy = vi.spyOn(remarkTemplateManager, 'updateCache').mockReturnValue(undefined);
      const invalidateSpy = vi.spyOn(remarkTemplateManager, 'invalidateCache').mockReturnValue(undefined);

      // 1. 空 channelCode 返回失败
      const emptyRes = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent, { channelCode: '' })) as {
        success: boolean;
        error?: string;
      };
      expect(emptyRes.success).toBe(false);
      expect(emptyRes.error).toContain('不能为空');

      // 2. 提供 template 时调用 updateRemarkTemplateCache
      const updateRes = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent, {
        channelCode: 'meituan',
        template: '新美团模板',
      })) as { success: boolean; error?: string };
      expect(updateRes.success).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith('MEITUAN', '新美团模板');

      // 3. template 为 null 时同样调用 updateRemarkTemplateCache（支持置空模板缓存）
      const updateNullRes = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent, {
        channelCode: 'meituan',
        template: null,
      })) as { success: boolean; error?: string };
      expect(updateNullRes.success).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith('MEITUAN', null);

      // 4. template 为 undefined 时调用 invalidateRemarkTemplateCache
      const invalidateRes = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent, {
        channelCode: 'ctrip',
      })) as { success: boolean; error?: string };
      expect(invalidateRes.success).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledWith('CTRIP');
    });
  });
});

describe('Electron main 进程环境决策 (resolveProcessEnvironment)', () => {
  it('development mode uses the host mode and working directory', () => {
    const resolved = resolveProcessEnvironment({
      args: ['electron', '.'],
      currentMode: 'mock',
      isPackaged: false,
      cwd: '/project/root',
      appPath: '/packaged/app',
    });

    expect(resolved).toEqual({ mode: 'mock', startupMode: 'dev', cwd: '/project/root' });
  });

  it('development mode accepts an explicit CLI mode over the host mode', () => {
    const resolved = resolveProcessEnvironment({
      args: ['electron', '.', '--mode', 'mock'],
      currentMode: 'development',
      isPackaged: false,
      cwd: '/project/root',
      appPath: '/packaged/app',
    });

    expect(resolved).toEqual({ mode: 'mock', startupMode: 'dev', cwd: '/project/root' });
  });

  it('packaged mode defaults explicitly to production and reads the app path', () => {
    const resolved = resolveProcessEnvironment({
      args: ['electron', '.'],
      currentMode: 'development',
      isPackaged: true,
      cwd: '/ accidental/current/dir',
      appPath: '/packaged/app',
    });

    expect(resolved).toEqual({ mode: 'production', startupMode: 'built', cwd: '/packaged/app' });
  });

  it('accepts an explicit built startup mode', () => {
    const resolved = resolveProcessEnvironment({
      args: ['electron', '.', '--start-mode=built'],
      currentMode: 'production',
      isPackaged: false,
      cwd: '/project/root',
      appPath: '/packaged/app',
    });

    expect(resolved).toEqual({
      mode: 'production',
      startupMode: 'built',
      cwd: '/project/root',
    });
  });

  it('direct-built startup loads local files without a renderer server', () => {
    const resolved = resolveProcessEnvironment({
      args: ['electron', '.', '--start-mode', 'built'],
      currentMode: 'production',
      isPackaged: false,
      cwd: '/project/root',
      appPath: '/project/root',
    });

    expect(resolved.startupMode).toBe('built');
  });

  it('packaged startup forces built mode even when dev is requested', () => {
    const resolved = resolveProcessEnvironment({
      args: ['electron', '.', '--start-mode=dev'],
      currentMode: 'development',
      isPackaged: true,
      cwd: '/accidental/current/dir',
      appPath: '/packaged/app',
    });

    expect(resolved).toEqual({
      mode: 'production',
      startupMode: 'built',
      cwd: '/packaged/app',
    });
  });

  it('rejects an unknown startup mode', () => {
    expect(() =>
      resolveProcessEnvironment({
        args: ['electron', '.', '--start-mode=remote'],
        currentMode: 'production',
        isPackaged: false,
        cwd: '/project/root',
        appPath: '/packaged/app',
      })
    ).toThrow('启动模式无效: remote，仅支持 dev 或 built');
  });
});

describe('Electron main 视窗安全防护 (configureWindowSecurity)', () => {
  type NavigationEvent = { preventDefault: ReturnType<typeof vi.fn> };
  type NavigationHandler = (event: NavigationEvent, url: string) => void;

  beforeEach(() => {
    windowEvents.clear();
    vi.mocked(BrowserWindow).mockImplementation(() => ({
      loadFile: vi.fn().mockResolvedValue(undefined),
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          windowEvents.set(event, listener);
        }),
      },
      on: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    }) as unknown as Electron.BrowserWindow);
  });

  it('built mode allows only the packaged application entry and blocks dropped local files', async () => {
    process.env[PROCESS_ENV_KEYS.startupMode] = 'built';
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    await createMainWindow();

    const willNavigate = windowEvents.get('will-navigate') as NavigationHandler;
    const entryUrl = pathToFileURL(path.resolve(process.cwd(), 'dist/index.html')).href;
    const droppedFileUrl = pathToFileURL(path.resolve(process.cwd(), 'dropped.pdf')).href;
    const allowedEvent = { preventDefault: vi.fn() };
    const droppedEvent = { preventDefault: vi.fn() };
    const remoteEvent = { preventDefault: vi.fn() };

    willNavigate(allowedEvent, entryUrl);
    willNavigate(droppedEvent, droppedFileUrl);
    willNavigate(remoteEvent, 'https://example.com/page');

    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
    expect(droppedEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(remoteEvent.preventDefault).toHaveBeenCalledTimes(1);

    existsSyncSpy.mockRestore();
    delete process.env[PROCESS_ENV_KEYS.startupMode];
  });

  it('blocks webview attachment inside the application window', async () => {
    process.env[PROCESS_ENV_KEYS.startupMode] = 'built';
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    await createMainWindow();

    const willAttachWebview = windowEvents.get('will-attach-webview') as (event: {
      preventDefault: () => void;
    }) => void;
    const event = { preventDefault: vi.fn() };
    willAttachWebview(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);

    existsSyncSpy.mockRestore();
    delete process.env[PROCESS_ENV_KEYS.startupMode];
  });
});

describe('registerCrawlerIpcHandlers 采集日志流转与调度', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    registerCrawlerIpcHandlers();
  });

  it('crawler:collect-hotels 触发采集时向 onLog 注入回调并流转至 logger.track', async () => {
    const handler = ipcHandlers.get('crawler:collect-hotels');
    expect(handler).toBeDefined();

    const trackSpy = vi.spyOn(logger, 'track').mockImplementation(vi.fn() as never);
    vi.spyOn(hotelCollectionEngine, 'collectHotels').mockImplementation(
      async (_request, onLog) => {
        if (onLog) {
          onLog({
            level: 'PLAYWRIGHT',
            message: '开始门店采集',
            details: '启动浏览器中',
          });
          onLog({
            level: 'SUCCESS',
            message: '门店采集成功',
          });
        }
        return {
          success: true,
          channelCode: 'MEITUAN',
          hotels: [],
          diagnostics: {
            targetUrl: 'https://test',
            source: 'test',
            scannedCount: 0,
            discoveredCount: 0,
            verifiedEmpty: true,
            durationMs: 100,
            warnings: [],
          },
        };
      }
    );

    const result = await handler!({}, { channelCode: 'meituan' });
    expect((result as { success: boolean }).success).toBe(true);

    expect(trackSpy).toHaveBeenCalledWith('CRAWLER_LOG', {
      module: 'HOTEL',
      level: 'INFO',
      message: '开始门店采集',
      details: '启动浏览器中',
    });

    expect(trackSpy).toHaveBeenCalledWith('CRAWLER_LOG', {
      module: 'HOTEL',
      level: 'SUCCESS',
      message: '门店采集成功',
      details: undefined,
    });
  });

  it('crawler:collect-products 触发采集时向 onLog 注入回调并流转至 logger.track', async () => {
    const handler = ipcHandlers.get('crawler:collect-products');
    expect(handler).toBeDefined();

    const trackSpy = vi.spyOn(logger, 'track').mockImplementation(vi.fn() as never);
    vi.spyOn(hotelCollectionEngine, 'collectProducts').mockImplementation(
      async (_request, onLog) => {
        if (onLog) {
          onLog({
            level: 'PLAYWRIGHT',
            message: '开始商品采集',
            details: '导航到商品列表',
          });
          onLog({
            level: 'ERROR',
            message: '采集部分失败',
            details: '网络波动',
          });
        }
        return {
          success: true,
          channelCode: 'MEITUAN',
          extUnitCode: 'POI-1',
          products: [],
        };
      }
    );

    const result = await handler!(
      {},
      { channelCode: 'meituan', extUnitCode: 'POI-1' }
    );
    expect((result as { success: boolean }).success).toBe(true);

    expect(trackSpy).toHaveBeenCalledWith('CRAWLER_LOG', {
      module: 'PRODUCT',
      level: 'INFO',
      message: '开始商品采集',
      details: '导航到商品列表',
    });

    expect(trackSpy).toHaveBeenCalledWith('CRAWLER_LOG', {
      module: 'PRODUCT',
      level: 'ERROR',
      message: '采集部分失败',
      details: '网络波动',
    });
  });
});

