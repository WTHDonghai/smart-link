/**
 * 异常诊断工作流（仅主进程，设计第 7/8 节 P3 范围）。
 *
 * 编排：事件资格过滤 -> 只读页面观察（在引擎缝隙同步采集，页面现场仍完好）
 * -> 去重判定 -> 单次结构化模型诊断 -> 契约校验 -> 可读结论 -> 群机器人通知。
 *
 * 刚性约束：
 * - 只诊断、只通知，不执行任何页面动作（自动关闭属 P4）；
 * - 模型不可用或输出不符合契约时，退回确定性错误码模板并标记 analysisUnavailable，
 *   通知照发（设计 8.2 异常告警路径，不把模板分析伪装为模型结论）；
 * - 通知按「渠道+订单+错误码+时间窗口」聚合去重（设计 8.2）；
 * - 关键追踪事件先落库确认再继续（复用 P1 提交确认闸门）；
 * - 任务回执仍由引擎按原 SUCCESS/FAIL 契约提交，诊断结论不扩展后端枚举（设计 12）。
 */

import type {
  DiagnosisConclusion,
  DiagnosisRunResult,
  DutyPageObservation,
  ExceptionCategory,
  ExceptionIncident,
  IncidentSideEffectState,
} from '@/src/types/agent';
import { EXCEPTION_CATEGORIES } from '@/src/types/agent';
import {
  callChatCompletion,
  type AgentModelEndpoint,
  type ModelCallInput,
  type ModelCallResult,
} from './agentModelClient';
import { AgentTraceEmitter } from './agentTraceEmitter';
import {
  buildExceptionDiagnosisMessages,
  EXCEPTION_DIAGNOSIS_PROMPT_VERSION,
} from './prompts/exceptionDiagnosisInstructions';
import type { NotificationDeduplicator } from './notificationDeduplicator';
import {
  buildIncidentNotificationText,
  sendAgentNotificationText,
  type NotificationSendResult,
} from '@/src/services/notificationApi';
import type { AgentNotificationConfig } from '@/src/config/agentNotificationConfig';
import { resolveChannelMeta } from '@/src/utils/channelMeta';
import { maskSensitiveText } from '@/src/utils/agent/sensitiveTextMask';
import { randomIdSuffix } from '@/src/utils/randomIdSuffix';
import { describeErrorMessage } from '@/src/utils/errorCauses';

/** 引擎侧事件捕获缝隙（dutyOrchestrationEngine 构造，见 DutyIncidentCapture） */
export interface IncidentCaptureInput {
  taskId: string;
  channelCode: string;
  orderNo: string | null;
  hotelScope: string;
  msgType: string;
  /** 失败发生的编排阶段标识（设计 7.1 phase，由任务调度器标注） */
  failurePhase: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean | null;
  /** 失败时外部副作用状态（设计 7.1 sideEffectState） */
  sideEffectState: IncidentSideEffectState;
  /** 在引擎缝隙内同步采集页面现场；观察失败返回 null（如实记录证据缺失） */
  observePage(): Promise<DutyPageObservation | null>;
}

/** 纯配置/契约类失败不构成需要人工介入的异常事件（设计 7.1 失败类型表） */ 
const NON_INCIDENTAL_ERROR_CODES = new Set([
  'TASK_PAYLOAD_INVALID',
  'MISSING_ORDER_ID',
  'ORDER_ID_MISSING',
  'CONFIRM_NO_MISSING',
  'UNSUPPORTED_TASK_TYPE',
  'METHOD_NOT_IMPLEMENTED',
  'CONFIRM_IMPORT_DISABLED',
  'RUNNER_NOT_RUNNING',
  'DOWNSTREAM_CREATION_FAILED',
]);

/** 错误码 -> 确定性模板（模型不可用时的可读兑底，analysisUnavailable=true） */ 
const DETERMINISTIC_TEMPLATES: Record<string, { category: ExceptionCategory; summary: string; manualAction: string }> = {
  RISK_VERIFICATION_REQUIRED: {
    category: 'risk_verification',
    summary: '页面出现风控或安全验证，自动处理已停止',
    manualAction: '请在该电脑人工完成安全验证后核对订单状态',
  },
  GUEST_INFO_MASKED: {
    category: 'business_field_missing',
    summary: '客人姓名/电话仍为掩码，自动入单已阻断',
    manualAction: '请人工在渠道后台完成敏感信息解密后重试',
  },
  ORDER_DETAIL_PARSE_FAILED: {
    category: 'protocol_parse_error',
    summary: '订单详情原始报文解析失败，字段结构可能已变化',
    manualAction: '请人工核对渠道后台订单详情并反馈报文样例',
  },
  ORDER_DETAIL_INVALID: {
    category: 'business_field_missing',
    summary: '订单详情缺少必须业务字段（入住人/房型/日期）',
    manualAction: '请人工在渠道后台核对订单完整性',
  },
};

