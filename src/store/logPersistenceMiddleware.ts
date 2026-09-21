import type { Middleware } from '@reduxjs/toolkit';
import { logger } from '../services/logger';
import { addLog, addLogs } from './slices/systemLogSlice';

/**
 * 日志持久化的唯一入口。
 *
 * 任何进入 Redux 日志流的条目都必须经此落库：本地埋点、主进程 IPC 推送、值守状态轮询补发，
 * 以及业务 slice 直接投递的日志。这样「界面可见」与「已持久化」始终同源，不再出现只进
 * Redux 却不落库的日志。落库以 entry.id 幂等，同一日志被多次投递不会产生重复记录。
 */
export const logPersistenceMiddleware: Middleware = () => (next) => (action) => {
  const result = next(action);

  if (addLog.match(action)) {
    logger.persist(action.payload);
  } else if (addLogs.match(action)) {
    for (const entry of action.payload) {
      logger.persist(entry);
    }
  }

  return result;
};
