import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { hotelCollectionEngine } from '../src/crawler/engine';
import { syncChromeProfile } from '../src/crawler/profileSync';
import { dutyOrchestrationEngine } from '../src/crawler/duty/dutyOrchestrationEngine';
import {
  initNodePlatformTokens,
  savePlatformTokenFile,
  clearPlatformTokenFile,
} from '../src/crawler/duty/platformTokenStore';
import { saveTokensToStorage, clearTokensFromStorage } from '../src/services/platformAuth';
import type { HotelCrawlRequest, HotelCrawlResult } from '../src/crawler/types';
import type { PlatformAuthTokens } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

/**
 * 从本地配置文件安全解析并加载环境变量至当前 Node 进程
 */
function parseAndLoadEnvFile(envPath: string, override = false): void {
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && (override || process.env[key] === undefined)) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // 忽略加载异常
  }
}

/**
 * 初始化 Electron 主进程环境变量（支持 --mode 与单一数据源对齐）
 */
export function initProcessEnvironment(): void {
  const args = process.argv.slice(2);
  let mode = process.env.MODE || 'development';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1].trim();
      break;
    }
  }

  const cwd = process.cwd();
  parseAndLoadEnvFile(path.resolve(cwd, '.env'), false);
  if (mode && mode !== 'development') {
    parseAndLoadEnvFile(path.resolve(cwd, `.env.${mode}`), true);
  }
  parseAndLoadEnvFile(path.resolve(cwd, '.env.local'), true);
  if (mode && mode !== 'development') {
    parseAndLoadEnvFile(path.resolve(cwd, `.env.${mode}.local`), true);
  }
  process.env.MODE = mode;
}

initProcessEnvironment();


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
        return await hotelCollectionEngine.collectHotels({
          ...request,
          channelCode: code,
        });
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

  // 2. Profile 本地登录态同步
  ipcMain.handle(
    'crawler:sync-profile',
    async (_event, channelCode?: string) => {
      try {
        const code = (channelCode || 'MEITUAN').trim().toUpperCase();
        const result = syncChromeProfile({ channelCode: code });
        return result;
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
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
      return { success: false, message: '渠道编码不能为空' };
    }
    try {
      const res = await dutyOrchestrationEngine.startDuty(code);
      return res;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('duty:stop', async (_event, channelCode: string) => {
    const code = (channelCode || '').trim().toUpperCase();
    if (!code) {
      return { success: false, message: '渠道编码不能为空' };
    }
    try {
      const res = await dutyOrchestrationEngine.stopDuty(code);
      return res;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
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
      return { success: false, message: '无效的 Token 载荷' };
    }
    saveTokensToStorage(tokens);
    savePlatformTokenFile(tokens);
    return { success: true };
  });

  ipcMain.handle('duty:clear-tokens', async () => {
    clearTokensFromStorage();
    clearPlatformTokenFile();
    return { success: true };
  });

  dutyOrchestrationEngine.subscribeLogs((entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('duty:log-entry', entry);
    }
  });
}

/**
 * 使用轻量 HTTP GET 检测本地开发服务是否就绪 (无 Chromium 控制台刷屏异常)
 */
function probeHttpServer(urlStr: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const req = http.get(
        {
          hostname: u.hostname,
          port: u.port || 80,
          path: '/',
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * 智能加载视窗内容：优先连接 Vite 开发服务器；若未启动则平滑回退加载已构建的本地 dist/index.html
 */
async function loadWindowContent(window: BrowserWindow): Promise<void> {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
  const indexPath = path.resolve(__dirname, '../dist/index.html');

  // 1. 如果处于已打包环境，直接加载本地静态单页应用
  if (app.isPackaged) {
    if (fs.existsSync(indexPath)) {
      await window.loadFile(indexPath);
      return;
    }
    throw new Error(`未找到已打包的应用主页文件: ${indexPath}`);
  }

  // 2. 开发环境下，优先检测 Vite 开发服务器是否已就绪 (最多静默探测 4 次，共约 1.5 秒)
  const maxProbes = 4;
  for (let i = 1; i <= maxProbes; i++) {
    const isReady = await probeHttpServer(devServerUrl, 400);
    if (isReady) {
      try {
        await window.loadURL(devServerUrl);
        return;
      } catch {
        // 若瞬时加载异常，继续重试
      }
    }
    if (i < maxProbes) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  // 3. 若本地 Vite 开发服务器未启动，但已存在构建产物 dist/index.html，平滑回退至本地产物，杜绝白屏
  if (fs.existsSync(indexPath)) {
    console.info('[Smart-Link] 未检测到运行中的 Vite 开发服务器，平滑加载本地已构建产物 (dist/index.html)...');
    await window.loadFile(indexPath);
    return;
  }

  // 4. 若两者均未就绪，呈现科技灰蓝设计风格指引页面，拒绝白屏崩溃
  const guideHtml = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <title>Smart-Link 智能直连控制台 - 正在准备开发环境</title>
      <style>
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #f8f9ff;
          color: #0b1c30;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .card {
          background: #ffffff;
          border: 1px solid #dce9ff;
          border-radius: 12px;
          padding: 32px;
          max-width: 540px;
          box-shadow: 0 4px 16px rgba(0, 74, 198, 0.06);
          text-align: center;
        }
        .title {
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 12px;
          color: #004ac6;
        }
        .desc {
          font-size: 13px;
          color: #737686;
          line-height: 1.6;
          margin-bottom: 20px;
        }
        .code-box {
          background: #0b1c30;
          color: #93c5fd;
          padding: 12px 16px;
          border-radius: 8px;
          font-family: monospace;
          font-size: 12px;
          text-align: left;
          margin-bottom: 24px;
        }
        .btn {
          display: inline-block;
          background: #004ac6;
          color: #ffffff;
          border: none;
          padding: 10px 24px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        .btn:hover {
          background: #003da6;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="title">正在等待本地开发服务启动</div>
        <div class="desc">
          当前未检测到正在运行的 Vite 开发服务器 (<code>${devServerUrl}</code>)，且未找到本地构建文件。
        </div>
        <div class="code-box">
          # 启动 Vite 开发服务：<br/>
          &gt; npm run dev<br/><br/>
          # 或一键构建后启动：<br/>
          &gt; npm run build &amp;&amp; npm run dev:electron
        </div>
        <button class="btn" onclick="window.location.reload()">重新连接</button>
      </div>
    </body>
    </html>
  `;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(guideHtml)}`);
}

/**
 * 创建应用主视窗
 */
export async function createMainWindow(): Promise<BrowserWindow> {
  const preloadPath = path.resolve(__dirname, 'preload.cjs');

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

  // 外部链接默认在系统默认浏览器中打开，避免劫持应用视窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  try {
    await loadWindowContent(mainWindow);
  } catch (error) {
    console.error('[Smart-Link] 加载主视窗内容异常:', error);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// 仅在被 Electron 主进程直接启动时激活生命周期
if (process.type === 'browser') {
  app.whenReady().then(async () => {
    // 注入应用数据持久化目录，防止在打包后的只读安装目录下引发 EACCES
    process.env.SMARTLINK_USER_DATA_DIR = app.getPath('userData');

    // 初始化已持久化的文旅平台 Token 凭据至 Node 内存
    initNodePlatformTokens();

    // 默认平台网关环境变量托管（若宿主环境未指定）
    if (!process.env.VITE_PLATFORM_BASE_URL) {
      process.env.VITE_PLATFORM_BASE_URL = 'https://xctp-api.devops.foxhis.com';
    }

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
