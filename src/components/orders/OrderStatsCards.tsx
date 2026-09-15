import React from 'react';
import { GuardianStats } from '../../types';

interface OrderStatsCardsProps {
  stats: GuardianStats;
}

export const OrderStatsCards: React.FC<OrderStatsCardsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-4 gap-3.5 mb-3 shrink-0">
      {/* 卡片 1: 今日导入 */}
      <div className="bg-[#f8f9fa] rounded-md p-3.5 flex flex-col justify-between h-[74px] border border-[#f0f2f5]">
        <span className="text-2xl font-bold text-[#0b1c30] leading-none">
          {stats.todayImported}
        </span>
        <span className="text-xs text-[#6b7280]">
          今日导入
        </span>
      </div>

      {/* 卡片 2: 待确认 (浅橙米黄底) */}
      <div className="bg-[#fff8ee] rounded-md p-3.5 flex flex-col justify-between h-[74px]">
        <span className="text-2xl font-bold text-[#c2410c] leading-none">
          {stats.pendingConfirm}
        </span>
        <span className="text-xs text-[#78716c]">
          待确认
        </span>
      </div>

      {/* 卡片 3: 已导入 (薄荷浅绿底) */}
      <div className="bg-[#e6f7f0] rounded-md p-3.5 flex flex-col justify-between h-[74px]">
        <span className="text-2xl font-bold text-[#0d9488] leading-none">
          {stats.imported}
        </span>
        <span className="text-xs text-[#047857]">
          已导入
        </span>
      </div>

      {/* 卡片 4: 失败 (浅粉红底) */}
      <div className="bg-[#fdeef0] rounded-md p-3.5 flex flex-col justify-between h-[74px]">
        <span className="text-2xl font-bold text-[#dc2626] leading-none">
          {stats.failed}
        </span>
        <span className="text-xs text-[#991b1b]">
          失败
        </span>
      </div>
    </div>
  );
};
