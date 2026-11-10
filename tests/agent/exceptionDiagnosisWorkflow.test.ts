import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import type { AgentLogPersistedAck } from '../../src/types/agent';
import type { LogEventType } from '../../src/types';
import type { TrackOptions } from '../../src/services/logger';
import {
  runExceptionDiagnosis,
  validateDiagnosisModelResponse,
  type IncidentCaptureInput,
  type ExceptionDiagnosisOptions,
} from '../../src/agent/exceptionDiagnosisWorkflow';
import { NotificationDeduplicator } from '../../src/agent/notificationDeduplicator';
import { agentTraceLedger } from '../../src/agent/agentTraceLedger';
import { logger } from '../../src/services/logger';
import type { SystemLogEntry } from '../../src/types';
import type { AgentNotificationConfig } from '../../src/config/agentNotificationConfig';
import type { ModelCallInput, ModelCallResult } from '../../src/agent/agentModelClient';
import type { NotificationSendResult } from '../../src/services/notificationApi';

/**
 * 异常诊断工作流：真实编排/校验/兑底/去重逻辑，
 * 仅注入外部 I/O（模型调用、通知发送、账本确认）。
 */

function buildCapture(overrides?: Partial<IncidentCaptureInput>): IncidentCaptureInput {
  return {
    taskId: 'task-1',
    channelCode: 'MEITUAN',
    orderNo: 'ORD-1001',
    hotelScope: '酒店 1001',
    msgType: 'OTA_IMPORT_ORDER',
    failurePhase: 'inspect-order-detail',
    errorCode: 'ORDER_DETAIL_FETCH_FAILED',
    errorMessage: '定位订单卡片超时 ORDER_CARD_NOT_FOUND',
    retryable: true,
    sideEffectState: 'not_started',
    observePage: async () => ({
      observedAt: '2026-11-03T10:00:00.000Z',
      pageUrl: 'https://ota.example.com/orders',
      visibleTextExcerpt: '页面可见文本',
      dialogs: [
        {
          frameUrl: 'https://ota.example.com/orders',
          role: 'dialog',
          title: '系统公告',
          bodyText: '今日凌晨系统升级',
          buttons: ['我知道了'],
        },
      ],
    }),
    ...overrides,
  };
}

function buildNotificationConfig(enabled = true): AgentNotificationConfig {
  return {
    enabled,
    webhookType: 'wecom',
    webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
    dingtalkSecret: '',
    timeoutMs: 5000,
  };
}

function buildOptions(overrides?: {
  modelCall?: ExceptionDiagnosisOptions['modelCall'];
  notifySend?: ExceptionDiagnosisOptions['notifySend'];
  notification?: AgentNotificationConfig;
  deduplicator?: NotificationDeduplicator;
}): ExceptionDiagnosisOptions {
  return {
    endpoint: { baseUrl: 'https://gateway.example.com/v1', apiKey: 'sk-x' },
    model: 'test-diagnosis-model',
    timeoutMs: 5000,
    notification: overrides?.notification ?? buildNotificationConfig(),
    deduplicator: overrides?.deduplicator ?? new NotificationDeduplicator(),
    modelCall: overrides?.modelCall,
    notifySend: overrides?.notifySend,
  };
}

function buildModelResult(parsedJson: unknown): ModelCallResult {
  return {
    content: JSON.stringify(parsedJson),
    parsedJson,
    usage: { promptTokens: 50, completionTokens: 20 },
    model: 'test-diagnosis-model',
    durationMs: 4,
  };
}

const VALID_DIAGNOSIS = {
  category: 'page_blocked',
  severity: 'high',
  confidence: 'medium',
  summary: '页面被系统公告遮挡，订单详情未能打开',
  manualAction: '请人工关闭公告后重试该订单',
  facts: ['错误信息：定位订单卡片超时', '页面观察：存在标题为「系统公告」的浮层'],
};

let trackSpy: MockInstance<(event: LogEventType | string, options?: TrackOptions) => SystemLogEntry>;
let ackSpy: MockInstance<
  (entryId: string, options?: { timeoutMs?: number }) => Promise<AgentLogPersistedAck>
>;

beforeEach(() => {
  let entryId = 0;
  trackSpy = vi.spyOn(logger, 'track').mockImplementation(() => {
    entryId += 1;
    return { id: `log-${entryId}` } as SystemLogEntry;
  });
  ackSpy = vi
    .spyOn(agentTraceLedger, 'waitForLogCommitAck')
    .mockResolvedValue({ entryId: 'log-1', runId: 'r', sequence: 1, status: 'committed' });
});

