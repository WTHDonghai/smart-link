import React from 'react';
import { GuardianStats } from '../../types';

interface OrderStatsCardsProps {
  stats: GuardianStats;
}

export const OrderStatsCards: React.FC<OrderStatsCardsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-3 shrink-0">
      {/* 卡片 1: 今日导入 */}
      <div className="bg-white rounded-xl p-3.5 flex flex-col justify-between h-[74px] border border-[#dce9ff] shadow-2xs">
        <span className="text-2xl font-mono font-bold text-[#0b1c30] leading-none">
          {stats.todayImported}
        </span>
        <span className="text-xs font-medium text-[#737686]">
          今日导入
        </span>
      </div>

      {/* 卡片 2: 待确认 (琥珀橙) */}
      <div className="bg-amber-50/70 rounded-xl p-3.5 flex flex-col justify-between h-[74px] border border-amber-200 shadow-2xs">
        <span className="text-2xl font-mono font-bold text-amber-800 leading-none">
          {stats.pendingConfirm}
        </span>
        <span className="text-xs font-medium text-amber-700">
          待确认
        </span>
      </div>

      {/* 卡片 3: 已导入 (祖母绿) */}
      <div className="bg-emerald-50/70 rounded-xl p-3.5 flex flex-col justify-between h-[74px] border border-emerald-200 shadow-2xs">
        <span className="text-2xl font-mono font-bold text-emerald-700 leading-none">
          {stats.imported}
        </span>
        <span className="text-xs font-medium text-emerald-600">
          已导入
        </span>
      </div>

      {/* 卡片 4: 失败 (玫瑰红) */}
      <div className="bg-rose-50/70 rounded-xl p-3.5 flex flex-col justify-between h-[74px] border border-rose-200 shadow-2xs">
        <span className="text-2xl font-mono font-bold text-rose-700 leading-none">
          {stats.failed}
        </span>
        <span className="text-xs font-medium text-rose-600">
          失败
        </span>
      </div>
    </div>
  );
};
