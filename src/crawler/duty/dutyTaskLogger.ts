import type { DutyClaimedTask, SystemLogEntry } from '../../types';
import { logger } from '@/src/services/logger';

export type DutyTaskLogSink = (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => void;

export interface DutyTaskLoggerContext {
  channelCode: string;
  orderId?: string;
  orderNo?: string;
}

export type DutyTaskLogPayload = Omit<
  SystemLogEntry,
  'id' | 'timestamp' | 'createdAt' | 'module' | 'taskId' | 'msgType'
> & {
  module?: SystemLogEntry['module'];
  taskId?: string;
  msgType?: SystemLogEntry['msgType'];
};

export interface DutyTaskLogger {
  readonly task: DutyClaimedTask;
  context: DutyTaskLoggerContext;
  log(entry: DutyTaskLogPayload): void;
  updateContext(partialContext: Partial<DutyTaskLoggerContext>): void;
}

/** 值守任务日志条目契约（event 必填，其余与 DutyTaskLogSink 入参一致） */
export type DutyTaskLogEntry = Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'> & {
  event: string;
};

/**
 * 统一值守采集日志发射：优先走任务日志通道 (taskId 绑定)；CLI 等无任务上下文场景回退全局 logger。
 */
export function emitDutyTaskLog(
  channelId: string,
  audit: DutyTaskLogSink | undefined,
  entry: DutyTaskLogEntry
): void {
  if (audit) {
    audit(entry);
    return;
  }
  logger.track(entry.event, {
    level: entry.level,
    message: entry.message,
    module: 'DUTY_TASK',
    channelId,
    orderNo: entry.orderNo,
    msgType: 'OTA_COLLECT_ORDER',
    taskActionStage: entry.taskActionStage,
    meta: entry.meta,
  });
}

/**
 * 创建任务级上下文日志辅助器
 * 自动透传 taskId, msgType, orderNo (由 orderId 映射), channelId, module: 'DUTY_TASK'，消除各流转阶段手动拼装冗余
 */
export function createTaskLogger(
  task: DutyClaimedTask,
  context: DutyTaskLoggerContext,
  sink: DutyTaskLogSink
): DutyTaskLogger {
  const currentContext: DutyTaskLoggerContext = { ...context };

  return {
    task,
    get context() {
      return { ...currentContext };
    },
    set context(newCtx: DutyTaskLoggerContext) {
      currentContext.channelCode = newCtx.channelCode;
      currentContext.orderId = newCtx.orderId ?? newCtx.orderNo;
      currentContext.orderNo = newCtx.orderNo ?? newCtx.orderId;
    },
    updateContext(partial: Partial<DutyTaskLoggerContext>): void {
      if (partial.channelCode !== undefined) {
        currentContext.channelCode = partial.channelCode;
      }
      if (partial.orderId !== undefined) {
        currentContext.orderId = partial.orderId;
        currentContext.orderNo = partial.orderId;
      } else if (partial.orderNo !== undefined) {
        currentContext.orderNo = partial.orderNo;
        currentContext.orderId = partial.orderNo;
      }
    },
    log(entry: DutyTaskLogPayload): void {
      const resolvedOrderNo = entry.orderNo || currentContext.orderId || currentContext.orderNo;
      sink({
        level: entry.level,
        module: entry.module || 'DUTY_TASK',
        event: entry.event,
        message: entry.message,
        details: entry.details,
        channelId: entry.channelId || currentContext.channelCode,
        orderNo: resolvedOrderNo,
        durationMs: entry.durationMs,
        meta: entry.meta,
        taskId: entry.taskId || task.id,
        msgType: entry.msgType || task.msgType,
        taskActionStage: entry.taskActionStage,
        taskStatus: entry.taskStatus,
        taskResult: entry.taskResult,
        apiUrl: entry.apiUrl,
        apiMethod: entry.apiMethod,
        apiParams: entry.apiParams,
        apiResponse: entry.apiResponse,
        httpStatus: entry.httpStatus,
      });
    },
  };
}
