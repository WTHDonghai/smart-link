import { describe, it, expect } from 'vitest';
import systemLogReducer, {
  setFilterLevel,
  setFilterModule,
  setFilterSearch,
  setFilterStartDate,
  setFilterEndDate,
  setFilterDateRange,
  resetDateFilter,
  setFilterTaskStage,
  resetLogFilters,
  toggleAutoScroll,
  addLog,
  addLogs,
  clearLogs,
  clearAllLogs,
  hydrateLogsFromStorage,
} from '../../../src/store/slices/systemLogSlice';
import type { SystemLogEntry, TaskActionStage } from '../../../src/types';

function createInitialState() {
  return systemLogReducer(undefined, { type: '@@INIT' });
}

describe('systemLogSlice', () => {
  it('initializes with clean empty logs and default filter configurations', () => {
    const state = createInitialState();

    expect(state.logs).toEqual([]);
    expect(state.filterLevel).toBe('ALL');
    expect(state.filterModule).toBe('ALL');
    expect(state.filterStartDate).toBe('');
    expect(state.filterEndDate).toBe('');
    expect(state.filterTaskStage).toBe('ALL');
    expect(state.filterSearch).toBe('');
    expect(state.isAutoScroll).toBe(true);
  });

  describe('filter actions', () => {
    it('updates log level filter accurately', () => {
      const initialState = createInitialState();

      const errorState = systemLogReducer(initialState, setFilterLevel('ERROR'));
      expect(errorState.filterLevel).toBe('ERROR');

      const playwrightState = systemLogReducer(errorState, setFilterLevel('PLAYWRIGHT'));
      expect(playwrightState.filterLevel).toBe('PLAYWRIGHT');

      const allState = systemLogReducer(playwrightState, setFilterLevel('ALL'));
      expect(allState.filterLevel).toBe('ALL');
    });

    it('updates module and task stage filters accurately', () => {
      const initialState = createInitialState();

      const moduleState = systemLogReducer(initialState, setFilterModule('AUTH'));
      expect(moduleState.filterModule).toBe('AUTH');

      const validStage: 'ALL' | TaskActionStage = 'order-import-submit';
      const stageState = systemLogReducer(moduleState, setFilterTaskStage(validStage));
      expect(stageState.filterTaskStage).toBe('order-import-submit');
      expect(stageState.filterModule).toBe('AUTH');
    });

    it('updates date range filters and resets them independently', () => {
      const initialState = createInitialState();

      const rangeState = systemLogReducer(
        initialState,
        setFilterDateRange({ startDate: '2026-09-10', endDate: '2026-09-18' })
      );
      expect(rangeState.filterStartDate).toBe('2026-09-10');
      expect(rangeState.filterEndDate).toBe('2026-09-18');

      const startOnly = systemLogReducer(rangeState, setFilterStartDate('2026-09-12'));
      expect(startOnly.filterStartDate).toBe('2026-09-12');
      expect(startOnly.filterEndDate).toBe('2026-09-18');

      const endOnly = systemLogReducer(startOnly, setFilterEndDate('2026-09-20'));
      expect(endOnly.filterEndDate).toBe('2026-09-20');

      const dateReset = systemLogReducer(endOnly, resetDateFilter());
      expect(dateReset.filterStartDate).toBe('');
      expect(dateReset.filterEndDate).toBe('');
    });

    it('updates keyword search query', () => {
      const initialState = createInitialState();

      const searchState = systemLogReducer(initialState, setFilterSearch('DY-20260914-5502'));
      expect(searchState.filterSearch).toBe('DY-20260914-5502');

      const clearedSearchState = systemLogReducer(searchState, setFilterSearch(''));
      expect(clearedSearchState.filterSearch).toBe('');
    });

    it('resets every filter dimension back to defaults', () => {
      const dirtyState = systemLogReducer(
        systemLogReducer(
          systemLogReducer(createInitialState(), setFilterLevel('ERROR')),
          setFilterModule('ORDER')
        ),
        setFilterDateRange({ startDate: '2026-09-10', endDate: '2026-09-18' })
      );
      const withSearch = systemLogReducer(dirtyState, setFilterSearch('丽呈酒店'));
      const withStage = systemLogReducer(withSearch, setFilterTaskStage('claim'));

      const reset = systemLogReducer(withStage, resetLogFilters());

      expect(reset.filterLevel).toBe('ALL');
      expect(reset.filterModule).toBe('ALL');
      expect(reset.filterStartDate).toBe('');
      expect(reset.filterEndDate).toBe('');
      expect(reset.filterTaskStage).toBe('ALL');
      expect(reset.filterSearch).toBe('');
      expect(reset.isAutoScroll).toBe(withStage.isAutoScroll);
    });

    it('toggles auto scroll flag between true and false', () => {
      const initialState = createInitialState();
      expect(initialState.isAutoScroll).toBe(true);

      const disabledState = systemLogReducer(initialState, toggleAutoScroll());
      expect(disabledState.isAutoScroll).toBe(false);

      const enabledState = systemLogReducer(disabledState, toggleAutoScroll());
      expect(enabledState.isAutoScroll).toBe(true);
    });
  });

  describe('addLog', () => {
    it('prepends a new log entry with generated id, timestamp, and createdAt', () => {
      const initialState = createInitialState();

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

      const newLog = nextState.logs[0];
      expect(newLog.id).toMatch(/^log-\d+-[a-z0-9]+$/);
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
        ...createInitialState(),
        logs: fullLogs,
      };

      expect(stateAtCap.logs.length).toBe(500);
      expect(stateAtCap.logs[0].id).toBe('existing-log-0');
      expect(stateAtCap.logs[499].id).toBe('existing-log-499');

      const nextState = systemLogReducer(
        stateAtCap,
        addLog({
          level: 'WARN',
          channelId: 'douyin',
          message: 'Cap overflow test log',
        })
      );

      expect(nextState.logs.length).toBe(500);

      expect(nextState.logs[0].message).toBe('Cap overflow test log');
      expect(nextState.logs[0].level).toBe('WARN');

      expect(nextState.logs.some((l) => l.id === 'existing-log-499')).toBe(false);
      expect(nextState.logs[499].id).toBe('existing-log-498');
    });

    it('preserves task metadata including taskId, msgType, taskActionStage, taskStatus, and taskResult', () => {
      const initialState = createInitialState();

      const nextState = systemLogReducer(
        initialState,
        addLog({
          level: 'SUCCESS',
          module: 'DUTY_TASK',
          event: 'DUTY_TASK_EXECUTE_SUCCESS',
          message: '[任务结果 result] 任务 OTA_IMPORT_ORDER 执行成功',
          taskId: 'task-abc-123',
          msgType: 'OTA_IMPORT_ORDER',
          taskActionStage: 'result',
          taskStatus: 'SUCCEEDED',
          taskResult: { imported: true, pmsOrderNo: 'PMS-001' },
        })
      );

      expect(nextState.logs.length).toBe(1);
      const log = nextState.logs[0];
      expect(log.taskId).toBe('task-abc-123');
      expect(log.msgType).toBe('OTA_IMPORT_ORDER');
      expect(log.taskActionStage).toBe('result');
      expect(log.taskStatus).toBe('SUCCEEDED');
      expect(log.taskResult).toEqual({ imported: true, pmsOrderNo: 'PMS-001' });
    });

    it('deduplicates logs when adding an entry with an existing id', () => {
      const initialState = createInitialState();

      const firstState = systemLogReducer(
        initialState,
        addLog({
          id: 'log-dedup-1',
          level: 'INFO',
          message: '原始消息',
        })
      );
      expect(firstState.logs.length).toBe(1);

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
      const existingLog: SystemLogEntry = {
        id: 'log-batch-1',
        timestamp: '2026-09-17 12:00:00.000',
        createdAt: 1000,
        level: 'INFO',
        message: 'Existing log 1',
      };

      const withExisting = systemLogReducer(createInitialState(), addLogs([existingLog]));
      expect(withExisting.logs.length).toBe(1);

      const batch: SystemLogEntry[] = [
        existingLog,
        {
          id: 'log-batch-2',
          timestamp: '2026-09-17 12:01:00.000',
          createdAt: 2000,
          level: 'SUCCESS',
          module: 'DUTY_TASK',
          taskActionStage: 'claim',
          msgType: 'OTA_COLLECT_ORDER',
          message: 'New batch log 2',
        },
        {
          id: 'log-batch-3',
          timestamp: '2026-09-17 12:02:00.000',
          createdAt: 3000,
          level: 'SUCCESS',
          module: 'DUTY_TASK',
          taskActionStage: 'result',
          taskStatus: 'SUCCEEDED',
          msgType: 'OTA_COLLECT_ORDER',
          message: 'New batch log 3',
        },
      ];

      const afterBatch = systemLogReducer(withExisting, addLogs(batch));
      expect(afterBatch.logs.length).toBe(3);
      expect(afterBatch.logs[0].id).toBe('log-batch-3');
      expect(afterBatch.logs[1].id).toBe('log-batch-2');
      expect(afterBatch.logs[2].id).toBe('log-batch-1');
    });

    it('caps batch insertion at 500 logs and keeps the newest entries', () => {
      const existingLogs: SystemLogEntry[] = Array.from({ length: 499 }, (_, index) => ({
        id: `cap-log-${index}`,
        timestamp: '2026-09-17 12:00:00.000',
        createdAt: 1000 + index,
        level: 'INFO',
        message: `Cap log ${index}`,
      }));
      const seeded = systemLogReducer(createInitialState(), addLogs(existingLogs));

      const incoming: SystemLogEntry[] = [
        {
          id: 'cap-incoming-old',
          timestamp: '2026-09-17 13:00:00.000',
          createdAt: 5000,
          level: 'WARN',
          message: 'incoming older',
        },
        {
          id: 'cap-incoming-new',
          timestamp: '2026-09-17 13:01:00.000',
          createdAt: 6000,
          level: 'ERROR',
          message: 'incoming newer',
        },
      ];

      const afterBatch = systemLogReducer(seeded, addLogs(incoming));

      expect(afterBatch.logs.length).toBe(500);
      expect(afterBatch.logs[0].id).toBe('cap-incoming-new');
      expect(afterBatch.logs[1].id).toBe('cap-incoming-old');
      expect(afterBatch.logs.some((l) => l.id === 'cap-log-0')).toBe(false);
    });
  });

  describe('hydrateLogsFromStorage', () => {
    it('populates state logs from storage history batch', () => {
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

      const hydrated = systemLogReducer(createInitialState(), {
        type: hydrateLogsFromStorage.fulfilled.type,
        payload: mockHistory,
      });

      expect(hydrated.logs.length).toBe(1);
      expect(hydrated.logs[0].id).toBe('hist-1');
      expect(hydrated.logs[0].message).toBe('历史登录成功');
    });
  });

  describe('clearLogs and clearAllLogs', () => {
    it('clears active logs from state', () => {
      const initialState = createInitialState();
      const withLog = systemLogReducer(
        initialState,
        addLog({
          level: 'INFO',
          message: '临时日志',
        })
      );
      expect(withLog.logs.length).toBe(1);

      const clearedState = systemLogReducer(withLog, clearLogs());
      expect(clearedState.logs).toEqual([]);
    });

    it('resets logs when clearAllLogs is pending or fulfilled', () => {
      const withLog = {
        ...createInitialState(),
        logs: [
          {
            id: 'log-1',
            timestamp: '2026-09-17 12:00:00.000',
            createdAt: 1000,
            level: 'INFO' as const,
            message: '测试待清理日志',
          },
        ],
      };

      const pendingState = systemLogReducer(withLog, {
        type: clearAllLogs.pending.type,
      });
      expect(pendingState.logs).toEqual([]);

      const fulfilledState = systemLogReducer(withLog, {
        type: clearAllLogs.fulfilled.type,
      });
      expect(fulfilledState.logs).toEqual([]);
    });
  });
});
