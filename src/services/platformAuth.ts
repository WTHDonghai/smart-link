import { PlatformAuthTokens, PlatformDeviceCodeInfo, PlatformTokenState } from '../types';
import { formatBaseUrl, joinApiUrl } from '../utils/url';
import { logger } from './logger';

export const PLATFORM_OAUTH_CLIENT_ID = 'TOOLS';
export const PLATFORM_OAUTH_SCOPE = 'all';
export const PLATFORM_DEVICE_CODE_PATH = '/identity/oauth/device/code';
export const PLATFORM_TOKEN_PATH = '/identity/oauth/token';

export const TERMINAL_STATUS_CODES = [400, 401, 403] as const;
export const TERMINAL_OAUTH_ERRORS = [
  'invalid_grant',
  'invalid_token',
  'unauthorized_client',
  'invalid_client',
  'access_denied',
  'unsupported_grant_type',
] as const;
export const RETRYABLE_STATUS_CODES = [0, 408, 425, 429] as const;
export const RETRYABLE_ERROR_KEYWORDS = [
  'network',
  'timeout',
  'aborted',
  'failed to fetch',
] as const;

const STORAGE_KEY = 'smartlink_platform_tokens';
const MIN_DYNAMIC_REFRESH_SKEW_MS = 30 * 1000;
const MAX_DYNAMIC_REFRESH_SKEW_MS = 5 * 60 * 1000;
const REFRESH_LIFETIME_RATIO = 0.1;
const MAX_REFRESH_LIFETIME_FRACTION = 0.5;

export interface ClassifiedAuthError extends Error {
  statusCode?: number;
  terminal: boolean;
  retryable: boolean;
  oauthError?: string;
}

interface MetaWithEnv {
  env?: {
    DEV?: boolean;
    PROD?: boolean;
    MODE?: string;
    VITE_PLATFORM_BASE_URL?: string;
  };
}

export function getEnvironmentMode(): { mode: string; isDev: boolean; isProd: boolean } {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    const env = process.env.NODE_ENV;
    return {
      mode: env,
      isDev: env === 'development',
      isProd: env === 'production',
    };
  }

  const meta = typeof import.meta !== 'undefined' ? (import.meta as unknown as MetaWithEnv) : undefined;
  if (meta?.env) {
    const isDev = Boolean(meta.env.DEV);
    const isProd = Boolean(meta.env.PROD);
    const mode = String(meta.env.MODE || (isDev ? 'development' : 'production'));
    return { mode, isDev, isProd };
  }

  return { mode: 'development', isDev: true, isProd: false };
}

/**
 * 全局统一获取当前生效的文旅平台 Base URL
 * 优先级 1：当前登录会话中持久化的 platformBaseUrl (杜绝串服)
 * 优先级 2：环境变量 VITE_PLATFORM_BASE_URL (未配置则立即 Fail-Fast 抛错，绝不隐式硬编码兜底)
 */
export function getPlatformBaseUrl(): string {
  const savedTokens = loadTokensFromStorage();
  if (savedTokens?.platformBaseUrl) {
    const url = formatBaseUrl(savedTokens.platformBaseUrl);
    if (url) return url;
  }

  const electronUrl =
    typeof window !== 'undefined'
      ? (window as unknown as { electron?: { env?: { platformBaseUrl?: string } } }).electron?.env?.platformBaseUrl
      : undefined;

  const meta = typeof import.meta !== 'undefined' ? (import.meta as unknown as MetaWithEnv) : undefined;
  const envUrl =
    (typeof process !== 'undefined' && process.env?.VITE_PLATFORM_BASE_URL) ||
    meta?.env?.VITE_PLATFORM_BASE_URL ||
    electronUrl;

  if (!envUrl || !envUrl.trim()) {
    throw new Error('未配置平台接口基础地址，请在环境变量中配置 VITE_PLATFORM_BASE_URL');
  }

  return formatBaseUrl(envUrl);
}

export function calculateRefreshTiming(
  expiresAt: number,
  updatedAt: number,
  now: number = Date.now()
): { refreshAt: number; refreshLeadMs: number } {
  const lifetime = Math.max(0, expiresAt - updatedAt);
  let refreshLeadMs = MAX_DYNAMIC_REFRESH_SKEW_MS;
  if (lifetime > 0) {
    refreshLeadMs = Math.min(
      MAX_DYNAMIC_REFRESH_SKEW_MS,
      Math.max(MIN_DYNAMIC_REFRESH_SKEW_MS, lifetime * REFRESH_LIFETIME_RATIO),
      lifetime * MAX_REFRESH_LIFETIME_FRACTION
    );
  }
  const refreshAt = Math.max(now, expiresAt - refreshLeadMs);
  return { refreshAt, refreshLeadMs };
}

