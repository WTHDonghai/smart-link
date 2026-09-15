import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { NavTab, PlaywrightConfig } from '../../types';

interface AppState {
  currentTab: NavTab;
  sidebarCollapsed: boolean;
  playwrightModalOpen: boolean;
  tenantId: string;
  version: string;
  hasUpdate: boolean;
  latestVersion: string;
  isUpdating: boolean;
  updateProgress: number;
  playwrightConfig: PlaywrightConfig;
  toast: {
    visible: boolean;
    title: string;
    description?: string;
    type?: 'success' | 'info' | 'error';
  } | null;
}

const initialState: AppState = {
  currentTab: 'channel-mapping',
  sidebarCollapsed: false,
  playwrightModalOpen: false,
  tenantId: 'XR-89201',
  version: 'v2.4.1',
  hasUpdate: true,
  latestVersion: 'v2.5.0',
  isUpdating: false,
  updateProgress: 0,
  toast: null,
  playwrightConfig: {
    isRunning: true,
    headless: true,
    workerCount: 4,
    activeThreads: 3,
    crawlIntervalSec: 10,
    autoCaptchaSolver: true,
    proxyEnabled: true,
    browserType: 'chromium',
    sessions: [
      { channelId: 'meituan', accountName: '美团商家EB_0891', cookieStatus: 'valid', lastPing: '刚刚' },
      { channelId: 'meituanbiz', accountName: '美团企业商旅_VIP', cookieStatus: 'valid', lastPing: '1分钟前' },
      { channelId: 'douyin', accountName: '抖音来客文旅旗舰', cookieStatus: 'valid', lastPing: '刚刚' },
      { channelId: 'ctrip', accountName: '携程EBooking直连号', cookieStatus: 'valid', lastPing: '3分钟前' },
      { channelId: 'fliggy', accountName: '飞猪度假直销号', cookieStatus: 'expiring', lastPing: '5分钟前' },
    ]
  }
};

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setCurrentTab: (state, action: PayloadAction<NavTab>) => {
      state.currentTab = action.payload;
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setPlaywrightModalOpen: (state, action: PayloadAction<boolean>) => {
      state.playwrightModalOpen = action.payload;
    },
    startAutoUpdate: (state) => {
      state.isUpdating = true;
      state.updateProgress = 0;
    },
    setUpdateProgress: (state, action: PayloadAction<number>) => {
      state.updateProgress = action.payload;
    },
    finishAutoUpdate: (state) => {
      state.isUpdating = false;
      state.hasUpdate = false;
      state.version = state.latestVersion;
      state.updateProgress = 100;
    },
    resetUpdateDemo: (state) => {
      state.hasUpdate = true;
      state.version = 'v2.4.1';
      state.isUpdating = false;
      state.updateProgress = 0;
    },
    togglePlaywrightRunning: (state) => {
      state.playwrightConfig.isRunning = !state.playwrightConfig.isRunning;
    },
    updatePlaywrightConfig: (state, action: PayloadAction<Partial<PlaywrightConfig>>) => {
      state.playwrightConfig = { ...state.playwrightConfig, ...action.payload };
    },
    showToast: (state, action: PayloadAction<{ title: string; description?: string; type?: 'success' | 'info' | 'error' }>) => {
      state.toast = { visible: true, ...action.payload };
    },
    clearToast: (state) => {
      state.toast = null;
    }
  }
});

export const {
  setCurrentTab,
  toggleSidebar,
  setPlaywrightModalOpen,
  startAutoUpdate,
  setUpdateProgress,
  finishAutoUpdate,
  resetUpdateDemo,
  togglePlaywrightRunning,
  updatePlaywrightConfig,
  showToast,
  clearToast
} = appSlice.actions;

export default appSlice.reducer;
