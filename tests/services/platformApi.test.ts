import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestPlatformApi } from '../../src/services/platformApi';
import { saveTokensToStorage, clearTokensFromStorage } from '../../src/services/platformAuth';
import { PlatformAuthTokens } from '../../src/types';

describe('platformApi - 接口调用、认证注入与 401 透明重试', () => {
  beforeEach(() => {
    clearTokensFromStorage();
    vi.restoreAllMocks();
  });

  it('自动注入 App-Auth: bearer {token} 头部', async () => {
    const validTokens: PlatformAuthTokens = {
      accessToken: 'valid-test-bearer-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms.example.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(validTokens);

    let capturedHeaders: Headers | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ code: 0, data: { orderCount: 42 } }),
      } as unknown as Response;
    });

    const result = await requestPlatformApi<{ code: number; data: { orderCount: number } }>(
      '/api/v1/orders/summary',
      { baseUrl: 'https://pms.example.com' }
    );

    expect(result.data.orderCount).toBe(42);
    expect(capturedHeaders?.get('App-Auth')).toBe('bearer valid-test-bearer-token');
  });

  it('遇 401 自动执行单次强制刷新并透明重试', async () => {
    const tokens: PlatformAuthTokens = {
      accessToken: 'stale-token',
      refreshToken: 'good-refresh-token',
      expiresAt: Date.now() + 10000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms.example.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(tokens);

    const callHistory: { url: string; authHeader: string | null }[] = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get('App-Auth');
      callHistory.push({ url, authHeader });

      if (url.includes('/identity/oauth/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'fresh-retried-token',
            refresh_token: 'good-refresh-token',
            expires_in: 3600,
          }),
        } as unknown as Response;
      }

      if (authHeader === 'bearer stale-token') {
        return {
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ msg: 'Token expired' }),
        } as unknown as Response;
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, message: 'Retried successfully' }),
      } as unknown as Response;
    });

    const result = await requestPlatformApi<{ success: boolean; message: string }>(
      '/api/v1/hotels/sync',
      { baseUrl: 'https://pms.example.com' }
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe('Retried successfully');

    expect(callHistory.length).toBe(3);
    expect(callHistory[0].authHeader).toBe('bearer stale-token');
    expect(callHistory[1].url).toContain('/identity/oauth/token');
    expect(callHistory[2].authHeader).toBe('bearer fresh-retried-token');
  });

  it('业务接口返回非 401 错误时立即 Fail-Fast 抛出异常', async () => {
    const validTokens: PlatformAuthTokens = {
      accessToken: 'valid-token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms.example.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(validTokens);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ msg: '内部数据库连接超时' }),
    } as unknown as Response);

    await expect(
      requestPlatformApi('/api/v1/orders/push', { baseUrl: 'https://pms.example.com' })
    ).rejects.toThrow('平台接口调用失败 (500): 内部数据库连接超时');
  });

  it('未显式传入 baseUrl 时自动使用会话/环境变量中的 Base URL', async () => {
    const validTokens: PlatformAuthTokens = {
      accessToken: 'valid-token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://session-effective-pms.hotel.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(validTokens);

    let requestedUrl = '';
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true }),
      } as unknown as Response;
    });

    await requestPlatformApi('/api/v1/toolkit/import');

    expect(requestedUrl).toBe('https://session-effective-pms.hotel.com/api/v1/toolkit/import');
  });
});
