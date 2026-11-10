/**
 * Agent 配置环境变量读取公共件（agentModelConfig / agentNotificationConfig 共用）。
 *
 * 约束：值仅来源于主进程环境变量；报错只回显键名，绝不回显密钥、地址等敏感值。
 */

import { PROCESS_ENV_KEYS, type ProcessEnvKeyName } from '@/src/types/env';

export type EnvSource = Record<string, string | undefined>;

/** 布尔开关的统一真值集合（1/true/yes/on，大小写不敏感） */
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function readTrimmedEnv(env: EnvSource, keyName: ProcessEnvKeyName): string {
  return (env[PROCESS_ENV_KEYS[keyName]] ?? '').trim();
}

export function isEnabledEnvValue(raw: string): boolean {
  return ENABLED_VALUES.has(raw.toLowerCase());
}
