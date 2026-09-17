import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { hotelCollectionEngine } from '../src/crawler/engine';
import { syncChromeProfile } from '../src/crawler/profileSync';
import type { HotelCrawlRequest, HotelCrawlResult } from '../src/crawler/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

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

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    try {
      await mainWindow.loadURL(devServerUrl);
    } catch {
      // 若 Vite 尚未完全就绪，1秒后重试一次
      setTimeout(() => {
        mainWindow?.loadURL(devServerUrl);
      }, 1000);
    }
  } else {
    const indexPath = path.resolve(__dirname, '../dist/index.html');
    await mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// 仅在被 Electron 主进程直接启动时激活生命周期
if (process.type === 'browser') {
  app.whenReady().then(async () => {
    registerCrawlerIpcHandlers();
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
