import React, { useState, useEffect, useRef } from 'react';
import type { ToolkitOrder, HotelMapping, PlatformProperty } from '@/src/types';
import { resolveChannelMeta, type ChannelCandidate } from '@/src/utils/channelMeta';
import { ChannelBadge } from '../common/ChannelBadge';
import { StatusBadge } from '../common/StatusBadge';
import { EmptyState } from '../common/EmptyState';
import {
  formatCurrency,
  formatSyncTime,
  getAllowedOrderActions,
  getOrderStatusMeta,
  getOrderTypeMeta,
  resolveOrderHotelName,
} from '@/src/utils/orderHelpers';
import { copyToClipboard } from '@/src/utils/clipboard';
import { Edit3, Download, Trash2, Ban, Loader2, Copy, Check, MoreVertical, AlertCircle } from 'lucide-react';

interface OrderTableColumn {
  key: string;
  label: string;
  className: string;
}

export const ORDER_TABLE_COLUMNS: readonly OrderTableColumn[] = [
  {
    key: 'otaOrderId',
    label: 'OTA订单号',
    className:
      'py-2.5 px-3.5 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 left-0 z-30 w-[190px] min-w-[190px] border-b border-r border-[#e2e8f0] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]',
  },
  {
    key: 'contactName',
    label: '客人',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[85px] border-b border-[#e2e8f0]',
  },
  {
    key: 'mobile',
    label: '手机号',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[115px] border-b border-[#e2e8f0]',
  },
  {
    key: 'stayDates',
    label: '抵离日期',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[135px] border-b border-[#e2e8f0]',
  },
  {
    key: 'roomType',
    label: '房型',
    className:
      'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[160px] max-w-[240px] border-b border-[#e2e8f0]',
  },
  {
    key: 'rateCode',
    label: '房价码',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[90px] border-b border-[#e2e8f0]',
  },
  {
    key: 'paytype',
    label: '预订类型',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[95px] border-b border-[#e2e8f0]',
  },
  {
    key: 'otaChannel',
    label: '渠道',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[100px] border-b border-[#e2e8f0]',
  },
  {
    key: 'hotel',
    label: '酒店',
    className:
      'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[150px] max-w-[200px] border-b border-[#e2e8f0]',
  },
  {
    key: 'pricing',
    label: '每日房价',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[140px] border-b border-[#e2e8f0]',
  },
  {
    key: 'remark',
    label: '备注',
    className:
      'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[150px] max-w-[220px] border-b border-[#e2e8f0]',
  },
  {
    key: 'createdTime',
    label: '搬单时间',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[130px] border-b border-[#e2e8f0]',
  },
  {
    key: 'status',
    label: '状态',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[120px] border-b border-[#e2e8f0]',
  },
  {
    key: 'orderType',
    label: '类型',
    className: 'py-2.5 px-3 font-semibold bg-[#f9fafb] whitespace-nowrap sticky top-0 z-20 min-w-[80px] border-b border-[#e2e8f0]',
  },
  {
    key: 'actions',
    label: '操作',
    className:
      'py-2.5 px-3 font-semibold text-right bg-[#f9fafb] whitespace-nowrap sticky top-0 right-0 z-30 w-[80px] min-w-[80px] border-b border-l border-[#e2e8f0] shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.06)]',
  },
];

export interface OrderTableProps {
  orders: ToolkitOrder[];
  total?: number;
  channels?: readonly ChannelCandidate[];
  hotels?: readonly HotelMapping[];
  pmsProperties?: readonly PlatformProperty[];
  actionLoadingId?: string;
  initialOpenMenuId?: string;
  initialConfirmAction?: { orderId: string; action: 'CANCEL' | 'DELETE' };
  onViewDetail: (order: ToolkitOrder) => void;
  onEdit: (order: ToolkitOrder) => void;
  onImport: (order: ToolkitOrder) => void;
  onDelete: (order: ToolkitOrder) => void;
  onCancel: (order: ToolkitOrder) => void;
  onCopy?: (text: string, success: boolean) => void;
}

export const OrderTable: React.FC<OrderTableProps> = ({
  orders,
  total,
  channels = [],
  hotels = [],
  pmsProperties = [],
  actionLoadingId,
  initialOpenMenuId,
  initialConfirmAction,
  onViewDetail,
  onEdit,
  onImport,
  onDelete,
  onCancel,
  onCopy,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async (text: string) => {
    if (!text) return;
    let success = false;
    try {
      success = await copyToClipboard(text);
      if (success) {
        setCopiedId(text);
        if (copyTimerRef.current) {
          clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = setTimeout(() => {
          setCopiedId(null);
          copyTimerRef.current = null;
        }, 1500);
      }
    } catch {
      success = false;
    }
    onCopy?.(text, success);
  };

  const displayTotal = total !== undefined ? total : orders.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl border border-[#e2e8f0] shadow-xs overflow-hidden">
      {/* 表格顶部标题栏 */}
      <div className="px-4 py-3 border-b border-[#e2e8f0] bg-white flex items-center justify-between shrink-0">
        <h3 id="order-table-heading" className="text-sm font-bold text-[#0b1c30]">
          订单列表 (共 {displayTotal} 条)
        </h3>
      </div>

      {/* 滚动表格容器 */}
      <div
        tabIndex={0}
        role="region"
        aria-labelledby="order-table-heading"
        className="flex-1 min-h-0 overflow-auto outline-hidden"
      >
        <table className="w-full text-left border-separate border-spacing-0 min-w-[1680px]">
          <thead className="sticky top-0 z-20 bg-[#f9fafb]">
            <tr className="text-xs text-[#737686] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              {ORDER_TABLE_COLUMNS.map((col) => (
                <th key={col.key} className={col.className}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-xs divide-y divide-[#edf2f9]">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={ORDER_TABLE_COLUMNS.length} className="py-14">
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
                const typeMeta = getOrderTypeMeta(ord.orderType);
                const channelMeta = resolveChannelMeta({ channelCode: ord.otaChannel }, channels);
                const hotelDisplayName = resolveOrderHotelName(ord, hotels, pmsProperties);
                const isOperating = actionLoadingId === ord.id;
                const isCopied = copiedId === ord.otaOrderId;
                const isNearBottom = index >= orders.length - 2 && orders.length > 2;
                const pricingList = ord.booking?.pricing || [];

                return (
                  <tr
                    key={ord.id}
                    className="transition-colors hover:bg-[#f8faff] group"
                  >
                    {/* 列 1: OTA订单号 */}
                    <td className="py-3 px-3.5 align-top sticky left-0 z-10 bg-white group-hover:bg-[#f8faff] w-[190px] min-w-[190px] border-b border-r border-[#e2e8f0] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                      <div className="flex items-center gap-1 min-w-0">
                        <span
                          onClick={() => onViewDetail(ord)}
                          className="font-mono font-bold text-[#004ac6] hover:text-[#003da6] text-xs hover:underline cursor-pointer tracking-tight truncate select-text"
                          title="点击查看订单详情"
                        >
                          {ord.otaOrderId || ord.id || '-'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopy(ord.otaOrderId);
                          }}
                          className="text-[#94a3b8] hover:text-[#004ac6] p-0.5 cursor-pointer rounded shrink-0"
                          title="复制订单号"
                          aria-label="复制订单号"
                        >
                          {isCopied ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* 列 2: 客人 */}
                    <td className="py-3 px-3 align-top whitespace-nowrap border-b border-[#edf2f9]">
                      <span
                        className="font-medium text-[#0b1c30] text-xs select-text"
                        title={ord.contact?.name || '-'}
                      >
                        {ord.contact?.name || '-'}
                      </span>
                    </td>

                    {/* 列 3: 手机号 */}
                    <td className="py-3 px-3 align-top whitespace-nowrap font-mono text-[#0b1c30] border-b border-[#edf2f9] select-text">
                      {ord.contact?.mobile || '-'}
                    </td>

                    {/* 列 4: 抵离日期 */}
                    <td className="py-3 px-3 align-top whitespace-nowrap border-b border-[#edf2f9]">
                      <div className="flex flex-col font-mono">
                        <span className="font-bold text-[#0b1c30] text-xs">
                          {ord.booking?.arrival || '-'}
                        </span>
                        <span className="text-[11px] text-[#737686] mt-0.5">
                          至 {ord.booking?.departure || '-'} ({ord.booking?.nights || 1}晚)
                        </span>
                      </div>
                    </td>

                    {/* 列 5: 房型 */}
                    <td className="py-3 px-3 align-top max-w-[240px] border-b border-[#edf2f9]">
                      <div className="flex flex-col">
                        <span
                          className="font-bold text-[#0b1c30] text-xs leading-snug line-clamp-2"
                          title={ord.booking?.roomType || '-'}
                        >
                          {ord.booking?.roomType || '-'}
                        </span>
                        <span className="text-[11px] text-[#737686] mt-0.5">
                          {ord.booking?.quantity || 1}间
                        </span>
                      </div>
                    </td>

                    {/* 列 6: 房价码 */}
                    <td className="py-3 px-3 align-top whitespace-nowrap font-mono text-[#0b1c30] border-b border-[#edf2f9]">
                      {ord.booking?.rateCode || '-'}
                    </td>

                    {/* 列 7: 预订类型 */}
                    <td className="py-3 px-3 align-top whitespace-nowrap text-[#0b1c30] border-b border-[#edf2f9]">
                      {ord.booking?.paytype || '-'}
                    </td>

                    {/* 列 8: 渠道 */}
                    <td className="py-3 px-3 align-top whitespace-nowrap border-b border-[#edf2f9]">
                      <div className="flex items-center gap-1.5">
                        <ChannelBadge channelCode={ord.otaChannel} channels={channels} size="xs" />
                        <span className="text-xs text-[#0b1c30] font-medium truncate">
                          {channelMeta.name}
                        </span>
                      </div>
                    </td>

                    {/* 列 9: 酒店 */}
                    <td className="py-3 px-3 align-top max-w-[200px] border-b border-[#edf2f9]">
                      <span
                        className="font-bold text-[#0b1c30] text-xs leading-snug line-clamp-2"
                        title={hotelDisplayName}
                      >
                        {hotelDisplayName}
                      </span>
                    </td>

                    {/* 列 10: 每日房价 (默认仅显示首日，鼠标悬浮展开全部明细气泡) */}
                    <td className="py-3 px-3 align-top whitespace-nowrap border-b border-[#edf2f9]">
                      {pricingList.length > 0 ? (
                        <div
                          className="relative inline-flex items-center gap-1.5 font-mono group/pricing"
                          tabIndex={pricingList.length > 1 ? 0 : undefined}
                        >
                          <div className="text-xs text-[#0b1c30] inline-flex items-center">
                            {pricingList[0].date ? (
                              <span className="text-[#737686] mr-1">
                                {pricingList[0].date.slice(5)}:
                              </span>
                            ) : null}
                            <span className="font-semibold">
                              {formatCurrency(pricingList[0].price)}
                            </span>
                          </div>

                          {pricingList.length > 1 && (
                            <>
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#eff4ff] text-[#004ac6] rounded-md cursor-pointer select-none">
                                +{pricingList.length - 1}晚
                              </span>

                              {/* 悬浮展示全部每日房价浮层 */}
                              <div
                                role="tooltip"
                                className={`hidden group-hover/pricing:flex group-focus-within/pricing:flex flex-col gap-1 absolute left-0 ${
                                  isNearBottom ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                                } z-40 min-w-[165px] max-h-56 overflow-y-auto bg-white border border-[#dce9ff] rounded-xl shadow-lg p-2.5`}
                              >
                                <div className="text-[11px] font-sans font-semibold text-[#737686] pb-1 border-b border-[#f1f5f9]">
                                  每日房价明细 ({pricingList.length}晚)
                                </div>
                                {pricingList.map((item, idx) => (
                                  <div
                                    key={`${item.date || idx}-${idx}`}
                                    className="flex items-center justify-between gap-3 text-xs text-[#0b1c30]"
                                  >
                                    <span className="text-[#737686]">
                                      {item.date ? item.date.slice(5) : `第${idx + 1}晚`}
                                    </span>
                                    <span className="font-semibold">
                                      {formatCurrency(item.price)}
                                    </span>
                                  </div>
                                ))}
                                {ord.booking?.totalPrice != null && (
                                  <div className="flex items-center justify-between gap-3 pt-1 mt-0.5 border-t border-[#f1f5f9] text-[11px] text-[#0b1c30] font-semibold">
                                    <span className="font-sans text-[#737686]">合计</span>
                                    <span>{formatCurrency(ord.booking.totalPrice)}</span>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="font-mono font-bold text-[#0b1c30] text-xs">
                          {formatCurrency(ord.booking?.totalPrice)}
                        </span>
                      )}
                    </td>

                    {/* 列 11: 备注 */}
                    <td className="py-3 px-3 align-top max-w-[220px] border-b border-[#edf2f9]">
                      <span
                        className="text-xs text-[#434655] line-clamp-2 break-all"
                        title={ord.remark || ''}
                      >
                        {ord.remark || '-'}
                      </span>
                    </td>

                    {/* 列 12: 搬单时间 */}
                    <td className="py-3 px-3 align-top whitespace-nowrap font-mono text-xs text-[#434655] border-b border-[#edf2f9]">
                      {formatSyncTime(ord.createdTime || ord.updatedAt)}
                    </td>

                    {/* 列 13: 状态 */}
                    <td className="py-3 px-3 align-top border-b border-[#edf2f9]">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge
                            variant={statusMeta.tone}
                            label={statusMeta.label}
                            size="xs"
                          />
                        </div>
                        {ord.status === 'SUCCESS' && ord.pmsOrderId && (
                          <span
                            className="text-[11px] text-emerald-700 font-mono truncate"
                            title={ord.pmsOrderId}
                          >
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

                    {/* 列 14: 类型 */}
                    <td className="py-3 px-3 align-top whitespace-nowrap border-b border-[#edf2f9]">
                      {ord.orderType ? (
                        <StatusBadge
                          variant={typeMeta.tone}
                          label={typeMeta.label}
                          size="xs"
                        />
                      ) : (
                        <span className="text-[#94a3b8]">-</span>
                      )}
                    </td>

                    {/* 列 15: 操作 (Sticky right) */}
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
    </div>
  );
};
