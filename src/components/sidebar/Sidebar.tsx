import React from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { setCurrentTab, toggleSidebar, showToast } from '../../store/slices/appSlice';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import { logout } from '../../store/slices/authSlice';
import { selectGuardianStats } from '../../store/slices/orderGuardianSlice';
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
  LogOut
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
  const guardianStats = useAppSelector(selectGuardianStats);
  const pendingManualOrders = guardianStats.pendingManual ?? 0;
  const {
    update,
    hasUpdate,
    isUpdating,
    requestUpdate,
  } = useAppUpdate();
  
  // Tenant and version state
  const tenantId = useAppSelector(
    (state) => state.auth.tenantId || state.auth.tokens?.tenantId || ''
  );
  const version = update.currentVersion;
  const latestVersion = update.targetVersion;
  const updateProgress = update.progressPercent ?? 0;
  const [tenantMenuOpen, setTenantMenuOpen] = React.useState(false);
  const tenantMenuRef = React.useRef<HTMLDivElement>(null);
  const tenantTriggerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!tenantMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        tenantMenuRef.current &&
        !tenantMenuRef.current.contains(target) &&
        tenantTriggerRef.current &&
        !tenantTriggerRef.current.contains(target)
      ) {
        setTenantMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTenantMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [tenantMenuOpen]);

  const handleLogout = () => {
    setTenantMenuOpen(false);
    dispatch(logout());
    dispatch(
      showToast({
        title: '已退出登录',
        description: '您已成功退出当前账号授权',
        type: 'info',
      })
    );
  };

  const handleTriggerAutoUpdate = () => {
    if (isUpdating) return;
    requestUpdate();
  };

  const navItems: NavItem[] = [
    {
      id: 'channel-mapping',
      label: '渠道映射',
      icon: <ArrowLeftRight className="w-5 h-5 shrink-0" />
    },
    {
      id: 'hotel-sync',
      label: '门店采集',
      icon: <Building2 className="w-5 h-5 shrink-0" />
    },
    {
      id: 'product-mapping',
      label: '产品采集',
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
      <div className="p-2.5 border-t border-[#edf2f9] bg-[#fafcff]/60 relative">
        {/* 悬浮选项卡片 (Floating Popover 替代全屏弹窗) */}
        {tenantMenuOpen && (
          <div
            ref={tenantMenuRef}
            className={`absolute bottom-full mb-2 ${
              collapsed ? 'left-2 w-40' : 'left-2.5 w-48'
            } bg-white rounded-xl shadow-xl border border-[#e2e8f0] p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 select-none`}
          >
            <div className="px-2.5 py-1.5 border-b border-[#edf2f9] mb-1">
              <span className="text-[10px] text-[#737686] block">当前登录租户</span>
              <span className="font-mono text-xs font-bold text-[#0b1c30] block select-text">
                {tenantId || '未登录'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-lg transition-colors cursor-pointer text-left"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>退出登录</span>
            </button>
          </div>
        )}

        {collapsed ? (
          /* Collapsed Mode: keep account access visible beside update progress */
          <div className="flex flex-col items-center gap-2">
            <div ref={tenantTriggerRef}>
              <button
                type="button"
                onClick={() => setTenantMenuOpen((prev) => !prev)}
                className="w-8 h-8 rounded-lg bg-[#eff4ff] hover:bg-[#dbeafe] active:bg-[#d5e3fc] text-[#004ac6] border border-[#dce9ff] flex items-center justify-center font-mono font-bold text-[10px] cursor-pointer transition-colors shadow-2xs"
                title={`点击租户号 ${tenantId || '未登录'} 查看退出选项`}
              >
                {tenantId ? (tenantId.length > 4 ? tenantId.slice(0, 4) : tenantId) : 'XR'}
              </button>
            </div>
            {(hasUpdate || isUpdating) && (
              <button
                type="button"
                onClick={handleTriggerAutoUpdate}
                disabled={isUpdating}
                className="w-8 h-8 rounded-lg bg-[#eff4ff] hover:bg-[#dbeafe] text-[#004ac6] border border-[#bfdbfe] flex items-center justify-center cursor-pointer transition-all relative shadow-2xs group"
                aria-label={isUpdating ? `系统更新进度 ${updateProgress}%` : `安装系统更新 ${latestVersion}`}
                title={isUpdating ? `系统更新进度 ${updateProgress}%` : `发现新版本 ${latestVersion}，点击自动更新`}
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
            )}
          </div>
        ) : (
          /* Expanded Mode: Single-line clean representation */
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 px-1">
              {/* 点击租户ID，唤起悬浮菜单 */}
              <div ref={tenantTriggerRef} className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setTenantMenuOpen((prev) => !prev)}
                  className="flex items-center gap-2 p-1 -m-1 rounded-lg hover:bg-[#eff4ff] active:bg-[#dbeafe] transition-colors cursor-pointer group text-left w-full"
                  title="点击租户ID查看退出选项"
                >
                  <div className="w-6 h-6 rounded-md bg-[#eff4ff] group-hover:bg-[#dce9ff] text-[#004ac6] border border-[#dce9ff] flex items-center justify-center font-bold text-[10px] font-mono shrink-0 select-none transition-colors">
                    XR
                  </div>
                  <div className="flex items-baseline min-w-0">
                    <span
                      className="font-mono text-xs font-semibold text-[#0b1c30] group-hover:text-[#004ac6] whitespace-nowrap transition-colors"
                      title={`租户号: ${tenantId || '未登录'}`}
                    >
                      {tenantId || '未登录'}
                    </span>
                  </div>
                </button>
              </div>

              {/* 版本号 / 更新下载动作 */}
              <div className="flex items-center gap-1.5 shrink-0">
                {(hasUpdate || isUpdating) ? (
                  <button
                    type="button"
                    onClick={handleTriggerAutoUpdate}
                    disabled={isUpdating}
                    className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-[#eff4ff] hover:bg-[#dbeafe] active:bg-[#bfdbfe] text-[#004ac6] border border-[#bfdbfe] transition-all cursor-pointer group shadow-2xs"
                    aria-label={isUpdating ? `系统更新进度 ${updateProgress}%` : `安装系统更新 ${latestVersion}`}
                    title={isUpdating ? `系统更新进度 ${updateProgress}%` : `当前 ${version}，发现新版本 ${latestVersion}，点击立即自动更新`}
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
