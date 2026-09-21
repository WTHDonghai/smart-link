import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { hotelCollectionEngine } from '../src/crawler/engine';
import { syncChromeSessionViaCDP } from '../src/crawler/profileSync';
import { dutyOrchestrationEngine } from '../src/crawler/duty/dutyOrchestrationEngine';
import { closeAllBrowserSessions } from '../src/crawler/browserManager';
import { logger } from '../src/services/logger';
import {
  initNodePlatformTokens,
  savePlatformTokenFile,
  clearPlatformTokenFile,
} from '../src/crawler/duty/platformTokenStore';
import { stationIdentityManager } from '../src/crawler/duty/stationIdentity';
import { saveTokensToStorage, clearTokensFromStorage } from '../src/services/platformAuth';
import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  ProductCrawlRequest,
  ProductCrawlResult,
} from '../src/crawler/types';
import type {
  DesktopOperationResult,
  PlatformAuthTokens,
  PlatformBridgeRequestOptions,
  PlatformBridgeResponse,
  SystemLogEntry,
} from '../src/types';
import { loadProjectEnv } from '../src/config/envLoader';
import rendererServerConfig from '../src/config/rendererServer.json';
import { PROCESS_ENV_KEYS } from '../src/types/env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

const rendererAssetServerUrl = rendererServerConfig.url;
const MAX_PENDING_MAIN_LOGS = 50;

const pendingMainLogs = new Map<string, SystemLogEntry>();
let mainLogStreamDrained = false;

function publishMainLog(entry: SystemLogEntry): void {
  if (!mainLogStreamDrained) {
    pendingMainLogs.delete(entry.id);
    pendingMainLogs.set(entry.id, entry);
    if (pendingMainLogs.size > MAX_PENDING_MAIN_LOGS) {
      const oldestLogId = pendingMainLogs.keys().next().value;
      if (oldestLogId !== undefined) {
        pendingMainLogs.delete(oldestLogId);
      }
    }
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('host:log-entry', entry);
  }
}

function registerMainLogIpcHandlers(): void {
  ipcMain.handle('host:pending-logs', () => {
    const entries = [...pendingMainLogs.values()];
    pendingMainLogs.clear();
    mainLogStreamDrained = true;
    return entries;
  });

}

if (process.type === 'browser') {
  logger.subscribe(publishMainLog);
}

export interface ProcessEnvironmentHost {
  args: readonly string[];
  currentMode: string | undefined;
  isPackaged: boolean;
  cwd: string;
  appPath: string;
}

export type ApplicationStartupMode = 'dev' | 'built';

export interface ApplicationTeardownResult {
  completed: boolean;
  timedOut: boolean;
  failureReasons: string[];
}

function getCliOption(args: readonly string[], name: string): string | undefined {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1]?.trim();
  return args.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
}

export function resolveProcessEnvironment(host: ProcessEnvironmentHost): {
  mode: string;
  startupMode: ApplicationStartupMode;
  cwd: string;
} {
  const cliMode = getCliOption(host.args, 'mode');
  const cliStartupMode = getCliOption(host.args, 'start-mode');

  const fallbackMode = host.isPackaged ? 'production' : 'development';
  const mode =
    cliMode ||
    (host.isPackaged ? fallbackMode : host.currentMode?.trim() || fallbackMode);

  const startupMode: ApplicationStartupMode = host.isPackaged
    ? 'built'
    : cliStartupMode === 'built'
      ? 'built'
      : 'dev';

  if (cliStartupMode && cliStartupMode !== 'built' && cliStartupMode !== 'dev') {
    throw new Error(`启动模式无效: ${cliStartupMode}，仅支持 dev 或 built`);
  }

  return {
    mode,
    startupMode,
    cwd: host.isPackaged ? host.appPath : host.cwd,
  };
}

function initProcessEnvironment(): void {
  if (!gotSingleInstanceLock) {
    return;
  }

  const { mode, startupMode, cwd } = resolveProcessEnvironment({
    args: process.argv.slice(2),
    currentMode: process.env[PROCESS_ENV_KEYS.mode],
    isPackaged: app.isPackaged,
    cwd: process.cwd(),
    appPath: app.getAppPath(),
  });

  const projectEnv = loadProjectEnv(mode, cwd);
  for (const [key, value] of Object.entries(projectEnv)) {
    process.env[key] = value;
  }
  process.env[PROCESS_ENV_KEYS.mode] = mode;
  process.env[PROCESS_ENV_KEYS.startupMode] = startupMode;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  initProcessEnvironment();

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}


