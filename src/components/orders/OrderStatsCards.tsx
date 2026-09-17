import React from 'react';
import type { ToolkitOrderStatistics, GuardianStats } from '../../types';

interface OrderStatsCardsProps {
  statistics?: ToolkitOrderStatistics;
  stats?: GuardianStats;
  loading?: boolean;
}

export const OrderStatsCards: React.FC<OrderStatsCardsProps> = ({
  statistics,
  stats,
  loading = false,
}) => {
  const today = statistics?.today ?? stats?.todayImported ?? 0;
  const pending = statistics?.pending ?? stats?.pendingConfirm ?? 0;
  const success = statistics?.success ?? stats?.imported ?? 0;
  const failed = statistics?.failed ?? stats?.failed ?? 0;

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-3 shrink-0"
      role="region"
      aria-label="订单指标统计"
    >
      {/* 卡片 1: 今日导入 */}
      <div className="bg-white rounded-xl p-3.5 flex flex-col justify-between h-[74px] border border-[#dce9ff] shadow-2xs">
        <span
          className={`text-2xl font-mono font-bold text-[#0b1c30] leading-none ${
            loading ? 'animate-pulse opacity-50' : ''
          }`}
        >
          {today}
        </span>
        <span className="text-xs font-medium text-[#737686]">今日导入</span>
      </div>

      {/* 卡片 2: 待确认 (琥珀橙) */}
      <div className="bg-amber-50/70 rounded-xl p-3.5 flex flex-col justify-between h-[74px] border border-amber-200 shadow-2xs">
        <span
          className={`text-2xl font-mono font-bold text-amber-800 leading-none ${
            loading ? 'animate-pulse opacity-50' : ''
          }`}
        >
          {pending}
        </span>
        <span className="text-xs font-medium text-amber-700">待确认</span>
      </div>

      {/* 卡片 3: 已导入 (祖母绿) */}
      <div className="bg-emerald-50/70 rounded-xl p-3.5 flex flex-col justify-between h-[74px] border border-emerald-200 shadow-2xs">
        <span
          className={`text-2xl font-mono font-bold text-emerald-700 leading-none ${
            loading ? 'animate-pulse opacity-50' : ''
          }`}
        >
          {success}
        </span>
        <span className="text-xs font-medium text-emerald-600">已导入</span>
      </div>

      {/* 卡片 4: 失败 (玫瑰红) */}
      <div className="bg-rose-50/70 rounded-xl p-3.5 flex flex-col justify-between h-[74px] border border-rose-200 shadow-2xs">
        <span
          className={`text-2xl font-mono font-bold text-rose-700 leading-none ${
            loading ? 'animate-pulse opacity-50' : ''
          }`}
        >
          {failed}
        </span>
        <span className="text-xs font-medium text-rose-600">失败</span>
      </div>
    </div>
  );
};
