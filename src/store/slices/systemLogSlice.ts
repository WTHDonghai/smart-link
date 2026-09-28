import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import type { SystemLogEntry, LogLevel, LogModule, TaskActionStage, LogFilterParams } from '../../types';
import { formatLogTimestamp, parseDateBounds, matchesLogFilter } from '../../services/logStorage';
import { logger } from '../../services/logger';
import { generateLogId } from '../../utils/logId';

export interface SystemLogState {
  logs: SystemLogEntry[];
  historicalLogs: SystemLogEntry[] | null;
  isQuerying: boolean;
  filterLevel: 'ALL' | LogLevel;
  filterModule: 'ALL' | LogModule;
  filterStartDate: string;
  filterEndDate: string;
  filterTaskStage: 'ALL' | TaskActionStage;
  filterSearch: string;
  isAutoScroll: boolean;
}

const initialState: SystemLogState = {
  logs: [],
  historicalLogs: null,
  isQuerying: false,
  filterLevel: 'ALL',
  filterModule: 'ALL',
  filterStartDate: '',
  filterEndDate: '',
  filterTaskStage: 'ALL',
  filterSearch: '',
  isAutoScroll: true,
};

/**
 * 启动时从浏览器 IndexedDB 异步水合最近 7 天内的真实持久化日志
 */
export const hydrateLogsFromStorage = createAsyncThunk(
  'systemLog/hydrateLogsFromStorage',
  async () => {
    return logger.queryLogs(undefined, { limit: 300 });
  }
);

/**
 * 按多维过滤条件从浏览器 IndexedDB 持久化存储查询完整的历史日志
 */
export const queryLogsFromStorage = createAsyncThunk(
  'systemLog/queryLogsFromStorage',
  async (filterParams: LogFilterParams | undefined) => {
    return logger.queryLogs(filterParams, { limit: 2000 });
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
  const filterParams: LogFilterParams = {
    level: state.filterLevel,
    module: state.filterModule,
    startDate: state.filterStartDate,
    endDate: state.filterEndDate,
    taskActionStage: state.filterTaskStage,
    search: state.filterSearch,
  };
  const bounds = parseDateBounds(state.filterStartDate, state.filterEndDate);
  return matchesLogFilter(entry, filterParams, bounds);
}

export const systemLogSlice = createSlice({
  name: 'systemLog',
  initialState,
  reducers: {
    setFilterLevel: (state, action: PayloadAction<'ALL' | LogLevel>) => {
      state.filterLevel = action.payload;
    },
    setFilterModule: (state, action: PayloadAction<'ALL' | LogModule>) => {
      state.filterModule = action.payload;
    },
    setFilterStartDate: (state, action: PayloadAction<string>) => {
      state.filterStartDate = action.payload;
    },
    setFilterEndDate: (state, action: PayloadAction<string>) => {
      state.filterEndDate = action.payload;
    },
    setFilterDateRange: (
      state,
      action: PayloadAction<{ startDate: string; endDate: string }>
    ) => {
      state.filterStartDate = action.payload.startDate;
      state.filterEndDate = action.payload.endDate;
    },
    resetDateFilter: (state) => {
      state.filterStartDate = '';
      state.filterEndDate = '';
      const hasOtherFilters =
        state.filterLevel !== 'ALL' ||
        state.filterModule !== 'ALL' ||
        Boolean(state.filterSearch && state.filterSearch.trim()) ||
        state.filterTaskStage !== 'ALL';
      if (!hasOtherFilters) {
        state.historicalLogs = null;
      }
    },
    setFilterTaskStage: (state, action: PayloadAction<'ALL' | TaskActionStage>) => {
      state.filterTaskStage = action.payload;
    },
    resetLogFilters: (state) => {
      state.filterLevel = 'ALL';
      state.filterModule = 'ALL';
      state.filterStartDate = '';
      state.filterEndDate = '';
      state.filterTaskStage = 'ALL';
      state.filterSearch = '';
      state.historicalLogs = null;
    },
    setHistoricalLogs: (state, action: PayloadAction<SystemLogEntry[] | null>) => {
      state.historicalLogs = action.payload;
    },
    setFilterSearch: (state, action: PayloadAction<string>) => {
      state.filterSearch = action.payload;
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

        // 实时流内存保留最多 500 条
        if (state.logs.length > 500) {
          state.logs.pop();
        }

        // 若当前处于历史持久化查询模式，且新到达日志匹配当前筛选条件，实时同步注入历史视图
        if (state.historicalLogs !== null && matchesActiveFilter(entry, state)) {
          if (!state.historicalLogs.some((l) => l.id === entry.id)) {
            state.historicalLogs.unshift(entry);
            if (state.historicalLogs.length > 2000) {
              state.historicalLogs.pop();
            }
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
          if (state.historicalLogs.length > 2000) {
            state.historicalLogs.splice(2000);
          }
        }
      }
    },
    clearLogs: (state) => {
      state.logs = [];
      state.historicalLogs = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(hydrateLogsFromStorage.fulfilled, (state, action) => {
        state.logs = action.payload;
      })
      .addCase(queryLogsFromStorage.pending, (state) => {
        state.isQuerying = true;
      })
      .addCase(queryLogsFromStorage.fulfilled, (state, action) => {
        state.historicalLogs = action.payload;
        state.isQuerying = false;
      })
      .addCase(queryLogsFromStorage.rejected, (state) => {
        state.isQuerying = false;
      })
      .addCase(clearAllLogs.pending, (state) => {
        state.logs = [];
        state.historicalLogs = null;
      })
      .addCase(clearAllLogs.fulfilled, (state) => {
        state.logs = [];
        state.historicalLogs = null;
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
