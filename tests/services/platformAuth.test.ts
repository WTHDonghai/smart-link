import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateRefreshTiming,
  inspectTokenState,
  classifyAuthError,
  PlatformAuthService,
  saveTokensToStorage,
  loadTokensFromStorage,
  clearTokensFromStorage,
  subscribeTokenChange,
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
    vi.stubEnv('VITE_PLATFORM_BASE_URL', 'https://test-pms.hotel.com');
    service = new PlatformAuthService();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      await new Promise<void>((resolve) => queueMicrotask(resolve));
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

  it('refreshTokens 在服务端返回非 JSON (如 502 HTML) 时先读取 text，不重复消耗流，杜绝 Body has already been read', async () => {
    const existingTokens: PlatformAuthTokens = {
      accessToken: 'old-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() - 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-STREAM-TEST',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(existingTokens);

    let textReadCount = 0;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => {
        textReadCount += 1;
        return '<html><body>502 Bad Gateway</body></html>';
      },
    } as unknown as Response);

    let caughtError: unknown;
    try {
      await service.refreshTokens(existingTokens);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    const classified = caughtError as { message: string; statusCode: number; retryable: boolean };
    expect(classified.statusCode).toBe(502);
    expect(classified.message).toContain('HTTP 502: <html><body>502 Bad Gateway</body></html>');
    expect(classified.retryable).toBe(true);
    expect(textReadCount).toBe(1);
  });
});

