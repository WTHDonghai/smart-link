/**
 * 租户 AI 配置的主进程缓存（仅主进程消费）。
 *
 * - 应用启动、Token 同步后按需拉取；缓存 TTL 15 分钟，过期后在使用前重新拉取；
 * - 解密后的 apiKey 只存在于本模块内存，绝不写入文件、日志或 Renderer；
 * - 拉取失败只保留安全错误摘要，供诊断路径降级并上报。
 */

import {
  AgentAiConfigError,
  fetchAgentAiConfig,
  type AgentAiConfigFetchResult,
  type AgentAiConfigPayload,
} from '@/src/services/agentAiConfigApi';
import { getPlatformBaseUrl, loadTokensFromStorage } from '@/src/services/platformAuth';
import { describeErrorMessage } from '@/src/utils/errorCauses';

export const REMOTE_AGENT_AI_CONFIG_TTL_MS = 15 * 60 * 1000;

/** Access Token 是否当前有效（存在且未过期）；过期续期由渲染进程单飞负责 */
export function hasUsableAccessToken(tokens: { accessToken: string; expiresAt: number } | null): boolean {
  return Boolean(tokens?.accessToken && tokens.expiresAt > Date.now());
}

export interface CachedRemoteAgentAiConfig extends AgentAiConfigFetchResult {
  loadedAt: number;
  expiresAt: number;
}

export interface RemoteAgentAiConfigProviderOptions {
  /** 测试注入：自定义拉取实现 */
  loader?: () => Promise<AgentAiConfigFetchResult>;
  now?: () => number;
  ttlMs?: number;
}

/**
 * 默认拉取：登录态 Token + 当前平台网关地址。
 *
 * 主进程不主动续期 Token：续期由渲染进程单飞调度负责，续期后的 Token 经
 * duty:sync-tokens 同步至主进程，下一次按需加载自然使用新 Token。
 * 避免两个进程用同一 refresh_token 并发续期造成服务端轮换竞态。
 */
function loadFromPlatform(): Promise<AgentAiConfigFetchResult> {
  const tokens = loadTokensFromStorage();
  if (!tokens || !hasUsableAccessToken(tokens)) {
    throw new AgentAiConfigError(
      'AUTH_REQUIRED',
      '平台授权缺失或已过期，等待自动续期同步后重试'
    );
  }
  return fetchAgentAiConfig({
    baseUrl: getPlatformBaseUrl(),
    accessToken: tokens.accessToken,
  });
}

export class RemoteAgentAiConfigProvider {
  private readonly loader: () => Promise<AgentAiConfigFetchResult>;
  private readonly now: () => number;
  private readonly ttlMs: number;

  private cached: CachedRemoteAgentAiConfig | null = null;
  private inflight: Promise<CachedRemoteAgentAiConfig> | null = null;
  private lastError: string | null = null;

  constructor(options: RemoteAgentAiConfigProviderOptions = {}) {
    this.loader = options.loader ?? loadFromPlatform;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? REMOTE_AGENT_AI_CONFIG_TTL_MS;
  }

  /** 当前缓存快照（可能已过期）；调用方可用 isFresh 判断是否需要在后台刷新。 */
  getSnapshot(): CachedRemoteAgentAiConfig | null {
    return this.cached;
  }

  isFresh(): boolean {
    return Boolean(this.cached && this.now() < this.cached.expiresAt);
  }

  /** 最近一次拉取失败的安全摘要（不含密钥）；成功后清空。 */
  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * 确保有可用的远端配置：未过期直接返回缓存；并发调用共享同一次拉取。
   * 失败时抛出，绝不回落到本机环境变量中的密钥。
   */
  async ensureLoaded(options: { force?: boolean } = {}): Promise<CachedRemoteAgentAiConfig> {
    if (!options.force && this.cached && this.now() < this.cached.expiresAt) {
      return this.cached;
    }
    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = (async () => {
      try {
        const result = await this.loader();
        const loadedAt = this.now();
        this.cached = {
          ...result,
          loadedAt,
          expiresAt: loadedAt + this.ttlMs,
        };
        this.lastError = null;
        return this.cached;
      } catch (error) {
        this.lastError = describeErrorMessage(error);
        throw error;
      } finally {
        this.inflight = null;
      }
    })();

    return this.inflight;
  }

  /** 退出登录/切换租户时丢弃缓存，避免把上一租户的密钥继续留在内存。 */
  clear(): void {
    this.cached = null;
    this.lastError = null;
  }
}

export const remoteAgentAiConfigProvider = new RemoteAgentAiConfigProvider();

/** 读取 extras 中的非空字符串（模型覆盖项）。 */
export function readRemoteConfigExtraString(
  payload: AgentAiConfigPayload,
  key: string
): string {
  const value = payload.extras[key];
  return typeof value === 'string' ? value.trim() : '';
}