const FALLBACK_TEMPLATE = {
  category: 'unknown' as ExceptionCategory,
  summary: '值守任务失败，自动分析暂不可用',
  manualAction: '请人工核对订单状态与渠道后台',
};

function generateIncidentId(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `AG-${y}${m}${d}-${randomIdSuffix()}`;
}

function buildDeterministicConclusion(incident: ExceptionIncident): DiagnosisConclusion {
  const template = DETERMINISTIC_TEMPLATES[incident.errorCode] ?? FALLBACK_TEMPLATE;
  return {
    incidentId: incident.incidentId,
    category: template.category,
    severity: 'high',
    confidence: 'low',
    summary: template.summary,
    manualAction: template.manualAction,
    analysisUnavailable: true,
    observedFacts: [
      `错误码：${incident.errorCode}`,
      `失败阶段：${incident.failurePhase}`,
      `错误信息：${incident.errorMessage.slice(0, 120)}`,
      incident.sideEffectState === 'unknown'
        ? '外部提交状态未知，请先权威核对订单是否已提交'
        : '外部提交尚未开始',
      incident.observation
        ? incident.observation.dialogs.length > 0
          ? `页面观察：存在 ${incident.observation.dialogs.length} 个浮层`
          : '页面观察：未发现明显浮层'
        : '页面观察：不可用',
    ],
  };
}

/** 模型诊断输出的运行时契约校验（Fail-Fast：不合规即弃用，不静默修正） */ 
export function validateDiagnosisModelResponse(
  raw: unknown,
  incidentId: string
): { ok: true; conclusion: DiagnosisConclusion } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: '诊断输出不是 JSON 对象' };
  }
  const record = raw as Record<string, unknown>;

  if (!EXCEPTION_CATEGORIES.includes(record.category as ExceptionCategory)) {
    return { ok: false, reason: `诊断 category 越界: ${String(record.category)}` };
  }
  if (record.severity !== 'high' && record.severity !== 'medium' && record.severity !== 'low') {
    return { ok: false, reason: `诊断 severity 越界: ${String(record.severity)}` };
  }
  if (record.confidence !== 'high' && record.confidence !== 'medium' && record.confidence !== 'low') {
    return { ok: false, reason: `诊断 confidence 越界: ${String(record.confidence)}` };
  }
  if (typeof record.summary !== 'string' || !record.summary.trim() || record.summary.length > 200) {
    return { ok: false, reason: '诊断 summary 缺失或超长' };
  }
  if (typeof record.manualAction !== 'string' || !record.manualAction.trim() || record.manualAction.length > 200) {
    return { ok: false, reason: '诊断 manualAction 缺失或超长' };
  }
  if (!Array.isArray(record.facts) || record.facts.length === 0 || record.facts.length > 10) {
    return { ok: false, reason: '诊断 facts 必须为 1-10 条' };
  }
  for (const fact of record.facts) {
    if (typeof fact !== 'string' || !fact.trim() || fact.length > 160) {
      return { ok: false, reason: '诊断 facts 包含空或超长条目' };
    }
  }

  return {
    ok: true,
    conclusion: {
      incidentId,
      category: record.category as ExceptionCategory,
      severity: record.severity,
      confidence: record.confidence,
      summary: record.summary.trim(),
      manualAction: record.manualAction.trim(),
      analysisUnavailable: false,
      observedFacts: record.facts.map((fact) => String(fact).trim()),
    },
  };
}

export interface ExceptionDiagnosisOptions {
  /**
   * 模型端点与模型名；配置缺失（设计 8.2 异常告警兑底路径）时可省略，
   * 此时诊断直接退回确定性模板并照常通知，不发起模型调用。
   */
  endpoint?: AgentModelEndpoint;
  model?: string;
  timeoutMs: number;
  /** 通知配置（enabled=false 时诊断照常落追踪，仅跳过推送） */ 
  notification: AgentNotificationConfig;
  deduplicator: NotificationDeduplicator;
  /** 测试注入点：仅替换外部网络 I/O */ 
  modelCall?: (input: ModelCallInput) => Promise<ModelCallResult>;
  notifySend?: (config: AgentNotificationConfig, text: string) => Promise<NotificationSendResult>;
  now?: () => number;
}

