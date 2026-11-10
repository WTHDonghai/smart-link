import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { logPersistenceMiddleware } from '../../src/store/logPersistenceMiddleware';
import { addLog, addLogs } from '../../src/store/slices/systemLogSlice';
import { logger, type TrackOptions } from '../../src/services/logger';
import { confirmAgentLogPersisted } from '../../src/services/agentBridge';
import type { AgentTraceEventMeta } from '../../src/types/agent';
import type { SystemLogEntry, LogEventType } from '../../src/types';

/**
 * Agent 关键事件持久化确认闭环（渲染进程侧）：
 * Redux 唯一日志入口 -> IndexedDB 事务提交 -> host:log-persisted 回执。
 * 仅 Mock 不可控 I/O 边界（logger 存储与 IPC 网关），中间件与确认流为真实逻辑。
 */

vi.mock('../../src/services/agentBridge', () => ({
  confirmAgentLogPersisted: vi.fn().mockResolvedValue({ accepted: true }),
}));

const confirmMock = vi.mocked(confirmAgentLogPersisted);

function buildAgentEntry(
  id: string,
  agentOverrides?: Partial<AgentTraceEventMeta>,
  entryOverrides?: Partial<SystemLogEntry>
): SystemLogEntry {
  const agent: AgentTraceEventMeta = {
    schemaVersion: 1,
    traceId: 'trace-1',
    runId: 'run-1',
    spanId: 'span-1',
    sequence: 4,
    kind: 'tool',
    phase: 'started',
    occurredAt: '2026-11-02T10:00:00.000Z',
    summary: 'dismiss_overlay 意图',
    requiresCommitAck: true,
    ...agentOverrides,
  };
  return {
    id,
    timestamp: '2026-11-02 10:00:00.000',
    createdAt: 1780000000000,
    level: 'INFO',
    message: '[AGENT_TOOL_STARTED] dismiss_overlay',
    meta: { agent },
    ...entryOverrides,
  };
}

function buildPlainEntry(id: string): SystemLogEntry {
  return {
    id,
    timestamp: '2026-11-02 10:00:00.000',
    createdAt: 1780000000000,
    level: 'INFO',
    message: '[SYS_EVENT] 普通日志',
  };
}

async function flushAsyncChain(): Promise<void> {
  // 确认流为 fire-and-forget 异步链（等待提交 -> 发送回执），排空微任务队列
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('logPersistenceMiddleware Agent 提交确认流', () => {
  let store: ReturnType<typeof configureStore>;
  let persistSpy: MockInstance<(entry: SystemLogEntry) => void>;
  let waitForSpy: MockInstance<(entryId: string) => Promise<void>>;
  let trackSpy: MockInstance<(event: LogEventType | string, options?: TrackOptions) => SystemLogEntry>;

  beforeEach(() => {
    confirmMock.mockReset().mockResolvedValue({ accepted: true });
    persistSpy = vi.spyOn(logger, 'persist').mockImplementation(() => undefined);
    trackSpy = vi.spyOn(logger, 'track').mockImplementation(() => buildPlainEntry('tracked'));
    waitForSpy = vi
      .spyOn(logger, 'waitForEntryCommit')
      .mockResolvedValue(undefined);

    store = configureStore({
      reducer: () => ({ value: 0 }),
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(logPersistenceMiddleware),
    });
  });

  afterEach(() => {
    persistSpy.mockRestore();
    waitForSpy.mockRestore();
    trackSpy.mockRestore();
  });

  it('requiresCommitAck 事件：持久化后等待事务提交，并回传 committed 回执', async () => {
    const entry = buildAgentEntry('agent-entry-1');
    store.dispatch(addLog(entry));

    expect(persistSpy).toHaveBeenCalledWith(entry);
    await flushAsyncChain();

    expect(waitForSpy).toHaveBeenCalledWith('agent-entry-1');
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledWith({
      entryId: 'agent-entry-1',
      runId: 'run-1',
      sequence: 4,
      status: 'committed',
    });
  });

  it('提交确认失败：回传 persist-failed 并记录 ERROR 遥测', async () => {
    waitForSpy.mockRejectedValue(new Error('IndexedDB 事务失败'));
    const entry = buildAgentEntry('agent-entry-2', { kind: 'tool', phase: 'started' });

    store.dispatch(addLog(entry));
    await flushAsyncChain();

    expect(confirmMock).toHaveBeenCalledWith({
      entryId: 'agent-entry-2',
      runId: 'run-1',
      sequence: 4,
      status: 'persist-failed',
      error: 'IndexedDB 事务失败',
    });
    expect(trackSpy).toHaveBeenCalledWith(
      'AGENT_TRACE_PERSIST_FAILED',
      expect.objectContaining({ level: 'ERROR' })
    );
  });

  it('回执发送失败：记录 ERROR 遥测，交由主进程确认超时兜底', async () => {
    confirmMock.mockRejectedValue(new Error('IPC 通道不可用'));
    const entry = buildAgentEntry('agent-entry-3');

    store.dispatch(addLog(entry));
    await flushAsyncChain();

    expect(trackSpy).toHaveBeenCalledWith(
      'AGENT_TRACE_ACK_SEND_FAILED',
      expect.objectContaining({ level: 'ERROR' })
    );
  });

  it('无 meta.agent 的普通日志不触发任何确认回执', async () => {
    store.dispatch(addLog(buildPlainEntry('plain-1')));
    await flushAsyncChain();

    expect(persistSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'plain-1' }));
    expect(waitForSpy).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('meta.agent 存在但 requiresCommitAck 未开启时不回传确认', async () => {
    const entry = buildAgentEntry('agent-entry-4', { requiresCommitAck: false });
    store.dispatch(addLog(entry));
    await flushAsyncChain();

    expect(persistSpy).toHaveBeenCalledWith(entry);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('噪声黑名单事件即使携带确认标记也不持久化、不回传（不得产生永远挂起的确认）', async () => {
    const entry = buildAgentEntry('agent-noise-1', undefined, {
      event: 'ORDER_POLL_SUCCESS',
      level: 'INFO',
    });
    store.dispatch(addLog(entry));
    await flushAsyncChain();

    expect(persistSpy).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('addLogs 批量路径：批量持久化，但仅对需确认的 Agent 事件逐条回执', async () => {
    const agentEntry = buildAgentEntry('agent-batch-1', { sequence: 7 });
    const anotherAgent = buildAgentEntry('agent-batch-2', { sequence: 8, requiresCommitAck: true });
    const plain = buildPlainEntry('plain-batch-1');

    const persistBatchSpy = vi.spyOn(logger, 'persistBatch').mockImplementation(() => undefined);
    try {
      store.dispatch(addLogs([agentEntry, anotherAgent, plain]));
      await flushAsyncChain();

      expect(persistBatchSpy).toHaveBeenCalledTimes(1);
      expect(persistBatchSpy.mock.calls[0][0].map((item) => item.id)).toEqual([
        'agent-batch-1',
        'agent-batch-2',
        'plain-batch-1',
      ]);
      expect(confirmMock).toHaveBeenCalledTimes(2);
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ entryId: 'agent-batch-1', sequence: 7, status: 'committed' })
      );
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({ entryId: 'agent-batch-2', sequence: 8, status: 'committed' })
      );
    } finally {
      persistBatchSpy.mockRestore();
    }
  });
});
