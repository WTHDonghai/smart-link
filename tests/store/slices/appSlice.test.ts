import { describe, it, expect } from 'vitest';
import appReducer, {
  setCurrentTab,
  toggleSidebar,
  startAutoUpdate,
  setUpdateProgress,
  finishAutoUpdate,
  resetUpdateDemo,
  showToast,
  clearToast,
} from '../../../src/store/slices/appSlice';

describe('appSlice', () => {
  it('initializes with default state values', () => {
    const state = appReducer(undefined, { type: '@@INIT' });

    expect(state.currentTab).toBe('channel-mapping');
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.version).toBe('v2.4.1');
    expect(state.hasUpdate).toBe(true);
    expect(state.latestVersion).toBe('v2.5.0');
    expect(state.isUpdating).toBe(false);
    expect(state.updateProgress).toBe(0);
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

  describe('Auto Update Lifecycle (startAutoUpdate, setUpdateProgress, finishAutoUpdate, resetUpdateDemo)', () => {
    it('handles entire update lifecycle with precise state transitions', () => {
      const initialState = appReducer(undefined, { type: '@@INIT' });

      // 1. 开始自动更新
      const updatingState = appReducer(initialState, startAutoUpdate());
      expect(updatingState.isUpdating).toBe(true);
      expect(updatingState.updateProgress).toBe(0);

      // 2. 推进更新进度
      const progressState = appReducer(updatingState, setUpdateProgress(55));
      expect(progressState.updateProgress).toBe(55);
      expect(progressState.isUpdating).toBe(true);

      // 3. 完成更新
      const finishedState = appReducer(progressState, finishAutoUpdate());
      expect(finishedState.isUpdating).toBe(false);
      expect(finishedState.hasUpdate).toBe(false);
      expect(finishedState.version).toBe('v2.5.0');
      expect(finishedState.latestVersion).toBe('v2.5.0');
      expect(finishedState.updateProgress).toBe(100);

      // 4. 重置演示状态
      const resetState = appReducer(finishedState, resetUpdateDemo());
      expect(resetState.hasUpdate).toBe(true);
      expect(resetState.version).toBe('v2.4.1');
      expect(resetState.isUpdating).toBe(false);
      expect(resetState.updateProgress).toBe(0);
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
