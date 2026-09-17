import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { SystemLogEntry, LogLevel, LogModule } from '../../types';
import { logStorage, formatLogTimestamp } from '../../services/logStorage';

export interface SystemLogState {
  logs: SystemLogEntry[];
  filterLevel: 'ALL' | LogLevel;
  filterModule: 'ALL' | LogModule;
  filterEvent: 'ALL' | string;
  filterChannel: 'ALL' | string;
  filterTimeRange: 'ALL' | '1D' | '3D' | '7D';
  onlyErrors: boolean;
  filterSearch: string;
  isAutoScroll: boolean;
  storedLogCount: number;
  isLoadingHistory: boolean;
}

const initialState: SystemLogState = {
  logs: [],
  filterLevel: 'ALL',
  filterModule: 'ALL',
  filterEvent: 'ALL',
  filterChannel: 'ALL',
  filterTimeRange: 'ALL',
  onlyErrors: false,
  filterSearch: '',
  isAutoScroll: true,
  storedLogCount: 0,
  isLoadingHistory: false,
};

/**
 * 启动时从浏览器 IndexedDB 异步水合最近 7 天内的真实持久化日志
 */
export const hydrateLogsFromStorage = createAsyncThunk(
  'systemLog/hydrateLogsFromStorage',
  async () => {
    const [recentLogs, totalCount] = await Promise.all([
      logStorage.queryLogs(undefined, { limit: 300 }),
      logStorage.countLogs(),
    ]);
    return { recentLogs, totalCount };
  }
);

/**
 * 清理早于 7 天前的全部历史日志并刷新统计
 */
export const purgeExpiredLogs = createAsyncThunk(
  'systemLog/purgeExpiredLogs',
  async () => {
    const purgedCount = await logStorage.purgeLogsOlderThan7Days();
    const remainingCount = await logStorage.countLogs();
    return { purgedCount, remainingCount };
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
      // 切换模块时若选中的事件不属于该模块，重置事件过滤
      state.filterEvent = 'ALL';
    },
    setFilterEvent: (state, action: PayloadAction<'ALL' | string>) => {
      state.filterEvent = action.payload;
    },
    setFilterChannel: (state, action: PayloadAction<'ALL' | string>) => {
      state.filterChannel = action.payload;
    },
    setFilterTimeRange: (state, action: PayloadAction<'ALL' | '1D' | '3D' | '7D'>) => {
      state.filterTimeRange = action.payload;
    },
    toggleOnlyErrors: (state) => {
      state.onlyErrors = !state.onlyErrors;
    },
    setFilterSearch: (state, action: PayloadAction<string>) => {
      state.filterSearch = action.payload;
    },
    toggleAutoScroll: (state) => {
      state.isAutoScroll = !state.isAutoScroll;
    },
    setStoredLogCount: (state, action: PayloadAction<number>) => {
      state.storedLogCount = action.payload;
    },
    addLog: (
      state,
      action: PayloadAction<
        Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'> & {
          id?: string;
          timestamp?: string;
          createdAt?: number;
        }
      >
    ) => {
      const now = new Date();
      const createdAt = action.payload.createdAt ?? now.getTime();
      const timestamp = action.payload.timestamp ?? formatLogTimestamp(now);
      const id = action.payload.id ?? `log-${createdAt}-${Math.random().toString(36).slice(2, 6)}`;

      if (state.logs.some((l) => l.id === id)) {
        return;
      }

      const entry: SystemLogEntry = {
        ...action.payload,
        id,
        createdAt,
        timestamp,
      };

      state.logs.unshift(entry);
      state.storedLogCount += 1;

      // 实时流内存保留最多 500 条
      if (state.logs.length > 500) {
        state.logs.pop();
      }
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
      state.storedLogCount += newEntries.length;
      if (state.logs.length > 500) {
        state.logs.splice(500);
      }
    },
    hydrateLogs: (state, action: PayloadAction<SystemLogEntry[]>) => {
      state.logs = action.payload;
    },
    clearLogs: (state) => {
      state.logs = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(hydrateLogsFromStorage.pending, (state) => {
        state.isLoadingHistory = true;
      })
      .addCase(hydrateLogsFromStorage.fulfilled, (state, action) => {
        state.isLoadingHistory = false;
        state.logs = action.payload.recentLogs;
        state.storedLogCount = action.payload.totalCount;
      })
      .addCase(hydrateLogsFromStorage.rejected, (state) => {
        state.isLoadingHistory = false;
      })
      .addCase(purgeExpiredLogs.fulfilled, (state, action) => {
        state.storedLogCount = action.payload.remainingCount;
      });
  },
});

export const {
  setFilterLevel,
  setFilterModule,
  setFilterEvent,
  setFilterChannel,
  setFilterTimeRange,
  toggleOnlyErrors,
  setFilterSearch,
  toggleAutoScroll,
  setStoredLogCount,
  addLog,
  addLogs,
  hydrateLogs,
  clearLogs,
} = systemLogSlice.actions;

export default systemLogSlice.reducer;
