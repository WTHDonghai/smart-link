import React from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  setCurrentTab, 
  toggleSidebar,
  startAutoUpdate,
  setUpdateProgress,
  finishAutoUpdate,
  resetUpdateDemo,
  showToast
} from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import { NavTab } from '../../types';
import { 
  ArrowLeftRight, 
  Building2, 
  BedDouble, 
  ShieldCheck, 
  FileText, 
  Menu,
  Download,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';
import { XiruanLogoMark } from '../common/XiruanLogo';

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

export const Sidebar: React.FC = () => {
  const dispatch = useAppDispatch();
  const currentTab = useAppSelector((state) => state.app.currentTab);
  const collapsed = useAppSelector((state) => state.app.sidebarCollapsed);
  const pendingManualOrders = useAppSelector((state) => state.orderGuardian.stats.pendingManual);
  
  // Tenant and version state
  const tenantId = useAppSelector((state) => state.app.tenantId);
  const version = useAppSelector((state) => state.app.version);
  const hasUpdate = useAppSelector((state) => state.app.hasUpdate);
  const latestVersion = useAppSelector((state) => state.app.latestVersion);
  const isUpdating = useAppSelector((state) => state.app.isUpdating);
  const updateProgress = useAppSelector((state) => state.app.updateProgress);

  // Trigger automated update
  const handleTriggerAutoUpdate = () => {
    if (isUpdating) return;
    dispatch(startAutoUpdate());
    dispatch(showToast({
      title: '开始自动更新',
      description: `正在获取并下载最新补丁 (${latestVersion})...`,
      type: 'info'
    }));

    let progress = 0;
    const timer = setInterval(() => {
      progress += Math.floor(Math.random() * 16) + 14;
      if (progress >= 100) {
        clearInterval(timer);
        dispatch(setUpdateProgress(100));
        dispatch(finishAutoUpdate());
        dispatch(addLog({
          level: 'SUCCESS',
          message: `[AutoUpdater] 客户端自动升级完成，版本由 ${version} 成功更新至最新 ${latestVersion}`,
          details: `租户: ${tenantId} | 补丁哈希已通过完整性校验并热生效。`
        }));
        dispatch(showToast({
          title: '系统更新成功',
          description: `客户端已顺利升级至最新版本 ${latestVersion}！`,
          type: 'success'
        }));
      } else {
        dispatch(setUpdateProgress(progress));
      }
    }, 220);
  };

  const navItems: NavItem[] = [
    {
      id: 'channel-mapping',
      label: '渠道映射',
      icon: <ArrowLeftRight className="w-5 h-5 shrink-0" />
    },
    {
      id: 'hotel-sync',
      label: '酒店采集和映射',
      icon: <Building2 className="w-5 h-5 shrink-0" />
    },
    {
      id: 'product-mapping',
      label: '产品采集和映射',
      icon: <BedDouble className="w-5 h-5 shrink-0" />
    },
    {
      id: 'order-guardian',
      label: '订单值守',
      icon: <ShieldCheck className="w-5 h-5 shrink-0" />,
      badge: pendingManualOrders > 0 ? `${pendingManualOrders}` : undefined
    },
    {
      id: 'system-logs',
      label: '系统日志',
      icon: <FileText className="w-5 h-5 shrink-0" />
    }
  ];

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-white shadow-[0_1px_8px_rgba(0,0,0,0.04)] z-40 flex flex-col justify-between transition-all duration-300 border-r border-[#dce9ff] ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Top Header & Brand */}
      <div className="flex flex-col">
        <div className={`h-14 ${collapsed ? 'px-2 justify-center' : 'px-4 justify-between'} flex items-center bg-white border-b border-[#eff4ff] relative`}>
          <div 
            className={`flex items-center ${collapsed ? 'justify-center cursor-pointer' : 'gap-2.5 overflow-hidden'}`}
            onClick={collapsed ? () => dispatch(toggleSidebar()) : undefined}
          >
            <div 
              className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#0076f5] via-[#0052cc] to-[#003da5] flex items-center justify-center p-1.5 shadow-sm shrink-0 select-none overflow-hidden"
              title={collapsed ? '杭州西软 OTA智能搬单 (点击展开)' : '杭州西软 OTA智能搬单'}
            >
              <XiruanLogoMark className="w-full h-full object-contain" />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-sm text-[#0b1c30] leading-none tracking-tight truncate">
                  杭州西软
                </span>
                <span className="text-[11px] font-medium text-[#434655] mt-1 tracking-wider truncate">
                  OTA智能搬单
                </span>
              </div>
            )}
          </div>

          {collapsed ? (
            <button
              onClick={() => dispatch(toggleSidebar())}
              className="absolute -right-3 top-4 w-6 h-6 rounded-full bg-white border border-[#dce9ff] shadow-md flex items-center justify-center text-[#434655] hover:bg-[#eff4ff] hover:text-[#004ac6] transition-all cursor-pointer z-50 group"
              title="展开侧边栏"
              type="button"
            >
              <Menu className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => dispatch(toggleSidebar())}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#434655] hover:bg-[#eff4ff] hover:text-[#0b1c30] transition-colors shrink-0 cursor-pointer"
              title="收起侧边栏"
              type="button"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="p-2 space-y-1">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => dispatch(setCurrentTab(item.id))}
                className={`w-full flex items-center ${
                  collapsed ? 'justify-center px-0' : 'gap-3 px-3'
                } py-2.5 rounded-lg transition-all text-left group relative ${
                  isActive
                    ? 'bg-[#eff4ff] text-[#004ac6] font-semibold shadow-xs'
                    : 'text-[#434655] hover:bg-[#f0f4fc] hover:text-[#0b1c30]'
                }`}
                title={collapsed ? item.label : undefined}
                type="button"
              >
                <div className={`${isActive ? 'text-[#004ac6]' : 'text-[#737686] group-hover:text-[#0b1c30]'}`}>
                  {item.icon}
                </div>
                {!collapsed && (
                  <span className="text-sm font-medium tracking-tight truncate">
                    {item.label}
                  </span>
                )}

                {item.badge && !collapsed && (
                  <span className="ml-auto bg-[#ba1a1a] text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
                {item.badge && collapsed && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#ba1a1a]" />
                )}

                {/* Left Active Indicator Strip */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#004ac6] rounded-r-md" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom User Area: Clean Single-Row Tenant Info & Version with Update */}
      <div className="p-2.5 border-t border-[#edf2f9] bg-[#fafcff]/60">
        {collapsed ? (
          /* Collapsed Mode: Avatar with tooltip and update icon if present */
          <div className="flex flex-col items-center gap-2">
            {hasUpdate ? (
              <button
                type="button"
                onClick={handleTriggerAutoUpdate}
                disabled={isUpdating}
                className="w-8 h-8 rounded-lg bg-[#eff4ff] hover:bg-[#dbeafe] text-[#004ac6] border border-[#bfdbfe] flex items-center justify-center cursor-pointer transition-all relative shadow-2xs group"
                title={`租户: ${tenantId} | 发现新版本 ${latestVersion}，点击自动更新`}
              >
                {isUpdating ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-[#004ac6]" />
                ) : (
                  <>
                    <Download className="w-4 h-4 text-[#004ac6] animate-bounce" />
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#004ac6] ring-2 ring-white" />
                  </>
                )}
              </button>
            ) : (
              <div 
                className="w-8 h-8 rounded-lg bg-[#eff4ff] text-[#004ac6] border border-[#dce9ff] flex items-center justify-center font-mono font-bold text-[10px] select-none cursor-default"
                title={`租户号: ${tenantId} | 版本: ${version} (最新)`}
              >
                {tenantId.replace('XR-', '')}
              </div>
            )}
          </div>
        ) : (
          /* Expanded Mode: Single-line clean representation */
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 px-1">
              {/* 租户信息（作为用户标识） */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-md bg-[#eff4ff] text-[#004ac6] border border-[#dce9ff] flex items-center justify-center font-bold text-[10px] font-mono shrink-0 select-none">
                  XR
                </div>
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="font-mono text-xs font-semibold text-[#0b1c30] truncate" title={`租户号: ${tenantId}`}>
                    {tenantId}
                  </span>
                </div>
              </div>

              {/* 版本号 / 更新下载动作 */}
              <div className="flex items-center gap-1.5 shrink-0">
                {hasUpdate ? (
                  <button
                    type="button"
                    onClick={handleTriggerAutoUpdate}
                    disabled={isUpdating}
                    className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-[#eff4ff] hover:bg-[#dbeafe] active:bg-[#bfdbfe] text-[#004ac6] border border-[#bfdbfe] transition-all cursor-pointer group shadow-2xs"
                    title={`当前 ${version}，发现新版本 ${latestVersion}，点击立即自动更新`}
                  >
                    {isUpdating ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-[#004ac6]" />
                        <span className="font-mono text-[11px] font-bold">{updateProgress}%</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5 text-[#004ac6] group-hover:translate-y-0.5 transition-transform" />
                        <span className="font-mono text-[11px] font-semibold">{version}</span>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1 text-[11px] font-mono text-[#737686]">
                    <span>{version}</span>
                    <button
                      type="button"
                      onClick={() => dispatch(resetUpdateDemo())}
                      className="text-[#94a3b8] hover:text-[#004ac6] p-0.5 rounded transition-colors cursor-pointer"
                      title="已是最新 (点击可模拟发现新版本)"
                    >
                      <CheckCircle2 className="w-3 h-3 text-[#10b981]" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 更新中的微型进度条 */}
            {isUpdating && (
              <div className="w-full bg-[#e2e8f0] h-1 rounded-full overflow-hidden">
                <div 
                  className="bg-[#004ac6] h-full rounded-full transition-all duration-150"
                  style={{ width: `${updateProgress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