/**
 * 注册桌面端原生 IPC 通信监听器
 */
export function registerCrawlerIpcHandlers(): void {
  // 1. 门店自动化采集 (直接调度 hotelCollectionEngine，零 HTTP 端口开销)
  ipcMain.handle(
    'crawler:collect-hotels',
    async (_event, request: HotelCrawlRequest): Promise<HotelCrawlResult> => {
      try {
        const code = (request.channelCode || '').trim().toUpperCase();
        if (!code) {
          throw new Error('未指定采集渠道代码 channelCode');
        }
        return await hotelCollectionEngine.collectHotels(
          {
            ...request,
            channelCode: code,
          },
          (logPayload) => {
            logger.track('CRAWLER_LOG', {
              module: 'HOTEL',
              level: logPayload.level === 'PLAYWRIGHT' ? 'INFO' : logPayload.level,
              message: logPayload.message,
              details: logPayload.details,
            });
          }
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          channelCode: request?.channelCode || '',
          error: errorMsg,
          hotels: [],
          diagnostics: {
            targetUrl: '',
            source: 'electron-main-ipc',
            scannedCount: 0,
            discoveredCount: 0,
            verifiedEmpty: true,
            durationMs: 0,
            warnings: [errorMsg],
          },
        };
      }
    }
  );

  // 2. 产品自动化采集 (直接调度 hotelCollectionEngine.collectProducts)
  ipcMain.handle(
    'crawler:collect-products',
    async (_event, request: ProductCrawlRequest): Promise<ProductCrawlResult> => {
      try {
        const code = (request.channelCode || '').trim().toUpperCase();
        if (!code) {
          throw new Error('未指定采集渠道代码 channelCode');
        }
        const extUnitCode = (request.extUnitCode || '').trim();
        if (!extUnitCode) {
          throw new Error('未指定外部门店编码 extUnitCode');
        }
        return await hotelCollectionEngine.collectProducts(
          {
            ...request,
            channelCode: code,
            extUnitCode,
          },
          (logPayload) => {
            logger.track('CRAWLER_LOG', {
              module: 'PRODUCT',
              level: logPayload.level === 'PLAYWRIGHT' ? 'INFO' : logPayload.level,
              message: logPayload.message,
              details: logPayload.details,
            });
          }
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          channelCode: request?.channelCode || '',
          extUnitCode: request?.extUnitCode || '',
          error: errorMsg,
          products: [],
        };
      }
    }
  );

  // 2. Profile 本地登录态同步 (开发阶段：CDP 调试端口精准同步)
  ipcMain.handle(
    'crawler:sync-profile',
    async (_event, channelCode?: string) => {
      try {
        const code = (channelCode || 'MEITUAN').trim().toUpperCase();
        const result = await syncChromeSessionViaCDP({ channelCode: code });
        return result;
      } catch (error) {
        return {
          success: false,
          sourceDir: '',
          sourceProfile: '',
          targetDir: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );
}

/**
 * 注册文旅平台网络请求原生代理 IPC 监听器
 * 由 Electron 主进程 Node.js 原生发起，彻底脱离浏览器端 CORS 与 OPTIONS 预检限制
 */
export function registerPlatformIpcHandlers(): void {
  ipcMain.handle(
    'platform:request',
    async (_event, options: PlatformBridgeRequestOptions): Promise<PlatformBridgeResponse> => {
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 15000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(options.url, {
          method: (options.method || 'GET').toUpperCase(),
          headers: options.headers,
          body: options.body,
          signal: controller.signal,
        });

        const text = await response.text();
        const headersRecord: Record<string, string> = {};
        response.headers.forEach((val, key) => {
          headersRecord[key.toLowerCase()] = val;
        });

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: headersRecord,
          body: text,
        };
      } finally {
        clearTimeout(timer);
      }
    }
  );
}

/**
 * 注册桌面端原生值守 IPC 监听器
 */
export function registerDutyIpcHandlers(): void {
  ipcMain.handle('duty:start', async (_event, channelCode: string) => {
    const code = (channelCode || '').trim().toUpperCase();
    if (!code) {
      return { success: false, error: '渠道编码不能为空' };
    }
    try {
      const res = await dutyOrchestrationEngine.startDuty(code);
      return { success: res.success, error: res.error } satisfies DesktopOperationResult;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('duty:stop', async (_event, channelCode: string) => {
    const code = (channelCode || '').trim().toUpperCase();
    if (!code) {
      return { success: false, error: '渠道编码不能为空' };
    }
    try {
      const res = await dutyOrchestrationEngine.stopDuty(code);
      return { success: res.success, error: res.error } satisfies DesktopOperationResult;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('duty:status', async (_event, since?: number) => {
    return {
      channels: dutyOrchestrationEngine.getChannelDutyStatus(),
      coordinatorStatus: dutyOrchestrationEngine.getCoordinatorStatus(),
      station: dutyOrchestrationEngine.getStationIdentity(),
      logs: dutyOrchestrationEngine.getRecentDutyLogs(since || 0),
    };
  });

  ipcMain.handle('duty:sync-tokens', async (_event, tokens: PlatformAuthTokens) => {
    if (!tokens || !tokens.accessToken) {
      return { success: false, error: '无效的 Token 载荷' };
    }

    try {
      saveTokensToStorage(tokens);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const fileResult = savePlatformTokenFile(tokens);
    if (!fileResult.success) {
      return { success: false, error: fileResult.error };
    }

    if (tokens.platformBaseUrl) {
      stationIdentityManager.setPlatformBaseUrl(tokens.platformBaseUrl);
    }

    return { success: true };
  });

  ipcMain.handle('duty:clear-tokens', async () => {
    clearTokensFromStorage();
    clearPlatformTokenFile();
    return { success: true };
  });

  // 3. 一键停止所有渠道值守与后台调度
  ipcMain.handle('duty:stop-all', async () => {
    try {
      const result = await dutyOrchestrationEngine.stopAllDuty();
      return { success: result.success, error: result.error } satisfies DesktopOperationResult;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // 4. 应用级退出与全量资源回收调度
  ipcMain.handle('app:teardown', async () => {
    try {
      const result = await teardownApplicationResources();
      return {
        success: result.completed && result.failureReasons.length === 0,
        error: result.failureReasons.join('; ') || undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  dutyOrchestrationEngine.subscribeLogs(publishMainLog);
}

let isTearingDown = false;
let teardownPromise: Promise<ApplicationTeardownResult> | null = null;

/**
 * 唯一的应用退出与全量资源回收调度函数
 * 具备幂等性防护、2.5 秒超时兜底熔断与异常隔离保障，按序关闭值守、清退浏览器子进程并持久化日志
 */
export async function teardownApplicationResources(
  timeoutMs = 2500
): Promise<ApplicationTeardownResult> {
  if (isTearingDown && teardownPromise) {
    return teardownPromise;
  }
  isTearingDown = true;

  const teardownAction = async (): Promise<ApplicationTeardownResult> => {
    const failureReasons: string[] = [];

    // 1. 停止所有值守任务、清除心跳并通知中台离线
    try {
      const result = await dutyOrchestrationEngine.stopAllDuty();
      if (!result.success) {
        failureReasons.push(result.error || '停止值守任务失败');
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failureReasons.push(reason);
      logger.warn('[Smart-Link] 停止值守任务异常', {
        module: 'SYSTEM',
        details: reason,
      });
    }

    // 2. 并发安全关闭所有未释放的 BrowserContext，清空活跃集合并释放 Profile 物理锁文件
    try {
      await closeAllBrowserSessions();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failureReasons.push(reason);
      logger.warn('[Smart-Link] 关闭浏览器子进程异常', {
        module: 'SYSTEM',
        details: reason,
      });
    }

    return { completed: true, timedOut: false, failureReasons };
  };

  const timeoutFallback = new Promise<ApplicationTeardownResult>((resolve) => {
    const timer = setTimeout(() => {
      const reason = `资源回收超时 ${timeoutMs}ms`;
      logger.warn(`[Smart-Link] teardownApplicationResources 超时 ${timeoutMs}ms，执行强制兜底熔断`, {
        module: 'SYSTEM',
      });
      resolve({ completed: false, timedOut: true, failureReasons: [reason] });
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });

  teardownPromise = Promise.race([teardownAction(), timeoutFallback]);
  return await teardownPromise;
}

/**
 * 重置资源回收状态标志（仅供单元测试隔离使用）
 */
export function resetTeardownStateForTest(): void {
  isTearingDown = false;
  teardownPromise = null;
}

/**
 * 加载视窗内容：打包态读取本地构建产物，开发态仅连接 Electron 渲染层资源服务。
 */
async function loadWindowContent(
  window: BrowserWindow,
  startupMode: ApplicationStartupMode
): Promise<void> {
  const indexPath = path.resolve(__dirname, '../dist/index.html');

  // 1. built 模式（打包态或 start:built）直接加载新构建产物。
  if (startupMode === 'built') {
    if (fs.existsSync(indexPath)) {
      await window.loadFile(indexPath);
      return;
    }
    throw new Error(`未找到已打包的应用主页文件: ${indexPath}`);
  }

  // 2. dev 模式由 devRunner 先确保资源服务就绪；这里不可回退到旧构建产物。
  await window.loadURL(rendererAssetServerUrl);
}

function isAllowedNavigationUrl(
  navigationUrl: string,
  startupMode: ApplicationStartupMode,
  builtIndexPath: string
): boolean {
  try {
    const parsedUrl = new URL(navigationUrl);
    if (startupMode === 'dev') {
      return parsedUrl.origin === new URL(rendererAssetServerUrl).origin;
    }
    return parsedUrl.protocol === 'file:' && fileURLToPath(parsedUrl) === builtIndexPath;
  } catch {
    return false;
  }
}

function configureWindowSecurity(
  window: BrowserWindow,
  startupMode: ApplicationStartupMode,
  builtIndexPath: string
): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') {
        void shell.openExternal(url);
      }
    } catch {
      // Invalid payloads are denied; they are never handed to the OS.
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedNavigationUrl(navigationUrl, startupMode, builtIndexPath)) {
      event.preventDefault();
    }
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

/**
 * 创建应用主视窗
 */
export async function createMainWindow(): Promise<BrowserWindow> {
  const preloadPath = path.resolve(__dirname, 'preload.cjs');
  const builtIndexPath = path.resolve(__dirname, '../dist/index.html');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'Smart-Link 智能直连控制台',
    backgroundColor: '#f8f9ff',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try {
    const startupMode = process.env[PROCESS_ENV_KEYS.startupMode] === 'built' ? 'built' : 'dev';
    configureWindowSecurity(mainWindow, startupMode, builtIndexPath);
    await loadWindowContent(mainWindow, startupMode);
  } catch (error) {
    logger.error('[Smart-Link] 加载主视窗内容异常', {
      module: 'SYSTEM',
      details: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    mainLogStreamDrained = false;
  });

  return mainWindow;
}

let isAppQuitting = false;

// 仅在被 Electron 主进程直接启动时激活生命周期
if (process.type === 'browser') {
  // 拦截应用退出，保证后台值守、浏览器子进程与日志资源彻底清理完成后退出
  app.on('before-quit', (event) => {
    if (isAppQuitting) {
      return;
    }
    event.preventDefault();
    isAppQuitting = true;
    void teardownApplicationResources().finally(() => {
      app.exit(0);
    });
  });

  // 注册操作系统中断信号处理
  process.on('SIGINT', () => {
    void teardownApplicationResources().finally(() => {
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    void teardownApplicationResources().finally(() => {
      process.exit(0);
    });
  });

  app.whenReady().then(async () => {
    // 注入应用数据持久化目录，防止在打包后的只读安装目录下引发 EACCES
    process.env[PROCESS_ENV_KEYS.userDataDir] = app.getPath('userData');

    // 初始化已持久化的文旅平台 Token 凭据至 Node 内存
    initNodePlatformTokens();

    registerMainLogIpcHandlers();
    registerPlatformIpcHandlers();
    registerCrawlerIpcHandlers();
    registerDutyIpcHandlers();
    await createMainWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
