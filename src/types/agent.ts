/**
 * Agent 执行追踪领域契约（P1 追踪基础）。
 *
 * 依据 docs/architecture/llm-agent-integration-design.md 第 9 节：
 * Agent 事件作为 SystemLogEntry.meta.agent 的强类型内容承载，event 使用 AGENT_* 前缀，
 * 不把 payload 重复拷贝到多个日志字段。唯一持久化源仍是渲染进程 SmartLink_LogDB，
 * 经由 logPersistenceMiddleware 落库，禁止任何旁路写库。
 *
 * 本文件只承载 P1 阶段实际存在的变化：事件信封契约、运行时校验与持久化确认回执。
 * 按 kind 细分的 payload 联合类型随各自生产方（P2 产品映射 / P3 异常处置）落地，不提前抽象。
 */

import type { SystemLogEntry } from './index';
import { isRecord } from '@/src/utils/typeGuards';

export const AGENT_TRACE_SCHEMA_VERSION = 1;

export type AgentTraceEventKind =
  | 'run'
  | 'snapshot'
  | 'model'
  | 'decision'
  | 'tool'
  | 'validation'
  | 'draft'
  | 'save'
  | 'notification';
export type AgentTraceEventPhase = 'started' | 'completed' | 'failed' | 'cancelled';

const AGENT_TRACE_EVENT_KINDS: readonly AgentTraceEventKind[] = [
  'run',
  'snapshot',
  'model',
  'decision',
  'tool',
  'validation',
  'draft',
  'save',
  'notification',
];

const AGENT_TRACE_EVENT_PHASES: readonly AgentTraceEventPhase[] = [
  'started',
  'completed',
  'failed',
  'cancelled',
];

/**
 * Agent 追踪事件信封。嵌入 SystemLogEntry.meta.agent 时必须通过 isAgentTraceEventMeta 校验，
 * IndexedDB 的 agentTraceId / agentRunSeq 索引依赖 meta.agent.traceId 与 meta.agent.sequence 字段。
 */
export interface AgentTraceEventMeta {
  schemaVersion: typeof AGENT_TRACE_SCHEMA_VERSION;
  /** 一次完整业务链路（一次产品采集到映射，或一项搬单任务及其异常处置） */
  traceId: string;
  /** 一次具体 Agent 尝试；显式重跑生成新 runId 并关联前次尝试 */
  runId: string;
  /** 输入快照、每轮模型、每次工具、校验、通知、草稿填入等步骤标识 */
  spanId: string;
  parentSpanId?: string;
  /** 同一 run 内由唯一发射端分配的单调递增事件序号（从 1 开始） */
  sequence: number;
  kind: AgentTraceEventKind;
  phase: AgentTraceEventPhase;
  /** ISO 8601 时间戳 */
  occurredAt: string;
  outcomeCode?: string;
  summary: string;
  /** 扩展位置；具体字段由各 kind 生产方定义并由业务代码校验 */
  payload?: Record<string, unknown>;
  /**
   * 为 true 时，渲染进程必须在该条目 IndexedDB 事务提交完成后，
   * 经 host:log-persisted 向主进程回传确认；主进程收到确认前不得执行后续受限动作。
   */
  requiresCommitAck?: boolean;
}

/** 渲染进程 -> 主进程的日志持久化确认回执 */
export interface AgentLogPersistedAck {
  entryId: string;
  runId: string;
  sequence: number;
  status: 'committed' | 'persist-failed';
  error?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isAgentTraceEventMeta(value: unknown): value is AgentTraceEventMeta {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== AGENT_TRACE_SCHEMA_VERSION) return false;
  if (
    !isNonEmptyString(value.traceId) ||
    !isNonEmptyString(value.runId) ||
    !isNonEmptyString(value.spanId)
  ) {
    return false;
  }
  if (value.parentSpanId !== undefined && !isNonEmptyString(value.parentSpanId)) return false;
  if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 1) {
    return false;
  }
  if (!AGENT_TRACE_EVENT_KINDS.includes(value.kind as AgentTraceEventKind)) return false;
  if (!AGENT_TRACE_EVENT_PHASES.includes(value.phase as AgentTraceEventPhase)) return false;
  if (typeof value.occurredAt !== 'string' || Number.isNaN(Date.parse(value.occurredAt))) return false;
  if (value.outcomeCode !== undefined && !isNonEmptyString(value.outcomeCode)) return false;
  if (!isNonEmptyString(value.summary)) return false;
  if (value.payload !== undefined && !isRecord(value.payload)) return false;
  if (value.requiresCommitAck !== undefined && typeof value.requiresCommitAck !== 'boolean') {
    return false;
  }
  return true;
}

