import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type {
  ToolkitOrder,
  ToolkitOrderStatistics,
  ToolkitOrderFilters,
  ToolkitOrderDraft,
  ToolkitOrderAction,
  InternalProductOptions,
  ChannelDutyInfo,
  DutyCoordinatorStatus,
  StationIdentity,
  GuardianStats,
} from '../../types';
import {
  fetchToolkitOrders,
  fetchToolkitStatistics,
  fetchToolkitOrderDetails,
  updateToolkitOrder,
  importToolkitOrder,
  deleteToolkitOrder,
  cancelToolkitOrder,
  fetchPropertyProductOptions,
} from '../../services/toolkitOrderApi';
import {
  startDutyByChannel,
  stopDutyByChannel,
  queryDutyStatus,
} from '../../services/dutyBridge';
import { showToast } from './appSlice';
import { addLogs } from './systemLogSlice';

export interface OrderGuardianState {
  orders: ToolkitOrder[];
  total: number;
  loading: boolean;
  error?: string;
  actionLoadingId?: string;

  statistics: ToolkitOrderStatistics;
  statsLoading: boolean;

  filters: ToolkitOrderFilters;

  channelDuty: Record<string, ChannelDutyInfo>;
  coordinatorStatus: DutyCoordinatorStatus;
  station: StationIdentity | null;

  activeEditOrder: ToolkitOrder | null;
  productOptions: InternalProductOptions;
  drawerLoading: boolean;
  drawerSaving: boolean;
  drawerError?: string;
}

const initialFilters: ToolkitOrderFilters = {
  page: 1,
  pageSize: 20,
  status: 'all',
  query: '',
  arrivalStart: '',
  arrivalEnd: '',
};

const initialStatistics: ToolkitOrderStatistics = {
  today: 0,
  pending: 0,
  success: 0,
  failed: 0,
};

const initialChannelDuty: Record<string, ChannelDutyInfo> = {
  MEITUAN: { channelCode: 'MEITUAN', status: 'STOPPED' },
  MEITUAN_BIZ: { channelCode: 'MEITUAN_BIZ', status: 'STOPPED' },
  DOUYIN: { channelCode: 'DOUYIN', status: 'STOPPED' },
  CTRIP: { channelCode: 'CTRIP', status: 'STOPPED' },
};

const initialState: OrderGuardianState = {
  orders: [],
  total: 0,
  loading: false,
  error: undefined,
  actionLoadingId: undefined,

  statistics: initialStatistics,
  statsLoading: false,

  filters: initialFilters,

  channelDuty: initialChannelDuty,
  coordinatorStatus: 'STOPPED',
  station: null,

  activeEditOrder: null,
  productOptions: { roomTypes: [], rateCodes: [], reservationTypes: [] },
  drawerLoading: false,
  drawerSaving: false,
  drawerError: undefined,
};

/**
 * 异步拉取订单列表
 */
export const fetchOrdersThunk = createAsyncThunk(
  'orderGuardian/fetchOrders',
  async (overrideFilters: Partial<ToolkitOrderFilters> | undefined, { getState, dispatch, rejectWithValue }) => {
    try {
      const state = getState() as { orderGuardian: OrderGuardianState };
      const filters = { ...state.orderGuardian.filters, ...(overrideFilters || {}) };
      const res = await fetchToolkitOrders(filters);
      return {
        res,
        appliedFilters: {
          ...filters,
          page: res.page,
          pageSize: res.pageSize,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '获取文旅订单失败';
      dispatch(showToast({ type: 'error', title: '获取订单列表失败', description: msg }));
      return rejectWithValue(msg);
    }
  }
);

/**
 * 异步拉取 4 项统计指标
 */
export const fetchStatisticsThunk = createAsyncThunk(
  'orderGuardian/fetchStatistics',
  async (_, { rejectWithValue }) => {
    try {
      return await fetchToolkitStatistics();
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '获取订单统计失败');
    }
  }
);

/**
 * 异步执行订单操作 (单单导入 / 取消 / 删除)
 */
export const executeOrderActionThunk = createAsyncThunk(
  'orderGuardian/executeAction',
  async (
    { id, action }: { id: string; action: ToolkitOrderAction },
    { dispatch, rejectWithValue }
  ) => {
    try {
      if (action === 'IMPORT') {
        await importToolkitOrder(id);
        dispatch(showToast({ type: 'success', title: `订单 ${id} 已成功提交重新导入` }));
      } else if (action === 'DELETE') {
        await deleteToolkitOrder(id);
        dispatch(showToast({ type: 'success', title: `订单 ${id} 已成功删除` }));
      } else if (action === 'CANCEL') {
        await cancelToolkitOrder(id);
        dispatch(showToast({ type: 'success', title: `订单 ${id} 已成功提交取消` }));
      }
      // 成功后自动重新拉取当前列表与统计
      void dispatch(fetchOrdersThunk());
      void dispatch(fetchStatisticsThunk());
      return { id, action };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '执行订单操作失败';
      dispatch(showToast({ type: 'error', title: '操作失败', description: msg }));
      return rejectWithValue({ id, action, error: msg });
    }
  }
);

/**
 * 展开编辑抽屉并并发拉取详情与酒店产品选项
 */
export const loadOrderEditorThunk = createAsyncThunk(
  'orderGuardian/loadEditor',
  async (orderId: string, { rejectWithValue }) => {
    try {
      const order = await fetchToolkitOrderDetails(orderId);
      let productOptions: InternalProductOptions = {
        roomTypes: [],
        rateCodes: [],
        reservationTypes: [],
      };
      if (order.unitId) {
        try {
          productOptions = await fetchPropertyProductOptions(order.unitId);
        } catch {
          // 产品选项若失败保留空列表并在抽屉内提示
        }
      }
      return { order, productOptions };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : '加载订单编辑详情失败');
    }
  }
);

