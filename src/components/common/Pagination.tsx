import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationProps {
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  itemUnit?: string;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  itemUnit = '条数据',
  className = '',
}) => {
  const [jumpInput, setJumpInput] = useState('');

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  // Generate pagination range with smart ellipsis
  const getPaginationRange = (): (number | string)[] => {
    const delta = 1;
    const range: (number | string)[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= safeCurrentPage - delta && i <= safeCurrentPage + delta)
      ) {
        range.push(i);
      } else if (range[range.length - 1] !== '...') {
        range.push('...');
      }
    }
    return range;
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseInt(jumpInput, 10);
    if (!isNaN(target) && target >= 1 && target <= totalPages) {
      onPageChange(target);
      setJumpInput('');
    }
  };

  const paginationRange = getPaginationRange();

  return (
    <div
      className={`shrink-0 bg-white border-t border-[#e2e8f0] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#737686] select-none ${className}`}
    >
      {/* 左侧：条数信息与每页条数下拉选择 */}
      <div className="flex items-center gap-3">
        <span>
          共 <strong className="font-mono font-bold text-[#0b1c30]">{totalItems}</strong> {itemUnit}
        </span>
        <span className="text-[#dce9ff]">|</span>
        <span>
          显示第{' '}
          <strong className="font-mono font-medium text-[#0b1c30]">
            {totalItems === 0 ? 0 : startIndex + 1}
          </strong>{' '}
          至{' '}
          <strong className="font-mono font-medium text-[#0b1c30]">{endIndex}</strong> 条
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-[#737686]">每页</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-7 px-2 border border-[#dce9ff] hover:border-[#004ac6]/60 rounded-md bg-white text-xs font-mono text-[#0b1c30] outline-hidden focus:ring-1 focus:ring-[#004ac6] cursor-pointer transition-colors"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} 条
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 右侧：翻页按钮序列与跳转 */}
      <div className="flex items-center gap-1.5">
        {/* 上一页 */}
        <button
          type="button"
          disabled={safeCurrentPage <= 1}
          onClick={() => onPageChange(safeCurrentPage - 1)}
          className={`w-7 h-7 flex items-center justify-center rounded-md border transition-colors ${
            safeCurrentPage <= 1
              ? 'border-[#e2e8f0] text-[#c3c6d7] bg-[#f8f9ff] cursor-not-allowed'
              : 'border-[#dce9ff] text-[#434655] bg-white hover:bg-[#eff4ff] hover:text-[#004ac6] hover:border-[#004ac6]/40 cursor-pointer shadow-2xs'
          }`}
          title="上一页"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {/* 页码序列 */}
        {paginationRange.map((p, idx) => {
          if (p === '...') {
            return (
              <span key={`dots-${idx}`} className="w-6 text-center text-[#94a3b8] select-none">
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
              className={`min-w-7 h-7 px-2 flex items-center justify-center rounded-md text-xs font-mono font-medium transition-all cursor-pointer ${
                isCurrent
                  ? 'bg-[#004ac6] text-white border border-[#004ac6] shadow-2xs font-bold'
                  : 'bg-white text-[#434655] border border-[#dce9ff] hover:bg-[#eff4ff] hover:text-[#004ac6] hover:border-[#004ac6]/40'
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
          className={`w-7 h-7 flex items-center justify-center rounded-md border transition-colors ${
            safeCurrentPage >= totalPages
              ? 'border-[#e2e8f0] text-[#c3c6d7] bg-[#f8f9ff] cursor-not-allowed'
              : 'border-[#dce9ff] text-[#434655] bg-white hover:bg-[#eff4ff] hover:text-[#004ac6] hover:border-[#004ac6]/40 cursor-pointer shadow-2xs'
          }`}
          title="下一页"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {/* 跳至指定页 */}
        <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5 ml-2">
          <span className="text-[#737686]">跳至</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            placeholder={`${safeCurrentPage}`}
            className="w-11 h-7 text-center border border-[#dce9ff] focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] rounded-md text-xs font-mono text-[#0b1c30] outline-hidden transition-colors"
          />
          <span className="text-[#737686]">页</span>
          <button
            type="submit"
            className="h-7 px-2.5 bg-[#eff4ff] hover:bg-[#dce9ff] active:bg-[#d0e2ff] text-[#004ac6] border border-[#dce9ff] rounded-md text-xs font-medium transition-colors cursor-pointer"
          >
            跳转
          </button>
        </form>
      </div>
    </div>
  );
};
