/**
 * Agent 模型运行配置（仅主进程消费，P2 产品映射 / P3 异常诊断的模型客户端读取）。
 *
 * 依据 docs/architecture/llm-agent-integration-design.md 第 4.5 节：
 * - provider、模型、超时、并发、功能开关由运维经环境变量静默下发；客户主界面不提供网关 URL、Token 或调试参数；
 * - 密钥只存在于主进程环境变量，不进入安装包默认值、不进入 Renderer（APP_ENV_KEYS 快照）、不写入日志与报错信息。
 *
 * Fail-Fast：功能开关开启而必要配置缺失时立即抛错并逐项列明缺失键名，禁止用默认密钥或占位值兜底推进。
 */

import { PROCESS_ENV_KEYS, type ProcessEnvKeyName } from '@/src/types/env';
import { type EnvSource, readTrimmedEnv, isEnabledEnvValue } from '@/src/config/agentEnvReader';

export interface AgentModelConfig {
  /** 模型供应商标识（openai / deepseek / qwen / anthropic / 自定义 OpenAI 兼容网关等） */
  provider: string;
  /** 模型服务 Base URL（企业网关或供应商直连） */
  baseUrl: string;
  /** 供应商密钥；严禁写入日志、报错或 Renderer */
  apiKey: string;
  /** 产品映射任务使用的模型版本 */
  mappingModel: string;
  /** 异常诊断任务使用的模型版本（如启用截图观察需支持图片输入） */
  diagnosisModel: string;
  timeoutMs: number;
  maxConcurrency: number;
  productMappingEnabled: boolean;
  exceptionRecoveryEnabled: boolean;
}

export const DEFAULT_AGENT_MODEL_TIMEOUT_MS = 30_000;
export const DEFAULT_AGENT_MODEL_MAX_CONCURRENCY = 2;

/** 仅读取功能开关布尔态（不校验模型配置）：供能力查询 IPC 使用，开关已开但配置缺失时由启动接口 Fail-Fast 报错 */
export function readAgentFeatureSwitches(env: EnvSource = process.env): {
  productMappingEnabled: boolean;
  exceptionRecoveryEnabled: boolean;
} {
  return {
    productMappingEnabled: isEnabledEnvValue(readTrimmedEnv(env, 'agentProductMappingEnabled')),
    exceptionRecoveryEnabled: isEnabledEnvValue(readTrimmedEnv(env, 'agentExceptionRecoveryEnabled')),
  };
}

function readPositiveInt(env: EnvSource, keyName: ProcessEnvKeyName, fallback: number): number {
  const raw = readTrimmedEnv(env, keyName);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`环境变量 ${PROCESS_ENV_KEYS[keyName]} 必须为正整数，当前值非法: ${raw}`);
  }
  return parsed;
}

export function readAgentModelConfig(env: EnvSource = process.env): AgentModelConfig {
  const productMappingEnabled = isEnabledEnvValue(readTrimmedEnv(env, 'agentProductMappingEnabled'));
  const exceptionRecoveryEnabled = isEnabledEnvValue(readTrimmedEnv(env, 'agentExceptionRecoveryEnabled'));

  const config: AgentModelConfig = {
    provider: readTrimmedEnv(env, 'agentModelProvider'),
    baseUrl: readTrimmedEnv(env, 'agentModelBaseUrl'),
    apiKey: readTrimmedEnv(env, 'agentModelApiKey'),
    mappingModel: readTrimmedEnv(env, 'agentMappingModel'),
    diagnosisModel: readTrimmedEnv(env, 'agentDiagnosisModel'),
    timeoutMs: readPositiveInt(env, 'agentModelTimeoutMs', DEFAULT_AGENT_MODEL_TIMEOUT_MS),
    maxConcurrency: readPositiveInt(env, 'agentModelMaxConcurrency', DEFAULT_AGENT_MODEL_MAX_CONCURRENCY),
    productMappingEnabled,
    exceptionRecoveryEnabled,
  };

  // 两项功能开关均关闭时，Agent 不发起任何模型请求，配置不强制
  if (!productMappingEnabled && !exceptionRecoveryEnabled) {
    return config;
  }

  const missingKeys: string[] = [];
  if (!config.provider) missingKeys.push(PROCESS_ENV_KEYS.agentModelProvider);
  if (!config.baseUrl) missingKeys.push(PROCESS_ENV_KEYS.agentModelBaseUrl);
  if (!config.apiKey) missingKeys.push(PROCESS_ENV_KEYS.agentModelApiKey);
  if (productMappingEnabled && !config.mappingModel) missingKeys.push(PROCESS_ENV_KEYS.agentMappingModel);
  if (exceptionRecoveryEnabled && !config.diagnosisModel) {
    missingKeys.push(PROCESS_ENV_KEYS.agentDiagnosisModel);
  }

  if (missingKeys.length > 0) {
    // 只回显缺失的键名，绝不回显 apiKey 等敏感值
    throw new Error(
      `Agent 功能已开启但模型配置缺失: ${missingKeys.join(', ')}。请在环境配置文件中补齐后重启应用。`
    );
  }

  return config;
}
