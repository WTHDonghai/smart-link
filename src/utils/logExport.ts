import type { SystemLogEntry } from '../types';

function stringifyValue(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * 将日志条目格式化为可导出的纯文本行，逐字段保留任务与接口上下文
 */
export function formatLogsForExport(logs: SystemLogEntry[]): string {
  return logs
    .map(
      (log) =>
        `[${log.timestamp}] [${log.level}] [${log.module || 'UNKNOWN'}]${
          log.apiMethod ? ` [${log.apiMethod}]` : ''
        }${log.apiUrl ? ` [${log.apiUrl}]` : ''}${
          log.httpStatus ? ` [HTTP ${log.httpStatus}]` : ''
        }${log.taskActionStage ? ` [${log.taskActionStage}]` : ''}${
          log.msgType ? ` [msgType:${log.msgType}]` : ''
        }${log.orderNo ? ` [orderNo:${log.orderNo}]` : ''}${
          log.taskId ? ` [taskId:${log.taskId}]` : ''
        } ${log.message} ${log.details ? `| ${log.details}` : ''}${
          log.apiParams !== undefined ? ` | params: ${JSON.stringify(log.apiParams)}` : ''
        }${
          log.apiResponse !== undefined ? ` | response: ${JSON.stringify(log.apiResponse)}` : ''
        }${
          log.taskResult !== undefined ? ` | result: ${stringifyValue(log.taskResult)}` : ''
        }`
    )
    .join('\n');
}
