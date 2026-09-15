import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { GuardianOrder, GuardianStats, OrderStatus } from '../../types';
import { INITIAL_GUARDIAN_ORDERS } from '../../mocks/mockOrders';
import { isOrderSuccess } from '../../utils/orderHelpers';

export interface OrderGuardianState {
  orders: GuardianOrder[];
  isAutoGuarding: boolean;
  filterStatus: 'all' | OrderStatus;
  searchKeyword: string;
  startDate: string;
  endDate: string;
}

const initialState: OrderGuardianState = {
  isAutoGuarding: false,
  filterStatus: 'all',
  searchKeyword: '',
  startDate: '',
  endDate: '',
  orders: INITIAL_GUARDIAN_ORDERS
};

export const orderGuardianSlice = createSlice({
  name: 'orderGuardian',
  initialState,
  reducers: {
    toggleAutoGuarding: (state) => {
      state.isAutoGuarding = !state.isAutoGuarding;
    },
    setOrderFilterStatus: (state, action: PayloadAction<'all' | OrderStatus>) => {
      state.filterStatus = action.payload;
    },
    retryOrderTransfer: (state, action: PayloadAction<string>) => {
      const ord = state.orders.find(o => o.id === action.payload);
      if (ord) {
        ord.status = 'transferred';
        ord.transferredAt = '刚刚 (手动重推)';
        ord.failureReason = undefined;
        if (!ord.pmsOrderNo) {
          ord.pmsOrderNo = '';
        }
      }
    },
    importOrderDirectly: (state, action: PayloadAction<string>) => {
      const ord = state.orders.find(o => o.id === action.payload);
      if (ord) {
        ord.status = 'success';
        ord.transferredAt = '刚刚 (直接导入)';
        ord.failureReason = undefined;
        if (!ord.pmsOrderNo) {
          ord.pmsOrderNo = '';
        }
      }
    },
    updateOrder: (state, action: PayloadAction<Partial<GuardianOrder> & { id: string }>) => {
      const index = state.orders.findIndex(o => o.id === action.payload.id);
      if (index !== -1) {
        const prev = state.orders[index];
        const updated = { ...prev, ...action.payload };
        state.orders[index] = updated;
      }
    },
    deleteOrder: (state, action: PayloadAction<string>) => {
      state.orders = state.orders.filter(o => o.id !== action.payload);
    },
    cancelOrder: (state, action: PayloadAction<string>) => {
      const ord = state.orders.find(o => o.id === action.payload);
      if (ord) {
        ord.status = 'cancelled';
        ord.failureReason = '用户手动取消';
      }
    },
    setSearchKeyword: (state, action: PayloadAction<string>) => {
      state.searchKeyword = action.payload;
    },
    setDateRange: (state, action: PayloadAction<{ startDate: string; endDate: string }>) => {
      state.startDate = action.payload.startDate;
      state.endDate = action.payload.endDate;
    },
    resetFilters: (state) => {
      state.filterStatus = 'all';
      state.searchKeyword = '';
      state.startDate = '';
      state.endDate = '';
    }
  }
});

export const selectGuardianStats = (state: { orderGuardian: { orders: GuardianOrder[] } }): GuardianStats => {
  const orders = state.orderGuardian.orders;
  let todayImported = 0;
  let imported = 0;
  let failed = 0;
  let pendingConfirm = 0;
  let pendingManual = 0;

  for (const order of orders) {
    if (isOrderSuccess(order.status)) {
      imported += 1;
      todayImported += 1;
    } else if (order.status === 'failed') {
      failed += 1;
    } else if (order.status === 'pending' || order.status === 'processing' || order.status === 'importing') {
      pendingConfirm += 1;
    } else if (order.status === 'manual_review') {
      pendingManual += 1;
    }
  }

  return {
    todayImported,
    imported,
    failed,
    pendingConfirm,
    todayTotal: orders.length,
    todaySuccess: imported,
    todayFailed: failed,
    pendingManual,
    avgTransferSeconds: 1.2
  };
};

export const {
  toggleAutoGuarding,
  setOrderFilterStatus,
  retryOrderTransfer,
  importOrderDirectly,
  updateOrder,
  deleteOrder,
  cancelOrder,
  setSearchKeyword,
  setDateRange,
  resetFilters
} = orderGuardianSlice.actions;

export default orderGuardianSlice.reducer;

