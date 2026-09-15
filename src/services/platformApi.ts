import { platformAuthService, getPlatformBaseUrl } from './platformAuth';
import { joinApiUrl } from '../utils/url';

export interface PlatformApiOptions extends RequestInit {
  baseUrl?: string;
  timeoutMs?: number;
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
    throw new Error(
      `平台接口调用失败 (${response.status})${errorDetail ? `: ${errorDetail}` : ''}`
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}
