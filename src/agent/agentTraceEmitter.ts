/**
 * Agent 追踪事件发射器（仅主进程使用，设计 9.4/9.5）。
 *
 * 事件经既有 logger -> publishMainLog -> host:log-entry -> Redux addLog ->
 * logPersistenceMiddleware -> SmartLink_LogDB 唯一链路落库，不旁路写库。
 *
 * 关键事件（requiresCommitAck）在发射后等待渲染进程 IndexedDB 事务提交回执
 * （agentTraceLedger），确认失败或超时直接抛错：调用方必须停止后续 Agent 动作，
 * 不得静默继续——这是「先落库、后动作」的执行闸门。
 */

import { logger } from '@/src/services/logger';
import { agentTraceLedger, DEFAULT_ACK_TIMEOUT_MS } from './agentTraceLedger';
import { describeErrorMessage } from '@/src/utils/errorCauses';
import type {
  AgentTraceEventKind,
  AgentTraceEventMeta,
  AgentTraceEventPhase,
} from '@/src/types/agent';

export interface AgentTraceEmitterOptions {
  traceId: string;
  runId: string;
  /** 关键事件提交确认等待上限；测试可注入短时限 */
  ackTimeoutMs?: number;
}

export interface EmitEventInput {
  kind: AgentTraceEventKind;
  phase: AgentTraceEventPhase;
  summary: string;
  outcomeCode?: string;
  payload?: Record<string, unknown>;
  level?: 'INFO' | 'WARN' | 'ERROR';
}

function eventLogName(input: EmitEventInput): string {
  return `AGENT_${input.kind.toUpperCase()}_${input.phase.toUpperCase()}`;
}

export class AgentTraceEmitter {
  private nextSequence = 1;

  constructor(private readonly options: AgentTraceEmitterOptions) {}

  get runId(): string {
    return this.options.runId;
  }

  private buildMeta(input: EmitEventInput, requiresCommitAck: boolean): { meta: AgentTraceEventMeta; entry: ReturnType<typeof logger.track> } {
    const sequence = this.nextSequence;
    this.nextSequence += 1;

    const meta: AgentTraceEventMeta = {
      schemaVersion: 1,
      traceId: this.options.traceId,
      runId: this.options.runId,
      spanId: `${this.options.runId}-s${sequence}`,
      sequence,
      kind: input.kind,
      phase: input.phase,
      occurredAt: new Date().toISOString(),
      summary: input.summary,
      requiresCommitAck,
    };
    if (input.outcomeCode) meta.outcomeCode = input.outcomeCode;
    if (input.payload) meta.payload = input.payload;

    const entry = logger.track(eventLogName(input), {
      level: input.level ?? 'INFO',
      message: input.summary,
      meta: { agent: meta },
    });

    return { meta, entry };
  }

  /** 发射普通进度事件（异步批量落库，不等待确认） */
  emit(input: EmitEventInput): void {
    this.buildMeta(input, false);
  }

  /**
   * 发射关键事件并等待 IndexedDB 提交确认（设计 9.5）。
   * 确认超时或失败时抛错，调用方必须据此停止后续 Agent 动作并标记追踪不完整。
   */
  async emitCritical(input: EmitEventInput): Promise<void> {
    const { meta, entry } = this.buildMeta(input, true);

    try {
      await agentTraceLedger.waitForLogCommitAck(entry.id, {
        timeoutMs: this.options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS,
      });
    } catch (error) {
      const reason = describeErrorMessage(error);
      throw new Error(
        `关键追踪事件持久化确认失败，Agent 动作已停止: ${input.summary}（${reason}）`
      );
    }
  }
}
