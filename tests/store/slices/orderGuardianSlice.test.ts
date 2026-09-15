import { describe, it, expect } from 'vitest';
import orderGuardianReducer, {
  OrderGuardianState,
  toggleAutoGuarding,
  setOrderFilterStatus,
  retryOrderTransfer,
  importOrderDirectly,
  updateOrder,
  deleteOrder,
  cancelOrder,
  setSearchKeyword,
  setDateRange,
  resetFilters,
  selectGuardianStats,
} from '../../../src/store/slices/orderGuardianSlice';
import { GuardianOrder } from '../../../src/types';

const createMockOrder = (overrides?: Partial<GuardianOrder>): GuardianOrder => ({
  id: 'ord-test-01',
  otaOrderNo: 'OTA-TEST-1001',
  pmsOrderNo: '',
  channelId: 'meituan',
  channelName: '美团',
  hotelName: '西湖度假酒店',
  roomTypeName: '湖景大床房',
  ratePlanCode: 'BAR',
  guestName: '张三',
  guestPhone: '13800000000',
  checkInDate: '2026-09-15',
  checkOutDate: '2026-09-16',
  nights: 1,
  rooms: 1,
  otaPrice: 500,
  pmsCostPrice: 420,
  profit: 80,
  status: 'failed',
  failureReason: '预订类型不存在',
  remark: '测试订单',
  scrapedAt: '14:30:00',
  transferredAt: '-',
  crawlerDurationMs: 800,
  ...overrides,
});

const createTestState = (orders: GuardianOrder[] = []): OrderGuardianState => ({
  orders,
  isAutoGuarding: false,
  filterStatus: 'all',
  searchKeyword: '',
  startDate: '',
  endDate: '',
});

describe('orderGuardianSlice reducer', () => {
  it('handles initial state with default orders and controls', () => {
    const state = orderGuardianReducer(undefined, { type: '@@INIT' });
    expect(state.isAutoGuarding).toBe(false);
    expect(state.filterStatus).toBe('all');
    expect(state.orders.length).toBeGreaterThan(0);
  });

  it('handles toggleAutoGuarding', () => {
    const initialState = createTestState();
    const stateOn = orderGuardianReducer(initialState, toggleAutoGuarding());
    expect(stateOn.isAutoGuarding).toBe(true);

    const stateOff = orderGuardianReducer(stateOn, toggleAutoGuarding());
    expect(stateOff.isAutoGuarding).toBe(false);
  });

  it('handles setOrderFilterStatus', () => {
    const initialState = createTestState();
    const nextState = orderGuardianReducer(initialState, setOrderFilterStatus('failed'));
    expect(nextState.filterStatus).toBe('failed');
  });

  it('handles updateOrder with precise partial fields', () => {
    const initialOrder = createMockOrder({ id: 'ord-01', guestName: '原始姓名', otaPrice: 300 });
    const initialState = createTestState([initialOrder]);

    const nextState = orderGuardianReducer(
      initialState,
      updateOrder({
        id: 'ord-01',
        guestName: '修改后姓名',
        otaPrice: 550,
        profit: 130,
      })
    );

    const updated = nextState.orders.find((o) => o.id === 'ord-01');
    expect(updated).toBeDefined();
    expect(updated?.guestName).toBe('修改后姓名');
    expect(updated?.otaPrice).toBe(550);
    expect(updated?.profit).toBe(130);
    // Preserves other unmodified fields
    expect(updated?.hotelName).toBe('西湖度假酒店');
    expect(updated?.otaOrderNo).toBe('OTA-TEST-1001');
  });

  it('handles cancelOrder and marks status as cancelled with failure reason', () => {
    const initialOrder = createMockOrder({ id: 'ord-01', status: 'pending' });
    const initialState = createTestState([initialOrder]);

    const nextState = orderGuardianReducer(initialState, cancelOrder('ord-01'));
    const cancelled = nextState.orders.find((o) => o.id === 'ord-01');

    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.failureReason).toBe('用户手动取消');
  });

  it('handles deleteOrder and removes order from list', () => {
    const order1 = createMockOrder({ id: 'ord-01' });
    const order2 = createMockOrder({ id: 'ord-02' });
    const initialState = createTestState([order1, order2]);

    const nextState = orderGuardianReducer(initialState, deleteOrder('ord-01'));
    expect(nextState.orders.length).toBe(1);
    expect(nextState.orders.find((o) => o.id === 'ord-01')).toBeUndefined();
    expect(nextState.orders[0].id).toBe('ord-02');
  });

  describe('Fail-Fast adherence on importOrderDirectly & retryOrderTransfer', () => {
    it('importOrderDirectly updates status to success without generating fake random PMS numbers', () => {
      const failedOrder = createMockOrder({
        id: 'ord-fail',
        pmsOrderNo: '',
        status: 'failed',
        failureReason: 'RatePlan not mapped',
      });
      const initialState = createTestState([failedOrder]);

      const nextState = orderGuardianReducer(initialState, importOrderDirectly('ord-fail'));
      const processed = nextState.orders.find((o) => o.id === 'ord-fail')!;

      expect(processed.status).toBe('success');
      expect(processed.transferredAt).toBe('刚刚 (直接导入)');
      expect(processed.failureReason).toBeUndefined();
      // Verifies no fake Math.random() PMS number was fabricated
      expect(processed.pmsOrderNo).toBe('');
    });

    it('importOrderDirectly preserves existing valid PMS order number', () => {
      const orderWithPms = createMockOrder({
        id: 'ord-pms',
        pmsOrderNo: 'PMS-REAL-998811',
        status: 'failed',
      });
      const initialState = createTestState([orderWithPms]);

      const nextState = orderGuardianReducer(initialState, importOrderDirectly('ord-pms'));
      const processed = nextState.orders.find((o) => o.id === 'ord-pms')!;

      expect(processed.pmsOrderNo).toBe('PMS-REAL-998811');
      expect(processed.status).toBe('success');
    });

    it('retryOrderTransfer updates status to transferred without generating fake random PMS numbers', () => {
      const failedOrder = createMockOrder({
        id: 'ord-retry',
        pmsOrderNo: '',
        status: 'failed',
        failureReason: 'Connection timeout',
      });
      const initialState = createTestState([failedOrder]);

      const nextState = orderGuardianReducer(initialState, retryOrderTransfer('ord-retry'));
      const processed = nextState.orders.find((o) => o.id === 'ord-retry')!;

      expect(processed.status).toBe('transferred');
      expect(processed.transferredAt).toBe('刚刚 (手动重推)');
      expect(processed.failureReason).toBeUndefined();
      expect(processed.pmsOrderNo).toBe('');
    });
  });

  describe('search keyword and date filters', () => {
    it('handles setSearchKeyword, setDateRange, and resetFilters', () => {
      const initialState = createTestState();
      let state = orderGuardianReducer(initialState, setSearchKeyword('张三'));
      state = orderGuardianReducer(
        state,
        setDateRange({ startDate: '2026-09-01', endDate: '2026-09-30' })
      );
      state = orderGuardianReducer(state, setOrderFilterStatus('failed'));

      expect(state.searchKeyword).toBe('张三');
      expect(state.startDate).toBe('2026-09-01');
      expect(state.endDate).toBe('2026-09-30');
      expect(state.filterStatus).toBe('failed');

      const reset = orderGuardianReducer(state, resetFilters());
      expect(reset.searchKeyword).toBe('');
      expect(reset.startDate).toBe('');
      expect(reset.endDate).toBe('');
      expect(reset.filterStatus).toBe('all');
    });
  });
});

