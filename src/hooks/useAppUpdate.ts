import React from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { setUpdateState, showToast } from '../store/slices/appSlice';

export function useAppUpdate() {
  const dispatch = useAppDispatch();
  const update = useAppSelector((state) => state.app.update);
  const lastErrorMessage = React.useRef('');

  React.useEffect(() => {
    const updateApi = window.host?.update;
    if (!updateApi) {
      return;
    }

    let isActive = true;
    void updateApi.getState().then((state) => {
      if (isActive) {
        dispatch(setUpdateState(state));
      }
    });

    const unsubscribe = updateApi.onUpdateState((state) => {
      if (isActive) {
        dispatch(setUpdateState(state));
      }
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [dispatch]);

  React.useEffect(() => {
    if (update.status !== 'error' || !update.message || lastErrorMessage.current === update.message) {
      return;
    }

    lastErrorMessage.current = update.message;
    dispatch(showToast({
      title: '系统更新失败',
      description: update.message,
      type: 'error',
    }));
  }, [dispatch, update.message, update.status]);

  const isUpdating = update.status === 'downloading'
    || update.status === 'installing';
  const hasUpdate = update.status === 'available';

  const requestUpdate = React.useCallback(() => {
    const updateApi = window.host?.update;
    if (!updateApi || isUpdating) {
      return;
    }

    if (hasUpdate) {
      void updateApi.installUpdate();
      return;
    }
  }, [hasUpdate, isUpdating]);

  /** 弹窗「立刻安装」：清确认挂起态并立即下载安装 */
  const confirmInstall = React.useCallback(() => {
    const updateApi = window.host?.update;
    if (updateApi && !isUpdating) {
      void updateApi.confirmInstall();
    }
  }, [isUpdating]);

  /** 弹窗「晚点安装」：本轮放弃，等待下一轮周期检查重新决策 */
  const deferInstall = React.useCallback(() => {
    const updateApi = window.host?.update;
    if (updateApi && !isUpdating) {
      void updateApi.deferInstall();
    }
  }, [isUpdating]);

  return {
    update,
    hasUpdate,
    isUpdating,
    requestUpdate,
    confirmInstall,
    deferInstall,
  };
}

/**
 * 用户输入活跃心跳上报：鼠标/键盘/滚轮任一输入经节流（30s）通知主进程，
 * 作为更新自动安装时机的前台判定依据（窗口聚焦 + 近期输入 = 用户在场）。
 */
const USER_INPUT_HEARTBEAT_INTERVAL_MS = 30 * 1000;

export function useUserInputHeartbeat() {
  React.useEffect(() => {
    const updateApi = window.host?.update;
    if (!updateApi) {
      return;
    }

    let lastSentAt = 0;
    const report = () => {
      const now = Date.now();
      if (now - lastSentAt < USER_INPUT_HEARTBEAT_INTERVAL_MS) {
        return;
      }
      lastSentAt = now;
      updateApi.notifyUserInput();
    };

    window.addEventListener('mousedown', report);
    window.addEventListener('keydown', report);
    window.addEventListener('wheel', report, { passive: true });

    return () => {
      window.removeEventListener('mousedown', report);
      window.removeEventListener('keydown', report);
      window.removeEventListener('wheel', report);
    };
  }, []);
}
