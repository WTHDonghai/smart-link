import React from 'react';
import { Calendar, Search, RotateCcw, X } from 'lucide-react';

export interface OrderFilterBarProps {
  status: string;
  onStatusChange: (status: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  arrivalStart: string;
  arrivalEnd: string;
  onArrivalStartChange: (val: string) => void;
  onArrivalEndChange: (val: string) => void;
  onSearch: () => void;
  onReset: () => void;
  loading?: boolean;
}

const STATUS_TABS = [
  { label: '全部', value: 'all' },
  { label: '待确认', value: 'PENDING' },
  { label: '已导入', value: 'SUCCESS' },
  { label: '失败', value: 'FAILED' },
  { label: '已取消', value: 'CANCEL' },
  { label: '导入中', value: 'IMPORTING' },
];

export const OrderFilterBar: React.FC<OrderFilterBarProps> = ({
  status,
  onStatusChange,
  query,
  onQueryChange,
  arrivalStart,
  arrivalEnd,
  onArrivalStartChange,
  onArrivalEndChange,
  onSearch,
  onReset,
  loading = false,
}) => {
  const currentStatusNormalized = (status || 'all').trim().toUpperCase();

  return (
    <div className="mb-3 shrink-0 flex flex-col gap-2.5" role="search" aria-label="订单筛选与搜索">
      {/* 状态切换 Tabs */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center bg-[#edf4ff] p-0.5 rounded-lg border border-[#dce9ff] text-xs">
          {STATUS_TABS.map((tab) => {
            const isActive =
              tab.value === 'all'
                ? currentStatusNormalized === 'ALL'
                : currentStatusNormalized === tab.value.toUpperCase();

            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onStatusChange(tab.value)}
                className={`px-3 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-[#004ac6] shadow-2xs font-semibold'
                    : 'text-[#434655] hover:text-[#0b1c30]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 搜索与筛选表单行 */}
      <div className="bg-white p-3 rounded-xl border border-[#dce9ff] shadow-2xs">
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {/* 宽幅搜索框 */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#737686] pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder="搜索 OTA 订单号、中台单号、客人姓名、手机号..."
              className="w-full h-8.5 pl-8.5 pr-8 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs text-[#0b1c30] placeholder-[#94a3b8] outline-hidden transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#0b1c30] p-0.5 cursor-pointer"
                title="清空搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 入住开始日期 */}
          <div className="relative w-36 shrink-0">
            <input
              type="date"
              value={arrivalStart}
              onChange={(e) => onArrivalStartChange(e.target.value)}
              placeholder="入住开始"
              className="w-full h-8.5 pl-3 pr-8 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs font-mono text-[#0b1c30] placeholder-[#94a3b8] outline-hidden transition-colors"
            />
            <Calendar className="w-3.5 h-3.5 text-[#737686] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <span className="text-xs text-[#737686] shrink-0">至</span>

          {/* 入住结束日期 */}
          <div className="relative w-36 shrink-0">
            <input
              type="date"
              value={arrivalEnd}
              onChange={(e) => onArrivalEndChange(e.target.value)}
              placeholder="入住结束"
              className="w-full h-8.5 pl-3 pr-8 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs font-mono text-[#0b1c30] placeholder-[#94a3b8] outline-hidden transition-colors"
            />
            <Calendar className="w-3.5 h-3.5 text-[#737686] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 查询订单按钮 */}
          <button
            type="button"
            onClick={onSearch}
            disabled={loading}
            className="h-8.5 px-3.5 bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer select-none shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{loading ? '查询中...' : '查询'}</span>
          </button>

          {/* 重置筛选按钮 */}
          <button
            type="button"
            onClick={onReset}
            disabled={loading}
            className="h-8.5 px-3 bg-white hover:bg-[#eff4ff] text-[#434655] hover:text-[#0b1c30] border border-[#dce9ff] rounded-lg text-xs font-medium transition-colors cursor-pointer select-none shrink-0 inline-flex items-center gap-1 shadow-2xs disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置</span>
          </button>
        </div>
      </div>
    </div>
  );
};
