import { describe, it, expect, beforeEach } from 'vitest';
import authReducer, {
  setPlatformBaseUrl,
  setDeviceCodeInfo,
  cancelDeviceLogin,
  loginSucceeded,
  tokenRefreshed,
  authFailed,
  logout,
  updateTokenState,
  AuthState,
  startDeviceLogin,
} from '../../../src/store/slices/authSlice';
import { PlatformAuthTokens, PlatformDeviceCodeInfo } from '../../../src/types';
import { clearTokensFromStorage, saveTokensToStorage } from '../../../src/services/platformAuth';

describe('authSlice - 同步 Reducers 状态机流转', () => {
  let initialState: AuthState;

  beforeEach(() => {
    clearTokensFromStorage();
    initialState = {
      status: 'login-required',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-89201',
      tokens: null,
      tokenState: null,
      deviceCodeInfo: null,
      isAuthorizing: false,
      isRefreshing: false,
      failureReason: null,
      failureError: null,
    };
  });

  it('setPlatformBaseUrl 能够正确更新网关地址', () => {
    const nextState = authReducer(
      initialState,
      setPlatformBaseUrl('https://custom-pms.hotel.com')
    );
    expect(nextState.platformBaseUrl).toBe('https://custom-pms.hotel.com');
  });

  it('setDeviceCodeInfo 激活 authorizing 状态', () => {
    const mockCodeInfo: PlatformDeviceCodeInfo = {
      deviceCode: 'dev-999',
      userCode: 'CODE-123',
      verificationUri: 'https://verify.url',
      expiresIn: 600,
      interval: 5,
      expiresAt: Date.now() + 600000,
    };

    const nextState = authReducer(initialState, setDeviceCodeInfo(mockCodeInfo));
    expect(nextState.status).toBe('authorizing');
    expect(nextState.isAuthorizing).toBe(true);
    expect(nextState.deviceCodeInfo).toEqual(mockCodeInfo);
  });

  it('cancelDeviceLogin 能够安全终止授权等待并回归 login-required', () => {
    const activeState: AuthState = {
      ...initialState,
      status: 'authorizing',
      isAuthorizing: true,
      deviceCodeInfo: {
        deviceCode: 'dev',
        userCode: 'u',
        verificationUri: 'v',
        expiresIn: 600,
        interval: 5,
        expiresAt: Date.now() + 600000,
      },
    };

    const nextState = authReducer(activeState, cancelDeviceLogin());
    expect(nextState.isAuthorizing).toBe(false);
    expect(nextState.deviceCodeInfo).toBeNull();
    expect(nextState.status).toBe('login-required');
  });

  it('loginSucceeded 记录 Token 并推进为 authorized', () => {
    const mockTokens: PlatformAuthTokens = {
      accessToken: 'access-token-success',
      refreshToken: 'refresh-token-success',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-9988',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const nextState = authReducer(initialState, loginSucceeded(mockTokens));
    expect(nextState.status).toBe('authorized');
    expect(nextState.tokens).toEqual(mockTokens);
    expect(nextState.tenantId).toBe('XR-9988');
    expect(nextState.tokenState?.usable).toBe(true);
    expect(nextState.failureReason).toBeNull();
  });

  it('tokenRefreshed 更新 Token 并关闭 isRefreshing 标记', () => {
    const refreshingState: AuthState = {
      ...initialState,
      status: 'authorized',
      isRefreshing: true,
      tokens: {
        accessToken: 'old-token',
        refreshToken: 'ref',
        expiresAt: Date.now(),
        tokenType: 'bearer',
        platformBaseUrl: 'https://pms-api.xiruan.com',
        tenantId: 'XR-89201',
        authenticatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    const newTokens: PlatformAuthTokens = {
      accessToken: 'new-token',
      refreshToken: 'ref',
      expiresAt: Date.now() + 3600000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-89201',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const nextState = authReducer(refreshingState, tokenRefreshed(newTokens));
    expect(nextState.isRefreshing).toBe(false);
    expect(nextState.tokens?.accessToken).toBe('new-token');
  });

  it('authFailed 正确捕获并暴露失败原因 (Fail-Fast) 及结构化 failureError', () => {
    const nextState = authReducer(
      initialState,
      authFailed('文旅平台授权已过期，Refresh Token 失效 [401 invalid_grant]')
    );
    expect(nextState.status).toBe('login-required');
    expect(nextState.failureReason).toBe(
      '文旅平台授权已过期，Refresh Token 失效 [401 invalid_grant]'
    );
    expect(nextState.failureError?.code).toBe('AUTH_CRED_INVALID');
    expect(nextState.failureError?.userTitle).toBe('登录凭据已失效');
    expect(nextState.failureError?.retryable).toBe(false);
  });

  it('logout 彻底清除 Token 与状态', () => {
    const authorizedState: AuthState = {
      ...initialState,
      status: 'authorized',
      tokens: {
        accessToken: 'valid',
        refreshToken: 'ref',
        expiresAt: Date.now() + 3600000,
        tokenType: 'bearer',
        platformBaseUrl: 'https://pms-api.xiruan.com',
        tenantId: 'XR-89201',
        authenticatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    const nextState = authReducer(authorizedState, logout());
    expect(nextState.status).toBe('login-required');
    expect(nextState.tokens).toBeNull();
    expect(nextState.tokenState).toBeNull();
    expect(nextState.tenantId).toBe('');
  });

  it('updateTokenState 在 AccessToken 过期但持有有效 RefreshToken 时维持 authorized 态，杜绝误判踢出', () => {
    const expiredWithRefresh: AuthState = {
      ...initialState,
      status: 'authorized',
      tokens: {
        accessToken: 'expired-access-token',
        refreshToken: 'valid-refresh-token',
        expiresAt: Date.now() - 1000,
        tokenType: 'bearer',
        platformBaseUrl: 'https://pms-api.xiruan.com',
        tenantId: 'XR-89201',
        authenticatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    const nextState = authReducer(expiredWithRefresh, updateTokenState());
    expect(nextState.status).toBe('authorized');
    expect(nextState.tokenState?.usable).toBe(false);
  });

  it('updateTokenState 在 AccessToken 过期且缺少 RefreshToken 时流转为 login-required', () => {
    const expiredWithoutRefresh: AuthState = {
      ...initialState,
      status: 'authorized',
      tokens: {
        accessToken: 'expired-access-token',
        refreshToken: '',
        expiresAt: Date.now() - 1000,
        tokenType: 'bearer',
        platformBaseUrl: 'https://pms-api.xiruan.com',
        tenantId: 'XR-89201',
        authenticatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    const nextState = authReducer(expiredWithoutRefresh, updateTokenState());
    expect(nextState.status).toBe('login-required');
    expect(nextState.tokenState?.usable).toBe(false);
  });

  it('updateTokenState 作为纯函数仅基于当前内存 state 派发倒计时诊断，杜绝读取 localStorage 产生非纯 I/O 副作用', () => {
    // 即使外部 localStorage 写入了新 Token，纯函数 updateTokenState 也绝不产生侧漏读取
    const externalStorageTokens: PlatformAuthTokens = {
      accessToken: 'external-storage-token',
      refreshToken: 'external-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-NEW-TENANT',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTokensToStorage(externalStorageTokens);

    const currentState: AuthState = {
      ...initialState,
      status: 'authorized',
      tenantId: 'XR-MEMORY-TENANT',
      tokens: {
        accessToken: 'memory-valid-token',
        refreshToken: 'memory-refresh-token',
        expiresAt: Date.now() + 1800 * 1000,
        tokenType: 'bearer',
        platformBaseUrl: 'https://pms-api.xiruan.com',
        tenantId: 'XR-MEMORY-TENANT',
        authenticatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    const nextState = authReducer(currentState, updateTokenState());
    expect(nextState.status).toBe('authorized');
    // 严密断言：内存中的 Token 保持单向数据流纯洁性，未被 localStorage 外部副作用污染
    expect(nextState.tokens?.accessToken).toBe('memory-valid-token');
    expect(nextState.tenantId).toBe('XR-MEMORY-TENANT');
    expect(nextState.tokenState?.usable).toBe(true);
    expect(nextState.tokenState?.fresh).toBe(true);
  });

  it('updateTokenState 在 status 为 authorizing 时直接保持状态，严禁意外覆盖为 login-required', () => {
    const authorizingState: AuthState = {
      ...initialState,
      status: 'authorizing',
      isAuthorizing: true,
      tokens: null,
      tokenState: null,
      deviceCodeInfo: {
        deviceCode: 'dev-code-polling',
        userCode: 'UC-999',
        verificationUri: 'https://verify.url',
        expiresIn: 600,
        interval: 5,
        expiresAt: Date.now() + 600000,
      },
    };

    const nextState = authReducer(authorizingState, updateTokenState());
    expect(nextState.status).toBe('authorizing');
    expect(nextState.isAuthorizing).toBe(true);
    expect(nextState.deviceCodeInfo).not.toBeNull();
    expect(nextState.deviceCodeInfo?.deviceCode).toBe('dev-code-polling');
  });
});

describe('authSlice - 异步 ExtraReducers 状态流转', () => {
  it('startDeviceLogin.fulfilled 正确设置 authorized 状态并推进登录态', () => {
    const mockTokens: PlatformAuthTokens = {
      accessToken: 'thunk-access',
      refreshToken: 'thunk-refresh',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-THUNK',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const startState: AuthState = {
      status: 'authorizing',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-89201',
      tokens: null,
      tokenState: null,
      deviceCodeInfo: null,
      isAuthorizing: true,
      isRefreshing: false,
      failureReason: null,
      failureError: null,
    };

    const nextState = authReducer(
      startState,
      startDeviceLogin.fulfilled(mockTokens, 'requestId', { baseUrl: 'https://pms-api.xiruan.com' })
    );

    expect(nextState.status).toBe('authorized');
    expect(nextState.isAuthorizing).toBe(false);
    expect(nextState.tokens?.accessToken).toBe('thunk-access');
    expect(nextState.tenantId).toBe('XR-THUNK');
    expect(nextState.failureError).toBeNull();
  });

  it('startDeviceLogin.rejected 针对网关超时正确解析为 AUTH_NET_TIMEOUT 结构化错误', () => {
    const startState: AuthState = {
      status: 'authorizing',
      platformBaseUrl: 'https://pms-api.xiruan.com',
      tenantId: 'XR-89201',
      tokens: null,
      tokenState: null,
      deviceCodeInfo: null,
      isAuthorizing: true,
      isRefreshing: false,
      failureReason: null,
      failureError: null,
    };

    const rawError =
      '刷新 Token 失败: Failed to handle request [POST https://xctp-api.devops.foxhis.com/identity/oauth/token]: connection timed out after 30000 ms: /10.233.109.82:8090';

    const nextState = authReducer(
      startState,
      startDeviceLogin.rejected(new Error(rawError), 'requestId', { baseUrl: 'https://pms-api.xiruan.com' }, rawError)
    );

    expect(nextState.status).toBe('login-required');
    expect(nextState.isAuthorizing).toBe(false);
    expect(nextState.failureReason).toBe(rawError);
    expect(nextState.failureError).toBeDefined();
    expect(nextState.failureError?.code).toBe('AUTH_NET_TIMEOUT');
    expect(nextState.failureError?.userTitle).toBe('授权服务响应超时');
    expect(nextState.failureError?.retryable).toBe(true);
    expect(nextState.failureError?.rawMessage).toBe(rawError);
  });
});
