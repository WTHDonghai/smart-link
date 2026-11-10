import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import type { AgentLogPersistedAck } from '../../src/types/agent';
import type { LogEventType } from '../../src/types';
import type { TrackOptions } from '../../src/services/logger';
import { AgentTraceEmitter } from '../../src/agent/agentTraceEmitter';
import { agentTraceLedger } from '../../src/agent/agentTraceLedger';
import { logger } from '../../src/services/logger';
import type { SystemLogEntry } from '../../src/types';

/**
 * 追踪发射器：真实序号/信封构造逻辑 + 仅 Mock 外部 I/O
 * （logger.track 返回值 与 账本等待）。
 */

let trackSpy: MockInstance<(event: LogEventType | string, options?: TrackOptions) => SystemLogEntry>;
let ackSpy: MockInstance<
  (entryId: string, options?: { timeoutMs?: number }) => Promise<AgentLogPersistedAck>
>;
let entryIdCounter = 0;

beforeEach(() => {
  entryIdCounter = 0;
  trackSpy = vi.spyOn(logger, 'track').mockImplementation(() => {
    entryIdCounter += 1;
    return { id: `log-${entryIdCounter}` } as SystemLogEntry;
  });
  ackSpy = vi
    .spyOn(agentTraceLedger, 'waitForLogCommitAck')
    .mockResolvedValue({ entryId: 'log-1', runId: 'run-1', sequence: 1, status: 'committed' });
});

afterEach(() => {
  trackSpy.mockRestore();
  ackSpy.mockRestore();
});

describe('AgentTraceEmitter 事件发射', () => {
  it('runId 暴露为只读属性', () => {
    const emitter = new AgentTraceEmitter({ traceId: 'trace-1', runId: 'run-9' });
    expect(emitter.runId).toBe('run-9');
  });

  it('普通事件：序号单调递增、信封完整、不要求提交确认', () => {
    const emitter = new AgentTraceEmitter({ traceId: 'trace-1', runId: 'run-1' });

    emitter.emit({ kind: 'snapshot', phase: 'completed', summary: '快照就绪' });
    emitter.emit({ kind: 'validation', phase: 'completed', summary: '校验完成', outcomeCode: 'v1' });

    expect(trackSpy).toHaveBeenCalledTimes(2);

    const firstMeta = trackSpy.mock.calls[0][1]?.meta?.agent as Record<string, unknown>;
    expect(firstMeta).toMatchObject({
      schemaVersion: 1,
      traceId: 'trace-1',
      runId: 'run-1',
      spanId: 'run-1-s1',
      sequence: 1,
      kind: 'snapshot',
      phase: 'completed',
      requiresCommitAck: false,
    });
    expect(trackSpy.mock.calls[0][0]).toBe('AGENT_SNAPSHOT_COMPLETED');

    const secondMeta = trackSpy.mock.calls[1][1]?.meta?.agent as Record<string, unknown>;
    expect(secondMeta.sequence).toBe(2);
    expect(secondMeta.spanId).toBe('run-1-s2');
    expect(secondMeta.outcomeCode).toBe('v1');
    expect(secondMeta.occurredAt).toBeTruthy();
  });

  it('事件名与级别按 kind/phase 生成，失败事件为 ERROR 级', () => {
    const emitter = new AgentTraceEmitter({ traceId: 'trace-1', runId: 'run-1' });

    emitter.emit({ kind: 'model', phase: 'failed', level: 'ERROR', summary: '模型调用失败' });

    expect(trackSpy.mock.calls[0][0]).toBe('AGENT_MODEL_FAILED');
    expect(trackSpy.mock.calls[0][1]?.level).toBe('ERROR');
  });

  it('关键事件：信封带 requiresCommitAck=true 且等待账本确认后才返回', async () => {
    const emitter = new AgentTraceEmitter({ traceId: 'trace-1', runId: 'run-1', ackTimeoutMs: 50 });

    await emitter.emitCritical({ kind: 'run', phase: 'started', summary: '映射启动' });

    const meta = trackSpy.mock.calls[0][1]?.meta?.agent as Record<string, unknown>;
    expect(meta.requiresCommitAck).toBe(true);
    expect(ackSpy).toHaveBeenCalledWith('log-1', { timeoutMs: 50 });
  });

  it('关键事件确认超时：显式抛错并指明 Agent 动作已停止（不得静默继续）', async () => {
    ackSpy.mockRejectedValue(new Error('等待 Agent 日志提交确认超时（entryId=log-1）'));
    const emitter = new AgentTraceEmitter({ traceId: 'trace-1', runId: 'run-1' });

    await expect(
      emitter.emitCritical({ kind: 'run', phase: 'started', summary: '映射启动' })
    ).rejects.toThrow('关键追踪事件持久化确认失败，Agent 动作已停止');
  });
});
