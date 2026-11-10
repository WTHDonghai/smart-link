/**
 * 主进程日志启动缓冲（设计 9.5）：渲染进程完成日志水合前暂存主进程日志。
 *
 * - 普通日志维持既有 50 条上限，超限淘汰最旧；
 * - Agent 关键事件（meta.agent.requiresCommitAck）不进入淘汰路径，独立缓冲直至
 *   被取走——静默丢失会使主进程侧提交确认永久等待，只能靠超时收敛为追踪不完整。
 */

import type { SystemLogEntry } from '../src/types';
import { readAgentTraceMeta } from '../src/types/agent';

const MAX_NORMAL_PENDING = 50;

export class MainLogPendingBuffer {
  private readonly normalEntries = new Map<string, SystemLogEntry>();
  private readonly criticalEntries = new Map<string, SystemLogEntry>();
  private drained = false;

  public get isDrained(): boolean {
    return this.drained;
  }

  public publish(entry: SystemLogEntry): void {
    if (this.drained) return;
    if (readAgentTraceMeta(entry)?.requiresCommitAck) {
      // 同 ID 补发幂等覆盖（Map.set 语义），不淘汰
      this.criticalEntries.set(entry.id, entry);
      return;
    }
    this.normalEntries.delete(entry.id);
    this.normalEntries.set(entry.id, entry);
    if (this.normalEntries.size > MAX_NORMAL_PENDING) {
      const oldestLogId = this.normalEntries.keys().next().value;
      if (oldestLogId !== undefined) {
        this.normalEntries.delete(oldestLogId);
      }
    }
  }

  /** 取走全部暂存（关键事件在前），此后缓冲关闭、publish 不再暂存 */
  public drain(): SystemLogEntry[] {
    this.drained = true;
    const entries = [...this.criticalEntries.values(), ...this.normalEntries.values()];
    this.criticalEntries.clear();
    this.normalEntries.clear();
    return entries;
  }
}
