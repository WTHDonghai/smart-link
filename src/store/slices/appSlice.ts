import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { NavTab } from '../../types';
import type { AppUpdateState } from '../../types/update';

export interface AppState {
  currentTab: NavTab;
  sidebarCollapsed: boolean;
  update: AppUpdateState;
  toast: {
    visible: boolean;
    title: string;
    description?: string;
    type?: 'success' | 'info' | 'warning' | 'error';
  } | null;
}

const initialState: AppState = {
  currentTab: 'channel-mapping',
  sidebarCollapsed: false,
  update: {
    canUpdate: false,
    status: 'unavailable',
    currentVersion: '',
    targetVersion: '',
    progressPercent: null,
    message: '',
  },
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
    setUpdateState: (state, action: PayloadAction<AppUpdateState>) => {
      state.update = action.payload;
    },
    showToast: (state, action: PayloadAction<{ title: string; description?: string; type?: 'success' | 'info' | 'warning' | 'error' }>) => {
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
  setUpdateState,
  showToast,
  clearToast
} = appSlice.actions;

export default appSlice.reducer;
