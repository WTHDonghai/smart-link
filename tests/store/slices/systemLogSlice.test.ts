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
  queryLogsFromStorage,
  loadMoreHistoricalLogs,
  setFilterTimeRange,
  setHistoricalLogs,
} from '../../../src/store/slices/systemLogSlice';
import type { SystemLogEntry, TaskActionStage, LogQueryResult } from '../../../src/types';
import { getTodayDateString } from '../../../src/utils/logDate';
import { formatLogTimestamp } from '../../../src/services/logStorage';

function createInitialState() {
  return systemLogReducer(undefined, { type: '@@INIT' });
}

describe('systemLogSlice', () => {
  it('initializes with clean empty logs and default filter configurations', () => {
    const state = createInitialState();

    expect(state.logs).toEqual([]);
    expect(state.filterLevel).toBe('ALL');
    expect(state.filterModule).toBe('ALL');
    expect(state.filterStartDate).toBe(getTodayDateString());
    expect(state.filterEndDate).toBe(getTodayDateString());
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
      expect(dateReset.filterStartDate).toBe(getTodayDateString());
      expect(dateReset.filterEndDate).toBe(getTodayDateString());
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
      expect(reset.filterStartDate).toBe(getTodayDateString());
      expect(reset.filterEndDate).toBe(getTodayDateString());
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

    it('updates historicalLogs via setHistoricalLogs', () => {
      const initialState = createInitialState();
      expect(initialState.historicalLogs).toBeNull();

      const mockLogs: SystemLogEntry[] = [
        { id: 'hist-1', level: 'INFO', message: 'Historical log 1', timestamp: '2026-09-28 10:00:00.000', createdAt: 1789400000000 },
      ];
      const withLogs = systemLogReducer(initialState, setHistoricalLogs(mockLogs));
      expect(withLogs.historicalLogs).toEqual(mockLogs);

      const cleared = systemLogReducer(withLogs, setHistoricalLogs(null));
      expect(cleared.historicalLogs).toBeNull();
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

  describe('queryLogsFromStorage and historicalLogs integration', () => {
    it('updates isQuerying and historicalLogs across lifecycle', () => {
      const initialState = createInitialState();
      expect(initialState.historicalLogs).toBeNull();
      expect(initialState.isQuerying).toBe(false);

      const pending = systemLogReducer(initialState, {
        type: queryLogsFromStorage.pending.type,
      });
      expect(pending.isQuerying).toBe(true);

      const mockResults: SystemLogEntry[] = [
        {
          id: 'hist-stored-1',
          timestamp: '2026-09-10 10:00:00.000',
          createdAt: 1000,
          level: 'INFO',
          module: 'ORDER',
          orderNo: 'MT-HIST-999',
          message: '历史持久化订单日志',
        },
      ];

      const fulfilled = systemLogReducer(pending, {
        type: queryLogsFromStorage.fulfilled.type,
        payload: mockResults,
      });
      expect(fulfilled.isQuerying).toBe(false);
      expect(fulfilled.historicalLogs).toEqual(mockResults);
    });

    it('handles request race conditions by discarding stale responses', () => {
      const initialState = createInitialState();

      // 请求 1 发起
      const pendingReq1 = systemLogReducer(initialState, {
        type: queryLogsFromStorage.pending.type,
        meta: { requestId: 'req-1' },
      });
      expect(pendingReq1.isQuerying).toBe(true);
      expect(pendingReq1.activeRequestId).toBe('req-1');

      // 请求 2 紧接着发起 (覆盖 activeRequestId)
      const pendingReq2 = systemLogReducer(pendingReq1, {
        type: queryLogsFromStorage.pending.type,
        meta: { requestId: 'req-2' },
      });
      expect(pendingReq2.activeRequestId).toBe('req-2');

      const mockResultsReq1: SystemLogEntry[] = [
        {
          id: 'hist-old-1',
          timestamp: '2026-09-10 10:00:00.000',
          createdAt: 1000,
          level: 'INFO',
          message: '陈旧请求 1 结果',
        },
      ];
      const mockResultsReq2: SystemLogEntry[] = [
        {
          id: 'hist-new-2',
          timestamp: '2026-09-10 11:00:00.000',
          createdAt: 2000,
          level: 'INFO',
          message: '最新请求 2 结果',
        },
      ];

      // 陈旧请求 1 较晚返回，应被丢弃
      const staleResponseState = systemLogReducer(pendingReq2, {
        type: queryLogsFromStorage.fulfilled.type,
        payload: mockResultsReq1,
        meta: { requestId: 'req-1' },
      });
      expect(staleResponseState.historicalLogs).toBeNull();
      expect(staleResponseState.isQuerying).toBe(true);
      expect(staleResponseState.activeRequestId).toBe('req-2');

      // 最新请求 2 返回，正常采纳
      const freshResponseState = systemLogReducer(staleResponseState, {
        type: queryLogsFromStorage.fulfilled.type,
        payload: mockResultsReq2,
        meta: { requestId: 'req-2' },
      });
      expect(freshResponseState.historicalLogs).toEqual(mockResultsReq2);
      expect(freshResponseState.isQuerying).toBe(false);
      expect(freshResponseState.activeRequestId).toBeNull();
    });

    it('captures queryError on rejected query and clears error on new pending', () => {
      const initialState = createInitialState();
      const pending = systemLogReducer(initialState, {
        type: queryLogsFromStorage.pending.type,
        meta: { requestId: 'req-err' },
      });
      expect(pending.queryError).toBeNull();

      const rejected = systemLogReducer(pending, {
        type: queryLogsFromStorage.rejected.type,
        meta: { requestId: 'req-err' },
        error: { message: 'IndexedDB transaction aborted' },
      });
      expect(rejected.isQuerying).toBe(false);
      expect(rejected.queryError).toBe('IndexedDB transaction aborted');
      expect(rejected.historicalLogs).toEqual([]);

      const nextPending = systemLogReducer(rejected, {
        type: queryLogsFromStorage.pending.type,
        meta: { requestId: 'req-retry' },
      });
      expect(nextPending.queryError).toBeNull();
      expect(nextPending.isQuerying).toBe(true);
    });

    it('invalidates historicalLogs immediately when filter criteria changes during pending query', () => {
      const stateWithOldLogs = {
        ...createInitialState(),
        historicalLogs: [
          {
            id: 'hist-old',
            timestamp: '2026-09-10 10:00:00.000',
            createdAt: 1000,
            level: 'INFO' as const,
            message: '旧筛选结果',
          },
        ],
        filterLevel: 'INFO' as const,
      };

      const updated = systemLogReducer(stateWithOldLogs, setFilterLevel('ERROR'));
      expect(updated.historicalLogs).toBeNull();
      expect(updated.filterLevel).toBe('ERROR');
    });

    it('clears historicalLogs when resetLogFilters or resetDateFilter without other filters is dispatched', () => {
      const stateWithHist = {
        ...createInitialState(),
        historicalLogs: [
          {
            id: 'hist-1',
            timestamp: '2026-09-10 10:00:00.000',
            createdAt: 1000,
            level: 'INFO' as const,
            message: '历史记录',
          },
        ],
        filterStartDate: '2026-09-10',
        filterEndDate: '2026-09-12',
      };

      const resetFilters = systemLogReducer(stateWithHist, resetLogFilters());
      expect(resetFilters.historicalLogs).toBeNull();

      const resetDate = systemLogReducer(stateWithHist, resetDateFilter());
      expect(resetDate.historicalLogs).toBeNull();
    });

    it('synchronizes incoming live logs into historicalLogs when matching current filter', () => {
      const stateWithFilter = {
        ...createInitialState(),
        filterLevel: 'ERROR' as const,
        historicalLogs: [
          {
            id: 'hist-err-1',
            timestamp: '2026-09-10 10:00:00.000',
            createdAt: 1000,
            level: 'ERROR' as const,
            message: '历史错误日志 1',
          },
        ],
      };

      // 1. 匹配 ERROR 筛选条件的日志被同步注入 historicalLogs
      const nextMatching = systemLogReducer(
        stateWithFilter,
        addLog({
          id: 'live-err-2',
          level: 'ERROR',
          message: '新增实时错误日志',
        })
      );
      expect(nextMatching.logs[0].id).toBe('live-err-2');
      expect(nextMatching.historicalLogs?.[0].id).toBe('live-err-2');
      expect(nextMatching.historicalLogs?.length).toBe(2);

      // 2. 不匹配的 INFO 日志只进入 logs，不污染 historicalLogs
      const nextUnmatched = systemLogReducer(
        nextMatching,
        addLog({
          id: 'live-info-3',
          level: 'INFO',
          message: '新增常规信息日志',
        })
      );
      expect(nextUnmatched.logs[0].id).toBe('live-info-3');
      expect(nextUnmatched.historicalLogs?.some((l) => l.id === 'live-info-3')).toBe(false);
      expect(nextUnmatched.historicalLogs?.length).toBe(2);
    });

    it('does not inject older logs outside of filterTimeRange into historicalLogs', () => {
      const now = Date.now();
      const stateWith1HFilter = {
        ...createInitialState(),
        filterTimeRange: '1H' as const,
        historicalLogs: [
          {
            id: 'hist-recent-1',
            timestamp: formatLogTimestamp(new Date(now - 1000)),
            createdAt: now - 1000,
            level: 'INFO' as const,
            message: '近 1 小时内的日志',
          },
        ],
      };

      // 产生一条 2 小时前的日志（例如补发或积压日志）
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      const nextState = systemLogReducer(
        stateWith1HFilter,
        addLog({
          id: 'old-backlog-log',
          createdAt: twoHoursAgo,
          timestamp: formatLogTimestamp(new Date(twoHoursAgo)),
          level: 'INFO',
          message: '2小时前的积压日志',
        })
      );

      // 该日志会进入全局 logs 流
      expect(nextState.logs[0].id).toBe('old-backlog-log');
      // 但绝不应混入当前限制为 1H 的 historicalLogs
      expect(nextState.historicalLogs?.some((l) => l.id === 'old-backlog-log')).toBe(false);
      expect(nextState.historicalLogs?.length).toBe(1);
    });

    it('clears both logs and historicalLogs when clearLogs or clearAllLogs is executed', () => {
      const stateWithData = {
        ...createInitialState(),
        logs: [
          {
            id: 'log-1',
            timestamp: '2026-09-10 10:00:00.000',
            createdAt: 1000,
            level: 'INFO' as const,
            message: '实时日志',
          },
        ],
        historicalLogs: [
          {
            id: 'hist-1',
            timestamp: '2026-09-10 09:00:00.000',
            createdAt: 900,
            level: 'INFO' as const,
            message: '历史日志',
          },
        ],
      };

      const cleared = systemLogReducer(stateWithData, clearLogs());
      expect(cleared.logs).toEqual([]);
      expect(cleared.historicalLogs).toBeNull();

      const allCleared = systemLogReducer(stateWithData, {
        type: clearAllLogs.fulfilled.type,
      });
      expect(allCleared.logs).toEqual([]);
      expect(allCleared.historicalLogs).toBeNull();
    });

    it('handles streaming pagination lifecycle with loadMoreHistoricalLogs and updates nextQueryCursor', () => {
      const state = createInitialState();

      // 第一页 fulfilled
      const firstPageResult: LogQueryResult = {
        items: [
          {
            id: 'log-page1-01',
            timestamp: '2026-09-29 10:00:00.000',
            createdAt: 2000,
            level: 'INFO',
            message: '第一页日志 1',
          },
          {
            id: 'log-page1-02',
            timestamp: '2026-09-29 09:59:00.000',
            createdAt: 1900,
            level: 'INFO',
            message: '第一页日志 2',
          },
        ],
        hasMore: true,
        nextCursor: { createdAt: 1900, id: 'log-page1-02' },
        totalScanned: 2,
      };

      const withPage1 = systemLogReducer(state, {
        type: queryLogsFromStorage.fulfilled.type,
        payload: firstPageResult,
      });
      expect(withPage1.historicalLogs?.length).toBe(2);
      expect(withPage1.hasMoreHistorical).toBe(true);
      expect(withPage1.nextQueryCursor).toEqual({ createdAt: 1900, id: 'log-page1-02' });

      // 加载更多 pending
      const loadingMore = systemLogReducer(withPage1, {
        type: loadMoreHistoricalLogs.pending.type,
      });
      expect(loadingMore.isQueryingMore).toBe(true);

      // 加载更多 fulfilled
      const secondPageResult: LogQueryResult = {
        items: [
          {
            id: 'log-page2-01',
            timestamp: '2026-09-29 09:58:00.000',
            createdAt: 1800,
            level: 'INFO',
            message: '第二页日志 1',
          },
        ],
        hasMore: false,
        nextCursor: undefined,
        totalScanned: 1,
      };

      const withPage2 = systemLogReducer(loadingMore, {
        type: loadMoreHistoricalLogs.fulfilled.type,
        payload: secondPageResult,
      });
      expect(withPage2.isQueryingMore).toBe(false);
      expect(withPage2.historicalLogs?.length).toBe(3);
      expect(withPage2.hasMoreHistorical).toBe(false);
      expect(withPage2.nextQueryCursor).toBeUndefined();
    });

    it('discards stale responses that arrive after a newer request has already fulfilled and cleared activeRequestId', () => {
      const state = createInitialState();

      // 1. 发起请求 1 (req-1)
      const stateReq1 = systemLogReducer(state, {
        type: queryLogsFromStorage.pending.type,
        meta: { requestId: 'req-1' },
      });
      expect(stateReq1.activeRequestId).toBe('req-1');

      // 2. 用户快速切换条件，发起请求 2 (req-2)
      const stateReq2 = systemLogReducer(stateReq1, {
        type: queryLogsFromStorage.pending.type,
        meta: { requestId: 'req-2' },
      });
      expect(stateReq2.activeRequestId).toBe('req-2');

      // 3. 请求 2 较快返回 fulfilled，写入最新结果
      const stateFulfilled2 = systemLogReducer(stateReq2, {
        type: queryLogsFromStorage.fulfilled.type,
        meta: { requestId: 'req-2' },
        payload: {
          items: [
            {
              id: 'log-req2-01',
              timestamp: '2026-10-01 10:00:00.000',
              createdAt: 2000,
              level: 'INFO',
              message: '新请求 2 结果',
            },
          ],
          hasMore: false,
          totalScanned: 1,
        },
      });
      expect(stateFulfilled2.historicalLogs?.[0].id).toBe('log-req2-01');
      expect(stateFulfilled2.activeRequestId).toBeNull();

      // 4. 迟到的请求 1 返回 fulfilled，携带陈旧数据
      const stateStaleFulfilled1 = systemLogReducer(stateFulfilled2, {
        type: queryLogsFromStorage.fulfilled.type,
        meta: { requestId: 'req-1' },
        payload: {
          items: [
            {
              id: 'log-req1-01',
              timestamp: '2026-10-01 09:00:00.000',
              createdAt: 1000,
              level: 'WARN',
              message: '陈旧请求 1 结果',
            },
          ],
          hasMore: false,
          totalScanned: 1,
        },
      });

      // 严格断言：请求 1 的陈旧结果必须被丢弃，保留请求 2 的结果
      expect(stateStaleFulfilled1.historicalLogs?.[0].id).toBe('log-req2-01');
      expect(stateStaleFulfilled1.historicalLogs?.[0].message).toBe('新请求 2 结果');
    });

    it('updates and resets filterTimeRange cleanly', () => {
      const state = createInitialState();
      expect(state.filterTimeRange).toBe('24H');

      const updated = systemLogReducer(state, setFilterTimeRange('3D'));
      expect(updated.filterTimeRange).toBe('3D');

      const reset = systemLogReducer(updated, resetLogFilters());
      expect(reset.filterTimeRange).toBe('24H');
      expect(reset.hasMoreHistorical).toBe(false);
      expect(reset.nextQueryCursor).toBeUndefined();
    });
  });
});

