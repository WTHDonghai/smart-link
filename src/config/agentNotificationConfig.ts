/**
 * Agent 值守消息通知配置（仅主进程消费，P3 异常诊断与通知工作流读取）。
 *
 * 依据 docs/architecture/llm-agent-integration-design.md 第 8 节，最省事接入路径（运营方 2026-11-02 决策）：
 * - 通知渠道为企业微信群机器人 / 钉钉群机器人 / 飞书群机器人 webhook；
 * - webhook 地址与加签密钥由运维经环境变量手工配置，仅存在于主进程，不进入 Renderer、日志与报错信息；
 * - 群机器人只提供「服务端受理」结果：不承诺幂等、无送达回执，调用方需按 incident 维度自行去重。
 *
 * Fail-Fast：开关开启而必要配置缺失或取值非法时立即抛错并指明键名，禁止静默跳过通知或用占位地址兜底。
 */

import { PROCESS_ENV_KEYS } from '@/src/types/env';
import { type EnvSource, readTrimmedEnv, isEnabledEnvValue } from '@/src/config/agentEnvReader';

export type AgentNotifyWebhookType = 'wecom' | 'dingtalk' | 'feishu';

export const AGENT_NOTIFY_WEBHOOK_TYPES: readonly AgentNotifyWebhookType[] = ['wecom', 'dingtalk', 'feishu'];

export interface AgentNotificationConfig {
  enabled: boolean;
  webhookType: AgentNotifyWebhookType;
  /** 群机器人完整 webhook 地址（必须为 https） */
  webhookUrl: string;
  /** 仅钉钉「加签」安全设置的机器人需要 */
  dingtalkSecret: string;
  timeoutMs: number;
}

export const DEFAULT_AGENT_NOTIFY_TIMEOUT_MS = 10_000;

function parseWebhookType(raw: string): AgentNotifyWebhookType {
  const candidate = raw.toLowerCase() as AgentNotifyWebhookType;
  if (!AGENT_NOTIFY_WEBHOOK_TYPES.includes(candidate)) {
    throw new Error(
      `环境变量 ${PROCESS_ENV_KEYS.agentNotifyWebhookType} 必须为 ${AGENT_NOTIFY_WEBHOOK_TYPES.join(' / ')} 之一，当前值非法: ${raw}`
    );
  }
  return candidate;
}

function parseWebhookUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // webhook 地址携带机器人密钥，报错不回显原值
    throw new Error(`环境变量 ${PROCESS_ENV_KEYS.agentNotifyWebhookUrl} 不是合法 URL，请粘贴群机器人给出的完整 https 地址`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`环境变量 ${PROCESS_ENV_KEYS.agentNotifyWebhookUrl} 必须为 https 地址，当前协议为 ${parsed.protocol}`);
  }
  return raw;
}

function parseTimeoutMs(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`环境变量 ${PROCESS_ENV_KEYS.agentNotifyTimeoutMs} 必须为正整数，当前值非法: ${raw}`);
  }
  return parsed;
}

export function readAgentNotificationConfig(env: EnvSource = process.env): AgentNotificationConfig {
  const enabledRaw = readTrimmedEnv(env, 'agentNotifyEnabled');
  const enabled = isEnabledEnvValue(enabledRaw);

  const typeRaw = readTrimmedEnv(env, 'agentNotifyWebhookType');
  const urlRaw = readTrimmedEnv(env, 'agentNotifyWebhookUrl');
  const secretRaw = readTrimmedEnv(env, 'agentNotifyDingtalkSecret');
  const timeoutRaw = readTrimmedEnv(env, 'agentNotifyTimeoutMs');

  // 已提供的取值必须立即校验（即使功能关闭），让配置错误在启动阶段暴露而非静默沉睡
  const config: AgentNotificationConfig = {
    enabled,
    webhookType: typeRaw ? parseWebhookType(typeRaw) : 'wecom',
    webhookUrl: urlRaw ? parseWebhookUrl(urlRaw) : '',
    dingtalkSecret: secretRaw,
    timeoutMs: timeoutRaw ? parseTimeoutMs(timeoutRaw) : DEFAULT_AGENT_NOTIFY_TIMEOUT_MS,
  };

  if (!enabled) {
    return config;
  }

  const missingKeys: string[] = [];
  if (!typeRaw) missingKeys.push(PROCESS_ENV_KEYS.agentNotifyWebhookType);
  if (!config.webhookUrl) missingKeys.push(PROCESS_ENV_KEYS.agentNotifyWebhookUrl);

  if (missingKeys.length > 0) {
    // 只回显缺失的键名，绝不回显 webhook 地址与加签密钥等敏感值
    throw new Error(
      `Agent 通知已开启但配置缺失: ${missingKeys.join(', ')}。请在环境配置文件中补齐后重启应用。`
    );
  }

  return config;
}
