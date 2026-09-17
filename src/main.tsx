import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store';
import { addLog, hydrateLogsFromStorage } from './store/slices/systemLogSlice';
import { logger } from './services/logger';
import { initGlobalErrorLogging } from './services/globalErrorLogger';
import App from './App.tsx';
import './index.css';

// 1. 初始化全局未捕获异常与 Promise 拒绝拦截
initGlobalErrorLogging();

// 2. 初始化统一日志中枢，将日志实时流双轨分发给 Redux 驱动界面渲染
logger.init({
  onLog: (entry) => store.dispatch(addLog(entry)),
  autoPurge7Days: true,
});

// 3. 从 IndexedDB 异步水合最近 7 天内的持久化运行日志
store.dispatch(hydrateLogsFromStorage());

// 4. 监听 Electron 原生端推送的实时任务调度日志流 (若处于 Electron 桌面环境)
if (typeof window !== 'undefined') {
  const win = window as unknown as {
    electron?: {
      duty?: {
        onLog?: (cb: (entry: import('./types').SystemLogEntry) => void) => () => void;
      };
    };
  };
  win.electron?.duty?.onLog?.((entry) => {
    store.dispatch(addLog(entry));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);

