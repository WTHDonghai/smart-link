import React from 'react';
import { Calendar, Play } from 'lucide-react';
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
    <div className="mb-3 shrink-0">
      {/* 状态切换 Tabs 与开始值守按钮 */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((tab) => {
            const isActive = filterStatus === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onTabChange(tab.value)}
                className={`px-3.5 py-1.5 rounded text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#004ac6] text-white shadow-2xs'
                    : 'bg-[#f3f4f6] text-[#374151] hover:bg-[#e5e7eb]'
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
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
            isAutoGuarding
              ? 'bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0] hover:bg-[#d1fae5]'
              : 'bg-[#10b981] hover:bg-[#059669] text-white active:bg-[#047857]'
          }`}
          title={isAutoGuarding ? '点击可暂停值守' : '点击启动订单全自动值守'}
        >
          {isAutoGuarding ? (
            <>
              <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
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
      <div>
        {/* 上排小标签 */}
        <div className="flex items-center justify-between text-xs text-[#4b5563] mb-1.5 px-0.5">
          <div>订单或客人</div>
          <div className="flex items-center gap-12 pr-44">
            <span>入住开始</span>
            <span className="text-gray-400">至</span>
            <span>入住结束</span>
          </div>
        </div>

        {/* 下排输入控件 */}
        <div className="flex items-center gap-3">
          {/* 宽幅搜索框 */}
          <div className="flex-1">
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder="搜索订单号或客人姓名"
              className="w-full h-9 px-3 bg-white border border-[#d1d5db] rounded text-xs text-[#111827] placeholder-[#9ca3af] outline-none focus:border-[#004ac6]"
            />
          </div>

          {/* 入住开始日期 */}
          <div className="relative w-40">
            <input
              type="text"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="w-full h-9 pl-3 pr-8 bg-white border border-[#d1d5db] rounded text-xs text-[#111827] placeholder-[#9ca3af] outline-none focus:border-[#004ac6]"
            />
            <Calendar className="w-3.5 h-3.5 text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <span className="text-xs text-[#6b7280]">至</span>

          {/* 入住结束日期 */}
          <div className="relative w-40">
            <input
              type="text"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="w-full h-9 pl-3 pr-8 bg-white border border-[#d1d5db] rounded text-xs text-[#111827] placeholder-[#9ca3af] outline-none focus:border-[#004ac6]"
            />
            <Calendar className="w-3.5 h-3.5 text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 查询订单按钮 */}
          <button
            type="button"
            onClick={onSearch}
            className="h-9 px-5 bg-[#004ac6] hover:bg-[#003ea8] text-white rounded text-xs font-medium transition-colors cursor-pointer shrink-0"
          >
            查询订单
          </button>

          {/* 重置筛选按钮 */}
          <button
            type="button"
            onClick={onReset}
            className="h-9 px-4 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[#374151] border border-[#e5e7eb] rounded text-xs font-medium transition-colors cursor-pointer shrink-0"
          >
            重置筛选
          </button>
        </div>
      </div>
    </div>
  );
};
