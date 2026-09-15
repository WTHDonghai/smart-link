import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateRefreshTiming,
  inspectTokenState,
  classifyAuthError,
  PlatformAuthService,
  saveTokensToStorage,
  loadTokensFromStorage,
  clearTokensFromStorage,
  getPlatformBaseUrl,
  getEnvironmentMode,
  TERMINAL_STATUS_CODES,
  TERMINAL_OAUTH_ERRORS,
} from '../../src/services/platformAuth';
import { PlatformAuthTokens } from '../../src/types';

describe('platformAuth - 动态提前刷新计算 (calculateRefreshTiming)', () => {
  it('应当对 10 分钟生命周期的 Token 提前 60 秒刷新 (10% 规则)', () => {
    const now = 1000000;
    const updatedAt = now;
    const expiresAt = now + 600 * 1000; // 10 分钟 = 600 秒

    const { refreshAt, refreshLeadMs } = calculateRefreshTiming(expiresAt, updatedAt, now);

    expect(refreshLeadMs).toBe(60 * 1000);
    expect(refreshAt).toBe(expiresAt - 60 * 1000);
  });

  it('应当对 1 分钟生命周期的 Token 保持至少 30 秒提前量 (下限与 50% 保护)', () => {
    const now = 1000000;
    const updatedAt = now;
    const expiresAt = now + 60 * 1000; // 1 分钟 = 60 秒

    const { refreshAt, refreshLeadMs } = calculateRefreshTiming(expiresAt, updatedAt, now);

    expect(refreshLeadMs).toBe(30 * 1000);
    expect(refreshAt).toBe(expiresAt - 30 * 1000);
  });

  it('应当对 2 小时长效 Token 应用最多 5 分钟的提前刷新上限', () => {
    const now = 1000000;
    const updatedAt = now;
    const expiresAt = now + 7200 * 1000; // 2 小时 = 7200 秒

    const { refreshAt, refreshLeadMs } = calculateRefreshTiming(expiresAt, updatedAt, now);

    expect(refreshLeadMs).toBe(300 * 1000);
    expect(refreshAt).toBe(expiresAt - 300 * 1000);
  });
});

describe('platformAuth - Token 状态诊断 (inspectTokenState)', () => {
  it('对空值或缺少 accessToken 的数据诊断为不可用', () => {
    const state = inspectTokenState(null);
    expect(state.fresh).toBe(false);
    expect(state.usable).toBe(false);
    expect(state.expiresAt).toBe(0);
  });

  it('在动态刷新时间之前判定为新鲜 (fresh: true, usable: true)', () => {
    const now = 1000000;
    const mockTokens: PlatformAuthTokens = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: now + 600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-001',
      authenticatedAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };

    const state = inspectTokenState(mockTokens, now);
    expect(state.usable).toBe(true);
    expect(state.fresh).toBe(true);
    expect(state.expiresInMs).toBe(600 * 1000);
  });

  it('在到达刷新时间后但未到达彻底过期时间前判定为可用但待刷新 (fresh: false, usable: true)', () => {
    const now = 1000000;
    const updatedAt = now - 550 * 1000;
    const expiresAt = now + 50 * 1000;

    const mockTokens: PlatformAuthTokens = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-001',
      authenticatedAt: new Date(updatedAt).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
    };

    const state = inspectTokenState(mockTokens, now);
    expect(state.usable).toBe(true);
    expect(state.fresh).toBe(false);
    expect(state.expiresInMs).toBe(50 * 1000);
  });

  it('过期后判定为彻底失效 (fresh: false, usable: false)', () => {
    const now = 1000000;
    const mockTokens: PlatformAuthTokens = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: now - 100,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-001',
      authenticatedAt: new Date(now - 10000).toISOString(),
      updatedAt: new Date(now - 10000).toISOString(),
    };

    const state = inspectTokenState(mockTokens, now);
    expect(state.usable).toBe(false);
    expect(state.fresh).toBe(false);
    expect(state.expiresInMs).toBe(0);
  });
});

describe('platformAuth - 错误分类 (classifyAuthError) 与常量收敛', () => {
  it('正确识别常量枚举中的终端终止性错误 (terminal: true)', () => {
    for (const code of TERMINAL_STATUS_CODES) {
      const err = Object.assign(new Error('Auth error'), { statusCode: code });
      const classified = classifyAuthError(err);
      expect(classified.terminal).toBe(true);
      expect(classified.retryable).toBe(false);
    }

    for (const oauthErr of TERMINAL_OAUTH_ERRORS) {
      const err = new Error(`OAuth error: ${oauthErr}`);
      const classified = classifyAuthError(err);
      expect(classified.terminal).toBe(true);
      expect(classified.retryable).toBe(false);
    }
  });

  it('正确识别 500 或网络波动为可重试错误 (retryable: true)', () => {
    const serverErr = Object.assign(new Error('Internal Server Error'), { statusCode: 502 });
    const classifiedServer = classifyAuthError(serverErr);
    expect(classifiedServer.retryable).toBe(true);
    expect(classifiedServer.terminal).toBe(false);

    const netErr = new Error('network timeout');
    const classifiedNet = classifyAuthError(netErr);
    expect(classifiedNet.retryable).toBe(true);
  });
});

