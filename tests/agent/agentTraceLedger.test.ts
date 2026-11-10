import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AgentTraceLedgerService,
  DEFAULT_ACK_TIMEOUT_MS,
} from '../../src/agent/agentTraceLedger';
import type { AgentLogPersistedAck } from '../../src/types/agent';

function buildAck(entryId: string, overrides?: Partial<AgentLogPersistedAck>): AgentLogPersistedAck {
  return {
    entryId,
    runId: 'run-1',
    sequence: 4,
    status: 'committed',
    ...overrides,
  };
}

describe('AgentTraceLedgerService 主进程确认账本', () => {
  let ledger: AgentTraceLedgerService;

  beforeEach(() => {
    ledger = new AgentTraceLedgerService();
  });

  it('已记录的条目 waitFor 立即返回同一条确认', async () => {
    const ack = buildAck('entry-1');
    ledger.record(ack);

    await expect(ledger.waitForLogCommitAck('entry-1')).resolves.toEqual(ack);
    expect(ledger.getRecordedAck('entry-1')).toEqual(ack);
  });

  it('先等待后记录：record 唤醒挂起的等待方并携带原始确认', async () => {
    const pending = ledger.waitForLogCommitAck('entry-2');
    const ack = buildAck('entry-2', { status: 'persist-failed', error: '事务失败' });

    ledger.record(ack);

    await expect(pending).resolves.toEqual(ack);
  });

  it('同一 entryId 的多个等待方都被唤醒', async () => {
    const waiterA = ledger.waitForLogCommitAck('entry-3');
    const waiterB = ledger.waitForLogCommitAck('entry-3');

    ledger.record(buildAck('entry-3'));

    await expect(waiterA).resolves.toMatchObject({ entryId: 'entry-3', status: 'committed' });
    await expect(waiterB).resolves.toMatchObject({ entryId: 'entry-3', status: 'committed' });
  });

  it('确认超时显式拒绝（默认 30 秒上限）', async () => {
    vi.useFakeTimers();

    try {
      expect(DEFAULT_ACK_TIMEOUT_MS).toBe(30_000);
      const pending = ledger.waitForLogCommitAck('entry-timeout', { timeoutMs: 50 });

      const assertion = expect(pending).rejects.toThrow(
        '等待 Agent 日志提交确认超时（entryId=entry-timeout）'
      );
      await vi.advanceTimersByTimeAsync(51);
      await assertion;
      // 超时后的迟到的 record 不得把已拒绝的等待复活为未处理积压
      expect(ledger.getRecordedAck('entry-timeout')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('等待超时后账本仍可接收后续 record 并供新等待方立即读取', async () => {
    vi.useFakeTimers();

    try {
      const first = ledger.waitForLogCommitAck('entry-late', { timeoutMs: 10 });
      const assertion = expect(first).rejects.toThrow('等待 Agent 日志提交确认超时');
      await vi.advanceTimersByTimeAsync(11);
      await assertion;

      ledger.record(buildAck('entry-late'));
      await expect(ledger.waitForLogCommitAck('entry-late')).resolves.toMatchObject({
        entryId: 'entry-late',
        status: 'committed',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('账本容量上限 1000 条，超出后按到达顺序淘汰最早记录', () => {
    for (let i = 0; i < 1001; i++) {
      ledger.record(buildAck(`entry-${i}`));
    }

    expect(ledger.getRecordedAck('entry-0')).toBeUndefined();
    expect(ledger.getRecordedAck('entry-1')).toBeDefined();
    expect(ledger.getRecordedAck('entry-1000')).toBeDefined();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