export function inspectTokenState(
  tokens: PlatformAuthTokens | null,
  now: number = Date.now()
): PlatformTokenState {
  if (!tokens || !tokens.accessToken) {
    return {
      fresh: false,
      usable: false,
      expiresAt: 0,
      expiresInMs: 0,
      refreshAt: 0,
      refreshInMs: 0,
    };
  }

  const expiresAt = tokens.expiresAt;
  const updatedAt = tokens.updatedAt ? new Date(tokens.updatedAt).getTime() : now;
  const usable = expiresAt > now;
  const { refreshAt } = calculateRefreshTiming(expiresAt, updatedAt, now);
  const fresh = usable && refreshAt > now;

  return {
    fresh,
    usable,
    expiresAt,
    expiresInMs: Math.max(0, expiresAt - now),
    refreshAt,
    refreshInMs: Math.max(0, refreshAt - now),
  };
}

export function classifyAuthError(error: unknown): ClassifiedAuthError {
  const err = (error instanceof Error ? error : new Error(String(error))) as ClassifiedAuthError;
  const status = err.statusCode ?? 0;
  const message = (err.message || '').toLowerCase();
  const oauthErr = (err.oauthError || '').toLowerCase();

  const isTerminal =
    (TERMINAL_STATUS_CODES as readonly number[]).includes(status) ||
    TERMINAL_OAUTH_ERRORS.some((code) => oauthErr === code || message.includes(code));

  const isRetryable =
    !isTerminal &&
    ((RETRYABLE_STATUS_CODES as readonly number[]).includes(status) ||
      status >= 500 ||
      RETRYABLE_ERROR_KEYWORDS.some((kw) => message.includes(kw)));

  err.terminal = isTerminal;
  err.retryable = isRetryable;
  return err;
}

const tokenChangeListeners = new Set<(tokens: PlatformAuthTokens | null) => void>();

export function subscribeTokenChange(
  listener: (tokens: PlatformAuthTokens | null) => void
): () => void {
  tokenChangeListeners.add(listener);
  return () => {
    tokenChangeListeners.delete(listener);
  };
}

function notifyTokenChange(tokens: PlatformAuthTokens | null): void {
  // 使用微任务异步派发，彻底避免在 Redux dispatching 执行周期内发生非法重入
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(() => {
      for (const listener of tokenChangeListeners) {
        try {
          listener(tokens);
        } catch {
          // 避免单个监听器异常影响其他监听器
        }
      }
    });
  } else {
    for (const listener of tokenChangeListeners) {
      try {
        listener(tokens);
      } catch {
        // 避免单个监听器异常影响其他监听器
      }
    }
  }
}

const activeSchedulers = new Set<PlatformAuthService>();

let inMemoryTokens: PlatformAuthTokens | null = null;

export function setInMemoryTokens(tokens: PlatformAuthTokens | null): void {
  inMemoryTokens = tokens;
}

export function saveTokensToStorage(tokens: PlatformAuthTokens): void {
  inMemoryTokens = tokens;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } catch {
      // 忽略存储配额或权限异常
    }
  }
  notifyTokenChange(tokens);
  for (const scheduler of activeSchedulers) {
    if (scheduler.isSchedulerActive()) {
      void scheduler.checkAndRefreshImmediately();
    }
  }
}

export function loadTokensFromStorage(): PlatformAuthTokens | null {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PlatformAuthTokens;
        if (parsed.accessToken && parsed.refreshToken && parsed.expiresAt) {
          inMemoryTokens = parsed;
          return parsed;
        }
      }
    } catch {
      // 容错回退内存缓存
    }
  }
  return inMemoryTokens;
}

export function clearTokensFromStorage(): void {
  const hadInMemory = Boolean(inMemoryTokens);
  inMemoryTokens = null;
  let hadStorage = false;
  if (typeof localStorage !== 'undefined') {
    try {
      hadStorage = Boolean(localStorage.getItem(STORAGE_KEY));
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 忽略异常
    }
  }
  if (hadStorage || hadInMemory) {
    notifyTokenChange(null);
  }
}

interface PlatformOAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  tenant_id?: string;
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
  data?: PlatformOAuthTokenResponse;
}

export class PlatformAuthService {
  private refreshPromise: Promise<PlatformAuthTokens> | null = null;
  private schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private isSchedulerRunning = false;