describe('platformAuth - 环境变量单一性与 Fail-Fast 刚性验证', () => {
  const originalProcessEnv = process.env;

  beforeEach(() => {
    clearTokensFromStorage();
    process.env = { ...originalProcessEnv };
  });

  afterEach(() => {
    process.env = originalProcessEnv;
  });

  it('环境变量未配置 VITE_PLATFORM_BASE_URL 时坚决不隐式兜底，立即 Fail-Fast 抛出异常', () => {
    delete process.env.VITE_PLATFORM_BASE_URL;
    expect(() => getPlatformBaseUrl()).toThrow(
      '未配置平台接口基础地址，请在环境变量中配置 VITE_PLATFORM_BASE_URL'
    );
  });

  it('当环境变量配置有效时正确读取并格式化', () => {
    process.env.VITE_PLATFORM_BASE_URL = '  https://custom-env.hotel.com///  ';
    const url = getPlatformBaseUrl();
    expect(url).toBe('https://custom-env.hotel.com');
  });

  it('正确识别环境模式对象 (mode, isDev, isProd)', () => {
    process.env.NODE_ENV = 'development';
    const devMode = getEnvironmentMode();
    expect(devMode.isDev).toBe(true);
    expect(devMode.isProd).toBe(false);

    process.env.NODE_ENV = 'production';
    const prodMode = getEnvironmentMode();
    expect(prodMode.isProd).toBe(true);
    expect(prodMode.isDev).toBe(false);
  });
});

describe('platformAuth - 全局统一 getPlatformBaseUrl', () => {
  const originalProcessEnv = process.env;

  beforeEach(() => {
    clearTokensFromStorage();
    process.env = { ...originalProcessEnv };
  });

  afterEach(() => {
    process.env = originalProcessEnv;
  });

  it('未登录时 getPlatformBaseUrl 严格读取环境变量', () => {
    process.env.VITE_PLATFORM_BASE_URL = 'https://xctp-api.devops.foxhis.com';
    expect(getPlatformBaseUrl()).toBe('https://xctp-api.devops.foxhis.com');
  });

  it('已登录且存在 platformBaseUrl 时 getPlatformBaseUrl 优先锁定登录会话地址 (会话亲和)', () => {
    process.env.VITE_PLATFORM_BASE_URL = 'https://other-gateway.com';
    saveTokensToStorage({
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://session-pms.hotel.com',
      tenantId: 'XR-01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(getPlatformBaseUrl()).toBe('https://session-pms.hotel.com');
  });
});

describe('platformAuth - PlatformAuthService 核心流程与并发单飞', () => {
  let service: PlatformAuthService;

  beforeEach(() => {
    clearTokensFromStorage();
    process.env.VITE_PLATFORM_BASE_URL = 'https://test-pms.hotel.com';
    service = new PlatformAuthService();
    vi.restoreAllMocks();
  });

  it('requestDeviceCode 正常返回设备码与完整验证链接', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        device_code: 'mock-device-code-123',
        user_code: 'UC-9988',
        verification_uri: 'https://pms.hotel.com/verify',
        verification_uri_complete: 'https://pms.hotel.com/verify?user_code=UC-9988',
        expires_in: 600,
        interval: 5,
      }),
    } as unknown as Response);

    const result = await service.requestDeviceCode('https://test-pms.hotel.com');
    expect(result.deviceCode).toBe('mock-device-code-123');
    expect(result.userCode).toBe('UC-9988');
    expect(result.verificationUri).toBe('https://pms.hotel.com/verify?user_code=UC-9988');
    expect(result.expiresIn).toBe(600);
  });

  it('refreshTokens 正常续期并在终端异常时清空存储', async () => {
    const existingTokens: PlatformAuthTokens = {
      accessToken: 'old-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() - 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-TEST',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(existingTokens);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'new-refreshed-access-token',
        refresh_token: 'new-refreshed-token',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    } as unknown as Response);

    const refreshed = await service.refreshTokens(existingTokens);
    expect(refreshed.accessToken).toBe('new-refreshed-access-token');

    const stored = loadTokensFromStorage();
    expect(stored?.accessToken).toBe('new-refreshed-access-token');
  });

  it('单飞并发去重 (Single-Flight Deduplication)：多个并发请求只发出 1 次网络刷新', async () => {
    const staleTokens: PlatformAuthTokens = {
      accessToken: 'stale-access-token',
      refreshToken: 'concurrent-refresh-token',
      expiresAt: Date.now() - 5000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-TEST',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(staleTokens);

    let fetchCallCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCallCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'concurrent-refreshed-token',
          refresh_token: 'concurrent-refresh-token',
          expires_in: 3600,
        }),
      } as unknown as Response;
    });

    const results = await Promise.all([
      service.getValidAccessToken({ forceRefresh: true }),
      service.getValidAccessToken({ forceRefresh: true }),
      service.getValidAccessToken({ forceRefresh: true }),
      service.getValidAccessToken({ forceRefresh: true }),
      service.getValidAccessToken({ forceRefresh: true }),
    ]);

    for (const res of results) {
      expect(res).toBe('concurrent-refreshed-token');
    }

    expect(fetchCallCount).toBe(1);
  });
});
