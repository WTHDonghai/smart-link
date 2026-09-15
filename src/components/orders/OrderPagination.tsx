import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface OrderPaginationProps {
  totalItems: number;
  startIndex: number;
  endIndex: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  safeCurrentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  paginationRange: (number | string)[];
  jumpInput: string;
  setJumpInput: (val: string) => void;
  onJumpSubmit: (e: React.FormEvent) => void;
}

export const OrderPagination: React.FC<OrderPaginationProps> = ({
  totalItems,
  startIndex,
  endIndex,
  pageSize,
  onPageSizeChange,
  safeCurrentPage,
  totalPages,
  onPageChange,
  paginationRange,
  jumpInput,
  setJumpInput,
  onJumpSubmit
}) => {
  return (
    <div className="shrink-0 bg-white border-t border-[#e5e7eb] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#4b5563] z-10">
      {/* 左侧：条数信息与每页选择 */}
      <div className="flex items-center gap-3">
        <span>
          共 <span className="font-semibold text-[#111827]">{totalItems}</span> 条订单
        </span>
        <span className="text-gray-300">|</span>
        <span>
          显示第 <span className="text-[#111827] font-medium">{totalItems === 0 ? 0 : startIndex + 1}</span> 至{' '}
          <span className="text-[#111827] font-medium">{endIndex}</span> 条
        </span>
        <div className="flex items-center gap-1.5 ml-1">
          <span className="text-gray-500">每页</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-7 px-2 border border-[#d1d5db] rounded bg-white text-xs text-[#374151] outline-none focus:border-[#004ac6] cursor-pointer"
          >
            <option value={5}>5 条</option>
            <option value={10}>10 条</option>
            <option value={20}>20 条</option>
            <option value={50}>50 条</option>
          </select>
        </div>
      </div>

      {/* 右侧：翻页按钮与跳转 */}
      <div className="flex items-center gap-1.5">
        {/* 上一页 */}
        <button
          type="button"
          disabled={safeCurrentPage <= 1}
          onClick={() => onPageChange(safeCurrentPage - 1)}
          className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
            safeCurrentPage <= 1
              ? 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'
              : 'border-[#d1d5db] text-[#374151] bg-white hover:bg-gray-50 hover:border-gray-400 cursor-pointer shadow-2xs'
          }`}
          title="上一页"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {/* 页码序列 */}
        {paginationRange.map((p, idx) => {
          if (p === '...') {
            return (
              <span key={`dots-${idx}`} className="w-6 text-center text-gray-400 select-none">
                ...
              </span>
            );
          }
          const isCurrent = p === safeCurrentPage;
          return (
            <button
              key={`page-${p}`}
              type="button"
              onClick={() => onPageChange(p as number)}
              className={`min-w-7 h-7 px-2 flex items-center justify-center rounded text-xs font-medium transition-all cursor-pointer ${
                isCurrent
                  ? 'bg-[#004ac6] text-white border border-[#004ac6] shadow-2xs'
                  : 'bg-white text-[#374151] border border-[#d1d5db] hover:bg-gray-50 hover:border-gray-400'
              }`}
            >
              {p}
            </button>
          );
        })}

        {/* 下一页 */}
        <button
          type="button"
          disabled={safeCurrentPage >= totalPages}
          onClick={() => onPageChange(safeCurrentPage + 1)}
          className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
            safeCurrentPage >= totalPages
              ? 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'
              : 'border-[#d1d5db] text-[#374151] bg-white hover:bg-gray-50 hover:border-gray-400 cursor-pointer shadow-2xs'
          }`}
          title="下一页"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {/* 跳至指定页 */}
        <form onSubmit={onJumpSubmit} className="flex items-center gap-1.5 ml-2">
          <span className="text-gray-500">跳至</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder={`${safeCurrentPage}`}
            className="w-11 h-7 text-center border border-[#d1d5db] rounded text-xs text-[#111827] outline-none focus:border-[#004ac6]"
          />
          <span className="text-gray-500">页</span>
          <button
            type="submit"
            className="h-7 px-2.5 bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[#374151] border border-[#d1d5db] rounded text-xs font-medium transition-colors cursor-pointer"
          >
            跳转
          </button>
        </form>
      </div>
    </div>
  );
};
