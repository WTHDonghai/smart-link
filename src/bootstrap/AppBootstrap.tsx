import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from '../store';
import { addLog, hydrateLogsFromStorage } from '../store/slices/systemLogSlice';
import { applyAutoMappingResult, setAutoMappingProgress } from '../store/slices/productSlice';
import { subscribeAgentProductMappingProgress } from '../services/agentBridge';
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

  // Agent 产品映射进度订阅：应用级接线，确保即使离开产品页也能收到终态并落草稿
  // （Electron-Only：宿主缺失时订阅抛错，由全局错误日志暴露，不静默吞掉）
  try {
    subscribeAgentProductMappingProgress((event) => {
      if (event.result) {
        store.dispatch(applyAutoMappingResult(event.result));
      } else {
        store.dispatch(setAutoMappingProgress(event));
      }
    });
  } catch (error) {
    console.error('[AppBootstrap] Agent 映射进度订阅失败:', error);
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
