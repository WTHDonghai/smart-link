import { logger } from './logger';

let isListening = false;
let errorHandler: ((event: ErrorEvent) => void) | null = null;
let rejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

/**
 * 全局运行时异常与未处理 Promise 拒绝拦截器
 * 将所有未受保护的系统崩溃与脚本异常自动转化为结构化 SYSTEM 埋点日志落库
 */
export function initGlobalErrorLogging(): void {
  if (typeof window === 'undefined' || isListening) {
    return;
  }

  isListening = true;

  errorHandler = (event: ErrorEvent) => {
    const error = event.error;
    const stack = error instanceof Error ? error.stack : undefined;
    const message = event.message || (error instanceof Error ? error.message : '未知全局脚本异常');

    logger.track('SYS_UNHANDLED_ERROR', {
      module: 'SYSTEM',
      level: 'ERROR',
      message: `[System Crash] ${message}`,
      details: stack || `位置: ${event.filename}:${event.lineno}:${event.colno}`,
      meta: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack,
      },
    });
  };

  rejectionHandler = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const stack = reason instanceof Error ? reason.stack : undefined;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : '未处理的异步 Promise 拒绝 (Unhandled Rejection)';

    logger.track('SYS_UNHANDLED_REJECTION', {
      module: 'SYSTEM',
      level: 'ERROR',
      message: `[Unhandled Rejection] ${message}`,
      details: stack,
      meta: {
        reason: typeof reason === 'object' && reason !== null ? String(reason) : reason,
        stack,
      },
    });
  };

  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);
}

export function cleanupGlobalErrorLogging(): void {
  if (typeof window === 'undefined' || !isListening) {
    return;
  }

  if (errorHandler) {
    window.removeEventListener('error', errorHandler);
    errorHandler = null;
  }
  if (rejectionHandler) {
    window.removeEventListener('unhandledrejection', rejectionHandler);
    rejectionHandler = null;
  }

  isListening = false;
}
