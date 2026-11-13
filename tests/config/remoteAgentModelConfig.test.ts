import { describe, it, expect, vi } from 'vitest';
import {
  RemoteAgentAiConfigProvider,
  REMOTE_AGENT_AI_CONFIG_TTL_MS,
} from '@/src/config/remoteAgentModelConfig';
import type { AgentAiConfigFetchResult } from '@/src/services/agentAiConfigApi';

function buildResult(keyId = 'default'): AgentAiConfigFetchResult {
  return {
    keyId,
    payload: {
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'sk-remote',
      model: 'qwen-vl-max',
      timeoutSeconds: 30,
      enabled: true,
      extras: {},
    },
  };
}

describe('RemoteAgentAiConfigProvider', () => {
  it('首次加载后命中缓存，TTL 到期后重新拉取', async () => {
    let now = 1_000;
    const loader = vi.fn(async () => buildResult());
    const provider = new RemoteAgentAiConfigProvider({ loader, now: () => now });

    const first = await provider.ensureLoaded();
    expect(first.keyId).toBe('default');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(provider.isFresh()).toBe(true);

    await provider.ensureLoaded();
    expect(loader).toHaveBeenCalledTimes(1);

    now += REMOTE_AGENT_AI_CONFIG_TTL_MS;
    expect(provider.isFresh()).toBe(false);

    await provider.ensureLoaded();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('并发 ensureLoaded 共享同一次拉取', async () => {
    let resolveLoader!: (value: AgentAiConfigFetchResult) => void;
    const pending = new Promise<AgentAiConfigFetchResult>((resolve) => {
      resolveLoader = resolve;
    });
    const loader = vi.fn(() => pending);
    const provider = new RemoteAgentAiConfigProvider({ loader, now: () => 1 });

    const first = provider.ensureLoaded();
    const second = provider.ensureLoaded();
    expect(loader).toHaveBeenCalledTimes(1);

    resolveLoader(buildResult());
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
  });

  it('force 绕过未过期缓存', async () => {
    let calls = 0;
    const loader = vi.fn(async () => buildResult(`key-${++calls}`));
    const provider = new RemoteAgentAiConfigProvider({ loader, now: () => 1 });

    await provider.ensureLoaded();
    const refreshed = await provider.ensureLoaded({ force: true });

    expect(loader).toHaveBeenCalledTimes(2);
    expect(refreshed.keyId).toBe('key-2');
  });

  it('拉取失败抛出并保留安全错误摘要，成功后清空', async () => {
    let fail = true;
    const loader = vi.fn(async () => {
      if (fail) throw new Error('network down');
      return buildResult();
    });
    const provider = new RemoteAgentAiConfigProvider({ loader, now: () => 1 });

    await expect(provider.ensureLoaded()).rejects.toThrow('network down');
    expect(provider.getLastError()).toContain('network down');
    expect(provider.getSnapshot()).toBeNull();

    fail = false;
    await provider.ensureLoaded();
    expect(provider.getLastError()).toBeNull();
  });

  it('clear 丢弃缓存与错误，供退出登录使用', async () => {
    const provider = new RemoteAgentAiConfigProvider({
      loader: async () => buildResult(),
      now: () => 1,
    });

    await provider.ensureLoaded();
    expect(provider.getSnapshot()).not.toBeNull();

    provider.clear();
    expect(provider.getSnapshot()).toBeNull();
    expect(provider.isFresh()).toBe(false);
  });
});