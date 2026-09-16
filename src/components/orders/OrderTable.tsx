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
import { normalizeAppError } from '../../utils/errorNormalizer';

const OrderErrorStatusCell: React.FC<{ failureReason?: string }> = ({ failureReason }) => {
  const err = normalizeAppError(failureReason || '订单同步失败', 'ORDER');
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <StatusBadge variant="failed" label="失败" size="xs" />
        <span className="text-[10px] px-1 py-0.5 rounded bg-rose-50 text-rose-600 font-mono border border-rose-200">
          {err.code.replace('ORDER_', '')}
        </span>
      </div>
      <span
        className="text-[11px] text-rose-700 cursor-help underline decoration-rose-300 decoration-dotted underline-offset-2"
        title={`${err.userTitle}：${err.userMessage}\n指引：${err.suggestion}`}
      >
        {err.userTitle}
      </span>
    </div>
  );
};

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
        <thead className="sticky top-0 z-20 bg-[#f8faff]">
          <tr className="text-xs text-[#737686] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            {/* 多选框 */}
            <th className="py-2.5 pl-4 pr-2 bg-[#f8faff] whitespace-nowrap sticky top-0 left-0 z-30 w-10 border-b border-[#e2e8f0]">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={onToggleSelectAll}
                className="w-4 h-4 rounded text-[#004ac6] focus:ring-[#004ac6] border-[#dce9ff] cursor-pointer"
                title="全选当页订单"
              />
            </th>

            {/* 固定列：酒店 */}
            <th className="py-2.5 px-3 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 left-10 z-30 w-[180px] min-w-[180px] max-w-[180px] border-b border-[#e2e8f0]">
              酒店
            </th>

            {/* 固定列：OTA 订单 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 left-[220px] z-30 w-[210px] min-w-[210px] max-w-[210px] border-b border-r border-[#e2e8f0] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
              OTA 订单
            </th>

            {/* 滚动列：同步时间 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[140px] border-b border-[#e2e8f0]">
              同步时间
            </th>

            {/* 滚动列：抵离日期 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[110px] border-b border-[#e2e8f0]">
              抵离日期
            </th>

            {/* 滚动列：房型 / 房价 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[240px] max-w-[320px] border-b border-[#e2e8f0]">
              房型 / 房价
            </th>

            {/* 滚动列：金额 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[90px] border-b border-[#e2e8f0]">
              金额
            </th>

            {/* 滚动列：状态 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[120px] border-b border-[#e2e8f0]">
              状态
            </th>

            {/* 固定列：操作 */}
            <th className="py-2.5 px-6 font-semibold text-right bg-[#f8faff] whitespace-nowrap sticky top-0 right-0 z-30 w-[84px] min-w-[84px] border-b border-l border-[#e2e8f0] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
              操作
            </th>
          </tr>
        </thead>
        <tbody className="text-xs">
          {orders.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-12 border-b border-[#edf2f9]">
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
                    isSelected ? 'bg-[#eff4ff]/60 hover:bg-[#eff4ff]/80' : 'hover:bg-[#f8faff]'
                  }`}
                >
                  {/* 复选框 */}
                  <td className="py-3.5 pl-4 pr-2 align-top sticky left-0 z-10 bg-white group-hover:bg-[#f8faff] w-10 border-b border-[#edf2f9]">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelectOrder(ord.id)}
                      className="w-4 h-4 rounded text-[#004ac6] focus:ring-[#004ac6] border-[#dce9ff] cursor-pointer mt-0.5"
                    />
                  </td>

                  {/* 固定列 1：酒店 */}
                  <td className="py-3.5 px-3 align-top sticky left-10 z-10 bg-white group-hover:bg-[#f8faff] w-[180px] min-w-[180px] max-w-[180px] border-b border-[#edf2f9]">
                    <div className="flex flex-col">
                      <span className="font-bold text-[#0b1c30] text-xs leading-snug" title={ord.hotelName}>
                        {ord.hotelName}
                      </span>
                      <span className="inline-block mt-1 w-fit text-[11px] px-1.5 py-0.5 bg-[#eff4ff] text-[#004ac6] border border-[#dce9ff] rounded font-medium">
                        {ord.channelName}
                      </span>
                    </div>
                  </td>

                  {/* 固定列 2：OTA 订单 */}
                  <td className="py-3.5 px-4 align-top sticky left-[220px] z-10 bg-white group-hover:bg-[#f8faff] w-[210px] min-w-[210px] max-w-[210px] border-b border-r border-[#e2e8f0] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                    <div className="flex flex-col">
                      <span 
                        onClick={() => onCopy(ord.otaOrderNo)}
                        className="font-mono font-bold text-[#004ac6] hover:text-[#003da6] text-xs hover:underline cursor-pointer tracking-tight truncate select-text"
                        title="点击复制 OTA 订单号"
                      >
                        {ord.otaOrderNo}
                      </span>
                      <span className="text-[11px] text-[#737686] mt-0.5 truncate" title={`${ord.guestName} / ${ord.guestPhone}`}>
                        {ord.guestName} / {ord.guestPhone}
                      </span>
                    </div>
                  </td>

                  {/* 同步时间 */}
                  <td className="py-3.5 px-4 align-top whitespace-nowrap min-w-[140px] border-b border-[#edf2f9]">
                    <span className="text-[#0b1c30] text-xs font-mono font-medium">
                      {formatSyncTime(ord.transferredAt || ord.scrapedAt)}
                    </span>
                  </td>

                  {/* 抵离日期 */}
                  <td className="py-3.5 px-4 align-top min-w-[110px] border-b border-[#edf2f9]">
                    <div className="flex flex-col font-mono">
                      <span className="font-bold text-[#0b1c30] text-xs">
                        {ord.checkInDate}
                      </span>
                      <span className="text-[11px] text-[#737686] mt-0.5">
                        {ord.checkOutDate}
                      </span>
                    </div>
                  </td>

                  {/* 房型 / 房价 */}
                  <td className="py-3.5 px-4 align-top min-w-[240px] max-w-[320px] border-b border-[#edf2f9]">
                    <div 
                      className="relative group/room cursor-help"
                      title={`${ord.roomTypeName}\n房价方案: ${ord.ratePlanCode || 'OTA标准价'}${ord.remark ? ` (${ord.remark})` : ''}`}
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-[#0b1c30] text-xs leading-relaxed line-clamp-2 break-all">
                          {ord.roomTypeName}
                        </span>
                        <span className="text-[11px] text-[#737686] mt-0.5 truncate font-mono">
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
                          <span className="text-[#bfdbfe] font-mono">{ord.channelName}</span>
                        </div>
                        <div className="font-medium text-white mb-2 break-words">
                          {ord.roomTypeName}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-gray-300 pt-1.5 border-t border-gray-700/80">
                          <span className="text-gray-400">房价方案:</span>
                          <span className="text-amber-300 font-mono font-medium">{ord.ratePlanCode || 'OTA标准价'}</span>
                        </div>
                        {ord.remark && (
                          <div className="text-[11px] text-gray-400 mt-1.5 pt-1.5 border-t border-gray-800 break-words font-mono">
                            备注: {ord.remark}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* 金额 */}
                  <td className="py-3.5 px-4 align-top min-w-[90px] border-b border-[#edf2f9]">
                    <span className="font-mono font-bold text-[#0b1c30] text-xs">
                      ¥{typeof ord.otaPrice === 'number' ? (ord.otaPrice % 1 === 0 ? ord.otaPrice : ord.otaPrice.toFixed(2)) : ord.otaPrice}
                    </span>
                  </td>

                  {/* 状态 */}
                  <td className="py-3.5 px-4 align-top min-w-[120px] border-b border-[#edf2f9]">
                    <div className="flex flex-col gap-1">
                      {isSuccess ? (
                        <>
                          <StatusBadge variant="success" label="成功" size="xs" />
                          <span className="text-[11px] text-emerald-700 font-mono">
                            {ord.pmsOrderNo || '已入账确认'}
                          </span>
                        </>
                      ) : isCancelled ? (
                        <>
                          <StatusBadge variant="cancelled" label="取消" size="xs" />
                          <span className="text-[11px] text-[#737686]">
                            {ord.failureReason || '已取消预订'}
                          </span>
                        </>
                      ) : (
                        <OrderErrorStatusCell failureReason={ord.failureReason} />
                      )}
                    </div>
                  </td>

                  {/* 固定列：操作 */}
                  <td className={`py-3 px-6 align-top text-right sticky right-0 bg-white group-hover:bg-[#f8faff] w-[84px] min-w-[84px] border-b border-l border-[#e2e8f0] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)] ${isMenuOpen ? 'z-40' : 'z-10'}`}>
                    <div className="inline-block text-left relative">
                      <button
                        type="button"
                        onClick={() => setActiveMenuOrderId(isMenuOpen ? null : ord.id)}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors cursor-pointer shadow-2xs ${
                          isMenuOpen
                            ? 'bg-[#eff4ff] border-[#004ac6] text-[#004ac6]'
                            : 'bg-white border-[#dce9ff] hover:border-[#004ac6]/60 text-[#434655] hover:bg-[#eff4ff]'
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

                          <div className="absolute right-0 top-8 w-32 bg-white rounded-xl shadow-xl border border-[#dce9ff] py-1.5 z-30 text-xs text-left animate-in fade-in zoom-in-95 duration-100">
                            {/* 编辑 */}
                            <button
                              type="button"
                              onClick={() => {
                                onOpenEdit(ord);
                                setActiveMenuOrderId(null);
                              }}
                              className="w-full px-3.5 py-1.5 text-[#0b1c30] hover:bg-[#eff4ff] flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-[#737686]" />
                              <span>编辑</span>
                            </button>

                            {/* 直连重推 */}
                            <button
                              type="button"
                              onClick={() => {
                                onRetry(ord);
                                setActiveMenuOrderId(null);
                              }}
                              className="w-full px-3.5 py-1.5 text-[#004ac6] hover:bg-[#eff4ff] flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <RotateCw className="w-3.5 h-3.5 text-[#004ac6]" />
                              <span>直连重推</span>
                            </button>

                            {/* 导入 */}
                            <button
                              type="button"
                              onClick={() => {
                                onDirectImport(ord);
                                setActiveMenuOrderId(null);
                              }}
                              className="w-full px-3.5 py-1.5 text-[#0b1c30] hover:bg-[#eff4ff] flex items-center gap-2 cursor-pointer font-medium"
                            >
                              <Download className="w-3.5 h-3.5 text-[#737686]" />
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
                                  ? 'text-[#94a3b8] cursor-not-allowed'
                                  : 'text-[#434655] hover:bg-[#eff4ff] cursor-pointer'
                              }`}
                            >
                              <Ban className="w-3.5 h-3.5 text-[#737686]" />
                              <span>取消</span>
                            </button>

                            {/* 删除 */}
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteOrder(ord);
                                setActiveMenuOrderId(null);
                              }}
                              className="w-full px-3.5 py-1.5 text-[#ba1a1a] hover:bg-rose-50 flex items-center gap-2 cursor-pointer font-medium border-t border-[#edf2f9] mt-1"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-[#ba1a1a]" />
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