  async requestDeviceCode(platformBaseUrl?: string): Promise<PlatformDeviceCodeInfo> {
    const baseUrl = formatBaseUrl(platformBaseUrl || getPlatformBaseUrl());
    const targetUrl = joinApiUrl(baseUrl, PLATFORM_DEVICE_CODE_PATH);

    const form = new URLSearchParams({ client_id: PLATFORM_OAUTH_CLIENT_ID });
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });

    const body = (await response.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
      error?: string;
      error_description?: string;
      msg?: string;
      data?: {
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        verification_uri_complete?: string;
        expires_in?: number;
        interval?: number;
      };
    };

    const payload = body.data || body;
    if (!response.ok || !payload.device_code) {
      const errMsg = body.error_description || body.error || body.msg || `HTTP ${response.status}`;
      const err = new Error(`申请设备授权码失败: ${errMsg}`) as ClassifiedAuthError;
      err.statusCode = response.status;
      throw classifyAuthError(err);
    }

    const expiresIn = Number(payload.expires_in || 600);
    const interval = Number(payload.interval || 5);
    const verificationUri =
      payload.verification_uri_complete || payload.verification_uri || joinApiUrl(baseUrl, '/login');

    return {
      deviceCode: payload.device_code,
      userCode: payload.user_code || '',
      verificationUri,
      expiresIn,
      interval,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  async pollDeviceToken(
    platformBaseUrl: string | undefined,
    deviceCode: string,
    options: {
      expiresIn?: number;
      interval?: number;
      signal?: AbortSignal;
      onPollAttempt?: (attempt: number) => void;
    } = {}
  ): Promise<PlatformAuthTokens> {
    const baseUrl = formatBaseUrl(platformBaseUrl || getPlatformBaseUrl());
    const targetUrl = joinApiUrl(baseUrl, PLATFORM_TOKEN_PATH);
    const expiresIn = options.expiresIn ?? 600;
    let pollIntervalSec = Math.max(2, options.interval ?? 5);
    const deadline = Date.now() + expiresIn * 1000;
    let attempt = 0;

    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new Error('授权流程已被用户取消');
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalSec * 1000));

      if (options.signal?.aborted) {
        throw new Error('授权流程已被用户取消');
      }

      attempt += 1;
      options.onPollAttempt?.(attempt);

      const form = new URLSearchParams({
        grant_type: 'device_code',
        client_id: PLATFORM_OAUTH_CLIENT_ID,
        device_code: deviceCode,
      });

      let response: Response;
      try {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form,
          signal: options.signal,
        });
      } catch (e) {
        if (options.signal?.aborted) throw new Error('授权流程已被用户取消');
        // 网络抖动可继续轮询
        continue;
      }

      let body: PlatformOAuthTokenResponse;
      try {
        const rawText =
          typeof response.text === 'function'
            ? await response.text().catch(() => '')
            : typeof response.json === 'function'
              ? JSON.stringify(await response.json().catch(() => ({})))
              : '';
        body = (rawText ? JSON.parse(rawText) : {}) as PlatformOAuthTokenResponse;
      } catch {
        if (response.status >= 500) {
          continue;
        }
        body = {};
      }
      const payload = body.data || body;
      if (response.ok && payload.access_token) {
        const now = Date.now();
        const tokenExpiresIn = Number(payload.expires_in || 3600);
        const tokens: PlatformAuthTokens = {
          accessToken: payload.access_token,
          refreshToken: payload.refresh_token || '',
          expiresAt: now + tokenExpiresIn * 1000,
          tokenType: payload.token_type || 'bearer',
          platformBaseUrl: baseUrl,
          tenantId: payload.tenant_id || 'DEFAULT',
          authenticatedAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
        };
        saveTokensToStorage(tokens);
        return tokens;
      }

      const errCode = (payload.error || body.error || body.msg || '').toLowerCase();
      if (errCode.includes('authorization_pending')) {
        continue;
      }
      if (errCode.includes('slow_down')) {
        pollIntervalSec = Math.min(15, pollIntervalSec + 2);
        continue;
      }

      if (response.status >= 500) {
        continue;
      }

      const err = new Error(
        payload.error_description || body.error_description || errCode || '轮询授权失败'
      ) as ClassifiedAuthError;
      err.statusCode = response.status;
      err.oauthError = errCode;
      throw classifyAuthError(err);
    }

    throw new Error('授权超时，未在有效期内完成平台网页登录');
  }

  async refreshTokens(
    currentTokens: PlatformAuthTokens,
    _options: { force?: boolean } = {}
  ): Promise<PlatformAuthTokens> {
    const baseUrl = formatBaseUrl(currentTokens.platformBaseUrl || getPlatformBaseUrl());
    const targetUrl = joinApiUrl(baseUrl, PLATFORM_TOKEN_PATH);

    if (!currentTokens.refreshToken) {
      throw new Error('未找到 refresh_token，无法执行自动刷新');
    }

    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentTokens.refreshToken,
      scope: PLATFORM_OAUTH_SCOPE,
    });

    let response: Response;
    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
    } catch (networkError) {
      const classified = classifyAuthError(networkError);
      logger.track('AUTH_TOKEN_REFRESH', {
        module: 'AUTH',
        level: 'WARN',
        message: `[Auth] 平台访问凭证 (AccessToken) 自动续期网络异常: ${classified.message}`,
        details: `终端错误: ${classified.terminal} | 可重试: ${classified.retryable}`,
        meta: { terminal: classified.terminal, retryable: classified.retryable },
      });
      throw classified;
    }

    const rawText =
      typeof response.text === 'function'
        ? await response.text().catch(() => '')
        : typeof response.json === 'function'
          ? JSON.stringify(await response.json().catch(() => ({})))
          : '';

    let body: PlatformOAuthTokenResponse;
    try {
      body = (rawText ? JSON.parse(rawText) : {}) as PlatformOAuthTokenResponse;
    } catch {
      const errMsg = `HTTP ${response.status}${rawText ? `: ${rawText.slice(0, 100)}` : ''}`;
      const parseErr = new Error(`刷新 Token 失败: ${errMsg}`) as ClassifiedAuthError;
      parseErr.statusCode = response.status;
      const classified = classifyAuthError(parseErr);
      if (classified.terminal) {
        clearTokensFromStorage();
      }
      logger.track('AUTH_TOKEN_REFRESH', {
        module: 'AUTH',
        level: 'WARN',
        message: `[Auth] 平台访问凭证 (AccessToken) 响应格式异常: ${errMsg}`,
        details: `终端错误: ${classified.terminal} | 状态码: ${response.status}`,
        meta: { terminal: classified.terminal, statusCode: response.status },
      });
      throw classified;
    }
    const payload = body.data || body;
    if (!response.ok || !payload.access_token) {
      const errMsg = body.error_description || body.error || body.msg || `HTTP ${response.status}`;
      const err = new Error(`刷新 Token 失败: ${errMsg}`) as ClassifiedAuthError;
      err.statusCode = response.status;
      err.oauthError = payload.error || body.error;
      const classified = classifyAuthError(err);
      if (classified.terminal) {
        clearTokensFromStorage();
      }
      logger.track('AUTH_TOKEN_REFRESH', {
        module: 'AUTH',
        level: 'ERROR',
        message: `[Auth] 平台访问凭证 (AccessToken) 自动续期失败: ${errMsg}`,
        details: `终端错误: ${classified.terminal} | 状态码: ${response.status}`,
        meta: { terminal: classified.terminal, statusCode: response.status }
      });
      throw classified;
    }

    const now = Date.now();
    const expiresIn = Number(payload.expires_in || 3600);
    const newTokens: PlatformAuthTokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || currentTokens.refreshToken,
      expiresAt: now + expiresIn * 1000,
      tokenType: payload.token_type || currentTokens.tokenType || 'bearer',
      platformBaseUrl: baseUrl,
      tenantId: payload.tenant_id || currentTokens.tenantId,
      authenticatedAt: currentTokens.authenticatedAt,
      updatedAt: new Date(now).toISOString(),
    };

    saveTokensToStorage(newTokens);
    logger.track('AUTH_TOKEN_REFRESH', {
      module: 'AUTH',
      level: 'INFO',
      message: `[Auth] 平台访问凭证 (AccessToken) 自动续期成功`,
      details: `有效租户: ${newTokens.tenantId} | 有效期: ${expiresIn}s`,
      meta: { tenantId: newTokens.tenantId, expiresIn }
    });
    return newTokens;
  }

  /**
   * 单飞并发控制刷新 (Single-Flight Deduplication)
   */
  async getValidAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    const tokens = loadTokensFromStorage();
    if (!tokens || !tokens.accessToken) {
      throw new Error('未找到有效的文旅平台授权，请先完成授权登录');
    }

    const state = inspectTokenState(tokens);

    if (!options.forceRefresh && state.fresh) {
      return tokens.accessToken;
    }

    if (!state.usable && !tokens.refreshToken) {
      clearTokensFromStorage();
      throw new Error('文旅平台授权已过期且无可用的 Refresh Token，请重新授权登录');
    }

    if (this.refreshPromise) {
      const refreshed = await this.refreshPromise;
      return refreshed.accessToken;
    }

    this.refreshPromise = (async () => {
      try {
        const latestTokens = loadTokensFromStorage() || tokens;
        const refreshed = await this.refreshTokens(latestTokens, {
          force: options.forceRefresh,
        });
        return refreshed;
      } finally {
        this.refreshPromise = null;
      }
    })();

    const resultTokens = await this.refreshPromise;
    return resultTokens.accessToken;
  }

  isSchedulerActive(): boolean {
    return this.isSchedulerRunning;
  }

  /**
   * 订阅 Token 变更通知 (无论是由调度器、登录还是业务 401 自动刷新)
   */
  onTokenChange(listener: (tokens: PlatformAuthTokens | null) => void): () => void {
    return subscribeTokenChange(listener);
  }

  private schedulerCallback: ((tokens: PlatformAuthTokens | null, error?: ClassifiedAuthError) => void) | null = null;
  private isChecking = false;

  private async executeRefreshCheck(): Promise<void> {
    if (!this.isSchedulerRunning || this.isChecking) return;
    this.isChecking = true;

    try {
      const tokens = loadTokensFromStorage();
      if (!tokens) {
        this.schedulerCallback?.(null);
        if (this.isSchedulerRunning) {
          if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
          }
          this.schedulerTimer = setTimeout(() => {
            void this.executeRefreshCheck();
          }, 30000);
        }
        return;
      }

      const state = inspectTokenState(tokens);
      // 只要进入刷新窗口，或者 AccessToken 已过期但存在 RefreshToken，都必须发起静默续期
      const needsRefresh = !state.fresh && (state.usable || Boolean(tokens.refreshToken));
      let nextDelayMs = Math.max(1000, Math.min(60000, state.refreshInMs || 60000));

      if (needsRefresh) {
        try {
          await this.getValidAccessToken({ forceRefresh: false });
          const latestTokens = loadTokensFromStorage();
          this.schedulerCallback?.(latestTokens);
          const updatedState = inspectTokenState(latestTokens);
          nextDelayMs = Math.max(1000, Math.min(60000, updatedState.refreshInMs || 60000));
        } catch (rawError) {
          const classified = classifyAuthError(rawError);
          if (classified.terminal) {
            // 终端致命凭据失效（如 invalid_grant），通知上层
            clearTokensFromStorage();
            this.schedulerCallback?.(null, classified);
            return;
          } else {
            // 网络抖动、超时等可重试异常：绝不通知踢出用户，设定较短退避时间重试
            logger.track('AUTH_REFRESH_RETRYABLE_ERROR', {
              module: 'AUTH',
              level: 'WARN',
              message: `[Auth] Token 后台静默续期遭遇可重试网络异常: ${classified.message}`,
              details: `状态码: ${classified.statusCode ?? 'N/A'}, 5 秒后重试`,
            });
            nextDelayMs = 5000;
          }
        }
      }

      if (this.isSchedulerRunning) {
        if (this.schedulerTimer) {
          clearTimeout(this.schedulerTimer);
        }
        this.schedulerTimer = setTimeout(() => {
          void this.executeRefreshCheck();
        }, nextDelayMs);
      }
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 启动 Token 后台自动续期调度器
   */
  startRefreshScheduler(
    onTick: (tokens: PlatformAuthTokens | null, error?: ClassifiedAuthError) => void
  ): void {
    this.schedulerCallback = onTick;
    if (this.isSchedulerRunning) {
      return;
    }
    this.isSchedulerRunning = true;
    activeSchedulers.add(this);

    const initialTokens = loadTokensFromStorage();
    const initialDelay = initialTokens
      ? Math.max(1000, Math.min(60000, inspectTokenState(initialTokens).refreshInMs || 60000))
      : 30000;

    this.schedulerTimer = setTimeout(() => {
      void this.executeRefreshCheck();
    }, initialDelay);
  }

  /**
   * 外部即时唤醒与校验（供休眠唤醒、获得焦点、网络恢复时即时响应）
   */
  async checkAndRefreshImmediately(): Promise<void> {
    if (!this.isSchedulerRunning) return;
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    await this.executeRefreshCheck();
  }

  stopRefreshScheduler(): void {
    this.isSchedulerRunning = false;
    this.schedulerCallback = null;
    activeSchedulers.delete(this);
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }
}

export const platformAuthService = new PlatformAuthService();
