import type { Middleware } from '@reduxjs/toolkit';
import { logger } from '../services/logger';
import { addLog, addLogs } from './slices/systemLogSlice';
import type { SystemLogEntry } from '../types';

/**
 * 心跳/轮询类噪声事件：只进实时流展示，不写入 IndexedDB 持久化。
 * 这些事件高频但无溯源价值，排除后可为真实业务日志保留更多存储空间。
 */
/**
 * 高频 routine 噪声事件黑名单：只在实时流展示，不写入 IndexedDB。
 * 注意：DUTY_ACTUAL_STATE_REPORT_RECOVERED（自愈恢复）以及 DUTY_HEARTBEAT_STARTED/STOPPED（值守启停）
 * 属于关键生命周期与审计里程碑，坚决不列入黑名单，正常持久化保存。
 */
export const ROUTINE_NOISE_EVENTS = new Set([
  'DUTY_ACTUAL_STATE_REPORT',
  'ORDER_POLL_START',
  'ORDER_POLL_SUCCESS',
  'PLAYWRIGHT_HEARTBEAT',
  'SYS_STORAGE_PURGE',
  'AUTH_TOKEN_REFRESH',
]);

export function shouldPersist(entry: SystemLogEntry): boolean {
  // 1. 刚性底线：任何 ERROR 或 WARN 级别（如心跳超时、上报失败、网络中断），100% 坚决落库保留以供故障审计排查
  if (entry.level === 'ERROR' || entry.level === 'WARN') {
    return true;
  }

  // 2. 关键自愈事件与值守启停生命周期，坚决落库
  if (
    entry.event === 'DUTY_ACTUAL_STATE_REPORT_RECOVERED' ||
    entry.event === 'DUTY_HEARTBEAT_STARTED' ||
    entry.event === 'DUTY_HEARTBEAT_STOPPED'
  ) {
    return true;
  }

  // 3. 命中高频 routine 轮询与心跳黑名单的普通日志跳过落库
  if (entry.event && ROUTINE_NOISE_EVENTS.has(entry.event)) {
    return false;
  }

  // 4. taskActionStage 为 report 且属于 actual-state 常规上报的非关键日志
  if (
    entry.taskActionStage === 'report' &&
    (entry.event === 'DUTY_ACTUAL_STATE_REPORT' || entry.message?.includes('actual-state/report 上报正常'))
  ) {
    return false;
  }

  return true;
}

/**
 * 日志持久化的唯一入口。
 *
 * 任何进入 Redux 日志流的条目都必须经此落库：本地埋点、主进程 IPC 推送、值守状态轮询补发，
 * 以及业务 slice 直接投递的日志。这样「界面可见」与「已持久化」始终同源，不再出现只进
 * Redux 却不落库的日志。落库以 entry.id 幂等，同一日志被多次投递不会产生重复记录。
 *
 * 心跳/轮询类噪声事件（见 SKIP_PERSIST_EVENTS）仅进实时流，不写 IndexedDB。
 */
export const logPersistenceMiddleware: Middleware = () => (next) => (action) => {
  const result = next(action);

  if (addLog.match(action)) {
    if (shouldPersist(action.payload)) {
      logger.persist(action.payload);
    }
  } else if (addLogs.match(action)) {
    const toSave = action.payload.filter(shouldPersist);
    if (toSave.length > 0) {
      logger.persistBatch(toSave);
    }
  }

  return result;
};
