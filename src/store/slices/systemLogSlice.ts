import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import type {
  SystemLogEntry,
  LogLevel,
  LogModule,
  TaskActionStage,
  LogFilterParams,
  LogQueryCursor,
  LogTimeRange,
} from '../../types';
import { formatLogTimestamp, resolveQueryBounds, matchesLogFilter } from '../../services/logStorage';
import { logger } from '../../services/logger';
import { generateLogId } from '../../utils/logId';
import { getTodayDateString } from '../../utils/logDate';

export interface SystemLogState {
  logs: SystemLogEntry[];
  historicalLogs: SystemLogEntry[] | null;
  isQuerying: boolean;
  isQueryingMore: boolean;
  hasMoreHistorical: boolean;
  nextQueryCursor?: LogQueryCursor;
  activeRequestId: string | null;
  queryError: string | null;
  filterLevel: 'ALL' | LogLevel;
  filterModule: 'ALL' | LogModule;
  filterStartDate: string;
  filterEndDate: string;
  filterTimeRange: LogTimeRange;
  filterTaskStage: 'ALL' | TaskActionStage;
  filterSearch: string;
  isAutoScroll: boolean;
}

const initialToday = getTodayDateString();

const initialState: SystemLogState = {
  logs: [],
  historicalLogs: null,
  isQuerying: false,
  isQueryingMore: false,
  hasMoreHistorical: false,
  nextQueryCursor: undefined,
  activeRequestId: null,
  queryError: null,
  filterLevel: 'ALL',
  filterModule: 'ALL',
  filterStartDate: initialToday,
  filterEndDate: initialToday,
  filterTimeRange: '24H',
  filterTaskStage: 'ALL',
  filterSearch: '',
  isAutoScroll: true,
};

/**
 * 启动时从浏览器 IndexedDB 异步水合今日的真实持久化日志（默认加载前 500 条）
 */
export const hydrateLogsFromStorage = createAsyncThunk(
  'systemLog/hydrateLogsFromStorage',
  async () => {
    const today = getTodayDateString();
    const result = await logger.queryLogs({ startDate: today, endDate: today }, { pageSize: 500 });
    return result.items;
  }
);

/**
 * 按多维过滤条件从浏览器 IndexedDB 持久化存储查询历史日志（支持游标流式分页）
 */
export const queryLogsFromStorage = createAsyncThunk(
  'systemLog/queryLogsFromStorage',
  async (filterParams: LogFilterParams | undefined) => {
    return logger.queryLogs(filterParams, { pageSize: 200 });
  }
);

/**
 * 加载更多历史持久化日志（根据 nextQueryCursor 增量游标继续遍历）
 */
export const loadMoreHistoricalLogs = createAsyncThunk(
  'systemLog/loadMoreHistoricalLogs',
  async (_, { getState }) => {
    const state = (getState() as { systemLog: SystemLogState }).systemLog;
    if (!state.nextQueryCursor || state.isQueryingMore) {
      return null;
    }
    const today = getTodayDateString();
    const hasCustomDate = Boolean(
      (state.filterStartDate && state.filterStartDate !== today) ||
      (state.filterEndDate && state.filterEndDate !== today)
    );
    const filterParams: LogFilterParams = {
      level: state.filterLevel,
      module: state.filterModule,
      startDate: hasCustomDate ? state.filterStartDate : undefined,
      endDate: hasCustomDate ? state.filterEndDate : undefined,
      timeRange: hasCustomDate ? undefined : state.filterTimeRange,
      taskActionStage: state.filterTaskStage,
      search: state.filterSearch,
    };
    return logger.queryLogs(filterParams, {
      pageSize: 200,
      cursor: state.nextQueryCursor,
    });
  }
);

/**
 * 彻底清空所有日志（包括内存日志流、logger 缓冲与 IndexedDB 持久化存储）
 */
export const clearAllLogs = createAsyncThunk(
  'systemLog/clearAllLogs',
  async () => {
    await logger.clearAll();
  }
);

function matchesActiveFilter(
  entry: SystemLogEntry,
  state: SystemLogState
): boolean {
  const today = getTodayDateString();
  const hasCustomDate = Boolean(
    (state.filterStartDate && state.filterStartDate !== today) ||
    (state.filterEndDate && state.filterEndDate !== today)
  );
  const filterParams: LogFilterParams = {
    level: state.filterLevel,
    module: state.filterModule,
    startDate: hasCustomDate ? state.filterStartDate : undefined,
    endDate: hasCustomDate ? state.filterEndDate : undefined,
    timeRange: hasCustomDate ? undefined : state.filterTimeRange,
    taskActionStage: state.filterTaskStage,
    search: state.filterSearch,
  };
  const bounds = resolveQueryBounds(filterParams);
  return matchesLogFilter(entry, filterParams, bounds);
}

