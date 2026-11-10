/**
 * 主进程 Agent 日志提交确认账本（P1 追踪基础）。
 *
 * 依据 docs/architecture/llm-agent-integration-design.md 第 9.5 节：
 * 执行可改变页面或发送通知的工具前，主进程必须先发射带稳定 entry.id 的工具意图事件，
 * 并等待渲染进程完成该事件对应的 IndexedDB 事务后回传的提交确认；
 * 未收到 committed 确认前不得执行动作。确认超时按追踪不完整处理并暂停后续动作。
 *
 * 本模块是纯状态账本，不依赖 Electron API，便于 100% 真实逻辑单测；
 * IPC 通道绑定与发送方校验由 electron/main.ts 完成。
 */

import type { AgentLogPersistedAck } from '@/src/types/agent';

/** 确认账本容量上限；超出后按到达顺序淘汰最早记录，防止内存无界增长 */
const MAX_ACK_LEDGER_ENTRIES = 1000;

/** 默认确认等待上限：超过即视为追踪不完整，调用方必须暂停后续动作 */
export const DEFAULT_ACK_TIMEOUT_MS = 30_000;

interface AckWaiter {
  resolve: (ack: AgentLogPersistedAck) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class AgentTraceLedgerService {
  private acksByEntryId = new Map<string, AgentLogPersistedAck>();
  private waitersByEntryId = new Map<string, AckWaiter[]>();

  /** 记录一条来自受信任渲染进程的提交确认，并唤醒所有等待方 */
  record(ack: AgentLogPersistedAck): void {
    this.acksByEntryId.set(ack.entryId, ack);
    if (this.acksByEntryId.size > MAX_ACK_LEDGER_ENTRIES) {
      const oldestEntryId = this.acksByEntryId.keys().next().value;
      if (oldestEntryId !== undefined) {
        this.acksByEntryId.delete(oldestEntryId);
      }
    }

    const waiters = this.waitersByEntryId.get(ack.entryId);
    if (!waiters || waiters.length === 0) return;
    this.waitersByEntryId.delete(ack.entryId);
    for (const waiter of waiters) {
      if (waiter.timer !== null) clearTimeout(waiter.timer);
      waiter.resolve(ack);
    }
  }

  /**
   * 等待指定日志条目的提交确认。
   * 已记录的直接返回；未记录的挂起等待，超时显式拒绝（调用方据此暂停动作并标记追踪不完整）。
   */
  waitForLogCommitAck(entryId: string, options?: { timeoutMs?: number }): Promise<AgentLogPersistedAck> {
    const recorded = this.acksByEntryId.get(entryId);
    if (recorded) {
      return Promise.resolve(recorded);
    }

    const timeoutMs = options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_ACK_TIMEOUT_MS;

    return new Promise<AgentLogPersistedAck>((resolve, reject) => {
      const waiter: AckWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeWaiter(entryId, waiter);
          reject(new Error(`等待 Agent 日志提交确认超时（entryId=${entryId}）`));
        }, timeoutMs),
      };

      const waiters = this.waitersByEntryId.get(entryId);
      if (waiters) {
        waiters.push(waiter);
      } else {
        this.waitersByEntryId.set(entryId, [waiter]);
      }
    });
  }

  /** 查询某条目是否已有确认记录（不等待） */
  getRecordedAck(entryId: string): AgentLogPersistedAck | undefined {
    return this.acksByEntryId.get(entryId);
  }

  private removeWaiter(entryId: string, waiter: AckWaiter): void {
    if (waiter.timer !== null) {
      clearTimeout(waiter.timer);
      waiter.timer = null;
    }
    const waiters = this.waitersByEntryId.get(entryId);
    if (!waiters) return;
    const next = waiters.filter((item) => item !== waiter);
    if (next.length === 0) {
      this.waitersByEntryId.delete(entryId);
    } else {
      this.waitersByEntryId.set(entryId, next);
    }
  }
}

export const agentTraceLedger = new AgentTraceLedgerService();
