import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SystemLogEntry } from '../../types';

export interface SystemLogState {
  logs: SystemLogEntry[];
  filterLevel: 'ALL' | 'PLAYWRIGHT' | 'INFO' | 'WARN' | 'ERROR';
  filterSearch: string;
  isAutoScroll: boolean;
}

const initialLogs: SystemLogEntry[] = [
  {
    id: 'log-01',
    timestamp: '19:35:58.204',
    level: 'PLAYWRIGHT',
    channelId: 'meituan',
    message: '[Playwright:ChromiumWorker#2] Page context https://eb.meituan.com/order/v2/unconfirmed active. Polling network tab.',
    details: 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 SLA-Headless'
  },
  {
    id: 'log-02',
    timestamp: '19:35:58.812',
    level: 'INFO',
    channelId: 'meituan',
    message: '[CrawlerEngine] Intercepted payload XHR: POST /api/order/pull. 0 new orders in queue.',
    details: 'HTTP 200 OK | size: 1.4KB | latency: 68ms'
  },
  {
    id: 'log-03',
    timestamp: '19:35:55.109',
    level: 'PLAYWRIGHT',
    channelId: 'douyin',
    message: '[Playwright:DouyinWorker#1] DOM evaluation complete on https://life.douyin.com/pms/orders. Found 1 pending ticket validation.',
    details: 'Target element: .order-card-row[data-state="paid_need_dispatch"]'
  },
  {
    id: 'log-04',
    timestamp: '19:35:55.940',
    level: 'SUCCESS',
    channelId: 'douyin',
    message: '[Dispatcher] Order DY-20260914-5502 matched to 文旅大中台 PMS API (Route: douyin_life). Response code 200.',
    details: 'Payload: {"otaOrderNo":"DY-20260914-5502","pmsHotelId":"PMS-SY-099","pmsRoomCode":"PMS-ATL-K01"}'
  },
  {
    id: 'log-05',
    timestamp: '19:35:48.330',
    level: 'PLAYWRIGHT',
    channelId: 'ctrip',
    message: '[Playwright:SessionManager] Cookie keep-alive ping for Ctrip EBooking returned status: 200 OK.',
    details: 'Cookie valid for next 48 hours. Session token refreshed.'
  },
  {
    id: 'log-06',
    timestamp: '19:35:40.112',
    level: 'WARN',
    channelId: 'fliggy',
    message: '[Playwright:FliggyWorker] Geetest slider captcha detected on session resume. Auto-solver module invoked.',
    details: 'Triggered OCR edge detection slider resolver. Solved in 420ms (Confidence: 96.4%).'
  },
  {
    id: 'log-07',
    timestamp: '19:35:32.400',
    level: 'INFO',
    message: '[Heartbeat] Electron Main Process CPU 3.4% | Memory: 184MB | Playwright 4 browser contexts active.',
    details: 'OS: Darwin (macOS 15.1) / x64 | Node: v22.14.0'
  }
];

const initialState: SystemLogState = {
  logs: initialLogs,
  filterLevel: 'ALL',
  filterSearch: '',
  isAutoScroll: true
};

export const systemLogSlice = createSlice({
  name: 'systemLog',
  initialState,
  reducers: {
    setFilterLevel: (state, action: PayloadAction<'ALL' | 'PLAYWRIGHT' | 'INFO' | 'WARN' | 'ERROR'>) => {
      state.filterLevel = action.payload;
    },
    setFilterSearch: (state, action: PayloadAction<string>) => {
      state.filterSearch = action.payload;
    },
    toggleAutoScroll: (state) => {
      state.isAutoScroll = !state.isAutoScroll;
    },
    addLog: (state, action: PayloadAction<Omit<SystemLogEntry, 'id' | 'timestamp'>>) => {
      const d = new Date();
      const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
      state.logs.unshift({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: timeStr,
        ...action.payload
      });
      if (state.logs.length > 300) {
        state.logs.pop();
      }
    },
    clearLogs: (state) => {
      state.logs = [];
    }
  }
});

export const {
  setFilterLevel,
  setFilterSearch,
  toggleAutoScroll,
  addLog,
  clearLogs
} = systemLogSlice.actions;

export default systemLogSlice.reducer;
