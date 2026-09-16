import { platformAuthService, getPlatformBaseUrl } from './platformAuth';
import { joinApiUrl } from '../utils/url';

export interface PlatformApiOptions extends RequestInit {
  baseUrl?: string;
  timeoutMs?: number;
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
  const { baseUrl = getPlatformBaseUrl(), timeoutMs = 15000, ...fetchOptions } = options;
  const fullUrl = joinApiUrl(baseUrl, path);

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

  let response = await makeRequest(token);

  // 遇 401 执行一次单飞透明刷新并重试
  if (response.status === 401) {
    token = await platformAuthService.getValidAccessToken({ forceRefresh: true });
    response = await makeRequest(token);
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = (await response.json()) as { msg?: string; message?: string; error?: string };
      errorDetail = errJson.msg || errJson.message || errJson.error || '';
    } catch {
      // 无法解析 JSON 则采用状态码
    }
    throw new PlatformApiError(
      response.status,
      `平台接口调用失败 (${response.status})${errorDetail ? `: ${errorDetail}` : ''}`,
      { url: fullUrl, errorDetail }
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}
