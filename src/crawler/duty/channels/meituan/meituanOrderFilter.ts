import fs from 'node:fs';
import path from 'node:path';
import type { RawMeituanDutyOrder } from '../../dutyContracts';
import { evaluateCondition, validateExpression } from '@/src/utils/template/evaluator';
import { resolveUserDataDir } from '@/src/crawler/paths';
import defaultRulesJson from './meituanFilterRules.json';


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

export interface ChannelFilterRule {
  id: string;
  name?: string;
  condition: string;
  action: 'MANUAL_ATTENTION' | 'CHANNEL_MISMATCH';
  orderType?: 'RESCHEDULED' | 'TMC';
  reason: string;
  enabled?: boolean;
}

export interface ChannelFilterConfig {
  channelId: string;
  version?: string;
  description?: string;
  rules: ChannelFilterRule[];
}

export function getDefaultMeituanFilterConfigPath(): string {
  return path.join(resolveUserDataDir(), 'filter-rules', 'meituan.json');
}

/**
 * 类型守卫：校验外部 JSON 输入是否符合渠道过滤规则配置契约。
 */
function isChannelFilterConfig(value: unknown): value is ChannelFilterConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { channelId?: unknown; rules?: unknown };
  return typeof candidate.channelId === 'string' && Array.isArray(candidate.rules);
}

/**
 * 加载随包发布的默认规则（经同一类型守卫校验，损坏则 Fail-Fast）。
 */
function loadBundledDefaultConfig(): ChannelFilterConfig {
  if (!isChannelFilterConfig(defaultRulesJson)) {
    throw new Error('随包默认过滤规则文件 meituanFilterRules.json 结构无效 (channelId 或 rules 缺失)');
  }
  return defaultRulesJson;
}

// 默认内存配置缓存（初始化自随包规则文件）
let activeMeituanFilterConfig: ChannelFilterConfig = loadBundledDefaultConfig();

/**
 * 从持久化文件加载美团订单过滤规则配置。
 * 优先级：
 * 1. 显式指定的 customFilePath；
 * 2. 操作系统用户数据目录中的持久化文件 (<userDataDir>/filter-rules/meituan.json)；
 * 3. 随包发布的默认规则文件 (meituanFilterRules.json)，仅当持久化文件不存在时（首启场景）。
 * 持久化文件存在但读取、解析或结构校验失败时立即抛出异常 (Fail-Fast)，绝不静默回退默认规则。
 */
export function loadMeituanFilterConfig(customFilePath?: string): ChannelFilterConfig {
  const filePath = customFilePath || getDefaultMeituanFilterConfigPath();
  if (!fs.existsSync(filePath)) {
    activeMeituanFilterConfig = loadBundledDefaultConfig();
    return activeMeituanFilterConfig;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `美团过滤规则配置文件读取或解析失败: ${filePath} (${err instanceof Error ? err.message : String(err)})，请修正配置文件后重试`
    );
  }

  if (!isChannelFilterConfig(parsed)) {
    throw new Error(
      `美团过滤规则配置文件结构无效: ${filePath} (缺少有效的 rules 数组)，请修正配置文件后重试`
    );
  }

  activeMeituanFilterConfig = parsed;
  return parsed;
}

/**
 * 将美团订单过滤规则持久化保存至文件（前置校验表达式语法）。
 */
export function saveMeituanFilterConfig(
  config: ChannelFilterConfig,
  customFilePath?: string
): void {
  if (!config || !Array.isArray(config.rules)) {
    throw new Error('保存配置必须包含有效的规则列表 (rules)');
  }
  for (const rule of config.rules) {
    if (typeof rule.condition !== 'string' || !rule.condition.trim()) {
      throw new Error(`规则「${rule.id || '未知'}」条件表达式不能为空`);
    }
    validateExpression(rule.condition);
  }
  const filePath = customFilePath || getDefaultMeituanFilterConfigPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  activeMeituanFilterConfig = config;
}

export function getActiveMeituanFilterConfig(): ChannelFilterConfig {
  return activeMeituanFilterConfig;
}

export function setActiveMeituanFilterConfig(config: ChannelFilterConfig): void {
  activeMeituanFilterConfig = config;
}

export function resetMeituanFilterConfig(): void {
  activeMeituanFilterConfig = loadBundledDefaultConfig();
}

/**
 * 提取订单业务核查与拦截归因证据。
 * 直接从已标准化的订单协议 (RawMeituanDutyOrder) 提取关键业务事实字段，绝无底层报文解析或多候选字段猜测。
 */
export function buildOrderFilterEvidence(order: RawMeituanDutyOrder): Record<string, unknown> {
  const evidence: Record<string, unknown> = {};

  const guestName = order.contacts?.[0]?.name;
  if (guestName) evidence.guestName = guestName;
  if (order.roomName) evidence.roomName = order.roomName;
  if (order.orderDisplayLabel) evidence.orderDisplayLabel = order.orderDisplayLabel;
  if (order.status != null) evidence.status = order.status;
  if (order.rescheduledOrderId != null) evidence.rescheduledOrderId = order.rescheduledOrderId;
  if (order.reversePriceTmcOrderTag != null) evidence.reversePriceTmcOrderTag = order.reversePriceTmcOrderTag;

  return evidence;
}

/**
 * 美团订单业务过滤算子。
 * 输入严格为阶段一标准化输出的订单协议实体 (RawMeituanDutyOrder)。
 * 直接使用订单协议字段执行表达式求值，绝无底层报文解析与字段重复校验逻辑。
 */
export function filterMeituanOrder(
  order: RawMeituanDutyOrder,
  options?: { config?: ChannelFilterConfig }
): OrderFilterResult {
  const orderId = order.orderId;
  const config = options?.config ?? getActiveMeituanFilterConfig();
  const context = order as unknown as Record<string, unknown>;

  for (const rule of config.rules) {
    if (rule.enabled === false) continue;

    let matched = false;
    try {
      matched = evaluateCondition(rule.condition, context);
    } catch (err) {
      return {
        allowed: false,
        action: 'MANUAL_ATTENTION',
        orderType: rule.orderType,
        orderId,
        reason: `过滤规则「${rule.id}」求值异常: ${err instanceof Error ? err.message : String(err)}，阻断自动接单并转人工`,
        evidence: buildOrderFilterEvidence(order),
      };
    }

    if (matched) {
      const reason = rule.reason.replace(/\{\{\s*orderId\s*\}\}/g, orderId);
      return {
        allowed: false,
        action: rule.action,
        orderType: rule.orderType,
        orderId,
        reason,
        evidence: buildOrderFilterEvidence(order),
      };
    }
  }

  return {
    allowed: true,
    action: 'ALLOW',
    orderId,
    reason: '符合自动化接单与值守处理标准',
  };
}
