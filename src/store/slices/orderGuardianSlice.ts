import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { GuardianOrder, OrderStatus } from '../../types';

interface OrderGuardianState {
  orders: GuardianOrder[];
  isAutoGuarding: boolean;
  selectedOrder: GuardianOrder | null;
  filterStatus: 'all' | OrderStatus;
  filterChannel: string;
  searchKeyword: string;
  startDate: string;
  endDate: string;
  stats: {
    todayImported: number;
    pendingConfirm: number;
    imported: number;
    failed: number;
    todayTotal: number;
    todaySuccess: number;
    todayFailed: number;
    pendingManual: number;
    avgTransferSeconds: number;
  };
}

const initialState: OrderGuardianState = {
  isAutoGuarding: false,
  selectedOrder: null,
  filterStatus: 'all',
  filterChannel: 'all',
  searchKeyword: '',
  startDate: '',
  endDate: '',
  stats: {
    todayImported: 0,
    pendingConfirm: 0,
    imported: 187,
    failed: 31,
    todayTotal: 218,
    todaySuccess: 187,
    todayFailed: 31,
    pendingManual: 0,
    avgTransferSeconds: 1.2
  },
  orders: [
    {
      id: 'ord-01',
      otaOrderNo: '1116956085050906669',
      pmsOrderNo: '',
      channelId: 'douyin',
      channelName: '抖音',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '错峰出游·中秋国庆可约｜豪华房1晚含早+双人西游/双人龙宫海洋（2选1）+景区接驳+儿童活动',
      ratePlanCode: 'OTA',
      guestName: '孙尹珂',
      guestPhone: '15962297640',
      checkInDate: '2026-09-09',
      checkOutDate: '2026-09-10',
      nights: 1,
      rooms: 1,
      otaPrice: 499.9,
      pmsCostPrice: 450,
      profit: 49.9,
      status: 'failed',
      failureReason: '预订类型不存在',
      remark: '错峰出游·中秋国庆可约',
      scrapedAt: '19:34:10',
      transferredAt: '19:34:11',
      crawlerDurationMs: 1140
    },
    {
      id: 'ord-02',
      otaOrderNo: '1117170788465949725',
      pmsOrderNo: '',
      channelId: 'douyin',
      channelName: '抖音',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动',
      ratePlanCode: 'OTA',
      guestName: '李阳',
      guestPhone: '13276394889',
      checkInDate: '2026-09-12',
      checkOutDate: '2026-09-13',
      nights: 1,
      rooms: 1,
      otaPrice: 708,
      pmsCostPrice: 650,
      profit: 58,
      status: 'failed',
      failureReason: '预订类型不存在',
      remark: '豪华家庭房1晚含早',
      scrapedAt: '19:32:05',
      transferredAt: '19:32:06',
      crawlerDurationMs: 980
    },
    {
      id: 'ord-03',
      otaOrderNo: '1111594275370615176',
      pmsOrderNo: '',
      channelId: 'douyin',
      channelName: '抖音',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动',
      ratePlanCode: 'OTA',
      guestName: '刘坤',
      guestPhone: '15726661465',
      checkInDate: '2026-09-24',
      checkOutDate: '2026-09-25',
      nights: 1,
      rooms: 1,
      otaPrice: 708,
      pmsCostPrice: 650,
      profit: 58,
      status: 'failed',
      failureReason: '预订类型不存在',
      remark: '三人西游乐园',
      scrapedAt: '19:28:44',
      transferredAt: '19:28:45',
      crawlerDurationMs: 1250
    },
    {
      id: 'ord-04',
      otaOrderNo: '5035036036232952942',
      pmsOrderNo: '',
      channelId: 'meituan',
      channelName: '美团',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '云隐大床房',
      ratePlanCode: 'OTA',
      guestName: '王五',
      guestPhone: '-',
      checkInDate: '2026-09-29',
      checkOutDate: '2026-09-30',
      nights: 1,
      rooms: 1,
      otaPrice: 219,
      pmsCostPrice: 190,
      profit: 29,
      status: 'failed',
      failureReason: '预订类型不存在',
      remark: '云隐大床房',
      scrapedAt: '19:15:20',
      transferredAt: '19:15:22',
      crawlerDurationMs: 1820
    },
    {
      id: 'ord-05',
      otaOrderNo: '20260907081413480000',
      pmsOrderNo: 'C26090700000003',
      channelId: 'meituan',
      channelName: '美团',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: 'EXK',
      ratePlanCode: 'RACK',
      guestName: '韩睿哲',
      guestPhone: '13133778388',
      checkInDate: '2026-09-29',
      checkOutDate: '2026-09-30',
      nights: 1,
      rooms: 1,
      otaPrice: 208,
      pmsCostPrice: 180,
      profit: 28,
      status: 'success',
      remark: 'EXK / RACK',
      scrapedAt: '19:05:10',
      transferredAt: '19:05:12',
      crawlerDurationMs: 910
    },
    {
      id: 'ord-06',
      otaOrderNo: '20260907012629993000',
      pmsOrderNo: 'C26090700000002',
      channelId: 'meituan',
      channelName: '美团',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: 'EXK',
      ratePlanCode: 'RACK',
      guestName: '高梓涵',
      guestPhone: '15018395540',
      checkInDate: '2026-09-07',
      checkOutDate: '2026-09-08',
      nights: 1,
      rooms: 1,
      otaPrice: 434,
      pmsCostPrice: 380,
      profit: 54,
      status: 'success',
      remark: 'EXK / RACK',
      scrapedAt: '18:50:00',
      transferredAt: '18:50:01',
      crawlerDurationMs: 840
    },
    {
      id: 'ord-07',
      otaOrderNo: 'DYBOOK-20260907012301578-000',
      pmsOrderNo: 'C26090700000001',
      channelId: 'douyin',
      channelName: '抖音',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: 'EXK',
      ratePlanCode: 'RACK',
      guestName: '李四',
      guestPhone: '13900001002',
      checkInDate: '2026-09-07',
      checkOutDate: '2026-09-08',
      nights: 1,
      rooms: 1,
      otaPrice: 416,
      pmsCostPrice: 360,
      profit: 56,
      status: 'success',
      remark: 'EXK / RACK',
      scrapedAt: '18:42:15',
      transferredAt: '18:42:17',
      crawlerDurationMs: 920
    },
    {
      id: 'ord-08',
      otaOrderNo: '1118294019284716301',
      pmsOrderNo: 'C26090600000018',
      channelId: 'douyin',
      channelName: '抖音',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '高级海景大床房（含早+双人海鲜自助晚餐抵用券）',
      ratePlanCode: 'OTA',
      guestName: '周梓轩',
      guestPhone: '13819827654',
      checkInDate: '2026-09-06',
      checkOutDate: '2026-09-07',
      nights: 1,
      rooms: 1,
      otaPrice: 628,
      pmsCostPrice: 560,
      profit: 68,
      status: 'success',
      remark: '高级海景大床房',
      scrapedAt: '18:20:11',
      transferredAt: '18:20:12',
      crawlerDurationMs: 890
    },
    {
      id: 'ord-09',
      otaOrderNo: '5035048910283401928',
      pmsOrderNo: '',
      channelId: 'meituan',
      channelName: '美团',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '豪华景观双床房',
      ratePlanCode: 'OTA',
      guestName: '张敏',
      guestPhone: '18671239988',
      checkInDate: '2026-09-05',
      checkOutDate: '2026-09-07',
      nights: 2,
      rooms: 1,
      otaPrice: 856,
      pmsCostPrice: 760,
      profit: 96,
      status: 'failed',
      failureReason: '房型映射未配置',
      remark: '豪华景观双床房2晚连住',
      scrapedAt: '17:55:04',
      transferredAt: '17:55:06',
      crawlerDurationMs: 1420
    },
    {
      id: 'ord-10',
      otaOrderNo: 'CTRIP-20260905098127361',
      pmsOrderNo: 'C26090500000012',
      channelId: 'ctrip',
      channelName: '携程',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '行政景观套房 (含双早+行政礼遇)',
      ratePlanCode: 'CORP',
      guestName: '钱学良',
      guestPhone: '13398210045',
      checkInDate: '2026-09-05',
      checkOutDate: '2026-09-06',
      nights: 1,
      rooms: 1,
      otaPrice: 1180,
      pmsCostPrice: 1020,
      profit: 160,
      status: 'success',
      remark: '行政套房商务常客',
      scrapedAt: '17:30:19',
      transferredAt: '17:30:20',
      crawlerDurationMs: 760
    },
    {
      id: 'ord-11',
      otaOrderNo: 'FLIGGY-20260904081923188',
      pmsOrderNo: '',
      channelId: 'fliggy',
      channelName: '飞猪',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '亲子童趣主题房（大床+儿童小床）',
      ratePlanCode: 'PROMO',
      guestName: '吴婷婷',
      guestPhone: '15988776655',
      checkInDate: '2026-09-04',
      checkOutDate: '2026-09-05',
      nights: 1,
      rooms: 1,
      otaPrice: 588,
      pmsCostPrice: 510,
      profit: 78,
      status: 'cancelled',
      failureReason: '客人主动申请取消预订',
      remark: '飞猪闪促活动房',
      scrapedAt: '16:45:00',
      transferredAt: '16:45:02',
      crawlerDurationMs: 1120
    },
    {
      id: 'ord-12',
      otaOrderNo: '1119028471928471920',
      pmsOrderNo: 'C26090400000009',
      channelId: 'douyin',
      channelName: '抖音',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '商务标准房 (不含早)',
      ratePlanCode: 'OTA',
      guestName: '郑伟',
      guestPhone: '13766554433',
      checkInDate: '2026-09-04',
      checkOutDate: '2026-09-05',
      nights: 1,
      rooms: 1,
      otaPrice: 328,
      pmsCostPrice: 290,
      profit: 38,
      status: 'success',
      remark: '无早特价',
      scrapedAt: '16:12:30',
      transferredAt: '16:12:31',
      crawlerDurationMs: 950
    },
    {
      id: 'ord-13',
      otaOrderNo: '5035091823746192840',
      pmsOrderNo: '',
      channelId: 'meituan',
      channelName: '美团',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '标准大床房',
      ratePlanCode: 'OTA',
      guestName: '孙建国',
      guestPhone: '15899001122',
      checkInDate: '2026-09-03',
      checkOutDate: '2026-09-04',
      nights: 1,
      rooms: 1,
      otaPrice: 288,
      pmsCostPrice: 250,
      profit: 38,
      status: 'failed',
      failureReason: '预订类型不存在',
      remark: '美团直营预订',
      scrapedAt: '15:20:10',
      transferredAt: '15:20:12',
      crawlerDurationMs: 1210
    },
    {
      id: 'ord-14',
      otaOrderNo: 'CTRIP-20260903082910384',
      pmsOrderNo: 'C26090300000005',
      channelId: 'ctrip',
      channelName: '携程',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '全海景豪华套房 (含双早)',
      ratePlanCode: 'OTA',
      guestName: '冯晓天',
      guestPhone: '13588990011',
      checkInDate: '2026-09-03',
      checkOutDate: '2026-09-05',
      nights: 2,
      rooms: 1,
      otaPrice: 1560,
      pmsCostPrice: 1380,
      profit: 180,
      status: 'success',
      remark: '携程金牌贵宾订单',
      scrapedAt: '14:50:00',
      transferredAt: '14:50:01',
      crawlerDurationMs: 820
    },
    {
      id: 'ord-15',
      otaOrderNo: 'DYBOOK-20260902091827461',
      pmsOrderNo: 'C26090200000002',
      channelId: 'douyin',
      channelName: '抖音',
      hotelName: '舟山锦舟宝盛大酒店',
      roomTypeName: '高级双床房 (含双早)',
      ratePlanCode: 'OTA',
      guestName: '陈晨',
      guestPhone: '18200112233',
      checkInDate: '2026-09-02',
      checkOutDate: '2026-09-03',
      nights: 1,
      rooms: 1,
      otaPrice: 468,
      pmsCostPrice: 410,
      profit: 58,
      status: 'success',
      remark: '抖音团购券核销下单',
      scrapedAt: '14:10:15',
      transferredAt: '14:10:17',
      crawlerDurationMs: 990
    }
  ]
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
    setOrderFilterChannel: (state, action: PayloadAction<string>) => {
      state.filterChannel = action.payload;
    },
    setSelectedOrder: (state, action: PayloadAction<GuardianOrder | null>) => {
      state.selectedOrder = action.payload;
    },
    retryOrderTransfer: (state, action: PayloadAction<string>) => {
      const ord = state.orders.find(o => o.id === action.payload);
      if (ord) {
        ord.status = 'transferred';
        ord.transferredAt = '刚刚 (手动重推)';
        ord.failureReason = undefined;
        ord.pmsOrderNo = ord.pmsOrderNo.startsWith('PMS-') || ord.pmsOrderNo.startsWith('C2') ? ord.pmsOrderNo : `C260907${Math.floor(10000000 + Math.random() * 90000000)}`;
        state.stats.todaySuccess += 1;
        state.stats.imported += 1;
        if (state.stats.failed > 0) state.stats.failed -= 1;
      }
    },
    importOrderDirectly: (state, action: PayloadAction<string>) => {
      const ord = state.orders.find(o => o.id === action.payload);
      if (ord) {
        const wasFailed = ord.status === 'failed';
        ord.status = 'success';
        ord.transferredAt = '刚刚 (直接导入)';
        ord.failureReason = undefined;
        if (!ord.pmsOrderNo || ord.pmsOrderNo === '-') {
          ord.pmsOrderNo = `C260907${Math.floor(10000000 + Math.random() * 90000000)}`;
        }
        state.stats.todayImported += 1;
        state.stats.imported += 1;
        if (state.stats.failed > 0 && wasFailed) {
          state.stats.failed -= 1;
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
      const ord = state.orders.find(o => o.id === action.payload);
      if (ord) {
        if (ord.status === 'failed' && state.stats.failed > 0) {
          state.stats.failed -= 1;
        } else if ((ord.status === 'success' || ord.status === 'transferred') && state.stats.imported > 0) {
          state.stats.imported -= 1;
        }
        state.orders = state.orders.filter(o => o.id !== action.payload);
      }
    },
    cancelOrder: (state, action: PayloadAction<string>) => {
      const ord = state.orders.find(o => o.id === action.payload);
      if (ord) {
        ord.status = 'cancelled';
        ord.failureReason = '用户手动取消';
      }
    },
    addNewScrapedOrder: (state, action: PayloadAction<GuardianOrder>) => {
      state.orders.unshift(action.payload);
      state.stats.todayTotal += 1;
      if (action.payload.status === 'transferred' || action.payload.status === 'confirmed' || action.payload.status === 'success') {
        state.stats.todaySuccess += 1;
        state.stats.imported += 1;
      } else {
        state.stats.failed += 1;
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
      state.filterChannel = 'all';
      state.searchKeyword = '';
      state.startDate = '';
      state.endDate = '';
    }
  }
});

export const {
  toggleAutoGuarding,
  setOrderFilterStatus,
  setOrderFilterChannel,
  setSelectedOrder,
  retryOrderTransfer,
  importOrderDirectly,
  updateOrder,
  deleteOrder,
  cancelOrder,
  addNewScrapedOrder,
  setSearchKeyword,
  setDateRange,
  resetFilters
} = orderGuardianSlice.actions;

export default orderGuardianSlice.reducer;
