import React from 'react';
import { Calendar, Play, Search, RotateCcw, X } from 'lucide-react';
import { OrderStatus } from '../../types';

interface OrderFilterBarProps {
  filterStatus: 'all' | OrderStatus;
  onTabChange: (status: 'all' | OrderStatus) => void;
  isAutoGuarding: boolean;
  onToggleGuarding: () => void;
  keywordInput: string;
  setKeywordInput: (v: string) => void;
  startInput: string;
  setStartInput: (v: string) => void;
  endInput: string;
  setEndInput: (v: string) => void;
  onSearch: () => void;
  onReset: () => void;
}

const STATUS_TABS: { label: string; value: 'all' | OrderStatus }[] = [
  { label: '全部', value: 'all' },
  { label: '成功', value: 'success' },
  { label: '待处理', value: 'pending' },
  { label: '失败', value: 'failed' },
  { label: '取消', value: 'cancelled' },
];

export const OrderFilterBar: React.FC<OrderFilterBarProps> = ({
  filterStatus,
  onTabChange,
  isAutoGuarding,
  onToggleGuarding,
  keywordInput,
  setKeywordInput,
  startInput,
  setStartInput,
  endInput,
  setEndInput,
  onSearch,
  onReset
}) => {
  return (
    <div className="mb-3 shrink-0 flex flex-col gap-2.5">
      {/* 状态切换 Tabs 与开始值守按钮 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center bg-[#edf4ff] p-0.5 rounded-lg border border-[#dce9ff] text-xs">
          {STATUS_TABS.map((tab) => {
            const isActive = filterStatus === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onTabChange(tab.value)}
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

        {/* 开始值守按钮 */}
        <button
          type="button"
          onClick={onToggleGuarding}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-2xs select-none ${
            isAutoGuarding
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
              : 'bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] text-white'
          }`}
          title={isAutoGuarding ? '点击可暂停值守' : '点击启动订单全自动值守'}
        >
          {isAutoGuarding ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
              <span>值守中</span>
            </>
          ) : (
            <>
              <Play className="w-3 h-3 fill-current" />
              <span>开始值守</span>
            </>
          )}
        </button>
      </div>

      {/* 搜索与筛选表单行 */}
      <div className="bg-white p-3 rounded-xl border border-[#dce9ff] shadow-2xs">
        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {/* 宽幅搜索框 */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#737686] pointer-events-none" />
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder="搜索 OTA订单号、中台单号、客人姓名、手机号..."
              className="w-full h-8.5 pl-8.5 pr-8 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs text-[#0b1c30] placeholder-[#94a3b8] outline-hidden transition-colors"
            />
            {keywordInput && (
              <button
                type="button"
                onClick={() => setKeywordInput('')}
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
              type="text"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              placeholder="入住开始 (YYYY-MM-DD)"
              className="w-full h-8.5 pl-3 pr-8 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs font-mono text-[#0b1c30] placeholder-[#94a3b8] outline-hidden transition-colors"
            />
            <Calendar className="w-3.5 h-3.5 text-[#737686] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <span className="text-xs text-[#737686] shrink-0">至</span>

          {/* 入住结束日期 */}
          <div className="relative w-36 shrink-0">
            <input
              type="text"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              placeholder="入住结束 (YYYY-MM-DD)"
              className="w-full h-8.5 pl-3 pr-8 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs font-mono text-[#0b1c30] placeholder-[#94a3b8] outline-hidden transition-colors"
            />
            <Calendar className="w-3.5 h-3.5 text-[#737686] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 查询订单按钮 */}
          <button
            type="button"
            onClick={onSearch}
            className="h-8.5 px-3.5 bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer select-none shrink-0 inline-flex items-center gap-1.5"
          >
            <Search className="w-3.5 h-3.5" />
            <span>查询</span>
          </button>

          {/* 重置筛选按钮 */}
          <button
            type="button"
            onClick={onReset}
            className="h-8.5 px-3 bg-white hover:bg-[#eff4ff] text-[#434655] hover:text-[#0b1c30] border border-[#dce9ff] rounded-lg text-xs font-medium transition-colors cursor-pointer select-none shrink-0 inline-flex items-center gap-1 shadow-2xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重置</span>
          </button>
        </div>
      </div>
    </div>
  );
};
