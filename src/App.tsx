import React from 'react';
import { useAppSelector } from './store';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChannelMappingView } from './components/channels/ChannelMappingView';
import { HotelSyncView } from './components/hotels/HotelSyncView';
import { ProductSyncView } from './components/products/ProductSyncView';
import { OrderGuardianView } from './components/orders/OrderGuardianView';
import { SystemLogsView } from './components/logs/SystemLogsView';
import { RemarkTemplateModal } from './components/channels/RemarkTemplateModal';
import { PlaywrightStatusDrawer } from './components/desktop/PlaywrightStatusDrawer';
import { ToastNotification } from './components/common/ToastNotification';

export default function App() {
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const collapsed = useAppSelector((state) => state.app.sidebarCollapsed);

  return (
    <div className="h-screen bg-[#f8f9ff] text-[#0b1c30] flex flex-col antialiased selection:bg-[#004ac6] selection:text-white overflow-hidden">
      {/* Main Workspace Frame */}
      <div className="flex flex-1 relative overflow-hidden h-full min-h-0">
        {/* Left Navigation Sidebar */}
        <Sidebar />

        {/* Dynamic Content Area */}
        <main
          className={`flex-1 transition-all duration-300 h-full min-h-0 ${
            currentTab === 'order-guardian'
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
      <PlaywrightStatusDrawer />
      <ToastNotification />
    </div>
  );
}