/**
 * 执行一次异常诊断与通知。任何内部失败都收敛为显式 outcome 返回，
 * 不抛出（引擎缝隙为 fire-and-forget，异常必须内部消化为可审计结果与追踪事件）。
 */
export async function runExceptionDiagnosis(
  capture: IncidentCaptureInput,
  options: ExceptionDiagnosisOptions
): Promise<DiagnosisRunResult> {
  if (NON_INCIDENTAL_ERROR_CODES.has(capture.errorCode)) {
    return {
      incidentId: '',
      outcome: 'skipped',
      conclusion: null,
      notifyDetail: null,
      skipReason: `配置/契约类失败不触发异常诊断: ${capture.errorCode}`,
    };
  }

  // 页面观察必须最先执行：引擎缝隙内现场仍然完好，之后回执与诊断可并行
  const observation = await capture.observePage();
  const now = options.now ?? Date.now;
  const incident: ExceptionIncident = {
    incidentId: generateIncidentId(),
    taskId: capture.taskId,
    channelCode: capture.channelCode,
    orderNo: capture.orderNo,
    hotelScope: capture.hotelScope,
    msgType: capture.msgType,
    failurePhase: capture.failurePhase,
    errorCode: capture.errorCode,
    // 原始错误信息进入模型与通知前统一脱敏（设计 7.1）；未满洗原文保留在任务执行日志中
    errorMessage: maskSensitiveText(capture.errorMessage),
    retryable: capture.retryable,
    sideEffectState: capture.sideEffectState,
    occurredAt: new Date(now()).toISOString(),
    observation,
  };

  const emitter = new AgentTraceEmitter({
    traceId: `incident-${incident.incidentId}`,
    runId: `diag-${incident.incidentId}`,
  });
  const modelCall =
    options.modelCall ??
    (async (input: ModelCallInput) => {
      if (!options.endpoint || !options.model) {
        throw new Error('诊断模型配置缺失，无法发起模型调用');
      }
      return callChatCompletion(options.endpoint, input);
    });
  const notifySend = options.notifySend ?? sendAgentNotificationText;

  const dedupKey = {
    channelCode: incident.channelCode,
    orderNo: incident.orderNo ?? '',
    errorCode: incident.errorCode,
  };
  const dedup = options.deduplicator.shouldNotify(dedupKey, now());
  if (!dedup.notify) {
    emitter.emit({
      kind: 'run',
      phase: 'completed',
      outcomeCode: 'suppressed_duplicate',
      summary: `同窗口内重复异常已抑制通知: ${incident.channelCode}/${incident.orderNo ?? '-'}/${incident.errorCode}`,
    });
    return {
      incidentId: incident.incidentId,
      outcome: 'suppressed_duplicate',
      conclusion: null,
      notifyDetail: `聚合窗口内已通知过相同异常，抑制至 ${new Date(dedup.suppressedUntil ?? 0).toISOString()}`,
    };
  }

  try {
    await emitter.emitCritical({
      kind: 'run',
      phase: 'started',
      summary: `异常诊断启动: ${incident.errorCode} 订单 ${incident.orderNo ?? '-'}`,
      payload: {
        incidentId: incident.incidentId,
        taskId: incident.taskId,
        channelCode: incident.channelCode,
        orderNo: incident.orderNo,
        failurePhase: incident.failurePhase,
        errorCode: incident.errorCode,
        sideEffectState: incident.sideEffectState,
        hasObservation: Boolean(observation),
      },
    });
  } catch (error) {
    // 首条关键事件确认失败：诊断终止并如实返回（不产生无审计的模型调用）
    return {
      incidentId: incident.incidentId,
      outcome: 'skipped',
      conclusion: null,
      notifyDetail: null,
      failureReason: describeErrorMessage(error),
    };
  }

  emitter.emit({
    kind: 'snapshot',
    phase: 'completed',
    summary: observation ? '页面现场观察完成' : '页面观察不可用，仅依据错误信息诊断',
    payload: {
      dialogCount: observation?.dialogs.length ?? 0,
      note: observation?.note ?? null,
    },
  });

  let conclusion: DiagnosisConclusion;
  emitter.emit({
    kind: 'model',
    phase: 'started',
    summary: '诊断模型调用开始',
    payload: { promptVersion: EXCEPTION_DIAGNOSIS_PROMPT_VERSION },
  });
  try {
    const modelResult = await modelCall({
      // 配置缺失路径由 modelCall 守卫抛错接管（确定性模板告警），占位模型名不进入任何日志或请求
      model: options.model ?? '',
      messages: buildExceptionDiagnosisMessages(incident),
      timeoutMs: options.timeoutMs,
    });
    emitter.emit({
      kind: 'model',
      phase: 'completed',
      summary: `诊断模型返回（${modelResult.durationMs}ms）`,
      payload: { model: modelResult.model, usage: modelResult.usage },
    });

    const validated = validateDiagnosisModelResponse(modelResult.parsedJson, incident.incidentId);
    if (validated.ok) {
      conclusion = validated.conclusion;
    } else {
      // 输出不符合契约：弃用模型结论，退回确定性模板并如实标记
      emitter.emit({
        kind: 'model',
        phase: 'failed',
        level: 'WARN',
        summary: `诊断输出契约违规，退回确定性模板: ${validated.reason}`,
      });
      conclusion = buildDeterministicConclusion(incident);
    }
  } catch (error) {
    const reason = describeErrorMessage(error);
    emitter.emit({
      kind: 'model',
      phase: 'failed',
      level: 'WARN',
      summary: `诊断模型不可用，退回确定性模板: ${reason}`,
    });
    conclusion = buildDeterministicConclusion(incident);
  }

  emitter.emit({
    kind: 'decision',
    phase: 'completed',
    outcomeCode: conclusion.category,
    summary: `诊断结论: ${conclusion.category}（${conclusion.summary}）`,
    payload: {
      severity: conclusion.severity,
      confidence: conclusion.confidence,
      analysisUnavailable: conclusion.analysisUnavailable,
      manualAction: conclusion.manualAction,
      facts: conclusion.observedFacts,
    },
  });

  // 通知未开启：诊断结论仍进追踪，推送显式跳过
  if (!options.notification.enabled) {
    emitter.emit({
      kind: 'notification',
      phase: 'cancelled',
      summary: '消息通知未开启，已跳过推送',
    });
    await emitter.emitCritical({
      kind: 'run',
      phase: 'completed',
      outcomeCode: 'skipped_notify_disabled',
      summary: '异常诊断完成（未推送）',
      payload: { category: conclusion.category },
    });
    return {
      incidentId: incident.incidentId,
      outcome: 'skipped',
      conclusion,
      notifyDetail: null,
      skipReason: '消息通知未开启',
    };
  }

  const channelName = resolveChannelMeta(incident.channelCode).name || incident.channelCode;
  let notifyText: string;
  try {
    notifyText = buildIncidentNotificationText({
      hotelName: incident.hotelScope,
      channelName,
      orderNo: incident.orderNo ?? '（订单号缺失）',
      summaryLines: [
        conclusion.summary,
        conclusion.analysisUnavailable
          ? '自动分析暂不可用，以上为错误码模板说明。'
          : `已观察事实：${conclusion.observedFacts.slice(0, 2).join('；')}`,
      ],
      manualAction: conclusion.manualAction,
      traceRef: incident.incidentId,
    });
  } catch (error) {
    const reason = describeErrorMessage(error);
    emitter.emit({
      kind: 'notification',
      phase: 'failed',
      level: 'ERROR',
      summary: `通知文案构造失败: ${reason}`,
    });
    await emitter.emitCritical({
      kind: 'run',
      phase: 'failed',
      outcomeCode: 'notify_build_failed',
      summary: '异常诊断完成但通知文案构造失败',
    });
    return {
      incidentId: incident.incidentId,
      outcome: 'notify_failed',
      conclusion,
      notifyDetail: reason,
      failureReason: reason,
    };
  }

  const notifyResult = await notifySend(options.notification, notifyText);
  // 未知（unknown）状态同样登记去重窗口：避免传输结果不明时反复轰炸；窗口后可再次提醒
  if (notifyResult.status !== 'failed') {
    options.deduplicator.record(dedupKey, now());
  }

  emitter.emit({
    kind: 'notification',
    phase: notifyResult.status === 'accepted' ? 'completed' : 'failed',
    level: notifyResult.status === 'accepted' ? 'INFO' : 'ERROR',
    outcomeCode: notifyResult.status,
    summary: `通知发送: ${notifyResult.status}（${notifyResult.detail}）`,
  });

  const outcome = notifyResult.status === 'accepted' ? 'notified' : 'notify_failed';
  await emitter.emitCritical({
    kind: 'run',
    phase: 'completed',
    outcomeCode: outcome,
    summary: `异常诊断结束: ${outcome}（${conclusion.category}）`,
    payload: { category: conclusion.category, notifyStatus: notifyResult.status },
  });

  return {
    incidentId: incident.incidentId,
    outcome,
    conclusion,
    notifyDetail: notifyResult.detail,
  };
}
