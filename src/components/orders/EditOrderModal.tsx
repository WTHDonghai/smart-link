import React, { useState } from 'react';
import { GuardianOrder } from '../../types';
import { X, Calendar, AlertCircle } from 'lucide-react';

interface EditOrderModalProps {
  order: GuardianOrder;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedData: Partial<GuardianOrder>, shouldImport: boolean) => void;
}

export const EditOrderModal: React.FC<EditOrderModalProps> = ({
  order,
  isOpen,
  onClose,
  onSave,
}) => {
  if (!isOpen) return null;

  // Form states initialized from order
  const [guestName, setGuestName] = useState(order.guestName || '');
  const [guestPhone, setGuestPhone] = useState(order.guestPhone || '');
  const [travelRoomType, setTravelRoomType] = useState(order.travelRoomType || '');
  const [ratePlanCode, setRatePlanCode] = useState(order.ratePlanCode || 'OTA');
  const [bookingType, setBookingType] = useState(order.bookingType || '');
  const [rooms, setRooms] = useState(order.rooms || 1);
  const [checkInDate, setCheckInDate] = useState(order.checkInDate || '');
  const [checkOutDate, setCheckOutDate] = useState(order.checkOutDate || '');
  const [price, setPrice] = useState<number>(order.otaPrice || 0);
  const [remark, setRemark] = useState(order.remark || `商品名称：${order.roomTypeName}`);

  const [hasValidated, setHasValidated] = useState(false);

  // Available options for selection
  const ROOM_TYPE_OPTIONS = [
    { value: '', label: '选择文旅房型' },
    { value: 'DLX_KING', label: '豪华大床房 (含双早)' },
    { value: 'DLX_TWIN', label: '豪华双床房 (含双早)' },
    { value: 'STD_KING', label: '标准大床房' },
    { value: 'EXEC_SUITE', label: '云隐行政套房' },
    { value: 'FAMILY_ROOM', label: '亲子主题景观房' }
  ];

  const RATE_CODE_OPTIONS = [
    { value: 'OTA', label: 'OTA - 在线分销净价' },
    { value: 'RACK', label: 'RACK - 门市挂牌价' },
    { value: 'CORP', label: 'CORP - 协议商务价' },
    { value: 'PROMO', label: 'PROMO - 促销特惠价' }
  ];

  const BOOKING_TYPE_OPTIONS = [
    { value: '', label: '选择预订类型' },
    { value: 'ONLINE_DIRECT', label: '直连网络预订 (自营)' },
    { value: 'CHANNEL_GUARANTEED', label: '渠道担保预订' },
    { value: 'PREPAID', label: '预付在线全额扣款' },
    { value: 'CORP_VIP', label: '大客户协议预留' }
  ];

  const isRoomValid = travelRoomType.trim() !== '';

  const handleSubmit = (autoImport: boolean) => {
    setHasValidated(true);
    if (!travelRoomType) {
      return;
    }

    onSave({
      guestName,
      guestPhone,
      travelRoomType,
      ratePlanCode,
      bookingType: bookingType || 'ONLINE_DIRECT',
      rooms: Number(rooms) || 1,
      checkInDate,
      checkOutDate,
      otaPrice: Number(price) || 0,
      remark,
      // If user provided a booking type and room type, resolve the previous failure reason
      ...(order.status === 'failed' && (bookingType || travelRoomType) ? { failureReason: undefined } : {})
    }, autoImport);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-2xl my-8 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
          <div>
            <h2 className="text-base font-bold text-[#111827] tracking-tight">
              编辑订单 - {order.otaOrderNo}
            </h2>
            <p className="text-[11px] text-[#6b7280] font-mono mt-0.5">
              记录 ID {order.id.replace('ord-', '20975974256')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh] text-xs">
          {/* Section 1: 订单信息 */}
          <div>
            <h3 className="text-xs font-bold text-[#111827] mb-3">
              订单信息
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">OTA 订单号</label>
                <input
                  type="text"
                  value={order.otaOrderNo}
                  disabled
                  className="w-full h-8.5 px-3 bg-blue-50/40 border border-blue-200 rounded text-xs text-blue-700 font-mono font-medium outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">OTA 渠道</label>
                <input
                  type="text"
                  value={order.channelName}
                  disabled
                  className="w-full h-8.5 px-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">客人姓名</label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="w-full h-8.5 px-3 bg-white border border-gray-300 rounded text-xs text-gray-900 focus:border-[#4850e5] outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">联系电话</label>
                <input
                  type="text"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  className="w-full h-8.5 px-3 bg-white border border-gray-300 rounded text-xs text-gray-900 focus:border-[#4850e5] outline-none"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Section 2: 预订信息 */}
          <div>
            <h3 className="text-xs font-bold text-[#111827] mb-3">
              预订信息
            </h3>
            
            <div className="mb-3">
              <label className="block text-[11px] text-[#4b5563] mb-1">房型名称 (OTA 原始)</label>
              <input
                type="text"
                value={order.roomTypeName || '订单未提供产品名称'}
                disabled
                className="w-full h-8.5 px-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">
                  文旅房型 <span className="text-red-500">*</span>
                </label>
                <select
                  value={travelRoomType}
                  onChange={(e) => setTravelRoomType(e.target.value)}
                  className={`w-full h-8.5 px-2.5 bg-white border rounded text-xs text-gray-900 outline-none ${
                    hasValidated && !isRoomValid 
                      ? 'border-red-400 bg-red-50/20 focus:border-red-500' 
                      : 'border-gray-300 focus:border-[#4850e5]'
                  }`}
                >
                  {ROOM_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {hasValidated && !isRoomValid && (
                  <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    请选择有效的房型。
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">房价码</label>
                <select
                  value={ratePlanCode}
                  onChange={(e) => setRatePlanCode(e.target.value)}
                  className="w-full h-8.5 px-2.5 bg-white border border-gray-300 rounded text-xs text-gray-900 focus:border-[#4850e5] outline-none"
                >
                  {RATE_CODE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">预订类型</label>
                <select
                  value={bookingType}
                  onChange={(e) => setBookingType(e.target.value)}
                  className="w-full h-8.5 px-2.5 bg-white border border-gray-300 rounded text-xs text-gray-900 focus:border-[#4850e5] outline-none"
                >
                  {BOOKING_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {order.failureReason?.includes('预订类型') && (
                  <p className="text-[10px] text-amber-600 mt-0.5">
                    * 补选预订类型后可消除“预订类型不存在”异常
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">房间数</label>
                <input
                  type="number"
                  min={1}
                  value={rooms}
                  onChange={(e) => setRooms(Number(e.target.value))}
                  className="w-full h-8.5 px-3 bg-white border border-gray-300 rounded text-xs text-gray-900 focus:border-[#4850e5] outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">入住日期</label>
                <div className="relative">
                  <input
                    type="text"
                    value={checkInDate}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    className="w-full h-8.5 pl-3 pr-8 bg-white border border-gray-300 rounded text-xs text-gray-900 focus:border-[#4850e5] outline-none"
                  />
                  <Calendar className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[#4b5563] mb-1">离店日期</label>
                <div className="relative">
                  <input
                    type="text"
                    value={checkOutDate}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                    className="w-full h-8.5 pl-3 pr-8 bg-white border border-gray-300 rounded text-xs text-gray-900 focus:border-[#4850e5] outline-none"
                  />
                  <Calendar className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Section 3: 每日价格 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-[#111827]">每日价格</h3>
              <span className="text-xs text-gray-500 font-medium">1 晚</span>
            </div>

            <div className="flex items-center justify-between gap-4 py-2 border-b border-gray-100">
              <span className="text-xs text-gray-700 font-mono">
                {checkInDate || '2026-09-09'}
              </span>
              <div className="w-44">
                <input
                  type="number"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className="w-full h-8.5 px-3 bg-white border border-gray-300 rounded text-xs text-right font-mono font-bold text-gray-900 focus:border-[#4850e5] outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3">
              <span className="text-xs text-gray-500">总计</span>
              <span className="text-base font-bold text-[#111827]">
                ¥{price.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* Section 4: 备注 */}
          <div>
            <h3 className="text-xs font-bold text-[#111827] mb-2">备注</h3>
            <label className="block text-[11px] text-[#4b5563] mb-1">订单备注</label>
            <textarea
              rows={3}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="w-full p-3 bg-white border border-gray-300 rounded text-xs text-gray-900 focus:border-[#4850e5] outline-none leading-relaxed resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 rounded text-xs font-medium transition-colors cursor-pointer"
          >
            关闭
          </button>
          
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            className="px-4 py-2 bg-white border border-[#4850e5] text-[#4850e5] hover:bg-blue-50 rounded text-xs font-medium transition-colors cursor-pointer"
          >
            仅保存订单
          </button>

          <button
            type="button"
            onClick={() => handleSubmit(true)}
            className="px-5 py-2 bg-[#4850e5] hover:bg-[#3b42c4] text-white rounded text-xs font-medium transition-colors shadow-2xs cursor-pointer"
          >
            保存并导入
          </button>
        </div>
      </div>
    </div>
  );
};
