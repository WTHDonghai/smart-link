import React, { useState, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  toggleChannelDutyThunk,
  syncDutyStatusThunk,
  setConfirmImportEnabledThunk,
} from '../../store/slices/orderGuardianSlice';
import { fetchChannelMappingData } from '../../store/slices/channelSlice';
import { setCurrentTab } from '../../store/slices/appSlice';
import { ChannelBadge } from '../common/ChannelBadge';
import { EmptyState } from '../common/EmptyState';
import { deriveMappedDutyChannels } from '../../utils/channelDutyHelpers';
import {
  Play,
  Square,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Activity,
  Server,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import type { DutyCoordinatorStatus } from '../../types';

function formatCoordinatorBadge(status: DutyCoordinatorStatus) {
  switch (status) {
    case 'CLAIMING':
      return { label: '正在领取任务', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
    case 'EXECUTING':
      return { label: '执行中', tone: 'bg-purple-50 text-purple-700 border-purple-200' };
    case 'REPORTING':
      return { label: '提交结果中', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    case 'IDLE':
      return { label: '等待平台任务', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'CLAIM_BACKOFF':
      return { label: '任务领取重试中', tone: 'bg-amber-50 text-amber-800 border-amber-200' };
    case 'DEGRADED':
      return { label: '任务协调异常', tone: 'bg-rose-50 text-rose-700 border-rose-200' };
    case 'STOPPED':
    default:
      return { label: '任务协调未运行', tone: 'bg-slate-50 text-slate-600 border-slate-200' };
  }
}

export const ChannelDutyPanel: React.FC = () => {
  const dispatch = useAppDispatch();
  const channelDuty = useAppSelector((state) => state.orderGuardian.channelDuty);
  const coordinatorStatus = useAppSelector((state) => state.orderGuardian.coordinatorStatus);
  const station = useAppSelector((state) => state.orderGuardian.station);
  const confirmImportEnabled = useAppSelector((state) => state.orderGuardian.confirmImportEnabled);

  // 从渠道切片获取接口返回的用户真实渠道映射数据
  const { mappings, isLoading: isMappingsLoading, error: mappingsError } = useAppSelector(
    (state) => state.channel
  );

  const [collapsed, setCollapsed] = useState(false);
  const [isSwitchingConfirmImport, setIsSwitchingConfirmImport] = useState(false);

  // 纯函数动态计算当前用户已映射的渠道配置列表
  const mappedChannels = useMemo(() => deriveMappedDutyChannels(mappings), [mappings]);

  // 统计已映射渠道中处于运行态的数量
  const activeCount = useMemo(
    () => mappedChannels.filter((c) => channelDuty[c.code]?.status === 'RUNNING').length,
    [mappedChannels, channelDuty]
  );

  const coordinatorBadge = formatCoordinatorBadge(coordinatorStatus);

  // 组件挂载时拉取后台值守状态与用户渠道映射数据（周期性轮询由 App.tsx 全局时钟统一定时维持）
  useEffect(() => {
    void dispatch(syncDutyStatusThunk());
    void dispatch(fetchChannelMappingData());
  }, [dispatch]);

  const handleToggle = (channelCode: string) => {
    void dispatch(toggleChannelDutyThunk(channelCode));
  };

  const handleToggleConfirmImport = async (targetEnabled: boolean) => {
    if (isSwitchingConfirmImport) return;
    setIsSwitchingConfirmImport(true);
    try {
      await dispatch(setConfirmImportEnabledThunk(targetEnabled)).unwrap();
    } catch {
      // 错误已由 thunk 处理并弹出 Toast 提示
    } finally {
      setIsSwitchingConfirmImport(false);
    }
  };

  const handleRefreshMappings = () => {
    void dispatch(fetchChannelMappingData());
  };

  return (
    <section className="bg-white border border-[#e2e8f0] rounded-xl p-3.5 shadow-xs" aria-label="渠道值守控制面板">
      {/* 头部标题与全局协调器徽标 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-[#f1f5f9]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#eff4ff] flex items-center justify-center text-[#004ac6]">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[#0b1c30]">渠道自动化值守</h3>
              <span className="text-[11px] text-[#737686] bg-[#f8f9ff] px-2 py-0.5 border border-[#e2e8f0] rounded-full font-mono">
                {activeCount} / {mappedChannels.length} 运行中
              </span>
            </div>
            <p className="text-[11px] text-[#737686]">按需多渠道 CDP 协同与中台任务长轮询调度</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* 订单确认号回填开关（开发调试安全保护） */}
          <div
            className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              confirmImportEnabled
                ? 'bg-slate-50 text-slate-700 border-slate-200'
                : 'bg-amber-50 text-amber-800 border-amber-300'
            }`}
            title="开启后自动向渠道后台回填确认号并接单；关闭后拦截回填接单，防止开发调试误确认真实订单"
          >
            <span className="select-none font-medium">确认号回填</span>
            <button
              type="button"
              role="switch"
              disabled={isSwitchingConfirmImport}
              aria-checked={confirmImportEnabled}
              aria-label="控制是否回填订单确认号"
              onClick={() => void handleToggleConfirmImport(!confirmImportEnabled)}
              className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                confirmImportEnabled
                  ? 'bg-[#004ac6] focus:ring-[#004ac6]'
                  : 'bg-slate-300 focus:ring-amber-500'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                  confirmImportEnabled ? 'translate-x-3' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`text-[11px] font-medium select-none ${confirmImportEnabled ? 'text-emerald-700' : 'text-amber-800 font-semibold'}`}>
              {confirmImportEnabled ? '开启' : '暂停'}
            </span>
          </div>

          {station?.stationId && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-full bg-slate-50 text-slate-700 border-slate-200"
              title={`主机名: ${station.hostname || '-'} | IP: ${station.ip || '-'} | MAC: ${station.macAddress || '-'}`}
              role="status"
            >
              <Server className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-mono text-[11px]">工位: {station.stationId}</span>
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-full ${coordinatorBadge.tone}`}
            role="status"
          >
            <Activity className="w-3.5 h-3.5" />
            {coordinatorBadge.label}
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded-md text-[#737686] hover:text-[#0b1c30] hover:bg-[#f1f5f9] transition-colors cursor-pointer"
            title={collapsed ? '展开渠道值守列表' : '收起渠道值守列表'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 调试保护警示横幅：当确认号回填开关关闭时始终显式提示 */}
      {!confirmImportEnabled && (
        <div className="mt-2.5 px-3 py-2 border border-amber-200 rounded-lg bg-amber-50/80 flex items-center justify-between gap-2 text-xs text-amber-800">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              <strong>开发调试保护中</strong>：订单确认号回填已暂停。中台派发的回填接单任务将被安全拦截，不会在渠道后台确认真实订单。
            </span>
          </div>
          <button
            type="button"
            disabled={isSwitchingConfirmImport}
            onClick={() => void handleToggleConfirmImport(true)}
            className="text-xs font-semibold text-[#004ac6] hover:underline cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            恢复开启
          </button>
        </div>
      )}

      {/* 渠道自动化值守列表 */}
      {!collapsed && (
        <div className="mt-2.5">
          {/* 状态 1: 正在加载映射数据且尚未有本地缓存 */}
          {isMappingsLoading && mappedChannels.length === 0 && (
            <div className="flex items-center justify-center p-6 border border-[#e2e8f0] rounded-lg bg-[#f8f9ff] text-[#737686] text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#004ac6]" />
              <span>正在从文旅中台同步已映射渠道...</span>
            </div>
          )}

          {/* 状态 2: 映射数据加载失败且无已映射渠道 */}
          {!isMappingsLoading && mappingsError && mappedChannels.length === 0 && (
            <div className="p-4 border border-rose-200 rounded-lg bg-rose-50/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-rose-700 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>加载渠道映射失败: {mappingsError}</span>
              </div>
              <button
                type="button"
                onClick={handleRefreshMappings}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#004ac6] hover:underline cursor-pointer shrink-0"
              >
                <RefreshCw className="w-3 h-3" />
                <span>重试</span>
              </button>
            </div>
          )}

          {/* 状态 3: 接口成功返回但未映射任何渠道 (空状态) */}
          {!isMappingsLoading && !mappingsError && mappedChannels.length === 0 && (
            <div className="border border-[#e2e8f0] rounded-lg bg-white p-6">
              <EmptyState
                title="暂未映射任何 OTA 渠道"
                description="订单自动化值守依赖已映射的渠道配置。请先在「渠道映射」中绑定 OTA 与文旅系统接收通道。"
                actionText="前往配置渠道映射"
                onAction={() => dispatch(setCurrentTab('channel-mapping'))}
              />
            </div>
          )}

          {/* 状态 4: 渲染真实已映射渠道列表 */}
          {mappedChannels.length > 0 && (
            <div className="divide-y divide-[#edf2f9] border border-[#e2e8f0] rounded-lg overflow-hidden bg-white">
              {mappedChannels.map(({ code, name, desc }) => {
                const info = channelDuty[code] || { channelCode: code, status: 'STOPPED' };
                const isRunning = info.status === 'RUNNING';
                const isStarting = info.status === 'STARTING';
                const isDegraded = info.status === 'DEGRADED';

                return (
                  <div
                    key={code}
                    className={`px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors hover:bg-[#f8faff] ${
                      isRunning ? 'bg-emerald-50/15' : isDegraded ? 'bg-rose-50/15' : 'bg-white'
                    }`}
                  >
                    {/* 左侧：渠道 Badge + 名称 + 业务说明 */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <ChannelBadge channelCode={code} size="sm" />
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-[#0b1c30] whitespace-nowrap">{name}</span>
                        <span className="text-xs text-[#737686] truncate max-w-[360px] hidden sm:inline-block">
                          {desc}
                        </span>
                      </div>
                    </div>

                    {/* 中间：会话活跃时间与运行状态 */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] text-[#737686] font-mono hidden md:inline-block">
                        {info.lastStartedAt
                          ? `启动于 ${new Date(info.lastStartedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                          : '无活跃会话'}
                      </span>

                      {isRunning && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          值守中
                        </span>
                      )}
                      {isStarting && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          正在启动
                        </span>
                      )}
                      {isDegraded && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                          <AlertCircle className="w-3 h-3" />
                          需要处理
                        </span>
                      )}
                      {!isRunning && !isStarting && !isDegraded && (
                        <span className="text-[11px] text-[#94a3b8] bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                          未启动
                        </span>
                      )}
                    </div>

                    {/* 右侧：操作按钮 */}
                    <div className="shrink-0">
                      <button
                        type="button"
                        disabled={isStarting}
                        onClick={() => handleToggle(code)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${
                          isRunning
                            ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 active:bg-rose-200'
                            : 'bg-[#004ac6] text-white hover:bg-[#003da6] active:bg-[#002f80] shadow-2xs'
                        }`}
                      >
                        {isStarting ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>启动中</span>
                          </>
                        ) : isRunning ? (
                          <>
                            <Square className="w-3 h-3 fill-current" />
                            <span>停止值守</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" />
                            <span>开始值守</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