function invalidateHistoricalLogs(state: SystemLogState): void {
  state.historicalLogs = null;
  state.hasMoreHistorical = false;
  state.nextQueryCursor = undefined;
  state.queryError = null;
}

export const systemLogSlice = createSlice({
  name: 'systemLog',
  initialState,
  reducers: {
    setFilterLevel: (state, action: PayloadAction<'ALL' | LogLevel>) => {
      state.filterLevel = action.payload;
      invalidateHistoricalLogs(state);
    },
    setFilterModule: (state, action: PayloadAction<'ALL' | LogModule>) => {
      state.filterModule = action.payload;
      invalidateHistoricalLogs(state);
    },
    setFilterStartDate: (state, action: PayloadAction<string>) => {
      state.filterStartDate = action.payload;
      invalidateHistoricalLogs(state);
    },
    setFilterEndDate: (state, action: PayloadAction<string>) => {
      state.filterEndDate = action.payload;
      invalidateHistoricalLogs(state);
    },
    setFilterDateRange: (
      state,
      action: PayloadAction<{ startDate: string; endDate: string }>
    ) => {
      state.filterStartDate = action.payload.startDate;
      state.filterEndDate = action.payload.endDate;
      invalidateHistoricalLogs(state);
    },
    resetDateFilter: (state) => {
      const today = getTodayDateString();
      state.filterStartDate = today;
      state.filterEndDate = today;
      invalidateHistoricalLogs(state);
    },
    setFilterTaskStage: (state, action: PayloadAction<'ALL' | TaskActionStage>) => {
      state.filterTaskStage = action.payload;
      invalidateHistoricalLogs(state);
    },
    setFilterTimeRange: (state, action: PayloadAction<LogTimeRange>) => {
      state.filterTimeRange = action.payload;
      invalidateHistoricalLogs(state);
    },
    resetLogFilters: (state) => {
      const today = getTodayDateString();
      state.filterLevel = 'ALL';
      state.filterModule = 'ALL';
      state.filterStartDate = today;
      state.filterEndDate = today;
      state.filterTimeRange = '24H';
      state.filterTaskStage = 'ALL';
      state.filterSearch = '';
      invalidateHistoricalLogs(state);
    },
    setHistoricalLogs: (state, action: PayloadAction<SystemLogEntry[] | null>) => {
      state.historicalLogs = action.payload;
    },
    setFilterSearch: (state, action: PayloadAction<string>) => {
      state.filterSearch = action.payload;
      invalidateHistoricalLogs(state);
    },
    toggleAutoScroll: (state) => {
      state.isAutoScroll = !state.isAutoScroll;
    },
    addLog: {
      reducer: (state, action: PayloadAction<SystemLogEntry>) => {
        const entry = action.payload;

        if (state.logs.some((l) => l.id === entry.id)) {
          return;
        }

        state.logs.unshift(entry);

        // 实时流内存保留最多 500 条滑动窗口，防止前端内存泄漏
        if (state.logs.length > 500) {
          state.logs.pop();
        }

        // 若当前处于历史持久化查询模式，且新到达日志匹配当前筛选条件，实时同步注入历史视图（无条数上限）
        if (state.historicalLogs !== null && matchesActiveFilter(entry, state)) {
          if (!state.historicalLogs.some((l) => l.id === entry.id)) {
            state.historicalLogs.unshift(entry);
          }
        }
      },
      // id 在 action creator 阶段生成，保证 action.payload 始终是可直接持久化的完整条目
      prepare: (
        input: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'> & {
          id?: string;
          timestamp?: string;
          createdAt?: number;
        }
      ) => {
        const now = new Date();
        const createdAt = input.createdAt ?? now.getTime();

        return {
          payload: {
            ...input,
            id: input.id ?? generateLogId(createdAt),
            timestamp: input.timestamp ?? formatLogTimestamp(new Date(createdAt)),
            createdAt,
          },
        };
      },
    },
    addLogs: (state, action: PayloadAction<SystemLogEntry[]>) => {
      if (!action.payload || action.payload.length === 0) return;
      const existingIds = new Set(state.logs.map((l) => l.id));
      const newEntries: SystemLogEntry[] = [];
      for (const rawItem of action.payload) {
        const item: SystemLogEntry = {
          ...rawItem,
          id: rawItem.id ?? generateLogId(rawItem.createdAt ?? Date.now()),
          createdAt: rawItem.createdAt ?? Date.now(),
          timestamp: rawItem.timestamp ?? formatLogTimestamp(new Date(rawItem.createdAt ?? Date.now())),
        };
        if (!existingIds.has(item.id)) {
          existingIds.add(item.id);
          newEntries.push(item);
        }
      }
      if (newEntries.length === 0) return;
      newEntries.sort((a, b) => b.createdAt - a.createdAt);
      state.logs.unshift(...newEntries);
      if (state.logs.length > 500) {
        state.logs.splice(500);
      }

      if (state.historicalLogs !== null) {
        const histExisting = new Set(state.historicalLogs.map((l) => l.id));
        const matching = newEntries.filter(
          (entry) => !histExisting.has(entry.id) && matchesActiveFilter(entry, state)
        );
        if (matching.length > 0) {
          state.historicalLogs.unshift(...matching);
          // historicalLogs 去除 500 条限制，按天全量保留无遗漏
        }
      }
    },
    clearLogs: (state) => {
      state.logs = [];
      invalidateHistoricalLogs(state);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(hydrateLogsFromStorage.fulfilled, (state, action) => {
        state.logs = action.payload;
      })
      .addCase(queryLogsFromStorage.pending, (state, action) => {
        state.isQuerying = true;
        state.activeRequestId = action.meta?.requestId ?? null;
        state.queryError = null;
      })
      .addCase(queryLogsFromStorage.fulfilled, (state, action) => {
        const reqId = action.meta?.requestId;
        const isCurrentRequest = reqId
          ? state.activeRequestId === reqId
          : !state.activeRequestId;

        if (isCurrentRequest) {
          if (Array.isArray(action.payload)) {
            state.historicalLogs = action.payload;
            state.hasMoreHistorical = false;
            state.nextQueryCursor = undefined;
          } else if (action.payload) {
            state.historicalLogs = action.payload.items;
            state.hasMoreHistorical = action.payload.hasMore;
            state.nextQueryCursor = action.payload.nextCursor;
          }
          state.isQuerying = false;
          state.activeRequestId = null;
          state.queryError = null;
        }
      })
      .addCase(queryLogsFromStorage.rejected, (state, action) => {
        const reqId = action.meta?.requestId;
        const isCurrentRequest = reqId
          ? state.activeRequestId === reqId
          : !state.activeRequestId;

        if (isCurrentRequest) {
          state.isQuerying = false;
          state.activeRequestId = null;
          state.historicalLogs = [];
          state.queryError = action.error?.message || '查询历史日志失败';
        }
      })
      .addCase(loadMoreHistoricalLogs.pending, (state) => {
        state.isQueryingMore = true;
        state.queryError = null;
      })
      .addCase(loadMoreHistoricalLogs.fulfilled, (state, action) => {
        state.isQueryingMore = false;
        if (action.payload) {
          const current = state.historicalLogs ?? [];
          const existingIds = new Set(current.map((l) => l.id));
          const newItems = action.payload.items.filter((l) => !existingIds.has(l.id));
          state.historicalLogs = [...current, ...newItems];
          state.hasMoreHistorical = action.payload.hasMore;
          state.nextQueryCursor = action.payload.nextCursor;
        }
      })
      .addCase(loadMoreHistoricalLogs.rejected, (state, action) => {
        state.isQueryingMore = false;
        state.queryError = action.error.message || '加载更多历史日志失败';
      })
      .addCase(clearAllLogs.pending, (state) => {
        state.logs = [];
        invalidateHistoricalLogs(state);
      })
      .addCase(clearAllLogs.fulfilled, (state) => {
        state.logs = [];
        invalidateHistoricalLogs(state);
      });
  },
});

export const {
  setFilterLevel,
  setFilterModule,
  setFilterStartDate,
  setFilterEndDate,
  setFilterDateRange,
  resetDateFilter,
  setFilterTimeRange,
  setFilterTaskStage,
  resetLogFilters,
  setHistoricalLogs,
  setFilterSearch,
  toggleAutoScroll,
  addLog,
  addLogs,
  clearLogs,
} = systemLogSlice.actions;

export default systemLogSlice.reducer;
