import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAppStore } from '../../src/store';
import { addLog, addLogs } from '../../src/store/slices/systemLogSlice';
import { logger } from '../../src/services/logger';
import { logStorage } from '../../src/services/logStorage';
import type { SystemLogEntry } from '../../src/types';

function createDutyEntry(id: string, createdAt: number): SystemLogEntry {
  return {
    id,
    timestamp: '2026-09-18 17:30:00.000',
    createdAt,
    level: 'INFO',
    module: 'DUTY_TASK',
    taskActionStage: 'claim',
    orderNo: 'MT-889900',
    message: `值守任务日志 ${id}`,
  };
}

describe('logPersistenceMiddleware 日志持久化唯一入口', () => {
  beforeEach(async () => {
    await logger.clearAll();
  });

  it('主进程 IPC 形态的完整条目经 addLog 进入 Redux 后会被落库', async () => {
    const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
    const store = createAppStore();
    const dutyEntry = createDutyEntry('duty-log-1000-a1b2c', 1000);

    store.dispatch(addLog(dutyEntry));
    await logger.flushStorage();

    expect(store.getState().systemLog.logs[0].id).toBe('duty-log-1000-a1b2c');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toHaveLength(1);
    expect(saveSpy.mock.calls[0][0][0].id).toBe('duty-log-1000-a1b2c');
  });

  it('轮询补发同一批任务日志时按 id 幂等，不会重复入队', async () => {
    const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
    const store = createAppStore();
    const batch = [
      createDutyEntry('duty-log-2000-aaaaa', 2000),
      createDutyEntry('duty-log-2001-bbbbb', 2001),
    ];

    store.dispatch(addLogs(batch));
    store.dispatch(addLogs(batch));
    store.dispatch(addLogs([...batch]));
    await logger.flushStorage();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const savedEntries = saveSpy.mock.calls[0][0];
    expect(savedEntries).toHaveLength(2);
    expect(savedEntries.map((entry) => entry.id)).toEqual([
      'duty-log-2000-aaaaa',
      'duty-log-2001-bbbbb',
    ]);
  });

  it('业务 slice 直接投递的局部日志也会被落库，且 id 在 action creator 阶段生成', async () => {
    const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
    const store = createAppStore();

    store.dispatch(addLog({ level: 'INFO', message: '[HotelMapping] 正在查询门店映射列表' }));
    await logger.flushStorage();

    const storedEntry = store.getState().systemLog.logs[0];
    expect(storedEntry.id).toMatch(/^log-\d+-[a-z0-9]{6}$/);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0][0].id).toBe(storedEntry.id);
  });

  it('本地埋点经 logger.track 产生的日志只入队一次', async () => {
    const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
    const store = createAppStore();
    const unsubscribe = logger.subscribe((entry) => store.dispatch(addLog(entry)));

    logger.track('ORDER_POLL_SUCCESS', { module: 'ORDER', message: '轮询完成' });
    await logger.flushStorage();
    unsubscribe();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toHaveLength(1);
  });
});
