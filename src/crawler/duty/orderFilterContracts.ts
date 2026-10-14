/**
 * 渠道订单过滤规则通用契约 (Channel-Agnostic Filter Rule Contracts)
 * 单文件多渠道过滤规则文件格式、规则条目结构与过滤结果类型的唯一可信定义，
 * 供各渠道 (美团/美团商旅/抖音等) 的过滤模块共享，严禁在各渠道模块内重复定义同名契约。
 */

/**
 * 单条业务过滤规则（基于表达式求值引擎 evaluateCondition）
 */
export interface ChannelFilterRule {
  id: string;
  name?: string;
  condition: string;
  action: 'MANUAL_ATTENTION' | 'CHANNEL_MISMATCH';
  orderType?: 'RESCHEDULED' | 'TMC';
  reason: string;
  enabled?: boolean;
}

/**
 * 单渠道过滤配置（从统一多渠道文件按渠道节提取的运行时形态）
 */
export interface ChannelFilterConfig {
  channelId: string;
  version?: string;
  description?: string;
  rules: ChannelFilterRule[];
}

/**
 * 统一多渠道过滤规则文件契约（单文件承载全部渠道，channels 键为规范化渠道码）
 */
export interface FilterRuleFamilyFile {
  version?: string;
  description?: string;
  channels: Record<string, { rules: ChannelFilterRule[] }>;
}

export type AllowedOrderFilterResult = {
  allowed: true;
  action: 'ALLOW';
  orderId: string;
  reason?: string;
};

export type RejectedOrderFilterResult = {
  allowed: false;
  action: 'MANUAL_ATTENTION' | 'CHANNEL_MISMATCH';
  orderType?: 'RESCHEDULED' | 'TMC';
  orderId: string;
  reason: string;
  evidence?: Record<string, unknown>;
};

export type OrderFilterResult = AllowedOrderFilterResult | RejectedOrderFilterResult;

/**
 * 类型守卫：校验外部 JSON 输入是否符合统一多渠道过滤规则文件契约。
 */
export function isFilterRuleFamilyFile(value: unknown): value is FilterRuleFamilyFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { channels?: unknown };
  if (typeof candidate.channels !== 'object' || candidate.channels === null) return false;
  for (const section of Object.values(candidate.channels as Record<string, unknown>)) {
    if (typeof section !== 'object' || section === null || !Array.isArray((section as { rules?: unknown }).rules)) {
      return false;
    }
  }
  return true;
}

/**
 * 从统一多渠道规则文件中提取指定渠道的过滤配置
 * (Fail-Fast：渠道节缺失立即报错，绝不静默回退其他渠道)
 */
export function extractFilterRuleChannelConfig(
  family: FilterRuleFamilyFile,
  channelId: string,
  sourceDesc: string
): ChannelFilterConfig {
  const section = family.channels[channelId];
  if (!section || !Array.isArray(section.rules)) {
    throw new Error(`${sourceDesc} 缺失渠道「${channelId}」的规则节 (channels.${channelId}.rules)，请补齐后重试`);
  }
  return {
    channelId,
    version: family.version,
    description: family.description,
    rules: section.rules,
  };
}
