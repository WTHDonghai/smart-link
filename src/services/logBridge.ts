import type { SystemLogEntry, LogBridgeApi } from '../types';

function getLogApi(): LogBridgeApi {
  const host = window.host;
  if (!host?.log) {
    throw new Error('系统日志监听仅支持桌面端 Electron 运行环境');
  }
  return host.log;
}

/**
 * 订阅 Electron 宿主全链路系统运行与调度日志流
 * 产生任何日志条目时，即刻通过回调函数通知
 *
 * @param callback 日志条目接收回调
 * @returns 取消监听的清理函数
 */
export function subscribeHostLogs(callback: (entry: SystemLogEntry) => void): () => void {
  return getLogApi().onLog(callback);
}

/**
 * 取回应用冷启动期间在宿主主进程中暂存的日志队列，并在取回后由宿主自动清空
 * 供渲染进程挂载时进行一次性日志追溯与回放
 */
export async function takePendingHostLogs(): Promise<SystemLogEntry[]> {
  return getLogApi().takePendingLogs();
}
