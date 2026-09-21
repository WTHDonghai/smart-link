import React, { useState, useEffect, useMemo } from 'react';
import type {
  ToolkitOrder,
  ToolkitOrderDraft,
  InternalProductOptions,
  NightlyPricing,
} from '../../types';
import { ChannelBadge } from '../common/ChannelBadge';
import { StatusBadge } from '../common/StatusBadge';
import { SearchableSelect, type SelectOption } from '../common/SearchableSelect';
import {
  calculateNightsAndPricing,
  formatCurrency,
  getOrderStatusMeta,
} from '../../utils/orderHelpers';
import { X, Save, AlertCircle, Loader2, Calendar, User, Phone, BedDouble, FileText, Edit3 } from 'lucide-react';

export interface EditOrderDrawerProps {
  order: ToolkitOrder | null;
  productOptions: InternalProductOptions;
  isOpen: boolean;
  isLoading?: boolean;
  isSaving?: boolean;
  isReadOnly?: boolean;
  error?: string;
  onClose: () => void;
  onSave?: (id: string, draft: ToolkitOrderDraft) => Promise<void> | void;
  onSwitchToEdit?: () => void;
}

export const EditOrderDrawer: React.FC<EditOrderDrawerProps> = ({
  order,
  productOptions,
  isOpen,
  isLoading = false,
  isSaving = false,
  isReadOnly = false,
  error,
  onClose,
  onSave,
  onSwitchToEdit,
}) => {
  // Form fields initialized directly from order for immediate rendering
  const [contactName, setContactName] = useState(order?.contact?.name || '');
  const [contactMobile, setContactMobile] = useState(order?.contact?.mobile || '');
  const [roomTypeId, setRoomTypeId] = useState(order?.booking?.roomTypeId || '');
  const [roomType, setRoomType] = useState(order?.booking?.roomType || '');
  const [rateCode, setRateCode] = useState(order?.booking?.rateCode || '');
  const [paytype, setPaytype] = useState(order?.booking?.paytype || '');
  const [arrival, setArrival] = useState(order?.booking?.arrival || '');
  const [departure, setDeparture] = useState(order?.booking?.departure || '');
  const [quantity, setQuantity] = useState(order?.booking?.quantity || 1);
  const [pricing, setPricing] = useState<NightlyPricing[]>(() => {
    if (!order) return [];
    const arr = order.booking?.arrival || '';
    const dep = order.booking?.departure || '';
    const existing = order.booking?.pricing || [];
    if (arr && dep) {
      const defaultP = existing.length > 0 ? existing[0].price : 0;
      return calculateNightsAndPricing(arr, dep, existing, defaultP).pricing;
    }
    return existing;
  });
  const [remark, setRemark] = useState(order?.remark || '');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync state when order changes
  useEffect(() => {
    if (order) {
      setContactName(order.contact?.name || '');
      setContactMobile(order.contact?.mobile || '');
      setRoomTypeId(order.booking?.roomTypeId || '');
      setRoomType(order.booking?.roomType || '');
      setRateCode(order.booking?.rateCode || '');
      setPaytype(order.booking?.paytype || '');
      const arr = order.booking?.arrival || '';
      const dep = order.booking?.departure || '';
      setArrival(arr);
      setDeparture(dep);
      setQuantity(order.booking?.quantity || 1);
      setRemark(order.remark || '');
      setValidationError(null);

      const existingPricing = order.booking?.pricing || [];
      if (arr && dep) {
        const defaultP = existingPricing.length > 0 ? existingPricing[0].price : 0;
        const computed = calculateNightsAndPricing(arr, dep, existingPricing, defaultP);
        setPricing(computed.pricing);
      } else {
        setPricing(existingPricing);
      }
    }
  }, [order]);

  // Handle Escape key and body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Options conversion
  const roomTypeOptions: SelectOption[] = useMemo(() => {
    const list = productOptions.roomTypes.map((r) => ({
      label: r.displayLabel || (r.code && r.name && r.name !== r.code ? `${r.name}（${r.code}）` : r.name || r.code),
      value: r.code,
      subtext: r.code && r.name !== r.code ? r.code : undefined,
    }));
    const currentCode = roomTypeId || roomType;
    if (currentCode && !list.some((item) => item.value === currentCode)) {
      return [{ label: roomType || roomTypeId, value: currentCode, subtext: '当前指定' }, ...list];
    }
    return list;
  }, [productOptions.roomTypes, roomTypeId, roomType]);

  const rateCodeOptions: SelectOption[] = useMemo(() => {
    const list = productOptions.rateCodes.map((r) => ({
      label: r.displayLabel || (r.rateCode && r.rateName && r.rateName !== r.rateCode ? `${r.rateName}（${r.rateCode}）` : r.rateName || r.rateCode),
      value: r.rateCode,
      subtext: r.rateCode && r.rateName !== r.rateCode ? r.rateCode : undefined,
    }));
    if (rateCode && !list.some((item) => item.value === rateCode)) {
      return [{ label: rateCode, value: rateCode, subtext: '当前指定' }, ...list];
    }
    return list;
  }, [productOptions.rateCodes, rateCode]);

  const paytypeOptions: SelectOption[] = useMemo(() => {
    const list = productOptions.reservationTypes.map((p) => ({
      label: p.displayLabel || (p.code && p.label && p.label !== p.code ? `${p.label}（${p.code}）` : p.label || p.code),
      value: p.code,
      subtext: p.code && p.label !== p.code ? p.code : undefined,
    }));
    if (paytype && !list.some((item) => item.value === paytype)) {
      return [{ label: paytype, value: paytype, subtext: '当前指定' }, ...list];
    }
    return list;
  }, [productOptions.reservationTypes, paytype]);

  // When arrival/departure changes, recompute pricing dates
  const handleDatesChange = (newArr: string, newDep: string) => {
    setArrival(newArr);
    setDeparture(newDep);
    if (newArr && newDep && newArr < newDep) {
      const defaultP = pricing.length > 0 ? pricing[0].price : 0;
      const computed = calculateNightsAndPricing(newArr, newDep, pricing, defaultP);
      setPricing(computed.pricing);
    }
  };

  // Price adjustment for a single night
  const handleNightPriceChange = (index: number, val: number) => {
    const next = [...pricing];
    next[index] = { ...next[index], price: Math.max(0, val) };
    setPricing(next);
  };

  // Calculate total price
  const totalPrice = useMemo(() => {
    return pricing.reduce((sum, item) => sum + (Number(item.price) || 0), 0) * (quantity || 1);
  }, [pricing, quantity]);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isReadOnly || !order || !onSave) return;

    if (!contactName.trim()) {
      setValidationError('请填写客人姓名');
      return;
    }
    if (!contactMobile.trim()) {
      setValidationError('请填写客人联系电话');
      return;
    }
    if (!arrival || !departure || arrival >= departure) {
      setValidationError('请选择有效的入住与离店日期（离店需晚于入住）');
      return;
    }
    if (!roomType.trim() && !roomTypeId.trim()) {
      setValidationError('请选择或输入文旅房型');
      return;
    }
    if (!rateCode.trim()) {
      setValidationError('请选择或输入房价码');
      return;
    }

    setValidationError(null);

    const draft: ToolkitOrderDraft = {
      otaOrderId: order.otaOrderId,
      contact: {
        name: contactName.trim(),
        mobile: contactMobile.trim(),
      },
      booking: {
        roomType: roomType.trim() || roomTypeId.trim(),
        roomTypeId: roomTypeId.trim(),
        rateCode: rateCode.trim(),
        paytype: paytype.trim(),
        arrival,
        departure,
        quantity: Math.max(1, quantity),
        pricing,
      },
      remark: remark.trim() || undefined,
    };

    void onSave(order.id, draft);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="edit-order-drawer-title">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/35 backdrop-blur-2xs transition-opacity duration-200"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-xl bg-white shadow-2xl flex flex-col border-l border-[#dce9ff] animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="px-6 py-4 border-b border-[#e2e8f0] flex items-center justify-between bg-[#f8faff] shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 id="edit-order-drawer-title" className="text-base font-bold text-[#0b1c30]">
                  {isReadOnly ? '文旅订单详情' : '编辑文旅订单'}
                </h2>
                {order && <ChannelBadge channelCode={order.otaChannel} size="xs" />}
                {order && (
                  <StatusBadge
                    variant={getOrderStatusMeta(order.status).tone}
                    label={getOrderStatusMeta(order.status).label}
                    size="xs"
                  />
                )}
              </div>
              <p className="text-xs text-[#737686] mt-0.5 font-mono">
                OTA单号: {order?.otaOrderId || '-'} · 酒店: {order?.unitName || order?.unitId || '-'}
                {order?.pmsOrderId && ` · PMS: ${order.pmsOrderId}`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#737686] hover:text-[#0b1c30] hover:bg-[#edf2f9] transition-colors cursor-pointer"
              title="关闭抽屉"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-[#737686]">
                <Loader2 className="w-8 h-8 animate-spin text-[#004ac6] mb-3" />
                <span className="text-sm">正在加载订单详情与产品目录...</span>
              </div>
            ) : (
              <form id="edit-order-form" onSubmit={handleSubmit} className="flex-1 flex flex-col space-y-5">
                {/* 错误提示 / 失败原因 */}
                {(validationError || error || (isReadOnly && order?.status === 'FAILED' && order?.errorMessage)) && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-700 text-xs shrink-0">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{validationError || error || order?.errorMessage}</span>
                  </div>
                )}

                {/* 模块 1: 客人信息 */}
                <div className="bg-[#f8faff] p-3.5 rounded-xl border border-[#e2e8f0] space-y-3 shrink-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#0b1c30]">
                    <User className="w-3.5 h-3.5 text-[#004ac6]" />
                    <span>客人联系信息</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[#737686] mb-1">姓名 *</label>
                      <input
                        type="text"
                        disabled={isReadOnly}
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="客人姓名"
                        className="w-full h-8 px-2.5 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs text-[#0b1c30] outline-hidden font-medium disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#737686] mb-1">手机电话 *</label>
                      <div className="relative">
                        <input
                          type="text"
                          disabled={isReadOnly}
                          value={contactMobile}
                          onChange={(e) => setContactMobile(e.target.value)}
                          placeholder="客人手机号"
                          className="w-full h-8 pl-2.5 pr-7 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs font-mono text-[#0b1c30] outline-hidden font-medium disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                        />
                        <Phone className="w-3.5 h-3.5 text-[#94a3b8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 模块 2: 预订与文旅产品绑定 */}
                <div className="bg-[#f8faff] p-3.5 rounded-xl border border-[#e2e8f0] space-y-3 shrink-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#0b1c30]">
                    <BedDouble className="w-3.5 h-3.5 text-[#004ac6]" />
                    <span>文旅产品绑定</span>
                  </div>

                  {/* 房型选择 */}
                  <div>
                    <label className="block text-xs text-[#737686] mb-1">文旅房型 *</label>
                    {roomTypeOptions.length > 0 ? (
                      <SearchableSelect
                        disabled={isReadOnly}
                        value={roomTypeId || roomType}
                        options={roomTypeOptions}
                        onChange={(val) => {
                          setRoomTypeId(val);
                          const matched = productOptions.roomTypes.find((r) => r.code === val);
                          if (matched) {
                            setRoomType(matched.name);
                          } else {
                            setRoomType(val);
                          }
                        }}
                        placeholder="请选择对应文旅房型"
                        searchPlaceholder="搜索房型名称/代码..."
                      />
                    ) : (
                      <input
                        type="text"
                        disabled={isReadOnly}
                        value={roomType}
                        onChange={(e) => setRoomType(e.target.value)}
                        placeholder="输入房型名称"
                        className="w-full h-8.5 px-2.5 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs text-[#0b1c30] outline-hidden disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                      />
                    )}
                  </div>

                  {/* 房价码与预订类型 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[#737686] mb-1">房价方案 (RateCode) *</label>
                      {rateCodeOptions.length > 0 ? (
                        <SearchableSelect
                          disabled={isReadOnly}
                          value={rateCode}
                          options={rateCodeOptions}
                          onChange={(val) => setRateCode(val)}
                          placeholder="请选择房价码"
                          searchPlaceholder="搜索房价码/名称..."
                        />
                      ) : (
                        <input
                          type="text"
                          disabled={isReadOnly}
                          value={rateCode}
                          onChange={(e) => setRateCode(e.target.value)}
                          placeholder="如 OTA, RACK"
                          className="w-full h-8.5 px-2.5 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs font-mono text-[#0b1c30] outline-hidden disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                        />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-[#737686] mb-1">预订类型 / 支付</label>
                      {paytypeOptions.length > 0 ? (
                        <SearchableSelect
                          disabled={isReadOnly}
                          value={paytype}
                          options={paytypeOptions}
                          onChange={(val) => setPaytype(val)}
                          placeholder="请选择预订类型"
                          searchPlaceholder="搜索预订类型/名称..."
                        />
                      ) : (
                        <input
                          type="text"
                          disabled={isReadOnly}
                          value={paytype}
                          onChange={(e) => setPaytype(e.target.value)}
                          placeholder="如 预付全额"
                          className="w-full h-8.5 px-2.5 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs text-[#0b1c30] outline-hidden disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                        />
                      )}
                    </div>
                  </div>

                  {/* 抵离日期与房间数 */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-[#737686] mb-1">入住日期 *</label>
                      <input
                        type="date"
                        disabled={isReadOnly}
                        value={arrival}
                        onChange={(e) => handleDatesChange(e.target.value, departure)}
                        className="w-full h-8 px-2 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs font-mono text-[#0b1c30] outline-hidden disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#737686] mb-1">离店日期 *</label>
                      <input
                        type="date"
                        disabled={isReadOnly}
                        value={departure}
                        onChange={(e) => handleDatesChange(arrival, e.target.value)}
                        className="w-full h-8 px-2 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs font-mono text-[#0b1c30] outline-hidden disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#737686] mb-1">间数</label>
                      <input
                        type="number"
                        disabled={isReadOnly}
                        min={1}
                        max={99}
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full h-8 px-2 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs font-mono text-[#0b1c30] outline-hidden disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                      />
                    </div>
                  </div>
                </div>

                {/* 模块 3: 每日价格拆分与金额合计 */}
                <div className="bg-[#f8faff] p-3.5 rounded-xl border border-[#e2e8f0] space-y-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#0b1c30]">
                      <Calendar className="w-3.5 h-3.5 text-[#004ac6]" />
                      <span>每日价格明细 ({pricing.length} 晚)</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-[#737686]">合计金额: </span>
                      <strong className="font-mono font-bold text-[#004ac6] text-sm">
                        {formatCurrency(totalPrice)}
                      </strong>
                    </div>
                  </div>

                  {pricing.length === 0 ? (
                    <p className="text-xs text-[#94a3b8] py-2">请先设置有效的入住与离店日期以生成价格拆分表</p>
                  ) : (
                    <div className="border border-[#dce9ff] rounded-lg overflow-hidden bg-white">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-[#edf4ff] text-[#434655]">
                          <tr>
                            <th className="py-2 px-3 font-semibold">日期</th>
                            <th className="py-2 px-3 font-semibold">单间每晚价格 (元)</th>
                            <th className="py-2 px-3 font-semibold text-right">小计 ({quantity}间)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f1f5f9]">
                          {pricing.map((item, idx) => (
                            <tr key={item.date} className="hover:bg-[#f8faff]">
                              <td className="py-2 px-3 font-mono font-medium text-[#0b1c30]">
                                {item.date}
                              </td>
                              <td className="py-1.5 px-3">
                                <div className="flex items-center gap-1">
                                  <span className="text-[#737686]">¥</span>
                                  <input
                                    type="number"
                                    disabled={isReadOnly}
                                    min={0}
                                    step="0.01"
                                    value={item.price}
                                    onChange={(e) =>
                                      handleNightPriceChange(idx, parseFloat(e.target.value) || 0)
                                    }
                                    className="w-24 h-7 px-2 bg-[#f8faff] border border-[#dce9ff] focus:border-[#004ac6] rounded text-xs font-mono font-bold text-[#0b1c30] outline-hidden disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                                  />
                                </div>
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-[#0b1c30]">
                                ¥{(item.price * quantity).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 模块 4: 备注说明 (自适应撑满剩余高度) */}
                <div className="bg-[#f8faff] p-3.5 rounded-xl border border-[#e2e8f0] space-y-2 flex flex-col flex-1 min-h-[120px]">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#0b1c30] shrink-0">
                    <FileText className="w-3.5 h-3.5 text-[#004ac6]" />
                    <span>备注 / 说明</span>
                  </div>
                  <textarea
                    disabled={isReadOnly}
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder={isReadOnly ? '无备注信息' : '选填，中台入账备注信息'}
                    className="w-full flex-1 min-h-[80px] p-2.5 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-md text-xs text-[#0b1c30] outline-hidden resize-none disabled:bg-[#f1f5f9] disabled:text-[#434655] disabled:cursor-not-allowed disabled:border-[#e2e8f0]"
                  />
                </div>
              </form>
            )}
          </div>

          {/* Footer */}
          {isReadOnly ? (
            <div className="px-6 py-3.5 border-t border-[#e2e8f0] bg-[#f8faff] flex items-center justify-between gap-3 shrink-0">
              <div>
                {order?.allowedActions?.includes('EDIT') && onSwitchToEdit && (
                  <button
                    type="button"
                    onClick={onSwitchToEdit}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#eff4ff] hover:bg-[#dce9ff] text-[#004ac6] border border-[#dce9ff] rounded-lg text-xs font-semibold cursor-pointer select-none transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>转为编辑</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 bg-white hover:bg-[#eff4ff] text-[#434655] hover:text-[#0b1c30] border border-[#dce9ff] rounded-lg text-xs font-medium transition-colors cursor-pointer select-none"
              >
                关闭
              </button>
            </div>
          ) : (
            <div className="px-6 py-3.5 border-t border-[#e2e8f0] bg-[#f8faff] flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 bg-white hover:bg-[#eff4ff] text-[#434655] hover:text-[#0b1c30] border border-[#dce9ff] rounded-lg text-xs font-medium transition-colors cursor-pointer select-none disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                form="edit-order-form"
                disabled={isSaving || isLoading}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer select-none disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>保存并导入中...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>保存并导入</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