describe('selectGuardianStats pure selector', () => {
  it('returns all zeros for empty order collection', () => {
    const stats = selectGuardianStats({
      orderGuardian: createTestState([]),
    });

    expect(stats.todayTotal).toBe(0);
    expect(stats.imported).toBe(0);
    expect(stats.todayImported).toBe(0);
    expect(stats.todaySuccess).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.todayFailed).toBe(0);
    expect(stats.pendingConfirm).toBe(0);
    expect(stats.pendingManual).toBe(0);
  });

  it('correctly aggregates counts across diverse order statuses', () => {
    const orders: GuardianOrder[] = [
      createMockOrder({ id: '1', status: 'success' }),
      createMockOrder({ id: '2', status: 'transferred' }),
      createMockOrder({ id: '3', status: 'confirmed' }),
      createMockOrder({ id: '4', status: 'failed' }),
      createMockOrder({ id: '5', status: 'failed' }),
      createMockOrder({ id: '6', status: 'pending' }),
      createMockOrder({ id: '7', status: 'processing' }),
      createMockOrder({ id: '8', status: 'manual_review' }),
      createMockOrder({ id: '9', status: 'cancelled' }),
    ];

    const stats = selectGuardianStats({
      orderGuardian: createTestState(orders),
    });

    expect(stats.todayTotal).toBe(9);
    // Success / Transferred / Confirmed = 3
    expect(stats.imported).toBe(3);
    expect(stats.todayImported).toBe(3);
    expect(stats.todaySuccess).toBe(3);
    // Failed = 2
    expect(stats.failed).toBe(2);
    expect(stats.todayFailed).toBe(2);
    // Pending / Processing = 2
    expect(stats.pendingConfirm).toBe(2);
    // Manual Review = 1
    expect(stats.pendingManual).toBe(1);
  });

  it('reactively updates metrics when orders are transitioned through reducers', () => {
    const failedOrder = createMockOrder({ id: 'o-1', status: 'failed' });
    let state = createTestState([failedOrder]);

    // Initial check: 1 failed, 0 imported
    let stats = selectGuardianStats({ orderGuardian: state });
    expect(stats.failed).toBe(1);
    expect(stats.imported).toBe(0);

    // Direct import transition: failed -> success
    state = orderGuardianReducer(state, importOrderDirectly('o-1'));
    stats = selectGuardianStats({ orderGuardian: state });
    expect(stats.failed).toBe(0);
    expect(stats.imported).toBe(1);
    expect(stats.todayTotal).toBe(1);

    // Deletion: 1 -> 0
    state = orderGuardianReducer(state, deleteOrder('o-1'));
    stats = selectGuardianStats({ orderGuardian: state });
    expect(stats.todayTotal).toBe(0);
    expect(stats.imported).toBe(0);
    expect(stats.failed).toBe(0);
  });
});
