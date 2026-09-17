import { describe, it, expect } from 'vitest';
import orderGuardianReducer, {
  setFilterStatus,
  setFilterQuery,
  setDateRange,
  setPagination,
  resetFilters,
  closeEditDrawer,
  fetchOrdersThunk,
  fetchStatisticsThunk,
  loadOrderEditorThunk,
  saveOrderDraftThunk,
  toggleChannelDutyThunk,
  syncDutyStatusThunk,
  selectGuardianStats,
} from '../../../src/store/slices/orderGuardianSlice';
import type { ToolkitOrder } from '../../../src/types';

const mockOrder: ToolkitOrder = {
  id: 'ord_1',
  unitId: 'unit_10',
  unitName: '西湖度假酒店',
  otaChannel: 'MEITUAN',
  otaOrderId: 'MT1001',
  contact: { name: '张三', mobile: '13800001111' },
  booking: {
    arrival: '2026-10-01',
    departure: '2026-10-02',
    roomType: '大床房',
    rateCode: 'BAR',
    paytype: 'PREPAY',
    nights: 1,
    quantity: 1,
    totalPrice: 200,
    pricing: [{ date: '2026-10-01', price: 200 }],
  },
  status: 'FAILED',
  allowedActions: ['EDIT', 'IMPORT', 'DELETE'],
};

