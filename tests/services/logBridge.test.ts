import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeHostLogs, takePendingHostLogs } from '../../src/services/logBridge';
import type { SystemLogEntry } from '../../src/types';

describe('logBridge - 跨进程宿主系统日志桥接网关', () => {
  const hostWindow = window as unknown as { host?: Record<string, unknown> };
  const originalHost = hostWindow.host;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    hostWindow.host = originalHost;
  });

  it('当非 Electron 宿主 (缺少 window.host) 时，调用均应 Fail-Fast 抛出异常', async () => {
    delete hostWindow.host;

    expect(() => subscribeHostLogs(() => undefined)).toThrow(
      '系统日志监听仅支持桌面端 Electron 运行环境'
    );
    await expect(takePendingHostLogs()).rejects.toThrow(
      '系统日志监听仅支持桌面端 Electron 运行环境'
    );
  });

  it('优先委托 window.host.log.onLog 订阅日志并返回 unsubscribe 取消订阅函数', () => {
    const unsubMock = vi.fn();
    const onLogMock = vi.fn().mockReturnValue(unsubMock);
    hostWindow.host = {
      log: {
        onLog: onLogMock,
        takePendingLogs: vi.fn(),
      },
    };

    const listener = vi.fn();
    const unsubscribe = subscribeHostLogs(listener);

    expect(onLogMock).toHaveBeenCalledWith(listener);
    unsubscribe();
    expect(unsubMock).toHaveBeenCalledTimes(1);
  });

  it('优先委托 window.host.log.takePendingLogs 取回启动暂存日志', async () => {
    const mockLogs: SystemLogEntry[] = [
      {
        id: 'log-cold-start-1',
        timestamp: '2026-09-22 10:00:00.000',
        createdAt: 1000,
        level: 'INFO',
        message: '冷启动暂存日志',
      },
    ];
    const takePendingLogsMock = vi.fn().mockResolvedValue(mockLogs);
    hostWindow.host = {
      log: {
        onLog: vi.fn(),
        takePendingLogs: takePendingLogsMock,
      },
    };

    const result = await takePendingHostLogs();
    expect(takePendingLogsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockLogs);
  });

  it('当仅有其他 host 模块但缺少 host.log 时，调用均应 Fail-Fast 抛出异常', async () => {
    hostWindow.host = {
      duty: {},
    };

    expect(() => subscribeHostLogs(() => undefined)).toThrow(
      '系统日志监听仅支持桌面端 Electron 运行环境'
    );
    await expect(takePendingHostLogs()).rejects.toThrow(
      '系统日志监听仅支持桌面端 Electron 运行环境'
    );
  });
});
