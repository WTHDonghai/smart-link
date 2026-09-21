import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from '../store';
import { addLog, hydrateLogsFromStorage } from '../store/slices/systemLogSlice';
import { logger } from '../services/logger';
import { initGlobalErrorLogging } from '../services/globalErrorLogger';
import App from '../App';
import '../index.css';

export function startApp(root: HTMLElement): void {
  initGlobalErrorLogging();

  logger.init({
    onLog: (entry) => store.dispatch(addLog(entry)),
    autoPurge7Days: true,
  });

  store.dispatch(hydrateLogsFromStorage());

  createRoot(root).render(
    <StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </StrictMode>,
  );
}
