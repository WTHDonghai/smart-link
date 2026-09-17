import React, { useState } from 'react';
import type { ToolkitOrder } from '../../types';
import { ChannelBadge } from '../common/ChannelBadge';
import { StatusBadge } from '../common/StatusBadge';
import { EmptyState } from '../common/EmptyState';
import {
  formatCurrency,
  getAllowedOrderActions,
  getOrderActionDisabledReason,
  getOrderStatusMeta,
} from '../../utils/orderHelpers';
import { Edit3, Download, Trash2, Ban, Loader2, Copy, Check } from 'lucide-react';

export interface OrderTableProps {
  orders: ToolkitOrder[];
  actionLoadingId?: string;
  onEdit: (order: ToolkitOrder) => void;
  onImport: (order: ToolkitOrder) => void;
  onDelete: (order: ToolkitOrder) => void;
  onCancel: (order: ToolkitOrder) => void;
}

export const OrderTable: React.FC<OrderTableProps> = ({
  orders,
  actionLoadingId,
  onEdit,
  onImport,
  onDelete,
  onCancel,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
            <th className="py-2.5 px-4 font-semibold text-right bg-[#f8faff] whitespace-nowrap sticky top-0 right-0 z-30 w-[160px] min-w-[160px] border-b border-l border-[#e2e8f0] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]">
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
            orders.map((ord) => {
              const allowedActions = getAllowedOrderActions(ord.status);
              const statusMeta = getOrderStatusMeta(ord.status);
              const isOperating = actionLoadingId === ord.id;
              const isCopied = copiedId === ord.otaOrderId;

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
                            onClick={() => handleCopy(ord.otaOrderId)}
                            className="font-mono font-bold text-[#004ac6] hover:text-[#003da6] text-xs hover:underline cursor-pointer tracking-tight truncate select-text"
                            title="点击复制 OTA 订单号"
                          >
                            {ord.otaOrderId}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(ord.otaOrderId)}
                            className="text-[#94a3b8] hover:text-[#004ac6] p-0.5"
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
                  <td className="py-3 px-4 align-top text-right sticky right-0 bg-white group-hover:bg-[#f8faff] w-[160px] min-w-[160px] border-b border-l border-[#e2e8f0] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)] z-10">
                    {isOperating ? (
                      <div className="flex items-center justify-end gap-1.5 py-1 text-xs text-[#004ac6]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>处理中...</span>
                      </div>
                    ) : allowedActions.length === 0 ? (
                      <span
                        className="text-xs text-[#94a3b8] cursor-not-allowed select-none"
                        title={getOrderActionDisabledReason('EDIT', ord.status)}
                      >
                        只读状态
                      </span>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        {/* 编辑 (仅 FAILED) */}
                        {allowedActions.includes('EDIT') && (
                          <button
                            type="button"
                            onClick={() => onEdit(ord)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#eff4ff] hover:bg-[#dce9ff] text-[#004ac6] font-medium text-xs transition-colors cursor-pointer"
                            title="编辑订单绑定参数"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>编辑</span>
                          </button>
                        )}

                        {/* 导入 (仅 FAILED) */}
                        {allowedActions.includes('IMPORT') && (
                          <button
                            type="button"
                            onClick={() => onImport(ord)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#004ac6] hover:bg-[#003da6] text-white font-medium text-xs transition-colors cursor-pointer shadow-2xs"
                            title="重新提交导入"
                          >
                            <Download className="w-3 h-3" />
                            <span>导入</span>
                          </button>
                        )}

                        {/* 删除 (仅 FAILED) */}
                        {allowedActions.includes('DELETE') && (
                          <button
                            type="button"
                            onClick={() => onDelete(ord)}
                            className="p-1 rounded text-[#ba1a1a] hover:bg-rose-50 transition-colors cursor-pointer"
                            title="删除失败订单"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* 取消 (仅 SUCCESS) */}
                        {allowedActions.includes('CANCEL') && (
                          <button
                            type="button"
                            onClick={() => onCancel(ord)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-medium text-xs transition-colors cursor-pointer"
                            title="取消已导入的订单"
                          >
                            <Ban className="w-3 h-3" />
                            <span>取消订单</span>
                          </button>
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
