/**
 * Agent 模型运行配置（仅主进程消费，P2 产品映射 / P3 异常诊断的模型客户端读取）。
 *
 * 依据 docs/architecture/llm-agent-integration-design.md 第 4.5 节与
 * 《Agent 获取 AI 配置接口说明》：
 * - 租户 AI 配置（baseUrl、apiKey、model、timeoutSeconds、enabled）由平台接口加密下发，
 *   见 src/config/remoteAgentModelConfig.ts 与 src/services/agentAiConfigApi.ts；
 * - apiKey 只来自远端租户配置，绝不回落到本机环境变量，也绝不进入 Renderer、日志或报错；
 * - 环境变量仅保留功能开关、并发度与模型名缺省值（决策：仅模型名允许 env 兜底）。
 *
 * Fail-Fast：功能开关开启而远端配置的必要字段缺失时立即抛错并逐项列明缺失项，禁止用占位值兜底推进。
 */

import { PROCESS_ENV_KEYS } from '@/src/types/env';
import { type EnvSource, readTrimmedEnv, isEnabledEnvValue } from '@/src/config/agentEnvReader';
import {
  readRemoteConfigExtraString,
  type CachedRemoteAgentAiConfig,
} from '@/src/config/remoteAgentModelConfig';

export interface AgentModelConfig {
  /** 模型服务 Base URL（企业网关或供应商直连） */
  baseUrl: string;
  /** 租户密钥；严禁写入日志、报错或 Renderer */
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

function readPositiveInt(
  env: EnvSource,
  keyName: keyof typeof PROCESS_ENV_KEYS,
  fallback: number
): number {
  const raw = readTrimmedEnv(env, keyName);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`环境变量 ${PROCESS_ENV_KEYS[keyName]} 必须为正整数，当前值非法: ${raw}`);
  }
  return parsed;
}

/**
 * 合并远端租户配置与本地非敏感缺省值，得到两个 Agent 任务实际使用的运行配置。
 *
 * 合并优先级：
 * - 功能开关：本地开关 AND 远端 enabled（远端关闭时 Agent 不得调用 AI）；
 * - baseUrl / apiKey / timeout：严格取远端（载荷解析已保证 baseUrl 非空、timeout 缺省 30）；
 * - mappingModel / diagnosisModel：extras 覆盖 > 远端 model > 环境变量缺省值。
 */
export function resolveAgentModelConfig(
  remote: CachedRemoteAgentAiConfig,
  env: EnvSource = process.env
): AgentModelConfig {
  const localSwitches = readAgentFeatureSwitches(env);
  const aiEnabled = remote.payload.enabled;

  const config: AgentModelConfig = {
    baseUrl: remote.payload.baseUrl,
    apiKey: remote.payload.apiKey,
    mappingModel:
      readRemoteConfigExtraString(remote.payload, 'mappingModel') ||
      remote.payload.model ||
      readTrimmedEnv(env, 'agentMappingModel'),
    diagnosisModel:
      readRemoteConfigExtraString(remote.payload, 'diagnosisModel') ||
      remote.payload.model ||
      readTrimmedEnv(env, 'agentDiagnosisModel'),
    timeoutMs: remote.payload.timeoutSeconds * 1000,
    maxConcurrency: readPositiveInt(
      env,
      'agentModelMaxConcurrency',
      DEFAULT_AGENT_MODEL_MAX_CONCURRENCY
    ),
    productMappingEnabled: localSwitches.productMappingEnabled && aiEnabled,
    exceptionRecoveryEnabled: localSwitches.exceptionRecoveryEnabled && aiEnabled,
  };

  // 两项功能开关均关闭（或远端禁用 AI）时，Agent 不发起任何模型请求，配置不强制
  if (!config.productMappingEnabled && !config.exceptionRecoveryEnabled) {
    return config;
  }

  const missingItems: string[] = [];
  if (!config.baseUrl) missingItems.push('baseUrl');
  if (!config.apiKey) missingItems.push('apiKey（租户 AI 配置）');
  if (config.productMappingEnabled && !config.mappingModel) missingItems.push('mappingModel');
  if (config.exceptionRecoveryEnabled && !config.diagnosisModel) missingItems.push('diagnosisModel');

  if (missingItems.length > 0) {
    // 只回显缺失项名称，绝不回显 apiKey 等敏感值
    throw new Error(
      `Agent 功能已开启但 AI 配置缺失: ${missingItems.join(', ')}。请检查租户 AI 配置下发结果后重试。`
    );
  }

  return config;
}