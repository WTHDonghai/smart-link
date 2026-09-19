import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import type { SystemLogEntry, LogLevel, LogModule, TaskActionStage } from '../../types';
import { logStorage, formatLogTimestamp } from '../../services/logStorage';
import { logger } from '../../services/logger';
import { generateLogId } from '../../utils/logId';

export interface SystemLogState {
  logs: SystemLogEntry[];
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
    return logStorage.queryLogs(undefined, { limit: 300 });
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
      for (const item of action.payload) {
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
    },
    clearLogs: (state) => {
      state.logs = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(hydrateLogsFromStorage.fulfilled, (state, action) => {
        state.logs = action.payload;
      })
      .addCase(clearAllLogs.pending, (state) => {
        state.logs = [];
      })
      .addCase(clearAllLogs.fulfilled, (state) => {
        state.logs = [];
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
  setFilterSearch,
  toggleAutoScroll,
  addLog,
  addLogs,
  clearLogs,
} = systemLogSlice.actions;

export default systemLogSlice.reducer;
