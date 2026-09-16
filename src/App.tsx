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
import { platformAuthService } from './services/platformAuth';
import { updateTokenState, tokenRefreshed, authFailed } from './store/slices/authSlice';

export default function App() {
  const dispatch = useAppDispatch();
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const collapsed = useAppSelector((state) => state.app.sidebarCollapsed);
  const authStatus = useAppSelector((state) => state.auth.status);

  useEffect(() => {
    // 启动文旅平台 Token 后台自动续期调度器
    platformAuthService.startRefreshScheduler((tokens, error) => {
      if (tokens) {
        dispatch(tokenRefreshed(tokens));
      } else if (error) {
        dispatch(authFailed(error.message));
      } else {
        dispatch(updateTokenState());
      }
    });

    // 定时每 10 秒刷新一次内存中的 TokenState 倒计时
    const timer = setInterval(() => {
      dispatch(updateTokenState());
    }, 10000);

    return () => {
      platformAuthService.stopRefreshScheduler();
      clearInterval(timer);
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