export function isAgentLogPersistedAck(value: unknown): value is AgentLogPersistedAck {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.entryId) || !isNonEmptyString(value.runId)) return false;
  if (typeof value.sequence !== 'number' || !Number.isInteger(value.sequence) || value.sequence < 1) {
    return false;
  }
  if (value.status !== 'committed' && value.status !== 'persist-failed') return false;
  if (value.error !== undefined && typeof value.error !== 'string') return false;
  return true;
}

/**
 * 从日志条目中读取经过运行时校验的 Agent 追踪事件信封。
 * 返回 null 表示该条目不是 Agent 追踪事件（无 meta.agent 或信封不符合契约）。
 * 信封非法时同样返回 null：不在中间件内抛错阻断日志主链路，
 * 由主进程侧的确认超时机制将「等待确认的事件」收敛为追踪不完整并暂停后续动作。
 */
export function readAgentTraceMeta(entry: SystemLogEntry): AgentTraceEventMeta | null {
  const candidate: unknown = entry.meta?.agent;
  return isAgentTraceEventMeta(candidate) ? candidate : null;
}

// ────────────────────────────────────────────────────────────────────────────
// P2：产品采集自动映射契约（设计第 6 节）
// ────────────────────────────────────────────────────────────────────────────

export type MatchGrade = 'high' | 'medium' | 'low' | 'undetermined';

/** 单个映射字段的最终结果；grade 由代码评级规则约束，不是模型自评分 */
export interface FieldMatch {
  selectedCode: string | null;
  grade: MatchGrade;
  reason: string;
  /** 与选定候选同名的其他候选编码，提示需核对 */
  alternatives: string[];
}

export type ProductMappingOutcome = 'matched' | 'partial' | 'unmatched' | 'conflict';

export interface ProductAutoMapping {
  /** P0-① 决策的复合键：otaRoomTypeId + \u001f + otaBasicRoomId（作用域内） */
  productKey: string;
  snapshotId: string;
  roomType: FieldMatch;
  rateCode: FieldMatch;
  reservationType: FieldMatch;
  outcome: ProductMappingOutcome;
  /** 整条等级不得高于最弱字段（设计 6.6） */
  overallGrade: MatchGrade;
}

/** 本次映射的作用域（设计 6.2）：租户/酒店/渠道/外部门店 */
export interface ProductMappingScope {
  channelCode: string;
  extUnitCode: string;
  unitId: string;
  unitType: string;
  hotelName: string;
}

/** 快照中的待映射产品行（仅包含存在缺失映射字段的产品，由渲染层构建时过滤） */
export interface SnapshotProduct {
  productKey: string;
  otaRoomTypeId: string;
  otaRoomTypeName: string;
  otaBasicRoomId: string;
  otaBasicRoomName: string;
  otaRateCodeId: string;
  otaPayType: string;
}

export interface CandidateOption {
  code: string;
  name: string;
}

/** 已完成映射的参考示例上限（作为模型只读上下文，2026-11-09 运营决策，设计 6.4） */
export const MAX_MAPPING_REFERENCE_EXAMPLES = 10;

/**
 * 已完成映射的参考示例（只读上下文）：展示该酒店既往映射习惯供模型对齐，
 * 不参与复合键、不进入结果回填，不改变「只填空白、不覆盖已保存映射」的约束。
 */
export interface MappingReferenceExample {
  productName: string;
  physicalRoomName: string;
  otaRateCodeId: string;
  otaPayType: string;
  /** 已保存的 PMS 房型编码 */
  roomType: string;
  /** 已保存的 PMS 房价码编码 */
  rateCode: string;
  /** 已保存的 PMS 预订类型编码 */
  payType: string;
}

/** 渲染层采集完成后构建的不可变输入快照（设计 6.1 步骤 5），经 IPC 交主进程校验后使用 */
export interface ProductMappingSnapshot {
  snapshotId: string;
  collectionRunId: string;
  capturedAt: string;
  scope: ProductMappingScope;
  products: SnapshotProduct[];
  /** 已完成映射的参考示例（最多 MAX_MAPPING_REFERENCE_EXAMPLES 条，可缺省） */
  referenceMappings?: MappingReferenceExample[];
  roomTypes: CandidateOption[];
  rateCodes: CandidateOption[];
  /** 预订类型选项；name 承载后端 label */
  reservationTypes: CandidateOption[];
}

