import React, { useState } from 'react';
import { GuardianOrder } from '../../types';
import { 
  MoreVertical, 
  Edit3, 
  Download, 
  Trash2, 
  Ban, 
  RotateCw
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { EmptyState } from '../common/EmptyState';
import { isOrderSuccess, formatSyncTime } from '../../utils/orderHelpers';

interface OrderTableProps {
  orders: GuardianOrder[];
  selectedOrderIds: string[];
  onToggleSelectAll: () => void;
  onToggleSelectOrder: (id: string) => void;
  onCopy: (text: string) => void;
  onOpenEdit: (order: GuardianOrder) => void;
  onRetry: (order: GuardianOrder) => void;
  onDirectImport: (order: GuardianOrder) => void;
  onDeleteOrder: (order: GuardianOrder) => void;
  onCancelOrder: (order: GuardianOrder) => void;
}

export const OrderTable: React.FC<OrderTableProps> = ({
  orders,
  selectedOrderIds,
  onToggleSelectAll,
  onToggleSelectOrder,
  onCopy,
  onOpenEdit,
  onRetry,
  onDirectImport,
  onDeleteOrder,
  onCancelOrder
}) => {
  const [activeMenuOrderId, setActiveMenuOrderId] = useState<string | null>(null);

  const isAllSelected = orders.length > 0 && orders.every(o => selectedOrderIds.includes(o.id));

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full text-left border-separate border-spacing-0 min-w-[1200px]">
        <thead className="sticky top-0 z-20 bg-[#f9fafb]">
          <tr className="text-xs text-[#6b7280] font-normal shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            {/* 多选框 */}
            <th className="py-2.5 pl-4 pr-2 bg-[#f9fafb] whitespace-nowrap sticky top-0 left-0 z-30 w-10 border-b border-[#e5e7eb]">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={onToggleSelectAll}
                className="w-4 h-4 rounded text-[#004ac6] focus:ring-[#004ac6] border-gray-300 cursor-pointer"
                title="全选当页订单"
              />
            </th>

            {/* 固定列：酒店 */}
            <th className="py-2.5 px-3 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 left-10 z-30 w-[180px] min-w-[180px] max-w-[180px] border-b border-[#e5e7eb]">
              酒店
            </th>

            {/* 固定列：OTA 订单 */}
            <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 left-[220px] z-30 w-[210px] min-w-[210px] max-w-[210px] border-b border-r border-[#e5e7eb] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
              OTA 订单
            </th>

            {/* 滚动列：同步时间 */}
            <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[140px] border-b border-[#e5e7eb]">
              同步时间
            </th>

            {/* 滚动列：抵离日期 */}
            <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[110px] border-b border-[#e5e7eb]">
              抵离日期
            </th>

            {/* 滚动列：房型 / 房价 */}
            <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[240px] max-w-[320px] border-b border-[#e5e7eb]">
              房型 / 房价
            </th>

            {/* 滚动列：金额 */}
            <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[90px] border-b border-[#e5e7eb]">
              金额
            </th>

            {/* 滚动列：状态 */}
            <th className="py-2.5 px-4 font-normal bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[120px] border-b border-[#e5e7eb]">
              状态
            </th>

            {/* 固定列：操作 */}
            <th className="py-2.5 px-6 font-normal text-right bg-[#f9fafb] whitespace-nowrap sticky top-0 right-0 z-30 w-[84px] min-w-[84px] border-b border-l border-[#e5e7eb] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
              操作
            </th>
          </tr>
        </thead>
        <tbody className="text-xs">
          {orders.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-12 border-b border-[#f3f4f6]">
                <EmptyState
                  title="暂无符合条件的订单记录"
                  description="可以尝试调整筛选条件、日期区间或搜索关键字"
                />
              </td>
            </tr>
          ) : (
            orders.map((ord, index) => {
              const isSuccess = isOrderSuccess(ord.status);
              const isCancelled = ord.status === 'cancelled';
              const isMenuOpen = activeMenuOrderId === ord.id;
              const isNearBottom = index >= Math.max(0, orders.length - 2);
              const isSelected = selectedOrderIds.includes(ord.id);

              return (
                <tr 
                  key={ord.id} 
                  className={`transition-colors group ${
                    isSelected ? 'bg-[#eff4ff]/60 hover:bg-[#eff4ff]/80' : 'hover:bg-[#fafafa]'
                  }`}
                >
                  {/* 复选框 */}
                  <td className="py-3.5 pl-4 pr-2 align-top sticky left-0 z-10 bg-white group-hover:bg-[#fafafa] w-10 border-b border-[#f3f4f6]">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelectOrder(ord.id)}
                      className="w-4 h-4 rounded text-[#004ac6] focus:ring-[#004ac6] border-gray-300 cursor-pointer mt-0.5"
                    />
                  </td>

                  {/* 固定列 1：酒店 */}
                  <td className="py-3.5 px-3 align-top sticky left-10 z-10 bg-white group-hover:bg-[#fafafa] w-[180px] min-w-[180px] max-w-[180px] border-b border-[#f3f4f6]">
                    <div className="flex flex-col">
                      <span className="font-bold text-[#111827] text-xs leading-snug" title={ord.hotelName}>
                        {ord.hotelName}
                      </span>
                      <span className="inline-block mt-1 w-fit text-[11px] px-1.5 py-0.2 bg-gray-100 text-gray-700 rounded font-normal">
                        {ord.channelName}
                      </span>
                    </div>
                  </td>

                  {/* 固定列 2：OTA 订单 */}
                  <td className="py-3.5 px-4 align-top sticky left-[220px] z-10 bg-white group-hover:bg-[#fafafa] w-[210px] min-w-[210px] max-w-[210px] border-b border-r border-[#e5e7eb] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                    <div className="flex flex-col">
                      <span 
                        onClick={() => onCopy(ord.otaOrderNo)}
                        className="font-bold text-[#3b82f6] text-xs hover:underline cursor-pointer tracking-tight truncate"
                        title="点击复制 OTA 订单号"
                      >
                        {ord.otaOrderNo}
                      </span>
                      <span className="text-[11px] text-[#6b7280] mt-0.5 truncate" title={`${ord.guestName} / ${ord.guestPhone}`}>
                        {ord.guestName} / {ord.guestPhone}
                      </span>
                    </div>
                  </td>

                  {/* 同步时间 */}
                  <td className="py-3.5 px-4 align-top whitespace-nowrap min-w-[140px] border-b border-[#f3f4f6]">
                    <span className="text-[#111827] text-xs font-mono font-medium">
                      {formatSyncTime(ord.transferredAt || ord.scrapedAt)}
                    </span>
                  </td>

                  {/* 抵离日期 */}
                  <td className="py-3.5 px-4 align-top min-w-[110px] border-b border-[#f3f4f6]">
                    <div className="flex flex-col">
                      <span className="font-bold text-[#111827] text-xs">
                        {ord.checkInDate}
                      </span>
                      <span className="text-[11px] text-[#6b7280] mt-0.5">
                        {ord.checkOutDate}
                      </span>
                    </div>
                  </td>

                  {/* 房型 / 房价 */}
                  <td className="py-3.5 px-4 align-top min-w-[240px] max-w-[320px] border-b border-[#f3f4f6]">
                    <div 
                      className="relative group/room cursor-help"
                      title={`${ord.roomTypeName}\n房价方案: ${ord.ratePlanCode || 'OTA标准价'}${ord.remark ? ` (${ord.remark})` : ''}`}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-[#111827] text-xs leading-relaxed line-clamp-2 break-all">
                          {ord.roomTypeName}
                        </span>
                        <span className="text-[11px] text-[#6b7280] mt-0.5 truncate">
                          {ord.ratePlanCode || 'OTA'}
                        </span>
                      </div>

                      {/* 悬浮气泡提示卡 */}
                      <div 
                        className={`absolute left-0 z-50 hidden group-hover/room:block pointer-events-none ${
                          isNearBottom ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                        } w-80 p-3 bg-gray-900/95 backdrop-blur-xs text-white rounded-lg shadow-2xl border border-gray-700 text-xs leading-relaxed animate-in fade-in duration-150`}
                      >
                        <div className="text-[11px] text-gray-400 mb-1 flex items-center justify-between">
                          <span>完整房型 / 房价信息</span>
                          <span className="text-amber-400 font-mono">{ord.channelName}</span>
                        </div>
                        <div className="font-medium text-white mb-2 break-words">
                          {ord.roomTypeName}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-gray-300 pt-1.5 border-t border-gray-700/80">
                          <span className="text-gray-400">房价方案:</span>
                          <span className="text-amber-300 font-medium">{ord.ratePlanCode || 'OTA标准价'}</span>
                        </div>
                        {ord.remark && (
                          <div className="text-[11px] text-gray-400 mt-1.5 pt-1.5 border-t border-gray-800 break-words">
                            备注: {ord.remark}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* 金额 */}
                  <td className="py-3.5 px-4 align-top min-w-[90px] border-b border-[#f3f4f6]">
                    <span className="font-bold text-[#111827] text-xs">
                      ¥{typeof ord.otaPrice === 'number' ? (ord.otaPrice % 1 === 0 ? ord.otaPrice : ord.otaPrice.toFixed(2)) : ord.otaPrice}
                    </span>
                  </td>

                  {/* 状态 */}
                  <td className="py-3.5 px-4 align-top min-w-[120px] border-b border-[#f3f4f6]">
                    <div className="flex flex-col gap-1">
                      {isSuccess ? (
                        <>
                          <StatusBadge variant="success" label="成功" size="xs" />
                          <span className="text-[11px] text-[#16a34a] font-mono">
                            {ord.pmsOrderNo || '已入账确认'}
                          </span>
                        </>
                      ) : isCancelled ? (
                        <>
                          <StatusBadge variant="cancelled" label="取消" size="xs" />
                          <span className="text-[11px] text-gray-500">
                            {ord.failureReason || '已取消预订'}
                          </span>
                        </>
                      ) : (
                        <>
                          <StatusBadge variant="failed" label="失败" size="xs" />
                          <span className="text-[11px] text-[#ef4444]">
                            {ord.failureReason || '预订类型不存在'}
                          </span>
                        </>
                      )}
                    </div>
                  </td>

                  {/* 固定列：操作 */}
                  <td className={`py-3 px-6 align-top text-right sticky right-0 bg-white group-hover:bg-[#fafafa] w-[84px] min-w-[84px] border-b border-l border-[#e5e7eb] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)] ${isMenuOpen ? 'z-40' : 'z-10'}`}>
                    <div className="inline-block text-left relative">
                      <button
                        type="button"
                        onClick={() => setActiveMenuOrderId(isMenuOpen ? null : ord.id)}
                        className={`w-7 h-7 flex items-center justify-center rounded border transition-colors cursor-pointer shadow-2xs ${
                          isMenuOpen 
                            ? 'bg-gray-100 border-gray-400 text-gray-900' 
                            : 'bg-white border-gray-200 hover:border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                        title="操作菜单"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>

                      {/* 操作下拉菜单 */}
                      {isMenuOpen && (
                        <>
                          <div 
                            className="fixed inset-0 z-20" 
                            onClick={() => setActiveMenuOrderId(null)} 
                          />

                          <div className="absolute right-0 top-8 w-32 bg-white rounded-lg shadow-xl border border-gray-200 py-1.5 z-30 text-xs text-left animate-in fade-in zoom-in-95 duration-100">
                            {/* 编辑 */}
                            <button
                              type="button"
                              onClick={() => {
                                onOpenEdit(ord);
                                setActiveMenuOrderId(null);
                              }}
                              className="w-full px-3.5 py-1.5 text-gray-800 hover:bg-gray-100 flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-gray-500" />
                              <span>编辑</span>
                            </button>

                            {/* 直连重推 (使用已封装的 retryOrderTransfer) */}
                            <button
                              type="button"
                              onClick={() => {
                                onRetry(ord);
                                setActiveMenuOrderId(null);
                              }}
                              className="w-full px-3.5 py-1.5 text-blue-600 hover:bg-blue-50 flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <RotateCw className="w-3.5 h-3.5 text-blue-500" />
                              <span>直连重推</span>
                            </button>

                            {/* 导入 */}
                            <button
                              type="button"
                              onClick={() => {
                                onDirectImport(ord);
                                setActiveMenuOrderId(null);
                              }}
                              className="w-full px-3.5 py-1.5 text-gray-800 hover:bg-gray-100 flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <Download className="w-3.5 h-3.5 text-gray-500" />
                              <span>强制导入</span>
                            </button>

                            {/* 取消 */}
                            <button
                              type="button"
                              onClick={() => {
                                onCancelOrder(ord);
                                setActiveMenuOrderId(null);
                              }}
                              disabled={isCancelled}
                              className={`w-full px-3.5 py-1.5 flex items-center gap-2 font-medium ${
                                isCancelled 
                                  ? 'text-gray-300 cursor-not-allowed' 
                                  : 'text-gray-600 hover:bg-gray-100 cursor-pointer'
                              }`}
                            >
                              <Ban className="w-3.5 h-3.5 text-gray-400" />
                              <span>取消</span>
                            </button>

                            {/* 删除 */}
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteOrder(ord);
                                setActiveMenuOrderId(null);
                              }}
                              className="w-full px-3.5 py-1.5 text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer font-medium border-t border-gray-100 mt-1"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                              <span>删除</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
