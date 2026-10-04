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

  it('本地埋点经 logger.track 产生的真实业务日志只入队一次', async () => {
    const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
    const store = createAppStore();
    const unsubscribe = logger.subscribe((entry) => store.dispatch(addLog(entry)));

    logger.track('AUTH_LOGIN_SUCCESS', { module: 'AUTH', message: '文旅平台登录成功' });
    await logger.flushStorage();
    unsubscribe();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toHaveLength(1);
    expect(saveSpy.mock.calls[0][0][0].event).toBe('AUTH_LOGIN_SUCCESS');
  });

  describe('心跳与轮询噪声过滤规则 (shouldPersist)', () => {
    it('常规高频轮询与状态报告 (INFO 级别) 被拦截，不写入存储', async () => {
      const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
      const store = createAppStore();

      // 派发常规高频心跳与轮询事件
      store.dispatch(addLog({
        level: 'INFO',
        event: 'ORDER_POLL_START',
        message: '开始长轮询任务认领',
      }));
      store.dispatch(addLog({
        level: 'INFO',
        event: 'ORDER_POLL_SUCCESS',
        message: '轮询未认领到新任务',
      }));
      store.dispatch(addLog({
        level: 'INFO',
        event: 'DUTY_ACTUAL_STATE_REPORT',
        taskActionStage: 'report',
        message: '工位 actual-state/report 上报正常',
      }));
      store.dispatch(addLog({
        level: 'INFO',
        event: 'PLAYWRIGHT_HEARTBEAT',
        message: '前台浏览器探活正常',
      }));
      store.dispatch(addLog({
        level: 'INFO',
        event: 'AUTH_TOKEN_REFRESH',
        message: '[Auth] 平台访问凭证 (AccessToken) 自动续期成功',
      }));

      await logger.flushStorage();

      // 严密断言：上述 5 条常规噪声（含凭证正常自动续期）均未进入持久化存储
      expect(saveSpy).not.toHaveBeenCalled();
      // 但内存实时流中仍正常存在以供值守控制台观察
      expect(store.getState().systemLog.logs).toHaveLength(5);
    });

    it('心跳或凭证续期发生 WARN 或 ERROR 异常时坚决落库，绝不掩盖系统故障', async () => {
      const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
      const store = createAppStore();

      // 派发带有心跳与凭证事件名但级别为 ERROR 和 WARN 的异常
      store.dispatch(addLog({
        level: 'ERROR',
        event: 'DUTY_ACTUAL_STATE_REPORT',
        taskActionStage: 'report',
        message: '[值守心跳] actual-state/report 上报异常: 网络超时',
      }));
      store.dispatch(addLog({
        level: 'WARN',
        event: 'ORDER_POLL_START',
        message: '长轮询重试超限告警',
      }));
      store.dispatch(addLog({
        level: 'ERROR',
        event: 'AUTH_TOKEN_REFRESH',
        message: '[Auth] 平台访问凭证 (AccessToken) 自动续期失败: invalid_grant',
      }));

      await logger.flushStorage();

      // 严密断言：异常事件被 100% 坚决落库
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved).toHaveLength(3);
      expect(saved[0].level).toBe('ERROR');
      expect(saved[1].level).toBe('WARN');
      expect(saved[2].level).toBe('ERROR');
      expect(saved[2].event).toBe('AUTH_TOKEN_REFRESH');
    });

    it('关键自愈事件 (DUTY_ACTUAL_STATE_REPORT_RECOVERED) 与启停里程碑坚决落库形成闭环审计', async () => {
      const saveSpy = vi.spyOn(logStorage, 'saveLogs').mockResolvedValue(undefined);
      const store = createAppStore();

      store.dispatch(addLog({
        level: 'INFO',
        event: 'DUTY_HEARTBEAT_STARTED',
        message: '[值守心跳] 心跳服务已启动',
      }));
      store.dispatch(addLog({
        level: 'INFO',
        event: 'DUTY_ACTUAL_STATE_REPORT_RECOVERED',
        message: '[值守心跳] 网络恢复，工位状态上报恢复正常',
      }));
      store.dispatch(addLog({
        level: 'INFO',
        event: 'DUTY_HEARTBEAT_STOPPED',
        message: '[值守心跳] 心跳服务已停止',
      }));

      await logger.flushStorage();

      // 严密断言：自愈与启停 3 个关键里程碑全量落库
      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved).toHaveLength(3);
      expect(saved.map((s) => s.event)).toEqual([
        'DUTY_HEARTBEAT_STARTED',
        'DUTY_ACTUAL_STATE_REPORT_RECOVERED',
        'DUTY_HEARTBEAT_STOPPED',
      ]);
    });
  });
});