/** 渲染层 -> 主进程：映射进度事件（实时提示，不是第二历史源） */
export interface ProductMappingProgressEvent {
  runId: string;
  phase:
    | 'snapshot-validated'
    | 'batch-started'
    | 'batch-completed'
    | 'batch-failed'
    | 'completed'
    | 'failed'
    | 'cancelled';
  processedProducts: number;
  totalProducts: number;
  error?: string;
  /** phase=completed 时携带完整结果 */
  result?: ProductMappingRunResult;
}

export interface ProductMappingRunResult {
  runId: string;
  snapshotId: string;
  collectionRunId: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  /** 已处理产品的映射结果（含 partial / unmatched / conflict，等级由代码评级） */
  mappings: ProductAutoMapping[];
  /** 模型批次失败或校验失败的产品及其原因（不得被已完成批次掩盖，设计 6.8） */
  failedProducts: { productKey: string; reason: string }[];
  counts: {
    total: number;
    mapped: number;
    partial: number;
    unmatched: number;
    conflict: number;
    failed: number;
  };
  /** run 级失败原因（如快照校验失败、关键追踪确认失败、预算耗尽） */
  failureReason?: string;
  /** 供应商未返回用量时为 null，不填 0（设计 9.3） */
  usage: { promptTokens: number | null; completionTokens: number | null };
}

/** 主进程能力开关状态（仅布尔，不携带任何密钥） */
export interface AgentCapabilities {
  productMappingEnabled: boolean;
  exceptionRecoveryEnabled: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// P3：异常诊断与通知契约（设计第 7、8 节）
// ────────────────────────────────────────────────────────────────────────────

/** 页面上观察到的单个对话框/浮层现场（只读观察，不含任何动作） */
export interface DutyPageDialogObservation {
  frameUrl: string;
  /** 观察到的语义线索（元素角色/类名），非权限成义 */
  role: string;
  title: string;
  bodyText: string;
  buttons: string[];
}

/** 一次只读页面观察的完整现场快照 */
export interface DutyPageObservation {
  observedAt: string;
  pageUrl: string;
  /** 顶层页面可见文本摘录（脱敏与截断后），供诊断参考 */
  visibleTextExcerpt: string;
  dialogs: DutyPageDialogObservation[];
  /** 观察限制说明（如跨域 frame 不可访问），如实记录不掩盖 */
  note?: string;
}

/** 值守任务失败时外部副作用（中台入单/渠道页面提交）的确定性状态（设计 7.1 sideEffectState） */
export type IncidentSideEffectState = 'not_started' | 'confirmed' | 'unknown';

/** 值守任务失败后捕获的异常事件（设计 7.1） */
export interface ExceptionIncident {
  /** 处理记录编号，形如 AG-20261103-a1b2c3 */
  incidentId: string;
  taskId: string;
  channelCode: string;
  orderNo: string | null;
  /** 酒店标识（中台 unitId，无酒店名时用真实标识，不伪造名称） */
  hotelScope: string;
  msgType: string;
  /** 失败发生的编排阶段标识（如 inspect-order-detail / submit-import，设计 7.1 phase） */
  failurePhase: string;
  errorCode: string;
  /** 已脱敏的原始错误信息（发送模型与通知前统一清除敏感信息，设计 7.1） */
  errorMessage: string;
  retryable: boolean | null;
  /** 失败时的外部副作用状态：未知时必须先权威核对（设计 7.1） */
  sideEffectState: IncidentSideEffectState;
  occurredAt: string;
  observation: DutyPageObservation | null;
}

export type ExceptionCategory =
  | 'login_required'
  | 'risk_verification'
  | 'page_blocked'
  | 'protocol_parse_error'
  | 'pms_rejection'
  | 'network_timeout'
  | 'business_field_missing'
  | 'unknown';

/** 诊断结论：模型分析或确定性模板兑底（analysisUnavailable 区分，不伪装） */
export interface DiagnosisConclusion {
  incidentId: string;
  category: ExceptionCategory;
  severity: 'high' | 'medium' | 'low';
  confidence: 'high' | 'medium' | 'low';
  /** 可读分析（已观察事实与判断分别表达） */
  summary: string;
  /** 人工需要执行的下一步 */
  manualAction: string;
  analysisUnavailable: boolean;
  observedFacts: string[];
}

export type DiagnosisRunOutcome =
  | 'notified'
  | 'notify_failed'
  | 'suppressed_duplicate'
  | 'skipped';

export interface DiagnosisRunResult {
  incidentId: string;
  outcome: DiagnosisRunOutcome;
  conclusion: DiagnosisConclusion | null;
  /** 通知发送结果详情（accepted/failed/unknown 语义见 notificationApi） */
  notifyDetail: string | null;
  skipReason?: string;
  failureReason?: string;
}

export const EXCEPTION_CATEGORIES: readonly ExceptionCategory[] = [
  'login_required',
  'risk_verification',
  'page_blocked',
  'protocol_parse_error',
  'pms_rejection',
  'network_timeout',
  'business_field_missing',
  'unknown',
];

export const PRODUCT_KEY_SEPARATOR = '\u001f';

/** 按P0-① 决策构建复合产品键 */
export function buildProductKey(otaRoomTypeId: string, otaBasicRoomId: string): string {
  return `${otaRoomTypeId.trim()}${PRODUCT_KEY_SEPARATOR}${(otaBasicRoomId || '').trim()}`;
}

function isCandidateOptionList(value: unknown): value is CandidateOption[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        isRecord(item) && isNonEmptyString(item.code) && typeof item.name === 'string'
    )
  );
}