describe('orderGuardianSlice reducer', () => {
  it('initializes with default filters, zero stats, and stopped channels', () => {
    const state = orderGuardianReducer(undefined, { type: '@@INIT' });
    expect(state.orders).toEqual([]);
    expect(state.total).toBe(0);
    expect(state.loading).toBe(false);
    expect(state.filters.status).toBe('all');
    expect(state.filters.page).toBe(1);
    expect(state.statistics).toEqual({ today: 0, pending: 0, success: 0, failed: 0 });
    expect(state.channelDuty.MEITUAN.status).toBe('STOPPED');
    expect(state.coordinatorStatus).toBe('STOPPED');
  });

  describe('filter and pagination actions', () => {
    it('handles setFilterStatus and resets page to 1', () => {
      const state1 = orderGuardianReducer(undefined, setPagination({ page: 5 }));
      const state2 = orderGuardianReducer(state1, setFilterStatus('FAILED'));
      expect(state2.filters.status).toBe('FAILED');
      expect(state2.filters.page).toBe(1);
    });

    it('handles setFilterQuery', () => {
      const state = orderGuardianReducer(undefined, setFilterQuery('张三'));
      expect(state.filters.query).toBe('张三');
    });

    it('handles setDateRange', () => {
      const state = orderGuardianReducer(
        undefined,
        setDateRange({ startDate: '2026-10-01', endDate: '2026-10-05' })
      );
      expect(state.filters.arrivalStart).toBe('2026-10-01');
      expect(state.filters.arrivalEnd).toBe('2026-10-05');
      expect(state.filters.page).toBe(1);
    });

    it('handles setPagination', () => {
      const state = orderGuardianReducer(undefined, setPagination({ page: 3, pageSize: 50 }));
      expect(state.filters.page).toBe(3);
      expect(state.filters.pageSize).toBe(50);
    });

    it('handles resetFilters', () => {
      let state = orderGuardianReducer(undefined, setFilterStatus('SUCCESS'));
      state = orderGuardianReducer(state, setFilterQuery('订单123'));
      state = orderGuardianReducer(state, resetFilters());
      expect(state.filters.status).toBe('all');
      expect(state.filters.query).toBe('');
      expect(state.filters.page).toBe(1);
    });

    it('handles closeEditDrawer', () => {
      const stateWithDrawer = {
        ...orderGuardianReducer(undefined, { type: '@@INIT' }),
        activeEditOrder: mockOrder,
        drawerSaving: true,
      };
      const next = orderGuardianReducer(stateWithDrawer, closeEditDrawer());
      expect(next.activeEditOrder).toBeNull();
      expect(next.drawerSaving).toBe(false);
    });
  });

  describe('thunk action reducers', () => {
    it('handles fetchOrdersThunk fulfilled', () => {
      const action = {
        type: fetchOrdersThunk.fulfilled.type,
        payload: {
          res: {
            records: [mockOrder],
            total: 1,
            page: 1,
            pageSize: 20,
          },
          appliedFilters: {
            page: 1,
            pageSize: 20,
            status: 'FAILED',
            query: '',
            arrivalStart: '',
            arrivalEnd: '',
          },
        },
      };

      const next = orderGuardianReducer(undefined, action);
      expect(next.loading).toBe(false);
      expect(next.orders).toEqual([mockOrder]);
      expect(next.total).toBe(1);
      expect(next.filters.status).toBe('FAILED');
    });

    it('handles fetchStatisticsThunk fulfilled', () => {
      const action = {
        type: fetchStatisticsThunk.fulfilled.type,
        payload: { today: 10, pending: 2, success: 7, failed: 1 },
      };
      const next = orderGuardianReducer(undefined, action);
      expect(next.statsLoading).toBe(false);
      expect(next.statistics).toEqual({ today: 10, pending: 2, success: 7, failed: 1 });
    });

    it('handles loadOrderEditorThunk fulfilled', () => {
      const action = {
        type: loadOrderEditorThunk.fulfilled.type,
        payload: {
          order: mockOrder,
          productOptions: {
            roomTypes: [{ code: 'R1', name: '大床房' }],
            rateCodes: [],
            reservationTypes: [],
          },
        },
      };
      const next = orderGuardianReducer(undefined, action);
      expect(next.drawerLoading).toBe(false);
      expect(next.activeEditOrder).toEqual(mockOrder);
      expect(next.productOptions.roomTypes).toHaveLength(1);
    });

    it('handles saveOrderDraftThunk fulfilled', () => {
      const stateWithEditor = {
        ...orderGuardianReducer(undefined, { type: '@@INIT' }),
        activeEditOrder: mockOrder,
        drawerSaving: true,
      };
      const action = {
        type: saveOrderDraftThunk.fulfilled.type,
        payload: 'ord_1',
      };
      const next = orderGuardianReducer(stateWithEditor, action);
      expect(next.drawerSaving).toBe(false);
      expect(next.activeEditOrder).toBeNull();
    });

    it('handles toggleChannelDutyThunk fulfilled and updates coordinator status', () => {
      const actionRun = {
        type: toggleChannelDutyThunk.fulfilled.type,
        payload: { channelCode: 'MEITUAN', nextStatus: 'RUNNING' },
      };
      const next = orderGuardianReducer(undefined, actionRun);
      expect(next.channelDuty.MEITUAN.status).toBe('RUNNING');
      expect(next.coordinatorStatus).toBe('CLAIMING');

      const actionStop = {
        type: toggleChannelDutyThunk.fulfilled.type,
        payload: { channelCode: 'MEITUAN', nextStatus: 'STOPPED' },
      };
      const stopped = orderGuardianReducer(next, actionStop);
      expect(stopped.channelDuty.MEITUAN.status).toBe('STOPPED');
      expect(stopped.coordinatorStatus).toBe('STOPPED');
    });

    it('handles syncDutyStatusThunk fulfilled', () => {
      const action = {
        type: syncDutyStatusThunk.fulfilled.type,
        payload: {
          channels: {
            CTRIP: { channelCode: 'CTRIP', status: 'RUNNING' as const },
          },
          coordinatorStatus: 'CLAIMING' as const,
        },
      };
      const next = orderGuardianReducer(undefined, action);
      expect(next.coordinatorStatus).toBe('CLAIMING');
      expect(next.channelDuty.CTRIP?.status).toBe('RUNNING');
    });
  });

  describe('selectGuardianStats selector', () => {
    it('maps statistics to GuardianStats for Sidebar compatibility', () => {
      const mockState = {
        orderGuardian: {
          statistics: { today: 15, pending: 3, success: 10, failed: 2 },
        },
      };
      const stats = selectGuardianStats(mockState);
      expect(stats.todayImported).toBe(15);
      expect(stats.pendingConfirm).toBe(3);
      expect(stats.imported).toBe(10);
      expect(stats.failed).toBe(2);
      expect(stats.pendingManual).toBe(2);
    });
  });
});