afterEach(() => {
  trackSpy.mockRestore();
  ackSpy.mockRestore();
});

describe('validateDiagnosisModelResponse 契约校验', () => {
  it('接受合法诊断输出', () => {
    const outcome = validateDiagnosisModelResponse(VALID_DIAGNOSIS, 'AG-1');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.conclusion.category).toBe('page_blocked');
    expect(outcome.conclusion.analysisUnavailable).toBe(false);
  });

  it('拒绝越界枚举、缺失字段与超长内容', () => {
    expect(validateDiagnosisModelResponse({ ...VALID_DIAGNOSIS, category: 'hacked' }, 'AG-1')).toMatchObject({ ok: false });
    expect(validateDiagnosisModelResponse({ ...VALID_DIAGNOSIS, severity: 'critical' }, 'AG-1')).toMatchObject({ ok: false });
    expect(validateDiagnosisModelResponse({ ...VALID_DIAGNOSIS, summary: '' }, 'AG-1')).toMatchObject({ ok: false });
    expect(validateDiagnosisModelResponse({ ...VALID_DIAGNOSIS, facts: [] }, 'AG-1')).toMatchObject({ ok: false });
    expect(validateDiagnosisModelResponse({ ...VALID_DIAGNOSIS, facts: Array.from({ length: 11 }, () => 'f') }, 'AG-1')).toMatchObject({ ok: false });
    expect(validateDiagnosisModelResponse('not-object', 'AG-1')).toMatchObject({ ok: false });
  });
});

