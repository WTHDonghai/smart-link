import React, { useState, useEffect } from 'react';
import type { ToolkitOrder } from '../../types';
import { ChannelBadge } from '../common/ChannelBadge';
import { StatusBadge } from '../common/StatusBadge';
import { EmptyState } from '../common/EmptyState';
import {
  formatCurrency,
  getAllowedOrderActions,
  getOrderStatusMeta,
} from '../../utils/orderHelpers';
import { Edit3, Download, Trash2, Ban, Loader2, Copy, Check, MoreVertical, AlertCircle } from 'lucide-react';

export interface OrderTableProps {
  orders: ToolkitOrder[];
  actionLoadingId?: string;
  initialOpenMenuId?: string;
  initialConfirmAction?: { orderId: string; action: 'CANCEL' | 'DELETE' };
  onViewDetail: (order: ToolkitOrder) => void;
  onEdit: (order: ToolkitOrder) => void;
  onImport: (order: ToolkitOrder) => void;
  onDelete: (order: ToolkitOrder) => void;
  onCancel: (order: ToolkitOrder) => void;
}

export const OrderTable: React.FC<OrderTableProps> = ({
  orders,
  actionLoadingId,
  initialOpenMenuId,
  initialConfirmAction,
  onViewDetail,
  onEdit,
  onImport,
  onDelete,
  onCancel,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(initialOpenMenuId || null);
  const [confirmAction, setConfirmAction] = useState<{
    orderId: string;
    action: 'CANCEL' | 'DELETE';
  } | null>(initialConfirmAction || null);

  useEffect(() => {
    if (initialOpenMenuId !== undefined) {
      setActiveMenuId(initialOpenMenuId);
    }
  }, [initialOpenMenuId]);

  useEffect(() => {
    if (initialConfirmAction !== undefined) {
      setConfirmAction(initialConfirmAction);
    }
  }, [initialConfirmAction]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveMenuId(null);
        setConfirmAction(null);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-order-actions-menu]')) {
        setActiveMenuId(null);
        setConfirmAction(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleCopy = (text: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-white rounded-xl border border-[#e2e8f0] shadow-xs">
      <table className="w-full text-left border-separate border-spacing-0 min-w-[1100px]">
        <thead className="sticky top-0 z-20 bg-[#f8faff]">
          <tr className="text-xs text-[#737686] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            {/* 列 1: 酒店/单位 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 left-0 z-30 w-[180px] min-w-[180px] border-b border-[#e2e8f0]">
              酒店 / 单位
            </th>

            {/* 列 2: OTA 订单 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 left-[180px] z-30 w-[230px] min-w-[230px] border-b border-r border-[#e2e8f0] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
              OTA 订单
            </th>

            {/* 列 3: 抵离日期 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[140px] border-b border-[#e2e8f0]">
              抵离日期
            </th>

            {/* 列 4: 房型 / 房价码 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[220px] max-w-[320px] border-b border-[#e2e8f0]">
              房型 / 房价码
            </th>

            {/* 列 5: 金额 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[110px] border-b border-[#e2e8f0]">
              金额
            </th>

            {/* 列 6: 状态 */}
            <th className="py-2.5 px-4 font-semibold bg-[#f8faff] whitespace-nowrap sticky top-0 z-20 min-w-[140px] border-b border-[#e2e8f0]">
              状态
            </th>

            {/* 固定列: 操作 */}
            <th className="py-2.5 px-3 font-semibold text-right bg-[#f8faff] whitespace-nowrap sticky top-0 right-0 z-30 w-[80px] min-w-[80px] border-b border-l border-[#e2e8f0] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
              操作
            </th>
          </tr>
        </thead>
        <tbody className="text-xs divide-y divide-[#edf2f9]">
          {orders.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-14">
                <EmptyState
                  title="暂无符合条件的订单记录"
                  description="可以尝试调整筛选状态、日期区间或搜索关键字"
                />
              </td>
            </tr>
          ) : (
            orders.map((ord, index) => {
              const allowedActions = getAllowedOrderActions(ord.status);
              const statusMeta = getOrderStatusMeta(ord.status);
              const isOperating = actionLoadingId === ord.id;
              const isCopied = copiedId === ord.otaOrderId;
              const isNearBottom = index >= orders.length - 2 && orders.length > 2;

              return (
                <tr
                  key={ord.id}
                  className="transition-colors hover:bg-[#f8faff] group"
                >
                  {/* 列 1: 酒店 / 单位 */}
                  <td className="py-3 px-4 align-top sticky left-0 z-10 bg-white group-hover:bg-[#f8faff] w-[180px] min-w-[180px] border-b border-[#edf2f9]">
                    <div className="flex flex-col">
                      <span
                        className="font-bold text-[#0b1c30] text-xs leading-snug truncate"
                        title={ord.unitName || ord.unitId}
                      >
                        {ord.unitName || ord.unitId || '未指定酒店'}
                      </span>
                      {ord.unitId && (
                        <span className="text-[11px] font-mono text-[#737686] mt-0.5 truncate">
                          ID: {ord.unitId}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* 列 2: OTA 订单 */}
                  <td className="py-3 px-4 align-top sticky left-[180px] z-10 bg-white group-hover:bg-[#f8faff] w-[230px] min-w-[230px] border-b border-r border-[#e2e8f0] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                    <div className="flex items-start gap-2">
                      <ChannelBadge channelCode={ord.otaChannel} size="xs" />
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1">
                          <span
                            onClick={() => onViewDetail(ord)}
                            className="font-mono font-bold text-[#004ac6] hover:text-[#003da6] text-xs hover:underline cursor-pointer tracking-tight truncate select-text"
                            title="点击查看订单详情"
                          >
                            {ord.otaOrderId}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(ord.otaOrderId);
                            }}
                            className="text-[#94a3b8] hover:text-[#004ac6] p-0.5 cursor-pointer rounded"
                            title="复制订单号"
                          >
                            {isCopied ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                        <span
                          className="text-[11px] text-[#737686] mt-0.5 truncate"
                          title={`${ord.contact?.name || '-'} / ${ord.contact?.mobile || '-'}`}
                        >
                          {ord.contact?.name || '-'} · {ord.contact?.mobile || '-'}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* 列 3: 抵离日期 */}
                  <td className="py-3 px-4 align-top whitespace-nowrap min-w-[140px] border-b border-[#edf2f9]">
                    <div className="flex flex-col font-mono">
                      <span className="font-bold text-[#0b1c30] text-xs">
                        {ord.booking?.arrival || '-'}
                      </span>
                      <span className="text-[11px] text-[#737686] mt-0.5">
                        至 {ord.booking?.departure || '-'} ({ord.booking?.nights || 1}晚)
                      </span>
                    </div>
                  </td>

                  {/* 列 4: 房型 / 房价码 */}
                  <td className="py-3 px-4 align-top min-w-[220px] max-w-[320px] border-b border-[#edf2f9]">
                    <div className="flex flex-col">
                      <span
                        className="font-bold text-[#0b1c30] text-xs leading-snug line-clamp-2"
                        title={ord.booking?.roomType || '-'}
                      >
                        {ord.booking?.roomType || '-'}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[#737686]">
                        <span className="font-mono">{ord.booking?.rateCode || '标准价'}</span>
                        <span>·</span>
                        <span>{ord.booking?.quantity || 1}间</span>
                        {ord.booking?.paytype && (
                          <>
                            <span>·</span>
                            <span>{ord.booking?.paytype}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* 列 5: 金额 */}
                  <td className="py-3 px-4 align-top min-w-[110px] border-b border-[#edf2f9]">
                    <span className="font-mono font-bold text-[#0b1c30] text-xs">
                      {formatCurrency(ord.booking?.totalPrice)}
                    </span>
                  </td>

                  {/* 列 6: 状态 */}
                  <td className="py-3 px-4 align-top min-w-[140px] border-b border-[#edf2f9]">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge
                          variant={statusMeta.tone}
                          label={statusMeta.label}
                          size="xs"
                        />
                      </div>
                      {ord.status === 'SUCCESS' && ord.pmsOrderId && (
                        <span className="text-[11px] text-emerald-700 font-mono truncate" title={ord.pmsOrderId}>
                          PMS: {ord.pmsOrderId}
                        </span>
                      )}
                      {ord.status === 'FAILED' && ord.errorMessage && (
                        <span
                          className="text-[11px] text-rose-600 line-clamp-2 break-all"
                          title={ord.errorMessage}
                        >
                          {ord.errorMessage}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* 列 7: 操作 (Sticky right) */}
                  <td
                    className={`py-3 px-3 align-top text-right sticky right-0 bg-white group-hover:bg-[#f8faff] w-[80px] min-w-[80px] border-b border-l border-[#e2e8f0] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)] ${
                      activeMenuId === ord.id ? 'z-30' : 'z-10'
                    }`}
                  >
                    {isOperating ? (
                      <div className="flex items-center justify-end gap-1 py-1 text-xs text-[#004ac6]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span className="text-[11px]">处理中...</span>
                      </div>
                    ) : allowedActions.length === 0 ? (
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          disabled
                          className="p-1.5 rounded-lg text-[#94a3b8] cursor-not-allowed select-none inline-flex items-center justify-center opacity-40"
                          title="只读状态"
                          aria-label="无可用操作"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative inline-block text-left" data-order-actions-menu>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId((prev) => (prev === ord.id ? null : ord.id));
                            setConfirmAction(null);
                          }}
                          className={`p-1.5 rounded-lg text-[#737686] hover:text-[#0b1c30] hover:bg-[#eff4ff] transition-colors cursor-pointer inline-flex items-center justify-center ${
                            activeMenuId === ord.id ? 'bg-[#eff4ff] text-[#004ac6]' : ''
                          }`}
                          title="更多操作"
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === ord.id}
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {activeMenuId === ord.id && (
                          <div
                            className={`absolute right-0 ${
                              confirmAction?.orderId === ord.id ? 'w-56' : 'w-32'
                            } bg-white rounded-xl border border-[#e2e8f0] shadow-lg py-1 z-50 transition-all ${
                              isNearBottom ? 'bottom-full mb-1' : 'top-full mt-1'
                            }`}
                            role="menu"
                            aria-orientation="vertical"
                          >
                            {confirmAction?.orderId === ord.id ? (
                              <div className="p-3 text-left">
                                <div className="flex items-start gap-2">
                                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-[#0b1c30]">
                                      {confirmAction.action === 'CANCEL' ? '确认取消订单？' : '确认删除订单？'}
                                    </p>
                                    <p className="text-[11px] text-[#737686] mt-1 leading-snug">
                                      {confirmAction.action === 'CANCEL'
                                        ? `确定在中台发起取消订单「${ord.otaOrderId}」？`
                                        : `确定删除订单「${ord.otaOrderId}」吗？此操作不可逆。`}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center justify-end gap-1.5 mt-3 pt-2 border-t border-[#f1f5f9]">
                                  <button
                                    type="button"
                                    onClick={() => setConfirmAction(null)}
                                    className="px-2.5 py-1 text-xs font-medium text-[#434655] hover:bg-[#eff4ff] border border-[#dce9ff] rounded-md transition-colors cursor-pointer"
                                  >
                                    取消
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const act = confirmAction.action;
                                      setConfirmAction(null);
                                      setActiveMenuId(null);
                                      if (act === 'CANCEL') {
                                        onCancel(ord);
                                      } else {
                                        onDelete(ord);
                                      }
                                    }}
                                    className="px-2.5 py-1 text-xs font-semibold text-white bg-[#ba1a1a] hover:bg-[#93000a] rounded-md transition-colors cursor-pointer shadow-2xs"
                                  >
                                    {confirmAction.action === 'CANCEL' ? '确认取消' : '确认删除'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {/* 编辑 (仅 FAILED) */}
                                {allowedActions.includes('EDIT') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null);
                                      onEdit(ord);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-[#0b1c30] hover:bg-[#eff4ff] hover:text-[#004ac6] flex items-center gap-2 cursor-pointer transition-colors"
                                    role="menuitem"
                                  >
                                    <Edit3 className="w-3.5 h-3.5 text-[#004ac6]" />
                                    <span>编辑订单</span>
                                  </button>
                                )}

                                {/* 导入 (仅 FAILED) */}
                                {allowedActions.includes('IMPORT') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null);
                                      onImport(ord);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-[#0b1c30] hover:bg-[#eff4ff] hover:text-[#004ac6] flex items-center gap-2 cursor-pointer transition-colors"
                                    role="menuitem"
                                  >
                                    <Download className="w-3.5 h-3.5 text-[#004ac6]" />
                                    <span>重新导入</span>
                                  </button>
                                )}

                                {/* 删除 (仅 FAILED) */}
                                {allowedActions.includes('DELETE') && (
                                  <>
                                    <div className="h-px bg-[#e2e8f0] my-1" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmAction({ orderId: ord.id, action: 'DELETE' });
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer transition-colors"
                                      role="menuitem"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                      <span>删除订单</span>
                                    </button>
                                  </>
                                )}

                                {/* 取消 (仅 SUCCESS) */}
                                {allowedActions.includes('CANCEL') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmAction({ orderId: ord.id, action: 'CANCEL' });
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer transition-colors"
                                    role="menuitem"
                                  >
                                    <Ban className="w-3.5 h-3.5 text-rose-600" />
                                    <span>取消订单</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
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
