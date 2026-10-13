import fs from 'node:fs';
import path from 'node:path';
import type { RawMeituanDutyOrder } from '../../dutyContracts';
import { evaluateCondition, validateExpression } from '@/src/utils/template/evaluator';
import { resolveUserDataDir } from '@/src/crawler/paths';
import defaultFamilyRulesJson from './meituanFilterRules.json';
import {
  extractFilterRuleChannelConfig,
  isFilterRuleFamilyFile,
  type ChannelFilterConfig,
  type FilterRuleFamilyFile,
  type OrderFilterResult,
} from '../../orderFilterContracts';
import { normalizeOtaChannelCode } from '@/src/config/otaUrls';

// 供既有消费方统一从本模块导入的契约再导出（单一可信定义在 orderFilterContracts）
export type {
  OrderFilterResult,
  RejectedOrderFilterResult,
} from '../../orderFilterContracts';

/**
 * 美团系过滤渠道身份：普通散客 (MEITUAN) 与企业商旅 (MEITUAN_BIZ)
 */
export type MeituanFilterChannelId = 'MEITUAN' | 'MEITUAN_BIZ';

/**
 * 规范化美团系过滤渠道身份：复用全局渠道码归一化 (normalizeOtaChannelCode) 后仅校验美团系自档，
 * 避免在本模块重复维护别名级联；未知渠道 Fail-Fast 拒绝
 */
export function normalizeMeituanFilterChannel(channelId?: string): MeituanFilterChannelId {
  const normalized = normalizeOtaChannelCode(channelId || 'MEITUAN');
  if (normalized === 'MEITUAN' || normalized === 'MEITUAN_BIZ') {
    return normalized;
  }
  throw new Error(`未知的美团系过滤渠道: ${channelId} (仅支持 MEITUAN / MEITUAN_BIZ)`);
}

export function getDefaultMeituanFilterConfigPath(): string {
  return path.join(resolveUserDataDir(), 'filter-rules', 'meituan.json');
}

/**
 * 加载随包发布的默认规则文件（经共享契约守卫校验，损坏则 Fail-Fast）。
 */
function loadBundledDefaultConfig(channel: MeituanFilterChannelId): ChannelFilterConfig {
  if (!isFilterRuleFamilyFile(defaultFamilyRulesJson)) {
    throw new Error('随包默认过滤规则文件 meituanFilterRules.json 结构无效 (channels 或其 rules 缺失)');
  }
  return extractFilterRuleChannelConfig(defaultFamilyRulesJson, channel, '随包默认过滤规则文件');
}

// 按渠道维度维护的内存配置缓存：MEITUAN 与 MEITUAN_BIZ 各自独立，互不覆盖（缓存原始规则，剥离策略在返回时应用）
const activeFilterConfigs = new Map<MeituanFilterChannelId, ChannelFilterConfig>();

// 商旅分流开关：用户配置 MEITUAN_BIZ 渠道映射时开启；
// 未配置时 MEITUAN 不做商旅分流过滤（TMC 订单照常走散客渠道，杜绝无人承接的丢单）
let meituanBizSplitEnabled = false;

export function setMeituanBizSplitEnabled(enabled: boolean): void {
  meituanBizSplitEnabled = Boolean(enabled);
}

/**
 * 商旅分流策略：分流关闭时剥离 MEITUAN 渠道全部 TMC 类规则
 * （无商旅渠道承接时拒 TMC 即丢单，属正确性约束，运营自定义的 TMC 规则同样剥离）；
 * 改签 (RESCHEDULED) 等安全规则与渠道分流无关，保留。
 * MEITUAN_BIZ 渠道不受开关影响（未配置映射时其值守无法启动，配置不生效亦无害）。
 */
function applyMeituanBizSplitPolicy(
  config: ChannelFilterConfig,
  channel: MeituanFilterChannelId
): ChannelFilterConfig {
  if (channel !== 'MEITUAN' || meituanBizSplitEnabled) {
    return config;
  }
  return {
    ...config,
    rules: config.rules.filter((rule) => rule.orderType !== 'TMC'),
  };
}

/**
 * 从持久化文件加载美团系订单过滤规则配置（统一多渠道文件，按渠道提取后缓存）。
 * 优先级：
 * 1. 显式指定的 customFilePath；
 * 2. 操作系统用户数据目录中的持久化文件 (<userDataDir>/filter-rules/meituan.json，含全部渠道节)；
 * 3. 随包发布的默认规则文件，仅当持久化文件不存在时（首启场景）。
 * 持久化文件存在但读取、解析或结构校验失败时立即抛出异常 (Fail-Fast)，绝不静默回退默认规则。
 */
