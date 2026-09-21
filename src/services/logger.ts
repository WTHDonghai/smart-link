import {
  SystemLogEntry,
  LogLevel,
  LogModule,
  LogEventType,
  LogFilterParams,
  DutyTaskMessageType,
  TaskActionStage,
} from '../types';
import { logStorage, formatLogTimestamp } from './logStorage';
import { resolveTaskActionStage } from '../utils/taskStage';
import { generateLogId } from '../utils/logId';
import { Logger as TsLogger } from 'tslog';

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
  taskActionStage?: TaskActionStage | string;
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

/** 内存中保留的幂等键上限，超出后按写入顺序淘汰最早的键 */
const MAX_QUEUED_ID_HISTORY = 5000;

/** 持久化异常重试缓冲区上限，防止极端存储故障导致内存无界膨胀 */
const MAX_RETRY_BUFFER_SIZE = 2000;

export class LoggerService {
  private listeners: Set<LogListener> = new Set();
  private readonly ownsPersistentStorage = !(
    typeof process !== 'undefined' && process.type === 'browser'
  );
  private writeBuffer: SystemLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isInitialized = false;
  private queuedEntryIds: Set<string> = new Set();
  private tsLogger: TsLogger<SystemLogEntry>;

  constructor() {
    const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
    this.tsLogger = new TsLogger<SystemLogEntry>({
      type: isTestEnv ? 'hidden' : 'pretty',
      minLevel: 0,
    });
  }

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
      } catch (error) {
        // 初始化失败不阻断应用启动，但必须显式暴露，避免日志链路静默失效
        console.error('[LoggerService] 日志存储初始化失败:', error);
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
      } catch (error) {
        // 隔离单个监听器异常，避免阻断其余订阅者
        console.warn('[LoggerService] 日志监听器执行异常:', error);
      }
    }
  }

  /**
   * 以 entry.id 作为幂等键登记入队。
   * 同一日志可能同时经 IPC 推送、轮询补发与本地埋点到达，重复投递必须被收敛为一次写入。
   */
  private markQueued(entryId: string): boolean {
    if (this.queuedEntryIds.has(entryId)) return false;

    this.queuedEntryIds.add(entryId);
    if (this.queuedEntryIds.size > MAX_QUEUED_ID_HISTORY) {
      const oldestEntryId = this.queuedEntryIds.values().next().value;
      if (oldestEntryId !== undefined) {
        this.queuedEntryIds.delete(oldestEntryId);
      }
    }

    return true;
  }

  /**
   * 批量缓冲写入 IndexedDB，防抖处理以防高频 I/O 挤占性能
   */
  private queueForStorage(entry: SystemLogEntry): void {
    if (!this.ownsPersistentStorage) return;

    if (!this.markQueued(entry.id)) return;

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
   * 幂等持久化一条已构建的日志条目。
   * 用于主进程 IPC 推送与轮询补发的任务日志：这些条目已带有稳定 id，无需重新生成。
   */
  persist(entry: SystemLogEntry): void {
    this.queueForStorage(entry);
  }

  /**
   * 立即刷新持久化缓冲区
   */
  async flushStorage(): Promise<void> {
    if (!this.ownsPersistentStorage) return;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.writeBuffer.length === 0) return;

    const entriesToSave = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      await logStorage.saveLogs(entriesToSave);
    } catch (error) {
      // 持久化失败时回填待写入条目，等待下一次刷新重试，避免日志静默丢失；设置容量上限防止内存膨胀
      this.writeBuffer = [...entriesToSave, ...this.writeBuffer];
      if (this.writeBuffer.length > MAX_RETRY_BUFFER_SIZE) {
        this.writeBuffer = this.writeBuffer.slice(-MAX_RETRY_BUFFER_SIZE);
      }
      console.error('[LoggerService] 日志持久化失败，已保留待重试:', error);
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
    const id = generateLogId(createdAt);

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
    if (options.taskStatus) entry.taskStatus = options.taskStatus;
    if (options.taskResult !== undefined) entry.taskResult = options.taskResult;

    // 强契约：对 taskActionStage 强制进行归一化与自愈推导，确保每条日志出厂即携带精准结构化阶段
    const resolvedStage = options.taskActionStage
      ? (resolveTaskActionStage({ taskActionStage: options.taskActionStage }) || String(options.taskActionStage).toLowerCase().replace(/_/g, '-'))
      : resolveTaskActionStage({
          event,
          apiUrl: options.apiUrl,
          message,
          details: options.details,
        });
    if (resolvedStage) {
      entry.taskActionStage = resolvedStage;
    }

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

    // tslog 结构化日志引擎接管
    try {
      if (level === 'ERROR') {
        this.tsLogger.error(entry);
      } else if (level === 'WARN') {
        this.tsLogger.warn(entry);
      } else {
        this.tsLogger.info(entry);
      }
    } catch (error) {
      // 控制台输出失败不影响日志主链路，但需显式暴露
      console.warn('[LoggerService] 控制台日志输出异常:', error);
    }

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
    return this.track('INFO', {
      ...options,
      level: 'INFO',
      message,
    });
  }

  warn(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track('WARN', {
      ...options,
      level: 'WARN',
      message,
    });
  }

  error(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track('ERROR', {
      ...options,
      level: 'ERROR',
      message,
    });
  }

  success(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track('SUCCESS', {
      ...options,
      level: 'SUCCESS',
      message,
    });
  }

  playwright(message: string, options: Omit<TrackOptions, 'level' | 'message'> = {}): SystemLogEntry {
    return this.track('PLAYWRIGHT_EVENT', {
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
    if (!this.ownsPersistentStorage) return [];

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
    if (!this.ownsPersistentStorage) return;

    this.writeBuffer = [];
    this.queuedEntryIds.clear();
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
    if (!this.ownsPersistentStorage) return 0;

    await this.flushStorage();
    return logStorage.countLogs();
  }
}

export const logger = new LoggerService();
