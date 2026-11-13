import { describe, it, expect } from 'vitest';
import {
  resolveAgentModelConfig,
  readAgentFeatureSwitches,
  DEFAULT_AGENT_MODEL_MAX_CONCURRENCY,
} from '@/src/config/agentModelConfig';
import type { CachedRemoteAgentAiConfig } from '@/src/config/remoteAgentModelConfig';
import { PROCESS_ENV_KEYS } from '@/src/types/env';

/**
 * Agent 模型配置：远端租户配置下发 + 本地非敏感缺省值合并、Fail-Fast、密钥不回显。
 */

function buildRemote(overrides: Partial<{
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
  enabled: boolean;
  extras: Record<string, unknown>;
}> = {}): CachedRemoteAgentAiConfig {
  return {
    keyId: 'default',
    loadedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_900_000,
    payload: {
      baseUrl: 'https://datapulse.example.com',
      apiKey: 'sk-remote-secret',
      model: 'qwen-vl-max',
      timeoutSeconds: 30,
      enabled: true,
      extras: {},
      ...overrides,
    },
  };
}

function buildEnabledEnv(overrides?: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    [PROCESS_ENV_KEYS.agentProductMappingEnabled]: 'true',
    ...overrides,
  };
}

describe('resolveAgentModelConfig 远端配置合并', () => {
  it('默认使用远端的 baseUrl、apiKey、model 与 timeout', () => {
    const config = resolveAgentModelConfig(buildRemote({ timeoutSeconds: 45 }), buildEnabledEnv());

    expect(config.baseUrl).toBe('https://datapulse.example.com');
    expect(config.apiKey).toBe('sk-remote-secret');
    expect(config.mappingModel).toBe('qwen-vl-max');
    expect(config.diagnosisModel).toBe('qwen-vl-max');
    expect(config.timeoutMs).toBe(45_000);
    expect(config.productMappingEnabled).toBe(true);
  });

  it('extras.mappingModel / diagnosisModel 优先，缺省共用远端 model', () => {
    const config = resolveAgentModelConfig(
      buildRemote({
        extras: { mappingModel: ' qwen-max ', diagnosisModel: 'qwen-vl-plus' },
      }),
      buildEnabledEnv({ [PROCESS_ENV_KEYS.agentExceptionRecoveryEnabled]: 'true' })
    );

    expect(config.mappingModel).toBe('qwen-max');
    expect(config.diagnosisModel).toBe('qwen-vl-plus');
  });

  it('apiKey 严格来自远端：环境变量中的密钥被忽略', () => {
    const config = resolveAgentModelConfig(
      buildRemote({ apiKey: 'sk-remote' }),
      buildEnabledEnv({ SMARTLINK_AGENT_MODEL_API_KEY: 'sk-env-should-be-ignored' })
    );

    expect(config.apiKey).toBe('sk-remote');
  });

  it('远端 enabled=false 时强制关闭两项功能，不调用模型', () => {
    const config = resolveAgentModelConfig(
      buildRemote({ enabled: false }),
      buildEnabledEnv({ [PROCESS_ENV_KEYS.agentExceptionRecoveryEnabled]: 'true' })
    );

    expect(config.productMappingEnabled).toBe(false);
    expect(config.exceptionRecoveryEnabled).toBe(false);
  });

  it('远端模型为空时使用环境变量缺省模型', () => {
    const config = resolveAgentModelConfig(
      buildRemote({ model: '' }),
      buildEnabledEnv({ [PROCESS_ENV_KEYS.agentMappingModel]: 'deepseek-chat' })
    );

    expect(config.mappingModel).toBe('deepseek-chat');
  });

  it('开关均关闭时不校验配置，直接返回关闭态', () => {
    const config = resolveAgentModelConfig(buildRemote({ model: '' }), {});
    expect(config.productMappingEnabled).toBe(false);
    expect(config.exceptionRecoveryEnabled).toBe(false);
    expect(config.timeoutMs).toBe(30_000);
    expect(config.maxConcurrency).toBe(DEFAULT_AGENT_MODEL_MAX_CONCURRENCY);
  });
});

describe('resolveAgentModelConfig Fail-Fast 校验', () => {
  it('开启产品映射但远端未下发模型：列明缺失项且不回显密钥', () => {
    try {
      resolveAgentModelConfig(buildRemote({ model: '' }), buildEnabledEnv());
      throw new Error('expected throw');
    } catch (error) {
      const message = String((error as Error).message);
      expect(message).toContain('Agent 功能已开启但 AI 配置缺失');
      expect(message).toContain('mappingModel');
      expect(message).not.toContain('sk-remote-secret');
    }
  });

  it('apiKey 为空时列明「租户 AI 配置」缺失', () => {
    expect(() =>
      resolveAgentModelConfig(buildRemote({ apiKey: '' }), buildEnabledEnv())
    ).toThrow('apiKey（租户 AI 配置）');
  });

  it('数值型缺省项非法时立即报错并指明键名', () => {
    expect(() =>
      resolveAgentModelConfig(
        buildRemote(),
        buildEnabledEnv({ [PROCESS_ENV_KEYS.agentModelMaxConcurrency]: '0' })
      )
    ).toThrow('SMARTLINK_AGENT_MODEL_MAX_CONCURRENCY 必须为正整数，当前值非法: 0');
  });
});

describe('readAgentFeatureSwitches', () => {
  it('支持 1/true/yes/on，空串与 false/0 视为关闭', () => {
    expect(readAgentFeatureSwitches({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: '1' }).productMappingEnabled).toBe(true);
    expect(readAgentFeatureSwitches({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: 'ON' }).productMappingEnabled).toBe(true);
    expect(readAgentFeatureSwitches({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: 'false' }).productMappingEnabled).toBe(false);
    expect(readAgentFeatureSwitches({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: '' }).productMappingEnabled).toBe(false);
  });
});