import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { NavTab } from '../../types';

export interface AppState {
  currentTab: NavTab;
  sidebarCollapsed: boolean;
  version: string;
  hasUpdate: boolean;
  latestVersion: string;
  isUpdating: boolean;
  updateProgress: number;
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
  version: 'v2.4.1',
  hasUpdate: true,
  latestVersion: 'v2.5.0',
  isUpdating: false,
  updateProgress: 0,
  toast: null,
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
  startAutoUpdate,
  setUpdateProgress,
  finishAutoUpdate,
  resetUpdateDemo,
  showToast,
  clearToast
} = appSlice.actions;

export default appSlice.reducer;
