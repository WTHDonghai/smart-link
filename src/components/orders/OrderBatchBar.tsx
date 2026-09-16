import React from 'react';
import { RotateCw, Download, Ban, X } from 'lucide-react';

interface OrderBatchBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBatchRetry: () => void;
  onBatchImport: () => void;
  onBatchCancel: () => void;
}

export const OrderBatchBar: React.FC<OrderBatchBarProps> = ({
  selectedCount,
  onClearSelection,
  onBatchRetry,
  onBatchImport,
  onBatchCancel
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="mb-2.5 px-3.5 py-2 bg-[#eff4ff] border border-[#dce9ff] rounded-lg flex items-center justify-between text-xs animate-in fade-in slide-in-from-top-1 duration-150 shrink-0 shadow-2xs">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[#0b1c30]">
          已选择 <strong className="font-mono text-[#004ac6] font-bold">{selectedCount}</strong> 条订单
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-[#004ac6] hover:text-[#003da6] flex items-center gap-0.5 ml-1 cursor-pointer transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          <span>取消选择</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBatchRetry}
          className="px-3 py-1 bg-white border border-[#dce9ff] text-[#004ac6] hover:bg-[#eff4ff] rounded-md font-medium flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span>批量直连重推</span>
        </button>

        <button
          type="button"
          onClick={onBatchImport}
          className="px-3 py-1 bg-[#004ac6] hover:bg-[#003da6] text-white rounded-md font-medium flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>批量强制导入</span>
        </button>

        <button
          type="button"
          onClick={onBatchCancel}
          className="px-3 py-1 bg-white border border-[#ffdad6] text-[#ba1a1a] hover:bg-rose-50 rounded-md font-medium flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
        >
          <Ban className="w-3.5 h-3.5" />
          <span>批量取消</span>
        </button>
      </div>
    </div>
  );
};
