import { describe, it, expect } from 'vitest';
import systemLogReducer, {
  setFilterLevel,
  setFilterModule,
  setFilterEvent,
  setFilterChannel,
  setFilterTimeRange,
  toggleOnlyErrors,
  setFilterSearch,
  toggleAutoScroll,
  addLog,
  addLogs,
  hydrateLogs,
  clearLogs,
  clearAllLogs,
} from '../../../src/store/slices/systemLogSlice';
import { SystemLogEntry } from '../../../src/types';

describe('systemLogSlice', () => {
  it('initializes with clean empty logs and default filter configurations', () => {
    const state = systemLogReducer(undefined, { type: '@@INIT' });

    expect(state.logs).toEqual([]);
    expect(state.filterLevel).toBe('ALL');
    expect(state.filterModule).toBe('ALL');
    expect(state.filterEvent).toBe('ALL');
    expect(state.filterChannel).toBe('ALL');
    expect(state.filterTimeRange).toBe('ALL');
    expect(state.onlyErrors).toBe(false);
    expect(state.filterSearch).toBe('');
    expect(state.isAutoScroll).toBe(true);
    expect(state.storedLogCount).toBe(0);
  });

  describe('filter actions', () => {
    it('updates log level filter accurately', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const errorState = systemLogReducer(initialState, setFilterLevel('ERROR'));
      expect(errorState.filterLevel).toBe('ERROR');

      const playwrightState = systemLogReducer(errorState, setFilterLevel('PLAYWRIGHT'));
      expect(playwrightState.filterLevel).toBe('PLAYWRIGHT');

      const allState = systemLogReducer(playwrightState, setFilterLevel('ALL'));
      expect(allState.filterLevel).toBe('ALL');
    });

    it('updates module and automatically resets event filter if module changed', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      const withEvent = systemLogReducer(initialState, setFilterEvent('ORDER_TRANSFER_PMS_FAILED'));
      expect(withEvent.filterEvent).toBe('ORDER_TRANSFER_PMS_FAILED');

      const moduleChanged = systemLogReducer(withEvent, setFilterModule('AUTH'));
      expect(moduleChanged.filterModule).toBe('AUTH');
      expect(moduleChanged.filterEvent).toBe('ALL');
    });

    it('updates channel and timeRange filters correctly', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const channelState = systemLogReducer(initialState, setFilterChannel('meituan'));
      expect(channelState.filterChannel).toBe('meituan');

      const timeState = systemLogReducer(channelState, setFilterTimeRange('7D'));
      expect(timeState.filterTimeRange).toBe('7D');
    });

    it('toggles onlyErrors flag', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      expect(initialState.onlyErrors).toBe(false);

      const toggled = systemLogReducer(initialState, toggleOnlyErrors());
      expect(toggled.onlyErrors).toBe(true);

      const toggledBack = systemLogReducer(toggled, toggleOnlyErrors());
      expect(toggledBack.onlyErrors).toBe(false);
    });

    it('updates keyword search query', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const searchState = systemLogReducer(initialState, setFilterSearch('DY-20260914-5502'));
      expect(searchState.filterSearch).toBe('DY-20260914-5502');

      const clearedSearchState = systemLogReducer(searchState, setFilterSearch(''));
      expect(clearedSearchState.filterSearch).toBe('');
    });

    it('toggles auto scroll flag between true and false', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      expect(initialState.isAutoScroll).toBe(true);

      const disabledState = systemLogReducer(initialState, toggleAutoScroll());
      expect(disabledState.isAutoScroll).toBe(false);

      const enabledState = systemLogReducer(disabledState, toggleAutoScroll());
      expect(enabledState.isAutoScroll).toBe(true);
    });
  });

  describe('addLog', () => {
    it('prepends a new log entry with generated id, timestamp, and createdAt', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const nextState = systemLogReducer(
        initialState,
        addLog({
          level: 'INFO',
          module: 'ORDER',
          event: 'ORDER_POLL_SUCCESS',
          channelId: 'meituan',
          orderNo: 'MT-20260916-001',
          message: '[CrawlerEngine] 手动触发拉取完成',
          details: '拉取到 2 个待处理新订单',
          durationMs: 340,
        })
      );

      expect(nextState.logs.length).toBe(1);
      expect(nextState.storedLogCount).toBe(1);

      const newLog = nextState.logs[0];
      expect(newLog.id).toMatch(/^log-\d+-[a-z0-9]+$/);
      // 验证日期时间格式为 YYYY-MM-DD HH:mm:ss.SSS
      expect(newLog.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(typeof newLog.createdAt).toBe('number');
      expect(newLog.createdAt).toBeGreaterThan(0);
      expect(newLog.level).toBe('INFO');
      expect(newLog.module).toBe('ORDER');
      expect(newLog.event).toBe('ORDER_POLL_SUCCESS');
      expect(newLog.channelId).toBe('meituan');
      expect(newLog.orderNo).toBe('MT-20260916-001');
      expect(newLog.message).toBe('[CrawlerEngine] 手动触发拉取完成');
      expect(newLog.details).toBe('拉取到 2 个待处理新订单');
      expect(newLog.durationMs).toBe(340);
    });

    it('enforces maximum 500 logs cap by dropping the oldest log when exceeded', () => {
      const fullLogs: SystemLogEntry[] = Array.from({ length: 500 }, (_, index) => ({
        id: `existing-log-${index}`,
        timestamp: '2026-09-16 10:00:00.000',
        createdAt: 1726452000000 + index,
        level: 'INFO',
        message: `Existing log entry #${index}`,
      }));

      const stateAtCap = {
        ...systemLogReducer(undefined, { type: '@@INIT' }),
        logs: fullLogs,
        storedLogCount: 500,
      };

      expect(stateAtCap.logs.length).toBe(500);
      expect(stateAtCap.logs[0].id).toBe('existing-log-0');
      expect(stateAtCap.logs[499].id).toBe('existing-log-499');

      // 插入第 501 条新日志
      const nextState = systemLogReducer(
        stateAtCap,
        addLog({
          level: 'WARN',
          channelId: 'douyin',
          message: 'Cap overflow test log',
        })
      );

      // 断言日志总数被严格保持在 500 条上限
      expect(nextState.logs.length).toBe(500);
      expect(nextState.storedLogCount).toBe(501);

      // 断言新插入的日志位于队首
      expect(nextState.logs[0].message).toBe('Cap overflow test log');
      expect(nextState.logs[0].level).toBe('WARN');

      // 断言最老的一条日志 (existing-log-499) 被弹出丢弃
      expect(nextState.logs.some((l) => l.id === 'existing-log-499')).toBe(false);
      expect(nextState.logs[499].id).toBe('existing-log-498');
    });

    it('preserves task metadata including taskId, msgType, taskActionStage, taskStatus, and taskResult', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const nextState = systemLogReducer(
        initialState,
        addLog({
          level: 'SUCCESS',
          module: 'DUTY_TASK',
          event: 'DUTY_TASK_EXECUTE_SUCCESS',
          message: '[任务结果 RESULT] 任务 OTA_IMPORT_ORDER 执行成功',
          taskId: 'task-abc-123',
          msgType: 'OTA_IMPORT_ORDER',
          taskActionStage: 'RESULT',
          taskStatus: 'SUCCEEDED',
          taskResult: { imported: true, pmsOrderNo: 'PMS-001' },
        })
      );

      expect(nextState.logs.length).toBe(1);
      const log = nextState.logs[0];
      expect(log.taskId).toBe('task-abc-123');
      expect(log.msgType).toBe('OTA_IMPORT_ORDER');
      expect(log.taskActionStage).toBe('RESULT');
      expect(log.taskStatus).toBe('SUCCEEDED');
      expect(log.taskResult).toEqual({ imported: true, pmsOrderNo: 'PMS-001' });
    });

    it('deduplicates logs when adding an entry with an existing id', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const firstState = systemLogReducer(
        initialState,
        addLog({
          id: 'log-dedup-1',
          level: 'INFO',
          message: '原始消息',
        })
      );
      expect(firstState.logs.length).toBe(1);

      // 再次添加相同 id 的日志，应当被去重跳过
      const secondState = systemLogReducer(
        firstState,
        addLog({
          id: 'log-dedup-1',
          level: 'INFO',
          message: '重复消息',
        })
      );
      expect(secondState.logs.length).toBe(1);
      expect(secondState.logs[0].message).toBe('原始消息');
    });
  });

  describe('addLogs batch', () => {
    it('appends multiple logs in batch while skipping existing duplicates', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const existingLog: SystemLogEntry = {
        id: 'log-batch-1',
        timestamp: '2026-09-17 12:00:00.000',
        createdAt: 1000,
        level: 'INFO',
        message: 'Existing log 1',
      };

      const withExisting = systemLogReducer(initialState, hydrateLogs([existingLog]));
      expect(withExisting.logs.length).toBe(1);

      const batch: SystemLogEntry[] = [
        existingLog, // 重复项
        {
          id: 'log-batch-2',
          timestamp: '2026-09-17 12:01:00.000',
          createdAt: 2000,
          level: 'SUCCESS',
          module: 'DUTY_TASK',
          taskActionStage: 'CLAIM',
          msgType: 'OTA_COLLECT_ORDER',
          message: 'New batch log 2',
        },
        {
          id: 'log-batch-3',
          timestamp: '2026-09-17 12:02:00.000',
          createdAt: 3000,
          level: 'SUCCESS',
          module: 'DUTY_TASK',
          taskActionStage: 'RESULT',
          taskStatus: 'SUCCEEDED',
          msgType: 'OTA_COLLECT_ORDER',
          message: 'New batch log 3',
        },
      ];

      const afterBatch = systemLogReducer(withExisting, addLogs(batch));
      expect(afterBatch.logs.length).toBe(3);
      // 最新创建的应位于队首
      expect(afterBatch.logs[0].id).toBe('log-batch-3');
      expect(afterBatch.logs[1].id).toBe('log-batch-2');
      expect(afterBatch.logs[2].id).toBe('log-batch-1');
    });
  });

  describe('hydrateLogs', () => {
    it('populates state logs from storage history batch', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      const mockHistory: SystemLogEntry[] = [
        {
          id: 'hist-1',
          timestamp: '2026-09-16 12:00:00.000',
          createdAt: 1726459200000,
          level: 'SUCCESS',
          module: 'AUTH',
          event: 'AUTH_LOGIN_SUCCESS',
          message: '历史登录成功',
        },
      ];

      const hydrated = systemLogReducer(initialState, hydrateLogs(mockHistory));
      expect(hydrated.logs.length).toBe(1);
      expect(hydrated.logs[0].id).toBe('hist-1');
      expect(hydrated.logs[0].message).toBe('历史登录成功');
    });
  });

  describe('clearLogs and clearAllLogs', () => {
    it('clears active logs and resets storedLogCount to 0 in state', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      const withLog = systemLogReducer(
        initialState,
        addLog({
          level: 'INFO',
          message: '临时日志',
        })
      );
      expect(withLog.logs.length).toBe(1);
      expect(withLog.storedLogCount).toBe(1);

      const clearedState = systemLogReducer(withLog, clearLogs());
      expect(clearedState.logs).toEqual([]);
      expect(clearedState.logs.length).toBe(0);
      expect(clearedState.storedLogCount).toBe(0);
    });

    it('resets logs and storedLogCount when clearAllLogs is pending or fulfilled', () => {
      const withLog = {
        ...systemLogReducer(undefined, { type: '@@INIT' }),
        logs: [
          {
            id: 'log-1',
            timestamp: '2026-09-17 12:00:00.000',
            createdAt: 1000,
            level: 'INFO' as const,
            message: '测试待清理日志',
          },
        ],
        storedLogCount: 1,
      };

      const pendingState = systemLogReducer(withLog, {
        type: clearAllLogs.pending.type,
      });
      expect(pendingState.logs).toEqual([]);
      expect(pendingState.storedLogCount).toBe(0);

      const fulfilledState = systemLogReducer(withLog, {
        type: clearAllLogs.fulfilled.type,
      });
      expect(fulfilledState.logs).toEqual([]);
      expect(fulfilledState.storedLogCount).toBe(0);
    });
  });
});
