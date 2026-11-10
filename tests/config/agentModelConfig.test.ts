import { describe, it, expect } from 'vitest';
import {
  readAgentModelConfig,
  DEFAULT_AGENT_MODEL_TIMEOUT_MS,
  DEFAULT_AGENT_MODEL_MAX_CONCURRENCY,
} from '../../src/config/agentModelConfig';
import { PROCESS_ENV_KEYS } from '../../src/types/env';

/**
 * Agent 模型配置预留（P0）：环境变量静默下发、Fail-Fast 校验、密钥不回显。
 */

function buildEnabledEnv(
  overrides?: Record<string, string>
): Record<string, string | undefined> {
  return {
    [PROCESS_ENV_KEYS.agentProductMappingEnabled]: 'true',
    [PROCESS_ENV_KEYS.agentModelProvider]: 'deepseek',
    [PROCESS_ENV_KEYS.agentModelBaseUrl]: 'https://gateway.example.com/v1',
    [PROCESS_ENV_KEYS.agentModelApiKey]: 'sk-test-123',
    [PROCESS_ENV_KEYS.agentMappingModel]: 'deepseek-chat',
    ...overrides,
  };
}

describe('readAgentModelConfig 功能开关与默认值', () => {
  it('两项开关均未配置时返回关闭态配置，不强制任何模型项', () => {
    const config = readAgentModelConfig({});
    expect(config.productMappingEnabled).toBe(false);
    expect(config.exceptionRecoveryEnabled).toBe(false);
    expect(config.provider).toBe('');
    expect(config.timeoutMs).toBe(DEFAULT_AGENT_MODEL_TIMEOUT_MS);
    expect(config.maxConcurrency).toBe(DEFAULT_AGENT_MODEL_MAX_CONCURRENCY);
  });

  it('开关支持 1/true/yes/on，空串与 false/0 视为关闭', () => {
    expect(readAgentModelConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: '1' })).productMappingEnabled).toBe(true);
    expect(readAgentModelConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: 'ON' })).productMappingEnabled).toBe(true);
    expect(readAgentModelConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: 'false' })).productMappingEnabled).toBe(false);
    expect(readAgentModelConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: '' })).productMappingEnabled).toBe(false);
  });

  it('完整配置被精确解析（去除首尾空白，数值项为正整数）', () => {
    const config = readAgentModelConfig(
      buildEnabledEnv({
        [PROCESS_ENV_KEYS.agentModelProvider]: '  qwen  ',
        [PROCESS_ENV_KEYS.agentModelTimeoutMs]: '45000',
        [PROCESS_ENV_KEYS.agentModelMaxConcurrency]: '3',
      })
    );
    expect(config.provider).toBe('qwen');
    expect(config.mappingModel).toBe('deepseek-chat');
    expect(config.timeoutMs).toBe(45000);
    expect(config.maxConcurrency).toBe(3);
  });

  it('数值项非法时立即报错并指明键名', () => {
    expect(() =>
      readAgentModelConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentModelTimeoutMs]: 'abc' }))
    ).toThrow('SMARTLINK_AGENT_MODEL_TIMEOUT_MS 必须为正整数，当前值非法: abc');
    expect(() =>
      readAgentModelConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentModelMaxConcurrency]: '0' }))
    ).toThrow('SMARTLINK_AGENT_MODEL_MAX_CONCURRENCY 必须为正整数，当前值非法: 0');
  });
});

describe('readAgentModelConfig Fail-Fast 校验', () => {
  it('开启产品映射但基础配置缺失：逐项列明缺失键，不兜底推进', () => {
    expect(() => readAgentModelConfig({ [PROCESS_ENV_KEYS.agentProductMappingEnabled]: 'true' })).toThrow(
      'Agent 功能已开启但模型配置缺失: SMARTLINK_AGENT_MODEL_PROVIDER, SMARTLINK_AGENT_MODEL_BASE_URL, SMARTLINK_AGENT_MODEL_API_KEY, SMARTLINK_AGENT_MAPPING_MODEL。请在环境配置文件中补齐后重启应用。'
    );
  });

  it('开启异常处置时额外要求诊断模型', () => {
    const env = buildEnabledEnv({
      [PROCESS_ENV_KEYS.agentProductMappingEnabled]: 'false',
      [PROCESS_ENV_KEYS.agentExceptionRecoveryEnabled]: 'true',
      [PROCESS_ENV_KEYS.agentDiagnosisModel]: '',
    });
    expect(() => readAgentModelConfig(env)).toThrow(
      'Agent 功能已开启但模型配置缺失: SMARTLINK_AGENT_DIAGNOSIS_MODEL。请在环境配置文件中补齐后重启应用。'
    );
  });

  it('空白字符串视为缺失（手工填写残留空格不得静默通过）', () => {
    expect(() =>
      readAgentModelConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentModelBaseUrl]: '   ' }))
    ).toThrow('Agent 功能已开启但模型配置缺失: SMARTLINK_AGENT_MODEL_BASE_URL。');
  });

  it('报错信息绝不回显 API Key 等敏感值', () => {
    const secret = 'sk-super-secret-value';
    let errorMessage = '';
    try {
      readAgentModelConfig(
        buildEnabledEnv({
          [PROCESS_ENV_KEYS.agentModelApiKey]: secret,
          [PROCESS_ENV_KEYS.agentModelBaseUrl]: '',
        })
      );
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    expect(errorMessage).toContain('SMARTLINK_AGENT_MODEL_BASE_URL');
    expect(errorMessage).not.toContain(secret);
  });
});
