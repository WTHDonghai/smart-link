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

  return {
    update,
    hasUpdate,
    isUpdating,
    requestUpdate,
  };
}
