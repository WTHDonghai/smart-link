import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from '../store';
import { addLog, hydrateLogsFromStorage } from '../store/slices/systemLogSlice';
import { logger } from '../services/logger';
import { initGlobalErrorLogging } from '../services/globalErrorLogger';
import App from '../App';
import '../index.css';

export async function startApp(root: HTMLElement): Promise<void> {
  initGlobalErrorLogging();

  try {
    await logger.init({
      onLog: (entry) => store.dispatch(addLog(entry)),
      autoPurge7Days: true,
    });
  } catch (error) {
    console.error('[AppBootstrap] logger 初始化失败:', error);
  }

  // 确保在 logger.init 完成（包含 7 天淘汰清理）后再从存储水合历史日志，彻底避免竞态
  void store.dispatch(hydrateLogsFromStorage());

  createRoot(root).render(
    <StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </StrictMode>,
  );
}
