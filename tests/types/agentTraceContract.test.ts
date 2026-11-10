import { describe, it, expect } from 'vitest';
import {
  AGENT_TRACE_SCHEMA_VERSION,
  isAgentTraceEventMeta,
  isAgentLogPersistedAck,
  readAgentTraceMeta,
  type AgentTraceEventMeta,
} from '../../src/types/agent';
import type { SystemLogEntry } from '../../src/types';

function buildValidMeta(overrides?: Partial<AgentTraceEventMeta>): AgentTraceEventMeta {
  return {
    schemaVersion: AGENT_TRACE_SCHEMA_VERSION,
    traceId: 'trace-1',
    runId: 'run-1',
    spanId: 'span-1',
    sequence: 1,
    kind: 'tool',
    phase: 'started',
    occurredAt: '2026-11-02T10:00:00.000Z',
    summary: 'dismiss_overlay 意图',
    payload: { overlayRef: 'ov-3' },
    requiresCommitAck: true,
    ...overrides,
  };
}

describe('isAgentTraceEventMeta 运行时契约校验', () => {
  it('接受完整合法的事件信封', () => {
    expect(isAgentTraceEventMeta(buildValidMeta())).toBe(true);
  });

  it('接受不含可选字段的最小信封', () => {
    const minimal: Record<string, unknown> = {
      schemaVersion: 1,
      traceId: 't',
      runId: 'r',
      spanId: 's',
      sequence: 42,
      kind: 'run',
      phase: 'completed',
      occurredAt: '2026-11-02T10:00:00.000Z',
      summary: 'run 结束',
    };
    expect(isAgentTraceEventMeta(minimal)).toBe(true);
  });

  it('拒绝非对象与非本版本信封', () => {
    expect(isAgentTraceEventMeta(null)).toBe(false);
    expect(isAgentTraceEventMeta('agent')).toBe(false);
    expect(isAgentTraceEventMeta([])).toBe(false);
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), schemaVersion: 2 })).toBe(false);
  });

  it('拒绝缺失或空白的标识字段', () => {
    expect(isAgentTraceEventMeta(buildValidMeta({ traceId: '' }))).toBe(false);
    expect(isAgentTraceEventMeta(buildValidMeta({ traceId: '   ' }))).toBe(false);
    expect(isAgentTraceEventMeta(buildValidMeta({ runId: '' }))).toBe(false);
    expect(isAgentTraceEventMeta(buildValidMeta({ spanId: '' }))).toBe(false);
    expect(isAgentTraceEventMeta(buildValidMeta({ parentSpanId: '' }))).toBe(false);
  });

  it('拒绝非法序号：非整数、零与负数', () => {
    expect(isAgentTraceEventMeta(buildValidMeta({ sequence: 0 }))).toBe(false);
    expect(isAgentTraceEventMeta(buildValidMeta({ sequence: -1 }))).toBe(false);
    expect(isAgentTraceEventMeta(buildValidMeta({ sequence: 1.5 }))).toBe(false);
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), sequence: '3' })).toBe(false);
  });

  it('拒绝越界 kind / phase / occurredAt / summary / payload', () => {
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), kind: 'browser' })).toBe(false);
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), phase: 'running' })).toBe(false);
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), occurredAt: 'not-a-date' })).toBe(false);
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), summary: '' })).toBe(false);
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), payload: ['not-record'] })).toBe(false);
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), requiresCommitAck: 'yes' })).toBe(false);
    expect(isAgentTraceEventMeta({ ...buildValidMeta(), outcomeCode: '' })).toBe(false);
  });
});

describe('isAgentLogPersistedAck 运行时契约校验', () => {
  it('接受合法回执（含错误说明的失败回执）', () => {
    expect(isAgentLogPersistedAck({ entryId: 'e1', runId: 'r1', sequence: 3, status: 'committed' })).toBe(true);
    expect(
      isAgentLogPersistedAck({
        entryId: 'e1',
        runId: 'r1',
        sequence: 3,
        status: 'persist-failed',
        error: '事务失败',
      })
    ).toBe(true);
  });

  it('拒绝缺失标识、非法序号与越界状态', () => {
    expect(isAgentLogPersistedAck({ entryId: '', runId: 'r1', sequence: 1, status: 'committed' })).toBe(false);
    expect(isAgentLogPersistedAck({ entryId: 'e1', runId: 'r1', sequence: 0, status: 'committed' })).toBe(false);
    expect(
      isAgentLogPersistedAck({ entryId: 'e1', runId: 'r1', sequence: 1, status: 'delivered' })
    ).toBe(false);
    expect(
      isAgentLogPersistedAck({ entryId: 'e1', runId: 'r1', sequence: 1, status: 'committed', error: 500 })
    ).toBe(false);
  });
});

describe('readAgentTraceMeta 日志条目读取', () => {
  const baseEntry: SystemLogEntry = {
    id: 'log-1',
    timestamp: '2026-11-02 10:00:00.000',
    createdAt: 1780000000000,
    level: 'INFO',
    message: '[AGENT_TOOL_STARTED] dismiss_overlay',
  };

  it('无 meta.agent 的普通条目返回 null', () => {
    expect(readAgentTraceMeta(baseEntry)).toBeNull();
  });

  it('meta.agent 非法时返回 null（由主进程确认超时兜底，不在中间件内抛错）', () => {
    const entry: SystemLogEntry = { ...baseEntry, meta: { agent: { traceId: 123 } } };
    expect(readAgentTraceMeta(entry)).toBeNull();
  });

  it('合法信封返回强类型 meta', () => {
    const meta = buildValidMeta();
    const entry: SystemLogEntry = { ...baseEntry, meta: { agent: meta } };
    expect(readAgentTraceMeta(entry)).toEqual(meta);
  });
});
