import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { toggleChannelDutyThunk, syncDutyStatusThunk } from '../../store/slices/orderGuardianSlice';
import { ChannelBadge } from '../common/ChannelBadge';
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
} from 'lucide-react';
import type { DutyCoordinatorStatus } from '../../types';

const CHANNELS_CONFIG = [
  { code: 'MEITUAN', name: '美团酒店', desc: '美团待处理订单自动发现与导入' },
  { code: 'MEITUAN_BIZ', name: '美团商旅', desc: '美团商旅独立订单列表自动同步' },
  { code: 'DOUYIN', name: '抖音生活服务', desc: '抖音新订/退款订单业务协同值守' },
  { code: 'CTRIP', name: '携程旅行', desc: '携程管家订单同步与确认号回填' },
];

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
  const [collapsed, setCollapsed] = useState(false);

  const activeCount = Object.values(channelDuty).filter((c) => c.status === 'RUNNING').length;
  const coordinatorBadge = formatCoordinatorBadge(coordinatorStatus);

  // 组件挂载时获取一次当前值守与工位身份
  useEffect(() => {
    void dispatch(syncDutyStatusThunk());
  }, [dispatch]);

  // 当有值守渠道正在启动或运行时，每 2 秒轮询同步状态与任务调度日志
  useEffect(() => {
    const hasActive = Object.values(channelDuty).some(
      (c) => c.status === 'RUNNING' || c.status === 'STARTING'
    );
    if (!hasActive) return;

    const timer = setInterval(() => {
      void dispatch(syncDutyStatusThunk());
    }, 2000);

    return () => clearInterval(timer);
  }, [dispatch, channelDuty]);

  const handleToggle = (channelCode: string) => {
    void dispatch(toggleChannelDutyThunk(channelCode));
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
                {activeCount} / {CHANNELS_CONFIG.length} 运行中
              </span>
            </div>
            <p className="text-[11px] text-[#737686]">按需多渠道 CDP 协同与中台任务长轮询调度</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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

      {/* 渠道自动化值守列表 */}
      {!collapsed && (
        <div className="divide-y divide-[#edf2f9] border border-[#e2e8f0] rounded-lg overflow-hidden mt-2.5 bg-white">
          {CHANNELS_CONFIG.map(({ code, name, desc }) => {
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
    </section>
  );
};
