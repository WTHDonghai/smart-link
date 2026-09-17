import {
  SystemLogEntry,
  LogLevel,
  LogModule,
  LogEventType,
  LogFilterParams,
  DutyTaskMessageType,
} from '../types';
import { logStorage, formatLogTimestamp } from './logStorage';

export interface TrackOptions {
  module?: LogModule;
  level?: LogLevel;
  message?: string;
  channelId?: string;
  orderNo?: string;
  durationMs?: number;
  details?: string;
  meta?: Record<string, unknown>;

  // 任务上下文元字段
  taskId?: string;
  msgType?: DutyTaskMessageType | string;
  taskActionStage?: 'CLAIM' | 'EXECUTE' | 'RESULT' | 'REPORT';
  taskStatus?: 'SUCCEEDED' | 'FAILED' | 'PROCESSING' | 'PENDING';
  taskResult?: unknown;

  // 接口请求专有元字段 (API Request & Response Metadata)
  apiUrl?: string;
  apiMethod?: string;
  apiParams?: unknown;
  apiResponse?: unknown;
  httpStatus?: number;
}

export type LogListener = (entry: SystemLogEntry) => void;

export class LoggerService {
  private listeners: Set<LogListener> = new Set();
  private writeBuffer: SystemLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isInitialized = false;

  /**
   * 注册日志流监听器（供 Redux Store 或实时 UI 挂载）
   */
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 初始化日志中枢：启动自动清理 7 天前过期历史并初始化 IndexedDB
   */
  async init(options?: {
    onLog?: LogListener;
    autoPurge7Days?: boolean;
  }): Promise<void> {
    if (options?.onLog) {
      this.subscribe(options.onLog);
    }

    if (!this.isInitialized) {
      this.isInitialized = true;
      try {
        await logStorage.initDB();
        if (options?.autoPurge7Days !== false) {
          const purgedCount = await logStorage.purgeLogsOlderThan7Days();
          if (purgedCount > 0) {
            this.track('SYS_STORAGE_PURGE', {
              module: 'SYSTEM',
              level: 'INFO',
              message: `[System] 启动时自动清理 7 天前历史日志完成`,
              details: `已清理 ${purgedCount} 条过期记录`,
              meta: { purgedCount },
            });
          }
        }
      } catch {
        // 确保初始化不抛错阻断整个应用
      }
    }
  }

  /**
   * 触发所有实时监听器
   */
  private notifyListeners(entry: SystemLogEntry): void {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // 隔离单个监听器异常
      }
    }
  }

  /**
   * 批量缓冲写入 IndexedDB，防抖处理以防高频 I/O 挤占性能
   */
  private queueForStorage(entry: SystemLogEntry): void {
    this.writeBuffer.push(entry);

    if (this.writeBuffer.length >= 20) {
      this.flushStorage();
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushStorage();
      }, 300);
    }
  }

  /**
   * 立即刷新持久化缓冲区
   */
  async flushStorage(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.writeBuffer.length === 0) return;

    const entriesToSave = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      await logStorage.saveLogs(entriesToSave);
    } catch {
      // 存储异常由内部容错兜底
    }
  }

  /**
   * 创建一条标准化日志/埋点条目
   */
  private createEntry(
    level: LogLevel,
    event: LogEventType | string | undefined,
    options: TrackOptions
  ): SystemLogEntry {
    const now = new Date();
    const createdAt = now.getTime();
    const timestamp = formatLogTimestamp(now);
    const id = `log-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;

    const message = options.message || (event ? `[${event}]` : `[${level}] Log entry`);

    const entry: SystemLogEntry = {
      id,
      timestamp,
      createdAt,
      level,
      message,
    };

    if (options.module) entry.module = options.module;
    if (event) entry.event = event;
    if (options.channelId) entry.channelId = options.channelId;
    if (options.orderNo) entry.orderNo = options.orderNo;
    if (options.durationMs !== undefined) entry.durationMs = options.durationMs;
    if (options.details) entry.details = options.details;
    if (options.meta) entry.meta = options.meta;

    if (options.taskId) entry.taskId = options.taskId;
    if (options.msgType) entry.msgType = options.msgType;
    if (options.taskActionStage) entry.taskActionStage = options.taskActionStage;
    if (options.taskStatus) entry.taskStatus = options.taskStatus;
    if (options.taskResult !== undefined) entry.taskResult = options.taskResult;

    if (options.apiUrl) entry.apiUrl = options.apiUrl;
    if (options.apiMethod) entry.apiMethod = options.apiMethod;
    if (options.apiParams !== undefined) entry.apiParams = options.apiParams;
    if (options.apiResponse !== undefined) entry.apiResponse = options.apiResponse;
    if (options.httpStatus !== undefined) entry.httpStatus = options.httpStatus;

    return entry;
  }

  /**
   * 记录标准化业务埋点事件
   */
  track(event: LogEventType | string, options: TrackOptions = {}): SystemLogEntry {
    const level = options.level || 'INFO';
    const entry = this.createEntry(level, event, options);

    this.notifyListeners(entry);
    this.queueForStorage(entry);

    return entry;
  }

  /**
   * 耗时测量埋点助手
   * @param event 埋点事件名
   * @param baseOptions 初始上下文
   * @returns 结束计时的结算回调
   */
  startTiming(
    event: LogEventType | string,
    baseOptions: TrackOptions = {}
  ): (finalOptions?: Partial<TrackOptions>) => SystemLogEntry {
    const startTime = Date.now();

    return (finalOptions: Partial<TrackOptions> = {}) => {
      const durationMs = Date.now() - startTime;
      const merged: TrackOptions = {
        ...baseOptions,
        ...finalOptions,
        durationMs: finalOptions.durationMs !== undefined ? finalOptions.durationMs : durationMs,
      };
      return this.track(event, merged);
    };
  }

  /**
   * 常规日志快捷方式
   */
  info(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track(options.module ? `${options.module}_INFO` : 'INFO', {
      ...options,
      level: 'INFO',
      message,
    });
  }

  warn(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track(options.module ? `${options.module}_WARN` : 'WARN', {
      ...options,
      level: 'WARN',
      message,
    });
  }

  error(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track(options.module ? `${options.module}_ERROR` : 'ERROR', {
      ...options,
      level: 'ERROR',
      message,
    });
  }

  success(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track(options.module ? `${options.module}_SUCCESS` : 'SUCCESS', {
      ...options,
      level: 'SUCCESS',
      message,
    });
  }

  playwright(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track(options.module ? `${options.module}_EVENT` : 'PLAYWRIGHT_EVENT', {
      ...options,
      module: options.module || 'PLAYWRIGHT',
      level: 'PLAYWRIGHT',
      message,
    });
  }

  /**
   * 多维查询持久化日志
   */
  async queryLogs(filter?: LogFilterParams, options?: { limit?: number; offset?: number }): Promise<SystemLogEntry[]> {
    await this.flushStorage();
    return logStorage.queryLogs(filter, options);
  }

  /**
   * 手动触发清除 7 天前过期日志
   */
  async purgeOlderThan7Days(): Promise<number> {
    await this.flushStorage();
    return logStorage.purgeLogsOlderThan7Days();
  }

  /**
   * 清空所有持久化日志
   */
  async clearAll(): Promise<void> {
    this.writeBuffer = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await logStorage.clearAllStoredLogs();
  }

  /**
   * 获取持久化日志总数
   */
  async count(): Promise<number> {
    await this.flushStorage();
    return logStorage.countLogs();
  }
}

export const logger = new LoggerService();
