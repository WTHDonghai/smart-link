import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from './store';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChannelMappingView } from './components/channels/ChannelMappingView';
import { HotelSyncView } from './components/hotels/HotelSyncView';
import { ProductSyncView } from './components/products/ProductSyncView';
import { OrderGuardianView } from './components/orders/OrderGuardianView';
import { SystemLogsView } from './components/logs/SystemLogsView';
import { RemarkTemplateModal } from './components/channels/RemarkTemplateModal';
import { PlatformLoginView } from './components/auth/PlatformLoginView';
import { ToastNotification } from './components/common/ToastNotification';
import { platformAuthService, classifyAuthError, loadTokensFromStorage } from './services/platformAuth';
import { updateTokenState, tokenRefreshed, authFailed, logout } from './store/slices/authSlice';
import { syncDutyTokens, clearDutyTokens } from './services/dutyBridge';

export default function App() {
  const dispatch = useAppDispatch();
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const collapsed = useAppSelector((state) => state.app.sidebarCollapsed);
  const authStatus = useAppSelector((state) => state.auth.status);

  useEffect(() => {
    // 1. 订阅 Token 变更广播，无论是登录、后台调度还是业务 API 401 自动刷新，均实时同步 Redux 内存及后台 Node 宿主
    const unsubscribeToken = platformAuthService.onTokenChange((tokens) => {
      if (tokens) {
        dispatch(tokenRefreshed(tokens));
        void syncDutyTokens(tokens);
      } else {
        void clearDutyTokens();
        dispatch((dispatchAction, getState) => {
          const authState = getState().auth;
          if (authState.status !== 'login-required' || authState.tokens !== null) {
            dispatchAction(logout());
          }
        });
      }
    });

    // 2. 挂载时，若前端已有已登录有效 Token，主动向后台 Node 宿主同步一次
    const initialTokens = loadTokensFromStorage();
    if (initialTokens && initialTokens.accessToken) {
      void syncDutyTokens(initialTokens);
    }

    // 2. 启动文旅平台 Token 后台自动续期调度器
    platformAuthService.startRefreshScheduler((_tokens, error) => {
      if (error) {
        // 关键防护：仅在凭据发生终端致命失效（如服务端确切返回 invalid_grant）时才触发登出
        // 网络超时、断网等可重试异常绝不能踢回登录页
        const classified = classifyAuthError(error);
        if (classified.terminal) {
          dispatch(authFailed(error.message));
        }
      } else {
        // 单一可信流：tokens 由 onTokenChange 负责同步，此处仅负责心跳时钟触发状态更新
        dispatch(updateTokenState());
      }
    });

    // 3. 定时每 10 秒刷新一次内存中的 TokenState 倒计时
    const timer = setInterval(() => {
      dispatch(updateTokenState());
    }, 10000);

    // 4. 监听系统休眠唤醒、获得焦点、网络恢复，即时校验与静默续期（300ms 轻量防抖避免事件连发）
    let wakeupTimer: ReturnType<typeof setTimeout> | null = null;
    const handleWakeupOrReconnect = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (wakeupTimer) clearTimeout(wakeupTimer);
        wakeupTimer = setTimeout(() => {
          dispatch(updateTokenState());
          void platformAuthService.checkAndRefreshImmediately();
        }, 300);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleWakeupOrReconnect);
    }
    window.addEventListener('focus', handleWakeupOrReconnect);
    window.addEventListener('online', handleWakeupOrReconnect);

    return () => {
      if (wakeupTimer) clearTimeout(wakeupTimer);
      unsubscribeToken();
      platformAuthService.stopRefreshScheduler();
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleWakeupOrReconnect);
      }
      window.removeEventListener('focus', handleWakeupOrReconnect);
      window.removeEventListener('online', handleWakeupOrReconnect);
    };
  }, [dispatch]);

  // 未授权时直接路由至文旅平台登录门禁界面
  if (authStatus !== 'authorized') {
    return (
      <>
        <PlatformLoginView />
        <ToastNotification />
      </>
    );
  }

  return (
    <div className="h-screen bg-[#f8f9ff] text-[#0b1c30] flex flex-col antialiased selection:bg-[#004ac6] selection:text-white overflow-hidden">
      {/* Main Workspace Frame */}
      <div className="flex flex-1 relative overflow-hidden h-full min-h-0">
        {/* Left Navigation Sidebar */}
        <Sidebar />

        {/* Dynamic Content Area */}
        <main
          className={`flex-1 transition-all duration-300 h-full min-h-0 ${
            currentTab === 'order-guardian' || currentTab === 'product-mapping'
              ? 'overflow-hidden flex flex-col'
              : 'overflow-y-auto'
          } ${collapsed ? 'pl-20' : 'pl-64'}`}
        >
          {currentTab === 'channel-mapping' && <ChannelMappingView />}
          {currentTab === 'hotel-sync' && <HotelSyncView />}
          {currentTab === 'product-mapping' && <ProductSyncView />}
          {currentTab === 'order-guardian' && <OrderGuardianView />}
          {currentTab === 'system-logs' && <SystemLogsView />}
        </main>
      </div>

      {/* Overlay Modals & Drawers */}
      <RemarkTemplateModal />
      <ToastNotification />
    </div>
  );
}

