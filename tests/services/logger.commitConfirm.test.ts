import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { LoggerService } from '../../src/services/logger';
import { logStorage } from '../../src/services/logStorage';
import type { SystemLogEntry } from '../../src/types';

/**
 * Agent 关键事件提交确认语义（设计 9.5）：
 * 仅在 IndexedDB 事务 oncomplete 后解析；失败重试期间保持等待；丢弃时显式拒绝。
 * 仅 Mock 底层 IndexedDB 写入（logStorage.saveLogs）这一不可控 I/O 边界，其余为真实逻辑。
 */

function buildEntry(id: string): SystemLogEntry {
  return {
    id,
    timestamp: '2026-11-02 10:00:00.000',
    createdAt: 1780000000000,
    level: 'INFO',
    message: `[AGENT_TOOL_STARTED] ${id}`,
  };
}

describe('LoggerService.waitForEntryCommit 提交确认', () => {
  let service: LoggerService;
  let saveLogsSpy: MockInstance<(entries: SystemLogEntry[]) => Promise<void>>;

  beforeEach(() => {
    service = new LoggerService();
    saveLogsSpy = vi.spyOn(logStorage, 'saveLogs');
  });

  afterEach(() => {
    saveLogsSpy.mockRestore();
  });

  it('事务提交成功后解析确认；事后补发的确认立即返回', async () => {
    const entry = buildEntry('entry-ok');
    service.persist(entry);
    const confirmation = service.waitForEntryCommit(entry.id);

    await service.flushStorage();
    await expect(confirmation).resolves.toBeUndefined();

    // ACK 丢失后同 ID 补发确认：幂等立即返回
    await expect(service.waitForEntryCommit(entry.id)).resolves.toBeUndefined();
  });

  it('持久化失败时保持等待，重试成功后才解析（不得被转换为成功确认）', async () => {
    saveLogsSpy.mockRejectedValueOnce(new Error('模拟 IndexedDB 事务失败'));

    const entry = buildEntry('entry-retry');
    service.persist(entry);
    const confirmation = service.waitForEntryCommit(entry.id);

    await service.flushStorage();

    // 首次失败：确认仍挂起
    const stillPending = await Promise.race([
      confirmation.then(() => 'resolved' as const),
      Promise.resolve('pending' as const),
    ]);
    expect(stillPending).toBe('pending');

    // 重试成功后解析（mockRejectedValueOnce 消耗后自动回落到真实写入逻辑）
    await service.flushStorage();
    await expect(confirmation).resolves.toBeUndefined();
  });

  it('重试缓冲溢出丢弃时显式拒绝，且丢弃 ID 不再被误判为已提交', async () => {
    const overflowService = new LoggerService({ maxRetryBufferSize: 2 });
    saveLogsSpy.mockRejectedValue(new Error('持续存储故障'));

    const oldest = buildEntry('entry-oldest');
    const kept1 = buildEntry('entry-kept-1');
    const kept2 = buildEntry('entry-kept-2');
    overflowService.persist(oldest);
    overflowService.persist(kept1);
    overflowService.persist(kept2);

    const oldestConfirmation = overflowService.waitForEntryCommit(oldest.id);
    const kept1Confirmation = overflowService.waitForEntryCommit(kept1.id);
    const kept2Confirmation = overflowService.waitForEntryCommit(kept2.id);

    await overflowService.flushStorage();

    await expect(oldestConfirmation).rejects.toThrow('日志持久化失败且重试队列溢出');

    // 存储恢复后，保留条目的确认正常解析
    saveLogsSpy.mockRestore();
    await overflowService.flushStorage();
    await expect(kept1Confirmation).resolves.toBeUndefined();
    await expect(kept2Confirmation).resolves.toBeUndefined();

    // 被丢弃的条目重新投递确认时必须显式拒绝，不得伪装成功
    await expect(overflowService.waitForEntryCommit(oldest.id)).rejects.toThrow(
      '未进入持久化队列'
    );
  });

  it('从未进入持久化队列的 entryId 立即拒绝', async () => {
    await expect(service.waitForEntryCommit('never-queued')).rejects.toThrow(
      '[LoggerService] 日志条目 never-queued 未进入持久化队列，拒绝无效的提交确认'
    );
    await expect(service.waitForEntryCommit('')).rejects.toThrow(
      '[LoggerService] 日志提交确认必须提供 entryId'
    );
  });

  it('日志被清空时，挂起的确认显式拒绝', async () => {
    const entry = buildEntry('entry-clear');
    service.persist(entry);
    const confirmation = service.waitForEntryCommit(entry.id);

    await service.clearAll();

    await expect(confirmation).rejects.toThrow('日志已被清空，无法确认提交');
  });

  it('批量 persistBatch 路径同样支持提交确认', async () => {
    const entries = [buildEntry('batch-1'), buildEntry('batch-2')];
    service.persistBatch(entries);
    const confirmations = Promise.all(entries.map((entry) => service.waitForEntryCommit(entry.id)));

    await service.flushStorage();
    await expect(confirmations).resolves.toEqual([undefined, undefined]);
    expect(saveLogsSpy).toHaveBeenCalledTimes(1);
    expect(saveLogsSpy.mock.calls[0][0].map((entry) => entry.id)).toEqual(['batch-1', 'batch-2']);
  });

  it('应用退出排空成功后解析确认', async () => {
    const entry = buildEntry('entry-shutdown');
    service.persist(entry);
    const confirmation = service.waitForEntryCommit(entry.id);

    await service.prepareForShutdown();
    await expect(confirmation).resolves.toBeUndefined();
  });

  it('flush 进行中注册的等待方在事务完成后被唤醒', async () => {
    // 仅注入受控延迟，验证在途事务期间注册的等待方也能在完成后被唤醒
    saveLogsSpy.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

    const entry = buildEntry('entry-inflight');
    service.persist(entry);
    const flushing = service.flushStorage();

    // flush 已在途，此时注册等待方
    const confirmation = service.waitForEntryCommit(entry.id);
    await flushing;

    await expect(confirmation).resolves.toBeUndefined();
  });
});
