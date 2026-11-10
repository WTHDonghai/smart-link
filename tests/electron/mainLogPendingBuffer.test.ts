import { describe, it, expect } from 'vitest';
import { MainLogPendingBuffer } from '../../electron/mainLogPendingBuffer';
import type { SystemLogEntry } from '../../src/types';

/**
 * 主进程日志启动缓冲（设计 9.5）：
 * 普通日志 50 条上限淘汰最旧；Agent 关键事件（requiresCommitAck）不进入淘汰路径。
 */

function buildEntry(id: string, requiresAck = false): SystemLogEntry {
  return {
    id,
    timestamp: '2026-11-09 12:00:00.000',
    createdAt: 1,
    level: 'INFO',
    message: `日志 ${id}`,
    ...(requiresAck
      ? {
          meta: {
            agent: {
              schemaVersion: 1,
              traceId: 'trace-1',
              runId: 'run-1',
              spanId: 'span-1',
              sequence: 1,
              kind: 'tool',
              phase: 'started',
              occurredAt: '2026-11-09T12:00:00.000Z',
              summary: '工具意图',
              requiresCommitAck: true,
            },
          },
        }
      : {}),
  };
}

describe('MainLogPendingBuffer', () => {
  it('普通日志超过 50 条时淘汰最旧，保留最近 50 条', () => {
    const buffer = new MainLogPendingBuffer();
    for (let i = 1; i <= 60; i++) {
      buffer.publish(buildEntry(`log-${i}`));
    }

    const entries = buffer.drain();
    expect(entries).toHaveLength(50);
    expect(entries[0].id).toBe('log-11');
    expect(entries[49].id).toBe('log-60');
  });

  it('Agent 关键事件不进入淘汰路径：大量普通日志涌入后仍完整保留（设计 9.5）', () => {
    const buffer = new MainLogPendingBuffer();
    buffer.publish(buildEntry('critical-1', true));
    for (let i = 1; i <= 80; i++) {
      buffer.publish(buildEntry(`log-${i}`));
    }
    buffer.publish(buildEntry('critical-2', true));

    const entries = buffer.drain();
    const criticalIds = entries.filter((entry) => entry.id.startsWith('critical')).map((entry) => entry.id);
    // 严密断言：两条关键事件都存活，且排在最前
    expect(criticalIds).toEqual(['critical-1', 'critical-2']);
    expect(entries).toHaveLength(52);
  });

  it('同 ID 重发幂等覆盖，不产生重复条目', () => {
    const buffer = new MainLogPendingBuffer();
    buffer.publish(buildEntry('same-id'));
    buffer.publish({ ...buildEntry('same-id'), message: '更新后的内容' });

    const entries = buffer.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('更新后的内容');
  });

  it('drain 取走全部并关闭缓冲；此后 publish 不再暂存，rearm 语义由新建实例承担', () => {
    const buffer = new MainLogPendingBuffer();
    buffer.publish(buildEntry('before-drain'));
    const drained = buffer.drain();
    expect(drained).toHaveLength(1);
    expect(buffer.isDrained).toBe(true);

    buffer.publish(buildEntry('after-drain'));
    expect(buffer.drain()).toHaveLength(0);
  });
});