export function loadMeituanFilterConfig(
  channelId?: string,
  customFilePath?: string
): ChannelFilterConfig {
  const channel = normalizeMeituanFilterChannel(channelId);
  const filePath = customFilePath || getDefaultMeituanFilterConfigPath();
  if (!fs.existsSync(filePath)) {
    const bundled = loadBundledDefaultConfig(channel);
    activeFilterConfigs.set(channel, bundled);
    return applyMeituanBizSplitPolicy(bundled, channel);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(
      `美团过滤规则配置文件读取或解析失败: ${filePath} (${err instanceof Error ? err.message : String(err)})，请修正配置文件后重试`
    );
  }

  if (!isFilterRuleFamilyFile(parsed)) {
    throw new Error(
      `美团过滤规则配置文件结构无效: ${filePath} (应为单文件多渠道格式，顶层需包含 channels 映射且各渠道节含 rules 数组)，请修正配置文件后重试`
    );
  }

  const rawConfig = extractFilterRuleChannelConfig(parsed, channel, `美团过滤规则配置文件 ${filePath}`);
  activeFilterConfigs.set(channel, rawConfig);
  return applyMeituanBizSplitPolicy(rawConfig, channel);
}

/**
 * 将指定渠道的过滤规则持久化保存至统一多渠道文件（读-改-写：仅替换对应渠道节，其余渠道节保持不变；前置校验表达式语法）。
 */
export function saveMeituanFilterConfig(
  config: ChannelFilterConfig,
  customFilePath?: string
): void {
  if (!config || !Array.isArray(config.rules)) {
    throw new Error('保存配置必须包含有效的规则列表 (rules)');
  }
  const channel = normalizeMeituanFilterChannel(config.channelId);
  for (const rule of config.rules) {
    if (typeof rule.condition !== 'string' || !rule.condition.trim()) {
      throw new Error(`规则「${rule.id || '未知'}」条件表达式不能为空`);
    }
    validateExpression(rule.condition);
  }

  const filePath = customFilePath || getDefaultMeituanFilterConfigPath();

  // 读-改-写：已存在合法的统一文件时仅替换目标渠道节，其余渠道节原样保留
  let family: FilterRuleFamilyFile;
  if (fs.existsSync(filePath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      throw new Error(
        `美团过滤规则配置文件读取或解析失败: ${filePath} (${err instanceof Error ? err.message : String(err)})，请修正配置文件后重试`
      );
    }
    if (!isFilterRuleFamilyFile(parsed)) {
      throw new Error(
        `美团过滤规则配置文件结构无效: ${filePath} (应为单文件多渠道格式)，请修正配置文件后重试`
      );
    }
    family = parsed;
  } else if (isFilterRuleFamilyFile(defaultFamilyRulesJson)) {
    family = defaultFamilyRulesJson;
  } else {
    throw new Error('随包默认过滤规则文件 meituanFilterRules.json 结构无效 (channels 或其 rules 缺失)');
  }

  const nextFamily: FilterRuleFamilyFile = {
    ...family,
    channels: {
      ...family.channels,
      [channel]: { rules: config.rules },
    },
  };

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(nextFamily, null, 2), 'utf8');
  activeFilterConfigs.set(channel, config);
}

export function getActiveMeituanFilterConfig(channelId?: string): ChannelFilterConfig {
  const channel = normalizeMeituanFilterChannel(channelId);
  const existing = activeFilterConfigs.get(channel);
  if (existing) return applyMeituanBizSplitPolicy(existing, channel);
  const bundled = loadBundledDefaultConfig(channel);
  activeFilterConfigs.set(channel, bundled);
  return applyMeituanBizSplitPolicy(bundled, channel);
}

export function setActiveMeituanFilterConfig(config: ChannelFilterConfig): void {
  const channel = normalizeMeituanFilterChannel(config.channelId);
  activeFilterConfigs.set(channel, config);
}

export function resetMeituanFilterConfig(channelId?: string): void {
  const channel = normalizeMeituanFilterChannel(channelId);
  activeFilterConfigs.set(channel, loadBundledDefaultConfig(channel));
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
 * 美团系订单业务过滤算子（按渠道维度选用过滤配置）。
 * 输入严格为阶段一标准化输出的订单协议实体 (RawMeituanDutyOrder)。
 * 直接使用订单协议字段执行表达式求值，绝无底层报文解析与字段重复校验逻辑。
 */
export function filterMeituanOrder(
  order: RawMeituanDutyOrder,
  options?: { config?: ChannelFilterConfig; channelId?: string }
): OrderFilterResult {
  const orderId = order.orderId;
  const config =
    options?.config ?? getActiveMeituanFilterConfig(options?.channelId);
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
