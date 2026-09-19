import { platformAuthService, getPlatformBaseUrl } from './platformAuth';
import { joinApiUrl } from '../utils/url';
import { logger } from './logger';
import type { LogModule, SystemLogEntry, TaskActionStage } from '../types';

export interface PlatformApiOptions extends RequestInit {
  baseUrl?: string;
  timeoutMs?: number;
  module?: LogModule;
  orderNo?: string;
  taskActionStage?: TaskActionStage;
}

export type ApiLogListener = (entry: SystemLogEntry) => void;
const apiLogListeners = new Set<ApiLogListener>();

export function registerApiLogListener(listener: ApiLogListener): () => void {
  apiLogListeners.add(listener);
  return () => {
    apiLogListeners.delete(listener);
  };
}

function broadcastApiLog(entry: SystemLogEntry): void {
  for (const listener of apiLogListeners) {
    try {
      listener(entry);
    } catch {
      // 隔离单点监听异常
    }
  }
}

function inferModuleFromPath(path: string): LogModule {
  if (path.includes('/toolbox/task') || path.includes('/toolbox/station') || path.includes('/toolbox/actual-state')) {
    return 'DUTY_TASK';
  }
  if (path.includes('/orders')) {
    return 'ORDER';
  }
  if (path.includes('/hotels')) {
    return 'HOTEL';
  }
  if (path.includes('/channels') || path.includes('/channel')) {
    return 'CHANNEL';
  }
  if (path.includes('/oauth') || path.includes('/identity') || path.includes('/auth')) {
    return 'AUTH';
  }
  return 'API';
}

/**
 * 文旅平台微服务/业务功能模块路由常量 (Microservice Route Modules)
 * 供系统所有业务服务层（channelApi、hotelApi、orderApi 等）统一复用
 */
export const PLATFORM_MODULES = {
  /** 工具箱/渠道接入与模板管理模块 */
  TOOLKIT: 'toolkit',
  /** 价格与渠道字典管理模块 */
  RATE_MANAGEMENT: 'rate-management',
  /** 统一身份认证与授权中心模块 */
  IDENTITY: 'identity',
} as const;

export type PlatformModuleName = (typeof PLATFORM_MODULES)[keyof typeof PLATFORM_MODULES];

/**
 * 工具箱/渠道接入业务模块路由常量快捷引用
 */
export const TOOLKIT_MODULE = PLATFORM_MODULES.TOOLKIT;

/**
 * 平台 API 异常类，包含 HTTP 状态码、请求 URL 与详细错误说明
 */
export class PlatformApiError extends Error {
  public readonly status: number;
  public readonly statusCode: number;
  public readonly url: string;
  public readonly errorDetail?: string;

  constructor(status: number, message: string, options: { url: string; errorDetail?: string }) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
    this.statusCode = status;
    this.url = options.url;
    this.errorDetail = options.errorDetail;
    Object.setPrototypeOf(this, PlatformApiError.prototype);
  }
}

export async function requestPlatformApi<T = unknown>(
  path: string,
  options: PlatformApiOptions = {}
): Promise<T> {
  if (typeof window !== 'undefined' && !window.host) {
    throw new Error('平台接口仅支持桌面端');
  }

  const { baseUrl = getPlatformBaseUrl(), timeoutMs = 15000, ...fetchOptions } = options;
  const fullUrl = joinApiUrl(baseUrl, path);
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const startTime = Date.now();

  // 1. 解析提取请求入参 (URL 查询参数或 Body 负载)
  let requestParams: unknown = undefined;
  if (fetchOptions.body) {
    if (typeof fetchOptions.body === 'string') {
      try {
        requestParams = JSON.parse(fetchOptions.body);
      } catch {
        requestParams = fetchOptions.body;
      }
    } else {
      requestParams = fetchOptions.body;
    }
  } else if (path.includes('?')) {
    const searchPart = path.slice(path.indexOf('?') + 1);
    const paramsObj: Record<string, string> = {};
    new URLSearchParams(searchPart).forEach((val, key) => {
      paramsObj[key] = val;
    });
    requestParams = paramsObj;
  }

  let token = await platformAuthService.getValidAccessToken();

  const makeRequest = async (accessToken: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = new Headers(fetchOptions.headers || {});
      headers.set('App-Auth', `bearer ${accessToken}`);
      if (!headers.has('Content-Type') && fetchOptions.body && typeof fetchOptions.body === 'string') {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(fullUrl, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    let response = await makeRequest(token);

    // 遇 401 执行一次单飞透明刷新并重试
    if (response.status === 401) {
      token = await platformAuthService.getValidAccessToken({ forceRefresh: true });
      response = await makeRequest(token);
    }

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      let errorDetail = '';
      let responseData: unknown = undefined;
      try {
        if (typeof response.json === 'function') {
          responseData = await response.json();
          const errJson = responseData as Record<string, unknown>;
          errorDetail = String(errJson.msg || errJson.message || errJson.error || '');
        } else if (typeof response.text === 'function') {
          const text = await response.text();
          errorDetail = text;
          responseData = text;
        }
      } catch {
        // 无法解析 JSON 则采用状态码
      }

      const logEntry = logger.track('API_REQUEST_FAILED', {
        level: 'ERROR',
        module: options.module || inferModuleFromPath(path),
        message: `[接口失败] [${method}] ${path} (${response.status}) - ${durationMs}ms`,
        details: errorDetail || `HTTP ${response.status}`,
        durationMs,
        apiUrl: path,
        apiMethod: method,
        apiParams: requestParams,
        apiResponse: responseData,
        httpStatus: response.status,
        taskActionStage: options.taskActionStage,
        orderNo: options.orderNo,
      });
      broadcastApiLog(logEntry);

      throw new PlatformApiError(
        response.status,
        `平台接口调用失败 (${response.status})${errorDetail ? `: ${errorDetail}` : ''}`,
        { url: fullUrl, errorDetail }
      );
    }

    let responseData: unknown = undefined;
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json') && typeof response.json === 'function') {
      responseData = await response.json();
    } else if (typeof response.text === 'function') {
      const text = await response.text();
      try {
        responseData = text ? JSON.parse(text) : undefined;
      } catch {
        responseData = text;
      }
    } else if (typeof response.json === 'function') {
      responseData = await response.json();
    }

    const logEntry = logger.track('API_REQUEST_SUCCESS', {
      level: 'INFO',
      module: options.module || inferModuleFromPath(path),
      message: `[接口调用] [${method}] ${path} (${response.status}) - ${durationMs}ms`,
      durationMs,
      apiUrl: path,
      apiMethod: method,
      apiParams: requestParams,
      apiResponse: responseData,
      httpStatus: response.status,
      taskActionStage: options.taskActionStage,
      orderNo: options.orderNo,
    });
    broadcastApiLog(logEntry);

    return responseData as T;
  } catch (err) {
    if (err instanceof PlatformApiError) {
      throw err;
    }
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    const logEntry = logger.track('API_REQUEST_ERROR', {
      level: 'ERROR',
      module: options.module || inferModuleFromPath(path),
      message: `[接口网络异常] [${method}] ${path}: ${errorMsg}`,
      details: errorMsg,
      durationMs,
      apiUrl: path,
      apiMethod: method,
      apiParams: requestParams,
      apiResponse: { error: errorMsg },
      taskActionStage: options.taskActionStage,
      orderNo: options.orderNo,
    });
    broadcastApiLog(logEntry);

    throw err;
  }
}
