import { describe, it, expect } from 'vitest';
import appReducer, {
  setCurrentTab,
  toggleSidebar,
  setUpdateState,
  showToast,
  clearToast,
} from '../../../src/store/slices/appSlice';
import type { AppUpdateState } from '../../../src/types/update';

function createUpdateState(overrides: Partial<AppUpdateState> = {}): AppUpdateState {
  return {
    canUpdate: true,
    status: 'idle',
    currentVersion: '1.0.0',
    targetVersion: '',
    progressPercent: null,
    message: '',
    ...overrides,
  };
}

describe('appSlice', () => {
  it('initializes with default state values', () => {
    const state = appReducer(undefined, { type: '@@INIT' });

    expect(state.currentTab).toBe('channel-mapping');
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.update).toEqual({
      canUpdate: false,
      status: 'unavailable',
      currentVersion: '',
      targetVersion: '',
      progressPercent: null,
      message: '',
    });
    expect(state.toast).toBeNull();
  });

  describe('setCurrentTab', () => {
    it('switches current active navigation tab correctly', () => {
      const initialState = appReducer(undefined, { type: '@@INIT' });
      const nextState = appReducer(initialState, setCurrentTab('order-guardian'));
      expect(nextState.currentTab).toBe('order-guardian');

      const logsState = appReducer(nextState, setCurrentTab('system-logs'));
      expect(logsState.currentTab).toBe('system-logs');
    });
  });

  describe('toggleSidebar', () => {
    it('toggles sidebarCollapsed between true and false', () => {
      const initialState = appReducer(undefined, { type: '@@INIT' });
      expect(initialState.sidebarCollapsed).toBe(false);

      const collapsedState = appReducer(initialState, toggleSidebar());
      expect(collapsedState.sidebarCollapsed).toBe(true);

      const expandedState = appReducer(collapsedState, toggleSidebar());
      expect(expandedState.sidebarCollapsed).toBe(false);
    });
  });

  describe('App update state', () => {
    it('replaces the host-owned update state without deriving fake progress', () => {
      const initialState = appReducer(undefined, { type: '@@INIT' });
      const downloading = appReducer(
        initialState,
        setUpdateState(createUpdateState({
          status: 'downloading',
          targetVersion: '1.1.0',
          progressPercent: 42,
        }))
      );

      expect(downloading.update.status).toBe('downloading');
      expect(downloading.update.targetVersion).toBe('1.1.0');
      expect(downloading.update.progressPercent).toBe(42);
      expect(downloading.sidebarCollapsed).toBe(initialState.sidebarCollapsed);
    });
  });

  describe('Toast Notifications (showToast, clearToast)', () => {
    it('shows toast with title, description, and type', () => {
      const initialState = appReducer(undefined, { type: '@@INIT' });

      const stateWithToast = appReducer(
        initialState,
        showToast({
          title: '配置已更新',
          description: '渠道备注模板保存成功',
          type: 'success',
        })
      );

      expect(stateWithToast.toast).toEqual({
        visible: true,
        title: '配置已更新',
        description: '渠道备注模板保存成功',
        type: 'success',
      });
    });

    it('shows toast with minimal options and clears toast', () => {
      const initialState = appReducer(undefined, { type: '@@INIT' });

      const stateWithToast = appReducer(
        initialState,
        showToast({
          title: '网络断开',
          type: 'error',
        })
      );

      expect(stateWithToast.toast?.visible).toBe(true);
      expect(stateWithToast.toast?.title).toBe('网络断开');
      expect(stateWithToast.toast?.type).toBe('error');
      expect(stateWithToast.toast?.description).toBeUndefined();

      const clearedState = appReducer(stateWithToast, clearToast());
      expect(clearedState.toast).toBeNull();
    });
  });
});