function isMappingReferenceExample(value: unknown): value is MappingReferenceExample {
  if (!isRecord(value)) return false;
  for (const field of ['productName', 'physicalRoomName', 'otaRateCodeId', 'otaPayType'] as const) {
    if (typeof value[field] !== 'string') return false;
  }
  // 三项 PMS 编码必须非空：参考示例必须是完整映射
  for (const field of ['roomType', 'rateCode', 'payType'] as const) {
    if (typeof value[field] !== 'string' || !(value[field] as string).trim()) return false;
  }
  return true;
}

/**
 * IPC 入口对映射快照的结构化运行时校验：
 * 主进程不接受 Renderer 任意拼装的候选与产品范围，结构、复合键一致性与三类候选非空全部通过才放行。
 */
export function isProductMappingSnapshot(value: unknown): value is ProductMappingSnapshot {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.snapshotId) || !isNonEmptyString(value.collectionRunId)) return false;
  if (typeof value.capturedAt !== 'string' || Number.isNaN(Date.parse(value.capturedAt))) return false;

  const scope = value.scope;
  if (
    !isRecord(scope) ||
    !isNonEmptyString(scope.channelCode) ||
    !isNonEmptyString(scope.extUnitCode) ||
    !isNonEmptyString(scope.unitId) ||
    !isNonEmptyString(scope.unitType) ||
    !isNonEmptyString(scope.hotelName)
  ) {
    return false;
  }

  if (!isCandidateOptionList(value.roomTypes)) return false;
  if (!isCandidateOptionList(value.rateCodes)) return false;
  if (!isCandidateOptionList(value.reservationTypes)) return false;

  if (!Array.isArray(value.products) || value.products.length === 0) return false;
  const seenKeys = new Set<string>();
  for (const product of value.products) {
    if (!isRecord(product)) return false;
    if (!isNonEmptyString(product.otaRoomTypeId)) return false;
    if (typeof product.otaRoomTypeName !== 'string' || !product.otaRoomTypeName.trim()) return false;
    if (typeof product.otaBasicRoomId !== 'string') return false;
    if (typeof product.otaBasicRoomName !== 'string') return false;
    if (typeof product.otaRateCodeId !== 'string') return false;
    if (typeof product.otaPayType !== 'string') return false;
    if (!isNonEmptyString(product.productKey)) return false;
    // 复合键必须与原始 ID 字段一致，防止键值错位串行
    if (product.productKey !== buildProductKey(product.otaRoomTypeId, product.otaBasicRoomId)) {
      return false;
    }
    if (seenKeys.has(product.productKey)) return false;
    seenKeys.add(product.productKey);
  }

  // 参考示例（可选）：结构合法且数量不得超过上限
  if (value.referenceMappings !== undefined) {
    if (
      !Array.isArray(value.referenceMappings) ||
      value.referenceMappings.length > MAX_MAPPING_REFERENCE_EXAMPLES ||
      !value.referenceMappings.every((item) => isMappingReferenceExample(item))
    ) {
      return false;
    }
  }

  return true;
}
