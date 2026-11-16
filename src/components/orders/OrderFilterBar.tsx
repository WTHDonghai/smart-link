import React from 'react';
import { Search, RotateCcw, X, ArrowRight } from 'lucide-react';
import { SearchableSelect, type SelectOption } from '../common/SearchableSelect';
import { ORDER_TYPE_OPTIONS } from '@/src/utils/orderHelpers';
import type { ToolkitOrderFilters } from '@/src/types';

export { ORDER_TYPE_OPTIONS };

export const ORDER_STATUS_OPTIONS: SelectOption[] = [
  { label: '待确认', value: 'PENDING' },
  { label: '已导入', value: 'SUCCESS' },
  { label: '失败', value: 'FAILED' },
  { label: '已取消', value: 'CANCEL' },
  { label: '导入中', value: 'IMPORTING' },
];

export type OrderFilterValues = Pick<
  ToolkitOrderFilters,
  'unitId' | 'otaChannel' | 'status' | 'orderType' | 'otaOrderId' | 'contactName' | 'createdStart' | 'createdEnd'
>;

export interface OrderFilterBarProps {
  filters: OrderFilterValues;
  onFilterChange: (patch: Partial<OrderFilterValues>) => void;
  hotelOptions?: SelectOption[];
  channelOptions?: SelectOption[];
  onSearch: () => void;
  onReset: () => void;
  loading?: boolean;
}

