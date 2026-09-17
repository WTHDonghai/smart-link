const { mockIpcMain, ipcHandlers, appListeners } = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const appListeners = new Map<string, (...args: unknown[]) => void>();
  const mockIpcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    }),
  };
  return { mockIpcMain, ipcHandlers, appListeners };
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn().mockReturnValue('/mock/user/data'),
      isPackaged: false,
      whenReady: vi.fn().mockResolvedValue(undefined),
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
      },
      on: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    })),
    ipcMain: mockIpcMain,
    shell: {
      openExternal: vi.fn(),
    },
  };
});

import {
  teardownApplicationResources,
  resetTeardownStateForTest,
  registerDutyIpcHandlers,
} from '../../electron/main';
import { dutyOrchestrationEngine } from '../../src/crawler/duty/dutyOrchestrationEngine';
import * as browserManager from '../../src/crawler/browserManager';
import { logger } from '../../src/services/logger';

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
    it('严格按序执行：1. 停止值守任务 -> 2. 关闭所有浏览器会话 -> 3. 刷新日志存储', async () => {
      const executionOrder: string[] = [];

      vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockImplementation(async () => {
        executionOrder.push('stopAllDuty');
        return { success: true, message: 'stopped' };
      });

      vi.spyOn(browserManager, 'closeAllBrowserSessions').mockImplementation(async () => {
        executionOrder.push('closeAllBrowserSessions');
      });

      vi.spyOn(logger, 'flushStorage').mockImplementation(async () => {
        executionOrder.push('flushStorage');
      });

      await teardownApplicationResources();

      // 精准断言调用顺序
      expect(executionOrder).toEqual(['stopAllDuty', 'closeAllBrowserSessions', 'flushStorage']);

      // 精准断言各清理模块调用次数确切为 1
      expect(dutyOrchestrationEngine.stopAllDuty).toHaveBeenCalledTimes(1);
      expect(browserManager.closeAllBrowserSessions).toHaveBeenCalledTimes(1);
      expect(logger.flushStorage).toHaveBeenCalledTimes(1);
    });
  });

  describe('幂等性防护与防重入 (Idempotency)', () => {
    it('多次并发调用 teardown 时，仅触发一次真实的底层资源回收', async () => {
      const stopAllSpy = vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockResolvedValue({
        success: true,
        message: 'stopped',
      });
      const closeSessionsSpy = vi.spyOn(browserManager, 'closeAllBrowserSessions').mockResolvedValue();
      const flushStorageSpy = vi.spyOn(logger, 'flushStorage').mockResolvedValue();

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
      expect(flushStorageSpy).toHaveBeenCalledTimes(1);
    });

    it('teardown 完成后再调用，直接返回已完成状态，不再重复清理', async () => {
      const stopAllSpy = vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockResolvedValue({
        success: true,
        message: 'stopped',
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
      await teardownApplicationResources(50);
      const elapsed = Date.now() - startTime;

      // 核心断言：在熔断阈值附近返回（允许正常系统调度时延），绝不无限等待
      expect(elapsed).toBeGreaterThanOrEqual(45);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('异常容错隔离 (Fail-Safe on Cleanup)', () => {
    it('当值守引擎抛错时，异常被隔离，后续浏览器清理与日志刷新依然正常执行', async () => {
      vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockRejectedValue(
        new Error('值守停止网络通信失败')
      );
      const closeSessionsSpy = vi.spyOn(browserManager, 'closeAllBrowserSessions').mockResolvedValue();
      const flushStorageSpy = vi.spyOn(logger, 'flushStorage').mockResolvedValue();

      await expect(teardownApplicationResources()).resolves.not.toThrow();

      expect(closeSessionsSpy).toHaveBeenCalledTimes(1);
      expect(flushStorageSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('IPC 处理器注册 (duty:stop-all 与 app:teardown)', () => {
    it('正确注册 duty:stop-all 处理器并调度 stopAllDuty', async () => {
      registerDutyIpcHandlers();

      expect(ipcHandlers.has('duty:stop-all')).toBe(true);

      const stopSpy = vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockResolvedValueOnce({
        success: true,
        message: '值守全部安全终止',
      });

      const handler = ipcHandlers.get('duty:stop-all')!;
      const result = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent)) as {
        success: boolean;
        message: string;
      };

      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.message).toBe('值守全部安全终止');
    });

    it('正确注册 app:teardown 处理器并调度 teardownApplicationResources', async () => {
      registerDutyIpcHandlers();

      expect(ipcHandlers.has('app:teardown')).toBe(true);

      const stopSpy = vi.spyOn(dutyOrchestrationEngine, 'stopAllDuty').mockResolvedValueOnce({
        success: true,
        message: 'stopped',
      });
      const closeSessionsSpy = vi.spyOn(browserManager, 'closeAllBrowserSessions').mockResolvedValueOnce();
      const flushStorageSpy = vi.spyOn(logger, 'flushStorage').mockResolvedValueOnce();

      const handler = ipcHandlers.get('app:teardown')!;
      const result = (await handler(undefined as unknown as Electron.IpcMainInvokeEvent)) as {
        success: boolean;
      };

      expect(result.success).toBe(true);
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(closeSessionsSpy).toHaveBeenCalledTimes(1);
      expect(flushStorageSpy).toHaveBeenCalledTimes(1);
    });
  });
});
