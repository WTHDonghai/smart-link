import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  requestPlatformApi,
  PlatformApiError,
  PLATFORM_MODULES,
  TOOLKIT_MODULE,
  registerApiLogListener,
} from '../../src/services/platformApi';
import { saveTokensToStorage, clearTokensFromStorage } from '../../src/services/platformAuth';
import { PlatformAuthTokens, SystemLogEntry } from '../../src/types';

const hostWindow = window as unknown as { host?: unknown };

describe('platformApi - 接口调用、认证注入与 401 透明重试', () => {
  beforeEach(() => {
    hostWindow.host = {};
    clearTokensFromStorage();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete hostWindow.host;
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

  it('standalone browser context cannot call platform APIs', async () => {
    delete hostWindow.host;

    await expect(requestPlatformApi('/api/v1/orders/summary')).rejects.toThrow(
      '平台接口仅支持桌面端'
    );
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

    let caughtError: unknown;
    try {
      await requestPlatformApi('/api/v1/orders/push', { baseUrl: 'https://pms.example.com' });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(PlatformApiError);
    const apiErr = caughtError as PlatformApiError;
    expect(apiErr.status).toBe(500);
    expect(apiErr.statusCode).toBe(500);
    expect(apiErr.url).toBe('https://pms.example.com/api/v1/orders/push');
    expect(apiErr.errorDetail).toBe('内部数据库连接超时');
    expect(apiErr.message).toBe('平台接口调用失败 (500): 内部数据库连接超时');
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

  it('导出标准的 PLATFORM_MODULES 常量与 TOOLKIT_MODULE 别名', () => {
    expect(PLATFORM_MODULES.TOOLKIT).toBe('toolkit');
    expect(PLATFORM_MODULES.RATE_MANAGEMENT).toBe('rate-management');
    expect(PLATFORM_MODULES.IDENTITY).toBe('identity');
    expect(TOOLKIT_MODULE).toBe('toolkit');
  });

  it('成功调用时完整捕获并记录请求入参 (Body) 与接口返回数据 (Response)', async () => {
    saveTokensToStorage({
      accessToken: 'valid-test-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms.example.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const capturedLogs: SystemLogEntry[] = [];
    const unsubscribe = registerApiLogListener((log) => capturedLogs.push(log));

    try {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ code: '0000', data: { taskId: 'task-1001', status: 'CLAIMED' } }),
      } as unknown as Response);

      const requestBody = {
        stationId: 'station-sh-01',
        appId: 'smart-link',
        direction: 'FORWARD',
      };

      const res = await requestPlatformApi<{ code: string; data: { taskId: string; status: string } }>(
        '/toolkit/toolbox/task-claims',
        {
          baseUrl: 'https://pms.example.com',
          method: 'POST',
          body: JSON.stringify(requestBody),
        }
      );

      expect(res.code).toBe('0000');
      expect(res.data.taskId).toBe('task-1001');

      // 验证日志中完整记录了请求入参与接口返回
      const apiSuccessLog = capturedLogs.find((l) => l.event === 'API_REQUEST_SUCCESS');
      expect(apiSuccessLog).toBeDefined();
      expect(apiSuccessLog?.apiUrl).toBe('/toolkit/toolbox/task-claims');
      expect(apiSuccessLog?.apiMethod).toBe('POST');
      expect(apiSuccessLog?.httpStatus).toBe(200);
      expect(apiSuccessLog?.apiParams).toEqual({
        stationId: 'station-sh-01',
        appId: 'smart-link',
        direction: 'FORWARD',
      });
      expect(apiSuccessLog?.apiResponse).toEqual({
        code: '0000',
        data: { taskId: 'task-1001', status: 'CLAIMED' },
      });
    } finally {
      unsubscribe();
    }
  });

  it('HTTP 错误时完整捕获并记录请求入参与错误响应报文', async () => {
    saveTokensToStorage({
      accessToken: 'valid-test-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms.example.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const capturedLogs: SystemLogEntry[] = [];
    const unsubscribe = registerApiLogListener((log) => capturedLogs.push(log));

    try {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ code: 'PARAM_ERROR', msg: '工位标识非法或不存在' }),
      } as unknown as Response);

      const requestBody = { stationId: 'invalid-station' };

      await expect(
        requestPlatformApi('/toolkit/toolbox/task-claims', {
          baseUrl: 'https://pms.example.com',
          method: 'POST',
          body: JSON.stringify(requestBody),
        })
      ).rejects.toThrow('平台接口调用失败 (400): 工位标识非法或不存在');

      const failedLog = capturedLogs.find((l) => l.event === 'API_REQUEST_FAILED');
      expect(failedLog).toBeDefined();
      expect(failedLog?.apiMethod).toBe('POST');
      expect(failedLog?.apiUrl).toBe('/toolkit/toolbox/task-claims');
      expect(failedLog?.httpStatus).toBe(400);
      expect(failedLog?.apiParams).toEqual({ stationId: 'invalid-station' });
      expect(failedLog?.apiResponse).toEqual({ code: 'PARAM_ERROR', msg: '工位标识非法或不存在' });
      expect(failedLog?.taskActionStage).toBe('claim');
    } finally {
      unsubscribe();
    }
  });

  it('URL 查询参数时解析提取 query 对象作为 apiParams', async () => {
    saveTokensToStorage({
      accessToken: 'valid-test-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms.example.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const capturedLogs: SystemLogEntry[] = [];
    const unsubscribe = registerApiLogListener((log) => capturedLogs.push(log));

    try {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ records: [], total: 0 }),
      } as unknown as Response);

      await requestPlatformApi('/api/v1/orders?page=2&pageSize=20&status=WAIT_CONFIRM', {
        baseUrl: 'https://pms.example.com',
      });

      const successLog = capturedLogs.find((l) => l.event === 'API_REQUEST_SUCCESS');
      expect(successLog).toBeDefined();
      expect(successLog?.apiParams).toEqual({
        page: '2',
        pageSize: '20',
        status: 'WAIT_CONFIRM',
      });
      expect(successLog?.apiResponse).toEqual({ records: [], total: 0 });
    } finally {
      unsubscribe();
    }
  });

  it('作为通用 HTTP 客户端不应在底层猜测业务字段，支持显式透传 options.orderNo 与 options.taskActionStage', async () => {
    saveTokensToStorage({
      accessToken: 'valid-test-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms.example.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const capturedLogs: SystemLogEntry[] = [];
    const unsubscribe = registerApiLogListener((log) => capturedLogs.push(log));

    try {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, pmsOrderId: 'PMS-9988' }),
      } as unknown as Response);

      await requestPlatformApi('/toolkit/orders/import', {
        baseUrl: 'https://pms.example.com',
        method: 'POST',
        orderNo: 'MT-987654321',
        taskActionStage: 'order-import-submit',
        body: JSON.stringify({
          otaOrderId: 987654321,
          extUnitCode: 'HOTEL-ROOM-1',
        }),
      });

      const log = capturedLogs.find((l) => l.event === 'API_REQUEST_SUCCESS');
      expect(log).toBeDefined();
      expect(log?.taskActionStage).toBe('order-import-submit');
      expect(log?.orderNo).toBe('MT-987654321');
      expect(log?.apiParams).toEqual({
        otaOrderId: 987654321,
        extUnitCode: 'HOTEL-ROOM-1',
      });
    } finally {
      unsubscribe();
    }
  });

  it('优先委托 window.host.platform.request 原生 IPC 发起网络请求', async () => {
    const validTokens: PlatformAuthTokens = {
      accessToken: 'valid-ipc-token',
      refreshToken: 'refresh-ipc',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms.example.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(validTokens);

    const mockRequest = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 200, data: [{ code: 'EXK', name: '行政大床房' }] }),
    });

    hostWindow.host = {
      platform: {
        request: mockRequest,
      },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await requestPlatformApi<{ code: number; data: { code: string; name: string }[] }>(
      '/product-management/room-types?unitId=1001',
      {
        baseUrl: 'https://pms.example.com',
        headers: { 'App-Property-Id': '1001' },
      }
    );

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const [callOptions] = mockRequest.mock.calls[0];
    expect(callOptions.url).toBe('https://pms.example.com/product-management/room-types?unitId=1001');
    expect(callOptions.headers['App-Property-Id']).toBe('1001');
    expect(callOptions.headers['App-Auth']).toBe('bearer valid-ipc-token');
    expect(result.data[0].code).toBe('EXK');
  });
});
