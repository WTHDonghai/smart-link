import React from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { toggleChannelDutyThunk } from '../../store/slices/orderGuardianSlice';
import { ChannelBadge } from '../common/ChannelBadge';
import { Play, Square, Loader2, AlertCircle, ShieldCheck, Activity } from 'lucide-react';
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

  const activeCount = Object.values(channelDuty).filter((c) => c.status === 'RUNNING').length;
  const coordinatorBadge = formatCoordinatorBadge(coordinatorStatus);

  const handleToggle = (channelCode: string) => {
    void dispatch(toggleChannelDutyThunk(channelCode));
  };

  return (
    <section className="bg-white border border-[#e2e8f0] rounded-xl p-4 shadow-xs" aria-label="渠道值守控制面板">
      {/* 头部标题与全局协调器徽标 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#f1f5f9]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#eff4ff] flex items-center justify-center text-[#004ac6]">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#0b1c30]">渠道自动化值守</h3>
            <p className="text-xs text-[#737686]">按需多渠道 CDP 协同与中台任务长轮询调度</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-full ${coordinatorBadge.tone}`}
            role="status"
          >
            <Activity className="w-3.5 h-3.5" />
            {coordinatorBadge.label}
          </span>
          <span className="text-xs text-[#737686] bg-[#f8f9ff] px-2.5 py-1 border border-[#e2e8f0] rounded-full font-mono">
            {activeCount} 个渠道值守中
          </span>
        </div>
      </div>

      {/* 渠道值守卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        {CHANNELS_CONFIG.map(({ code, name, desc }) => {
          const info = channelDuty[code] || { channelCode: code, status: 'STOPPED' };
          const isRunning = info.status === 'RUNNING';
          const isStarting = info.status === 'STARTING';
          const isDegraded = info.status === 'DEGRADED';

          return (
            <div
              key={code}
              className={`flex flex-col justify-between p-3.5 rounded-lg border transition-all ${
                isRunning
                  ? 'border-emerald-200 bg-emerald-50/20'
                  : isDegraded
                  ? 'border-rose-200 bg-rose-50/20'
                  : 'border-[#e2e8f0] bg-white hover:border-[#cbd5e1]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ChannelBadge channelCode={code} />
                    <span className="text-sm font-bold text-[#0b1c30]">{name}</span>
                  </div>
                  {/* 状态徽标 */}
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
                <p className="text-xs text-[#737686] mt-2 line-clamp-1">{desc}</p>
              </div>

              <div className="mt-4 pt-2.5 border-t border-[#f1f5f9] flex items-center justify-between">
                <span className="text-[11px] text-[#94a3b8] font-mono">
                  {info.lastStartedAt
                    ? `启动于 ${new Date(info.lastStartedAt).toLocaleTimeString('zh-CN', { hour12: false })}`
                    : '无活跃会话'}
                </span>

                <button
                  type="button"
                  disabled={isStarting}
                  onClick={() => handleToggle(code)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isRunning
                      ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                      : 'bg-[#004ac6] text-white hover:bg-[#003da6]'
                  }`}
                >
                  {isStarting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      启动中
                    </>
                  ) : isRunning ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      停止值守
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      开始值守
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