describe('runExceptionDiagnosis 主链路', () => {
  it('模型诊断成功且通知受理：notified，追踪事件齐备', async () => {
    const modelCall = vi.fn(async () => buildModelResult(VALID_DIAGNOSIS));
    const notifySend = vi.fn(
      async (_config: AgentNotificationConfig, _text: string): Promise<NotificationSendResult> => ({
        status: 'accepted',
        detail: '企业微信机器人已受理',
      })
    );

    const result = await runExceptionDiagnosis(buildCapture(), buildOptions({ modelCall, notifySend }));

    expect(result.outcome).toBe('notified');
    expect(result.conclusion?.category).toBe('page_blocked');
    expect(result.conclusion?.analysisUnavailable).toBe(false);
    expect(result.incidentId).toMatch(/^AG-\d{8}-/);

    // 通知文案包含真实字段：酒店、订单、事实与处理记录号
    const notifyText = notifySend.mock.calls[0][1];
    expect(notifyText).toContain('酒店 1001');
    expect(notifyText).toContain('ORD-1001');
    expect(notifyText).toContain('请人工关闭公告后重试该订单');
    expect(notifyText).toContain(result.incidentId);
    expect(notifyText).not.toContain('13812345678');

    const eventNames = trackSpy.mock.calls.map((call) => call[0]);
    expect(eventNames).toEqual([
      'AGENT_RUN_STARTED',
      'AGENT_SNAPSHOT_COMPLETED',
      'AGENT_MODEL_STARTED',
      'AGENT_MODEL_COMPLETED',
      'AGENT_DECISION_COMPLETED',
      'AGENT_NOTIFICATION_COMPLETED',
      'AGENT_RUN_COMPLETED',
    ]);
    // 诊断提示词版本随追踪事件留档（与产品映射对齐）
    const modelStarted = trackSpy.mock.calls.find((call) => call[0] === 'AGENT_MODEL_STARTED');
    const agentMeta = modelStarted?.[1]?.meta?.agent as { payload?: { promptVersion?: string } } | undefined;
    expect(agentMeta?.payload?.promptVersion).toBe('exception-diagnosis-v1');
  });

  it('模型不可用：退回确定性模板并照常通知，analysisUnavailable 如实标记', async () => {
    const modelCall = vi.fn(async () => {
      throw new Error('模型服务返回 HTTP 503');
    });
    const notifySend = vi.fn(
      async (_config: AgentNotificationConfig, _text: string): Promise<NotificationSendResult> => ({
        status: 'accepted',
        detail: '企业微信机器人已受理',
      })
    );

    const result = await runExceptionDiagnosis(
      buildCapture({ errorCode: 'RISK_VERIFICATION_REQUIRED' }),
      buildOptions({ modelCall, notifySend })
    );

    expect(result.outcome).toBe('notified');
    expect(result.conclusion?.analysisUnavailable).toBe(true);
    expect(result.conclusion?.category).toBe('risk_verification');
    expect(result.conclusion?.manualAction).toContain('安全验证');
    expect(notifySend).toHaveBeenCalledTimes(1);
  });

  it('模型输出不符合契约：弃用模型结论退回模板', async () => {
    const modelCall = vi.fn(async () => buildModelResult({ category: 'guess', summary: 'x' }));
    const notifySend = vi.fn(async (): Promise<NotificationSendResult> => ({ status: 'accepted', detail: 'ok' }));

    const result = await runExceptionDiagnosis(buildCapture(), buildOptions({ modelCall, notifySend }));

    expect(result.outcome).toBe('notified');
    expect(result.conclusion?.analysisUnavailable).toBe(true);
    expect(result.conclusion?.category).toBe('unknown');
  });

  it('同窗口重复异常被抑制：不调用模型也不推送，但留下审计事件', async () => {
    const modelCall = vi.fn(async () => buildModelResult(VALID_DIAGNOSIS));
    const notifySend = vi.fn(async (): Promise<NotificationSendResult> => ({ status: 'accepted', detail: 'ok' }));
    const deduplicator = new NotificationDeduplicator();
    const options = buildOptions({ modelCall, notifySend, deduplicator });

    const first = await runExceptionDiagnosis(buildCapture(), options);
    const second = await runExceptionDiagnosis(buildCapture(), options);

    expect(first.outcome).toBe('notified');
    expect(second.outcome).toBe('suppressed_duplicate');
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(notifySend).toHaveBeenCalledTimes(1);

    const suppressedEvents = trackSpy.mock.calls.filter((call) => call[0] === 'AGENT_RUN_COMPLETED');
    expect(suppressedEvents).toHaveLength(2);
    const lastMeta = suppressedEvents[1][1]?.meta?.agent as Record<string, unknown>;
    expect(lastMeta.outcomeCode).toBe('suppressed_duplicate');
  });

  it('通知未开启：诊断照常落追踪，推送显式跳过', async () => {
    const modelCall = vi.fn(async () => buildModelResult(VALID_DIAGNOSIS));
    const notifySend = vi.fn(async (): Promise<NotificationSendResult> => ({ status: 'accepted', detail: 'ok' }));

    const result = await runExceptionDiagnosis(
      buildCapture(),
      buildOptions({ modelCall, notifySend, notification: buildNotificationConfig(false) })
    );

    expect(result.outcome).toBe('skipped');
    expect(result.skipReason).toBe('消息通知未开启');
    expect(result.conclusion?.category).toBe('page_blocked');
    expect(notifySend).not.toHaveBeenCalled();
  });

  it('通知传输结果未知（unknown）：登记去重窗口避免轰炸，终态 notify_failed', async () => {
    const modelCall = vi.fn(async () => buildModelResult(VALID_DIAGNOSIS));
    const notifySend = vi.fn(async (): Promise<NotificationSendResult> => ({
      status: 'unknown',
      detail: '通知请求未获响应（可能超时或网络中断），结果未知',
    }));
    const deduplicator = new NotificationDeduplicator();
    const options = buildOptions({ modelCall, notifySend, deduplicator });

    const first = await runExceptionDiagnosis(buildCapture(), options);
    const second = await runExceptionDiagnosis(buildCapture(), options);

    expect(first.outcome).toBe('notify_failed');
    // unknown 也登记窗口：短时间内同异常不再轰炸
    expect(second.outcome).toBe('suppressed_duplicate');
  });

  it('配置/契约类失败不触发诊断（零模型调用零追踪）', async () => {
    const modelCall = vi.fn();
    const notifySend = vi.fn();

    const result = await runExceptionDiagnosis(
      buildCapture({ errorCode: 'CONFIRM_IMPORT_DISABLED' }),
      buildOptions({ modelCall, notifySend })
    );

    expect(result.outcome).toBe('skipped');
    expect(result.skipReason).toContain('不触发异常诊断');
    expect(modelCall).not.toHaveBeenCalled();
    expect(notifySend).not.toHaveBeenCalled();
    expect(trackSpy).not.toHaveBeenCalled();
  });

  it('页面观察不可用：继续诊断并如实记录证据缺失', async () => {
    const modelCall = vi.fn(async () => buildModelResult(VALID_DIAGNOSIS));
    const notifySend = vi.fn(async (): Promise<NotificationSendResult> => ({ status: 'accepted', detail: 'ok' }));

    const result = await runExceptionDiagnosis(
      buildCapture({ observePage: async () => null }),
      buildOptions({ modelCall, notifySend })
    );

    expect(result.outcome).toBe('notified');
    const snapshotEvent = trackSpy.mock.calls.find((call) => call[0] === 'AGENT_SNAPSHOT_COMPLETED');
    expect(snapshotEvent?.[1]?.message).toContain('页面观察不可用');
  });

  it('错误信息含敏感数据时：送模型与通知前统一脱敏（设计 7.1）', async () => {
    const modelCall = vi.fn(async (_input: ModelCallInput) => buildModelResult(VALID_DIAGNOSIS));
    const notifySend = vi.fn(
      async (): Promise<NotificationSendResult> => ({ status: 'accepted', detail: 'ok' })
    );

    const result = await runExceptionDiagnosis(
      buildCapture({ errorMessage: '下单人 13812345678 联系失败，证件 11010119900307867X 校验未通过' }),
      buildOptions({ modelCall, notifySend })
    );

    expect(result.outcome).toBe('notified');
    // 模型输入中不得出现未脱敏的原始敏感串，脱敏形态保留供诊断
    const modelInput = modelCall.mock.calls[0][0].messages.map((message) => message.content).join('\n');
    expect(modelInput).not.toContain('13812345678');
    expect(modelInput).not.toContain('11010119900307867X');
    expect(modelInput).toContain('138****5678');
    expect(modelInput).toContain('1101************7X');
  });

  it('确定性模板包含失败阶段事实；副作用未知时提示先权威核对（设计 7.1）', async () => {
    const modelCall = vi.fn(async (_input: ModelCallInput) => {
      throw new Error('模型服务返回 HTTP 503');
    });
    const notifySend = vi.fn(
      async (_config: AgentNotificationConfig, _text: string): Promise<NotificationSendResult> => ({
        status: 'accepted',
        detail: 'ok',
      })
    );

    const result = await runExceptionDiagnosis(
      buildCapture({ failurePhase: 'submit-import', sideEffectState: 'unknown' }),
      buildOptions({ modelCall, notifySend })
    );

    expect(result.conclusion?.analysisUnavailable).toBe(true);
    expect(result.conclusion?.observedFacts).toContain('失败阶段：submit-import');
    expect(result.conclusion?.observedFacts).toContain('外部提交状态未知，请先权威核对订单是否已提交');
    // 通知文案携带模板的人工核对指引（阶段与副作用事实进结论 facts 与追踪审计）
    const notifyText = notifySend.mock.calls[0][1];
    expect(notifyText).toContain('请人工核对订单状态与渠道后台');
  });

  it('模型配置缺失（省略 endpoint/model）：直接退回确定性模板并照常通知（设计 8.2 异常告警路径）', async () => {
    const notifySend = vi.fn(
      async (_config: AgentNotificationConfig, _text: string): Promise<NotificationSendResult> => ({
        status: 'accepted',
        detail: 'ok',
      })
    );
    const options = buildOptions({ notifySend });
    delete (options as Partial<ExceptionDiagnosisOptions>).endpoint;
    delete (options as Partial<ExceptionDiagnosisOptions>).model;

    const result = await runExceptionDiagnosis(
      buildCapture({ errorCode: 'RISK_VERIFICATION_REQUIRED' }),
      options
    );

    expect(result.outcome).toBe('notified');
    expect(result.conclusion?.analysisUnavailable).toBe(true);
    expect(result.conclusion?.category).toBe('risk_verification');
    // 配置缺失如实进入追踪事件，不伪装成模型结论
    const failedEvent = trackSpy.mock.calls.find((call) => call[0] === 'AGENT_MODEL_FAILED');
    expect(failedEvent?.[1]?.message).toContain('诊断模型配置缺失');
  });

  it('首条关键事件确认失败：诊断终止，不发起模型调用', async () => {
    ackSpy.mockRejectedValue(new Error('等待 Agent 日志提交确认超时'));
    const modelCall = vi.fn();
    const notifySend = vi.fn();

    const result = await runExceptionDiagnosis(buildCapture(), buildOptions({ modelCall, notifySend }));

    expect(result.outcome).toBe('skipped');
    expect(result.failureReason).toContain('关键追踪事件持久化确认失败');
    expect(modelCall).not.toHaveBeenCalled();
    expect(notifySend).not.toHaveBeenCalled();
  });
});