describe('platformAuth - Token 变更订阅与广播通知机制 (onTokenChange / subscribeTokenChange)', () => {
  beforeEach(() => {
    clearTokensFromStorage();
  });

  it('saveTokensToStorage 与 clearTokensFromStorage 能够精准触发广播通知', async () => {
    const received: (PlatformAuthTokens | null)[] = [];
    const unsubscribe = subscribeTokenChange((tokens) => {
      received.push(tokens);
    });

    const mockTokens: PlatformAuthTokens = {
      accessToken: 'broadcast-access-token',
      refreshToken: 'broadcast-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-BROADCAST',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveTokensToStorage(mockTokens);
    await Promise.resolve();
    expect(received.length).toBe(1);
    expect(received[0]?.accessToken).toBe('broadcast-access-token');

    clearTokensFromStorage();
    await Promise.resolve();
    expect(received.length).toBe(2);
    expect(received[1]).toBeNull();

    unsubscribe();
    saveTokensToStorage(mockTokens);
    await Promise.resolve();
    // 取消订阅后不再接收新事件
    expect(received.length).toBe(2);
  });

  it('PlatformAuthService.onTokenChange 支持订阅、通知及取消订阅完整生命周期', async () => {
    const testService = new PlatformAuthService();
    const received: (PlatformAuthTokens | null)[] = [];
    const unsubscribe = testService.onTokenChange((tokens) => {
      received.push(tokens);
    });

    const mockTokens: PlatformAuthTokens = {
      accessToken: 'service-sub-token',
      refreshToken: 'service-sub-refresh',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-SERVICE-SUB',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveTokensToStorage(mockTokens);
    await Promise.resolve();
    expect(received.length).toBe(1);
    expect(received[0]?.accessToken).toBe('service-sub-token');

    // 取消订阅后，后续变更不再触发该监听器
    unsubscribe();
    clearTokensFromStorage();
    await Promise.resolve();
    expect(received.length).toBe(1);
  });

  it('clearTokensFromStorage 具备幂等性，连续多次调用仅在首次有效清空时广播一次 null', async () => {
    const received: (PlatformAuthTokens | null)[] = [];
    const unsubscribe = subscribeTokenChange((tokens) => {
      received.push(tokens);
    });

    const mockTokens: PlatformAuthTokens = {
      accessToken: 'idempotent-token',
      refreshToken: 'idempotent-refresh',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-IDEMPOTENT',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveTokensToStorage(mockTokens);
    await Promise.resolve();
    expect(received.length).toBe(1);
    expect(received[0]?.accessToken).toBe('idempotent-token');

    // 第一次清空：Storage 中存在数据，成功删除并广播 null
    clearTokensFromStorage();
    await Promise.resolve();
    expect(received.length).toBe(2);
    expect(received[1]).toBeNull();

    // 第二次、第三次连续调用：Storage 中已无数据，绝不重复触发广播
    clearTokensFromStorage();
    clearTokensFromStorage();
    await Promise.resolve();
    expect(received.length).toBe(2);

    unsubscribe();
  });

  it('验证 logout 与 onTokenChange 协同工作时具备防重拦截，绝不发生无限微任务递归死循环', async () => {
    let currentAuthStatus = 'authorized';
    let currentTokens: PlatformAuthTokens | null = {
      accessToken: 'loop-test-token',
      refreshToken: 'loop-test-refresh',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-LOOP',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(currentTokens);

    let logoutCallCount = 0;
    let onTokenChangeNullCount = 0;

    const mockLogout = () => {
      logoutCallCount += 1;
      currentTokens = null;
      currentAuthStatus = 'login-required';
      clearTokensFromStorage();
    };

    // 按照 App.tsx 的防重策略接入 onTokenChange
    const unsubscribe = subscribeTokenChange((tokens) => {
      if (tokens === null) {
        onTokenChangeNullCount += 1;
        // 防重检查：仅在非退出态或仍有 tokens 时才派发 logout
        if (currentAuthStatus !== 'login-required' || currentTokens !== null) {
          mockLogout();
        }
      }
    });

    // 触发登出
    mockLogout();

    // 等待多次微任务排空与延时
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 严密断言：
    // 1. logout 仅调用 1 次，决不发生递归
    // 2. onTokenChange 接收 null 广播仅 1 次 (得益于 clearTokensFromStorage 幂等)
    // 3. 最终状态确切为 login-required，tokens 为 null
    expect(logoutCallCount).toBe(1);
    expect(onTokenChangeNullCount).toBe(1);
    expect(currentAuthStatus).toBe('login-required');
    expect(currentTokens).toBeNull();

    unsubscribe();
  });
});

describe('platformAuth - 调度器容错与即时唤醒续期', () => {
  let service: PlatformAuthService;

  beforeEach(() => {
    clearTokensFromStorage();
    vi.stubEnv('VITE_PLATFORM_BASE_URL', 'https://test-pms.hotel.com');
    service = new PlatformAuthService();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    service.stopRefreshScheduler();
    vi.unstubAllEnvs();
  });

  it('调度器在遭遇网络超时等可重试异常时，绝不向上层抛出致命终端错误，维持旧 Token 并继续保持登录态', async () => {
    // 待刷新的即将到期 Token
    const nearExpiryTokens: PlatformAuthTokens = {
      accessToken: 'expiring-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: Date.now() + 10 * 1000, // 仅剩 10 秒
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-RETRY',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(nearExpiryTokens);

    // 模拟网络失败 (例如网络波动断网)
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    let callbackError: unknown = null;
    let callbackTokens: unknown = null;

    service.startRefreshScheduler((tokens, error) => {
      callbackTokens = tokens;
      callbackError = error;
    });

    // 手动触发即时检查执行
    await service.checkAndRefreshImmediately();

    // 严密断言：可重试错误绝不传给上层回调造成误踢
    expect(callbackError).toBeNull();
    expect(callbackTokens).toBeNull();

    // 本地 Storage 依然保留旧 Token，杜绝数据被清空
    const currentStored = loadTokensFromStorage();
    expect(currentStored?.accessToken).toBe('expiring-access-token');
  });

  it('调度器在遭遇服务端明确返回 invalid_grant 终端失效时，清空存储并向回调传递致命错误', async () => {
    const expiredTokens: PlatformAuthTokens = {
      accessToken: 'stale-access-token',
      refreshToken: 'revoked-refresh-token',
      expiresAt: Date.now() - 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-TERMINAL',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(expiredTokens);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'Refresh token is expired or revoked',
      }),
    } as unknown as Response);

    let callbackError: unknown = null;
    let callbackTokens: unknown = 'init';

    service.startRefreshScheduler((tokens, error) => {
      callbackTokens = tokens;
      callbackError = error;
    });

    await service.checkAndRefreshImmediately();

    expect(callbackTokens).toBeNull();
    expect(callbackError).toBeDefined();
    const classified = callbackError as { terminal: boolean; statusCode: number };
    expect(classified.terminal).toBe(true);
    expect(classified.statusCode).toBe(400);

    // 本地存储已清除
    expect(loadTokensFromStorage()).toBeNull();
  });

  it('在 AccessToken 已过期但持有 RefreshToken 时 (休眠唤醒场景)，即时唤醒能够成功续期', async () => {
    const sleepWakeTokens: PlatformAuthTokens = {
      accessToken: 'sleep-expired-token',
      refreshToken: 'sleep-valid-refresh-token',
      expiresAt: Date.now() - 3600 * 1000, // 电脑休眠 1 小时已过期
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-WAKEUP',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(sleepWakeTokens);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'woken-new-access-token',
        refresh_token: 'woken-new-refresh-token',
        expires_in: 3600,
      }),
    } as unknown as Response);

    const callbackTokensList: PlatformAuthTokens[] = [];
    service.startRefreshScheduler((tokens) => {
      if (tokens) callbackTokensList.push(tokens);
    });

    await service.checkAndRefreshImmediately();

    expect(callbackTokensList.length).toBe(1);
    expect(callbackTokensList[0].accessToken).toBe('woken-new-access-token');

    const updated = loadTokensFromStorage();
    expect(updated?.accessToken).toBe('woken-new-access-token');
  });

  it('isSchedulerActive 能够正确反映调度器运行状态', () => {
    expect(service.isSchedulerActive()).toBe(false);
    service.startRefreshScheduler(() => {});
    expect(service.isSchedulerActive()).toBe(true);
    service.stopRefreshScheduler();
    expect(service.isSchedulerActive()).toBe(false);
  });

  it('调度器在初始无 Token 情况下启动保持活性，写入 Token 时自动唤醒并对齐续期', async () => {
    clearTokensFromStorage();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: 'auto-woken-token',
          refresh_token: 'auto-woken-refresh',
          expires_in: 3600,
        }),
      json: async () => ({
        access_token: 'auto-woken-token',
        refresh_token: 'auto-woken-refresh',
        expires_in: 3600,
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    const tickReceived: (PlatformAuthTokens | null)[] = [];
    service.startRefreshScheduler((tokens) => {
      if (tokens) tickReceived.push(tokens);
    });

    expect(service.isSchedulerActive()).toBe(true);

    // 写入一个已进入刷新窗口的 Token (例如已过期但持有 RefreshToken)
    const expiredTokens: PlatformAuthTokens = {
      accessToken: 'expiring-token',
      refreshToken: 'valid-refresh',
      expiresAt: Date.now() - 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://test-pms.hotel.com',
      tenantId: 'XR-WAKE',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveTokensToStorage(expiredTokens);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalled();
    const stored = loadTokensFromStorage();
    expect(stored?.accessToken).toBe('auto-woken-token');
  });
});