export const OrderFilterBar: React.FC<OrderFilterBarProps> = ({
  filters,
  onFilterChange,
  hotelOptions = [],
  channelOptions = [],
  onSearch,
  onReset,
  loading = false,
}) => {
  const {
    unitId,
    otaChannel,
    status,
    orderType,
    otaOrderId,
    contactName,
    createdStart,
    createdEnd,
  } = filters;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      onSearch();
    }
  };

  return (
    <div
      className="bg-white p-3.5 rounded-xl border border-[#dce9ff] shadow-2xs shrink-0 flex flex-col gap-3"
      role="search"
      aria-label="订单筛选与搜索"
    >
      {/* 第一行：酒店、渠道、状态、类型、OTA订单号、客人姓名 */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* 酒店 */}
        <div className="flex items-center gap-1.5 min-w-[180px]">
          <label className="text-xs font-medium text-[#0b1c30] shrink-0">酒店：</label>
          <div className="w-36 flex-1">
            <SearchableSelect
              value={unitId}
              onChange={(val) => onFilterChange({ unitId: val })}
              options={hotelOptions}
              placeholder="选择酒店"
              searchPlaceholder="搜索酒店..."
              clearable
              size="sm"
            />
          </div>
        </div>

        {/* 渠道 */}
        <div className="flex items-center gap-1.5 min-w-[165px]">
          <label className="text-xs font-medium text-[#0b1c30] shrink-0">渠道：</label>
          <div className="w-32 flex-1">
            <SearchableSelect
              value={otaChannel}
              onChange={(val) => onFilterChange({ otaChannel: val })}
              options={channelOptions}
              placeholder="选择渠道"
              searchPlaceholder="搜索渠道..."
              clearable
              size="sm"
            />
          </div>
        </div>

        {/* 状态 */}
        <div className="flex items-center gap-1.5 min-w-[165px]">
          <label className="text-xs font-medium text-[#0b1c30] shrink-0">状态：</label>
          <div className="w-32 flex-1">
            <SearchableSelect
              value={status}
              onChange={(val) => onFilterChange({ status: val })}
              options={ORDER_STATUS_OPTIONS}
              placeholder="选择状态"
              searchPlaceholder="搜索状态..."
              clearable
              size="sm"
            />
          </div>
        </div>

        {/* 类型 */}
        <div className="flex items-center gap-1.5 min-w-[165px]">
          <label className="text-xs font-medium text-[#0b1c30] shrink-0">类型：</label>
          <div className="w-32 flex-1">
            <SearchableSelect
              value={orderType}
              onChange={(val) => onFilterChange({ orderType: val })}
              options={ORDER_TYPE_OPTIONS}
              placeholder="选择类型"
              searchPlaceholder="搜索类型..."
              clearable
              size="sm"
            />
          </div>
        </div>

        {/* OTA订单号 */}
        <div className="flex items-center gap-1.5 min-w-[220px] flex-1 max-w-[280px]">
          <label htmlFor="filter-ota-order-id" className="text-xs font-medium text-[#0b1c30] shrink-0">
            OTA订单号：
          </label>
          <div className="relative flex-1">
            <input
              id="filter-ota-order-id"
              type="text"
              value={otaOrderId}
              onChange={(e) => onFilterChange({ otaOrderId: e.target.value })}
              onKeyDown={handleKeyDown}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="输入订单号"
              className="w-full h-8.5 pl-3 pr-7 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs font-mono text-[#0b1c30] placeholder-[#a0aec0] outline-hidden transition-colors"
            />
            {otaOrderId && (
              <button
                type="button"
                onClick={() => onFilterChange({ otaOrderId: '' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#0b1c30] p-0.5 cursor-pointer"
                title="清空订单号"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 客人姓名 */}
        <div className="flex items-center gap-1.5 min-w-[200px] flex-1 max-w-[240px]">
          <label htmlFor="filter-contact-name" className="text-xs font-medium text-[#0b1c30] shrink-0">
            客人姓名：
          </label>
          <div className="relative flex-1">
            <input
              id="filter-contact-name"
              type="text"
              value={contactName}
              onChange={(e) => onFilterChange({ contactName: e.target.value })}
              onKeyDown={handleKeyDown}
              placeholder="输入姓名"
              className="w-full h-8.5 pl-3 pr-7 bg-white border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-lg text-xs text-[#0b1c30] placeholder-[#a0aec0] outline-hidden transition-colors"
            />
            {contactName && (
              <button
                type="button"
                onClick={() => onFilterChange({ contactName: '' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#0b1c30] p-0.5 cursor-pointer"
                title="清空客人姓名"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 第二行：搬单日期起止 + 查询 + 重置 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label htmlFor="filter-created-start" className="text-xs font-medium text-[#0b1c30] shrink-0">
            搬单日期：
          </label>
          <div className="flex items-center gap-1.5 bg-white border border-[#dce9ff] focus-within:border-[#004ac6] focus-within:ring-1 focus-within:ring-[#004ac6] rounded-lg px-2.5 h-8.5 transition-colors">
            <input
              id="filter-created-start"
              type="date"
              value={createdStart}
              onChange={(e) => onFilterChange({ createdStart: e.target.value })}
              onKeyDown={handleKeyDown}
              aria-label="搬单开始日期"
              placeholder="Start date"
              className="bg-transparent text-xs font-mono text-[#0b1c30] outline-hidden cursor-pointer w-28"
            />
            <ArrowRight className="w-3.5 h-3.5 text-[#94a3b8] shrink-0" />
            <input
              id="filter-created-end"
              type="date"
              value={createdEnd}
              onChange={(e) => onFilterChange({ createdEnd: e.target.value })}
              onKeyDown={handleKeyDown}
              aria-label="搬单结束日期"
              placeholder="End date"
              className="bg-transparent text-xs font-mono text-[#0b1c30] outline-hidden cursor-pointer w-28"
            />
          </div>
        </div>

        {/* 查询按钮 */}
        <button
          type="button"
          onClick={onSearch}
          disabled={loading}
          className="h-8.5 px-4 bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer select-none shrink-0 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Search className="w-3.5 h-3.5" />
          <span>{loading ? '查询中...' : '查询'}</span>
        </button>

        {/* 重置按钮 */}
        <button
          type="button"
          onClick={onReset}
          disabled={loading}
          className="h-8.5 px-3.5 bg-white hover:bg-[#eff4ff] text-[#434655] hover:text-[#0b1c30] border border-[#dce9ff] rounded-lg text-xs font-medium transition-colors cursor-pointer select-none shrink-0 inline-flex items-center gap-1 shadow-2xs disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>重置</span>
        </button>
      </div>
    </div>
  );
};