/**
 * 保存编辑订单草稿
 */
export const saveOrderDraftThunk = createAsyncThunk(
  'orderGuardian/saveDraft',
  async (
    { id, draft }: { id: string; draft: ToolkitOrderDraft },
    { dispatch, rejectWithValue }
  ) => {
    try {
      await updateToolkitOrder(id, draft);
      dispatch(showToast({ type: 'success', title: '订单修改已成功保存' }));
      void dispatch(fetchOrdersThunk());
      void dispatch(fetchStatisticsThunk());
      return id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '保存修改失败';
      dispatch(showToast({ type: 'error', title: '保存修改失败', description: msg }));
      return rejectWithValue(msg);
    }
  }
);

/**
 * 切换指定渠道的值守状态 (开始值守 / 停止值守)
 */
export const toggleChannelDutyThunk = createAsyncThunk(
  'orderGuardian/toggleDuty',
  async (channelCode: string, { getState, dispatch, rejectWithValue }) => {
    const code = channelCode.trim().toUpperCase();
    const state = getState() as { orderGuardian: OrderGuardianState };
    const current = state.orderGuardian.channelDuty[code];
    const isRunning = current?.status === 'RUNNING';

    try {
      if (isRunning) {
        await stopDutyByChannel(code);
        dispatch(showToast({ type: 'info', title: `渠道「${code}」值守已停止` }));
      } else {
        await startDutyByChannel(code);
        dispatch(showToast({ type: 'success', title: `渠道「${code}」值守已启动` }));
      }
      return { channelCode: code, nextStatus: isRunning ? ('STOPPED' as const) : ('RUNNING' as const) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '切换渠道值守失败';
      dispatch(showToast({ type: 'error', title: '切换渠道值守失败', description: msg }));
      return rejectWithValue({ channelCode: code, error: msg });
    }
  }
);

/**
 * 同步当前全盘值守状态与调度任务日志
 */
export const syncDutyStatusThunk = createAsyncThunk(
  'orderGuardian/syncStatus',
  async (_, { dispatch }) => {
    const res = await queryDutyStatus();
    if (res.logs && res.logs.length > 0) {
      dispatch(addLogs(res.logs));
    }
    return res;
  }
);

export const orderGuardianSlice = createSlice({
  name: 'orderGuardian',
  initialState,
  reducers: {
    setFilterStatus: (state, action: PayloadAction<string>) => {
      state.filters.status = action.payload;
      state.filters.page = 1;
    },
    setFilterQuery: (state, action: PayloadAction<string>) => {
      state.filters.query = action.payload;
    },
    setDateRange: (state, action: PayloadAction<{ startDate: string; endDate: string }>) => {
      state.filters.arrivalStart = action.payload.startDate;
      state.filters.arrivalEnd = action.payload.endDate;
      state.filters.page = 1;
    },
    setPagination: (state, action: PayloadAction<{ page: number; pageSize?: number }>) => {
      state.filters.page = action.payload.page;
      if (action.payload.pageSize) {
        state.filters.pageSize = action.payload.pageSize;
      }
    },
    resetFilters: (state) => {
      state.filters = { ...initialFilters };
    },
    setFilterUnitId: (state, action: PayloadAction<string | undefined>) => {
      state.filters.unitId = action.payload;
      state.filters.page = 1;
    },
    setFilterChannel: (state, action: PayloadAction<string | undefined>) => {
      state.filters.otaChannel = action.payload;
      state.filters.page = 1;
    },
    closeEditDrawer: (state) => {
      state.activeEditOrder = null;
      state.drawerError = undefined;
      state.drawerSaving = false;
    },
  },
  extraReducers: (builder) => {
    // fetchOrders
    builder
      .addCase(fetchOrdersThunk.pending, (state) => {
        state.loading = true;
        state.error = undefined;
      })
      .addCase(fetchOrdersThunk.fulfilled, (state, action) => {
        state.loading = false;
        state.orders = action.payload.res.records;
        state.total = action.payload.res.total;
        state.filters = action.payload.appliedFilters;
      })
      .addCase(fetchOrdersThunk.rejected, (state, action) => {
        state.loading = false;
        state.error = String(action.payload || '获取订单列表失败');
      });

    // fetchStatistics
    builder
      .addCase(fetchStatisticsThunk.pending, (state) => {
        state.statsLoading = true;
      })
      .addCase(fetchStatisticsThunk.fulfilled, (state, action) => {
        state.statsLoading = false;
        state.statistics = action.payload;
      })
      .addCase(fetchStatisticsThunk.rejected, (state) => {
        state.statsLoading = false;
      });

    // executeAction
    builder
      .addCase(executeOrderActionThunk.pending, (state, action) => {
        state.actionLoadingId = action.meta.arg.id;
      })
      .addCase(executeOrderActionThunk.fulfilled, (state) => {
        state.actionLoadingId = undefined;
      })
      .addCase(executeOrderActionThunk.rejected, (state) => {
        state.actionLoadingId = undefined;
      });

    // loadEditor
    builder
      .addCase(loadOrderEditorThunk.pending, (state) => {
        state.drawerLoading = true;
        state.drawerError = undefined;
      })
      .addCase(loadOrderEditorThunk.fulfilled, (state, action) => {
        state.drawerLoading = false;
        state.activeEditOrder = action.payload.order;
        state.productOptions = action.payload.productOptions;
      })
      .addCase(loadOrderEditorThunk.rejected, (state, action) => {
        state.drawerLoading = false;
        state.drawerError = String(action.payload || '加载编辑详情失败');
      });

    // saveDraft
    builder
      .addCase(saveOrderDraftThunk.pending, (state) => {
        state.drawerSaving = true;
        state.drawerError = undefined;
      })
      .addCase(saveOrderDraftThunk.fulfilled, (state) => {
        state.drawerSaving = false;
        state.activeEditOrder = null;
      })
      .addCase(saveOrderDraftThunk.rejected, (state, action) => {
        state.drawerSaving = false;
        state.drawerError = String(action.payload || '保存订单失败');
      });

    // toggleDuty
    builder
      .addCase(toggleChannelDutyThunk.fulfilled, (state, action) => {
        const { channelCode, nextStatus } = action.payload;
        state.channelDuty[channelCode] = {
          channelCode,
          status: nextStatus,
          lastStartedAt: nextStatus === 'RUNNING' ? Date.now() : undefined,
        };
        const hasRunning = Object.values(state.channelDuty).some((c) => c.status === 'RUNNING');
        state.coordinatorStatus = hasRunning ? 'CLAIMING' : 'STOPPED';
      })
      .addCase(toggleChannelDutyThunk.rejected, (state, action) => {
        const payload = action.payload as { channelCode?: string; error?: string } | undefined;
        if (payload?.channelCode && state.channelDuty[payload.channelCode]) {
          state.channelDuty[payload.channelCode].status = 'DEGRADED';
          state.channelDuty[payload.channelCode].error = payload.error;
        }
      });

    // syncStatus
    builder.addCase(syncDutyStatusThunk.fulfilled, (state, action) => {
      state.coordinatorStatus = action.payload.coordinatorStatus;
      if (action.payload.station !== undefined) {
        state.station = action.payload.station;
      }
      for (const [code, info] of Object.entries(action.payload.channels)) {
        state.channelDuty[code] = info;
      }
    });
  },
});

/**
 * 保持向下兼容 Sidebar 统计指标选择器
 */
export const selectGuardianStats = (state: {
  orderGuardian: { statistics: ToolkitOrderStatistics };
}): GuardianStats => {
  const stats = state.orderGuardian.statistics;
  return {
    todayImported: stats.today,
    pendingConfirm: stats.pending,
    imported: stats.success,
    failed: stats.failed,
    todayTotal: stats.today,
    todaySuccess: stats.success,
    todayFailed: stats.failed,
    pendingManual: stats.failed,
    avgTransferSeconds: 1.2,
  };
};

export const {
  setFilterStatus,
  setFilterQuery,
  setDateRange,
  setPagination,
  resetFilters,
  setFilterUnitId,
  setFilterChannel,
  closeEditDrawer,
} = orderGuardianSlice.actions;

export default orderGuardianSlice.reducer;
