import { requestPlatformApi, TOOLKIT_MODULE } from './platformApi';
import { fetchRoomTypes, fetchRatePlans, fetchReservationTypes } from './productApi';
import { getAllowedOrderActions, isToolkitOrderType } from '../utils/orderHelpers';
import type {
  ToolkitOrder,
  ToolkitOrderStatus,
  ToolkitOrderType,
  ToolkitOrderStatistics,
  ToolkitOrderFilters,
  ToolkitOrderPageResult,
  ToolkitOrderDraft,
  InternalProductOptions,
} from '../types';

export const ORDER_ENDPOINTS = {
  ORDERS: `/${TOOLKIT_MODULE}/orders`,
  STATISTICS: `/${TOOLKIT_MODULE}/orders/statistics`,
} as const;

/**
 * 安全解包平台返回的数据信封（支持 { code: 200, data: ... } 或直接响应实体）
 * 严格遵循 Fail-Fast 原则：遇到后端业务 code 异常立即抛错阻断
 */
export function unwrapPlatformEnvelope<T = Record<string, unknown>>(body: unknown): T {
  if (!body || typeof body !== 'object') {
    return (body as T) || ({} as T);
  }

  const envelope = body as Record<string, unknown>;
  if (
    envelope.success === false ||
    (envelope.code !== undefined &&
      envelope.code !== null &&
      String(envelope.code) !== '0' &&
      String(envelope.code) !== '0000' &&
      String(envelope.code) !== '200')
  ) {
    const errorMsg =
      (typeof envelope.msg === 'string' && envelope.msg) ||
      (typeof envelope.message === 'string' && envelope.message) ||
      (typeof envelope.error === 'string' && envelope.error) ||
      `业务状态异常 (code: ${envelope.code})`;
    throw new Error(`平台接口返回业务错误: ${errorMsg}`);
  }

  if ('data' in envelope && envelope.data !== undefined && envelope.data !== null) {
    return envelope.data as T;
  }

  return envelope as T;
}

/**
 * 纯函数：将远程中台订单对象归一化为标准的 ToolkitOrder 实体
 */
export function normalizeToolkitOrder(raw: Record<string, unknown>): ToolkitOrder {
  const contact = (raw.contact && typeof raw.contact === 'object' ? raw.contact : {}) as Record<string, unknown>;
  const booking = (raw.booking && typeof raw.booking === 'object' ? raw.booking : {}) as Record<string, unknown>;

  const rawPricing = Array.isArray(booking.pricing) ? booking.pricing : [];
  const pricing = rawPricing.map((p) => {
    const item = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    return {
      date: String(item.date || '').slice(0, 10),
      price: Number(item.price) || 0,
    };
  });

  const arrival = String(booking.arrival || raw.arrival || '').slice(0, 10);
  const departure = String(booking.departure || raw.departure || '').slice(0, 10);
  const nights = Number(booking.nights) || (arrival && departure ? Math.max(1, Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000)) : 1);
  const quantity = Number(booking.quantity) || 1;
  const totalPrice = Number(booking.totalPrice ?? raw.totalPrice ?? 0);
  const rawStatus = String(raw.status || 'PENDING').trim().toUpperCase() as ToolkitOrder['status'];
  const rawOrderType = raw.orderType ?? raw.type;
  const normalizedOrderType = rawOrderType ? String(rawOrderType).trim().toUpperCase() : '';
  const rawCreatedTime = raw.createdTime ?? raw.createdAt ?? raw.transferTime;

  return {
    id: String(raw.id || raw.orderId || '').trim(),
    unitId: String(raw.unitId || raw.propertyId || raw.extUnitCode || '').trim(),
    unitName: String(
      raw.unitName ||
        raw.propertyName ||
        raw.hotelName ||
        raw.otaHotelName ||
        raw.shopName ||
        raw.poiName ||
        booking.unitName ||
        booking.hotelName ||
        ''
    ).trim(),
    otaChannel: String(raw.otaChannel || raw.platform || raw.channelCode || '').trim().toUpperCase(),
    otaOrderId: String(raw.otaOrderId || raw.orderId || '').trim(),
    contact: {
      name: String(contact.name || raw.guestName || raw.contactName || '').trim(),
      mobile: String(contact.mobile || contact.phone || raw.guestMobile || '').trim(),
    },
    booking: {
      arrival,
      departure,
      roomType: String(booking.roomType || raw.roomType || '').trim(),
      roomTypeId: booking.roomTypeId ? String(booking.roomTypeId).trim() : undefined,
      rateCode: String(booking.rateCode || booking.ratePlanCode || raw.rateCode || '').trim(),
      paytype: String(booking.paytype || raw.paytype || '').trim(),
      nights,
      quantity,
      totalPrice,
      pricing,
    },
    status: rawStatus,
    orderType: isToolkitOrderType(normalizedOrderType) ? normalizedOrderType : undefined,
    createdTime: rawCreatedTime ? String(rawCreatedTime).trim() : undefined,
    errorMessage: raw.errorMessage || raw.error ? String(raw.errorMessage || raw.error).trim() : undefined,
    pmsOrderId: raw.pmsOrderId || raw.confirmationNo ? String(raw.pmsOrderId || raw.confirmationNo).trim() : undefined,
    remark: raw.remark || raw.remarks ? String(raw.remark || raw.remarks).trim() : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt).trim() : undefined,
    allowedActions: getAllowedOrderActions(rawStatus),
  };
}

export const ORDER_STATUSES: readonly ToolkitOrderStatus[] = Object.freeze([
  'PENDING',
  'SUCCESS',
  'FAILED',
  'CANCEL',
  'IMPORTING',
]);

export const ORDER_TYPES: readonly ToolkitOrderType[] = Object.freeze([
  'NEW',
  'MODIFY',
  'CANCEL',
]);

function parseValidDate(value: unknown): string {
  const str = String(value == null ? '' : value).trim();
  if (!str) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return '';
  const date = new Date(`${str}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== str ? '' : str;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 纯函数：校验与归一化文旅中台订单查询筛选条件 (严格遵循 Fail-Fast 原则)
 */
export function normalizeToolkitOrderFilters(
  input: Partial<ToolkitOrderFilters> = {}
): ToolkitOrderFilters {
  const rawStatus = String(input.status == null ? '' : input.status).trim().toUpperCase();
  const status = rawStatus === 'ALL' ? '' : rawStatus;
  if (status && !ORDER_STATUSES.includes(status as ToolkitOrderStatus)) {
    throw new Error(`不支持的订单状态：${status}`);
  }

  const rawOrderType = String(input.orderType == null ? '' : input.orderType).trim().toUpperCase();
  const orderType = rawOrderType === 'ALL' ? '' : rawOrderType;
  if (orderType && !ORDER_TYPES.includes(orderType as ToolkitOrderType)) {
    throw new Error(`不支持的订单类型：${orderType}`);
  }

  const rawCreatedStart = String(input.createdStart == null ? '' : input.createdStart).trim();
  const rawCreatedEnd = String(input.createdEnd == null ? '' : input.createdEnd).trim();
  const createdStart = parseValidDate(rawCreatedStart);
  const createdEnd = parseValidDate(rawCreatedEnd);

  if (rawCreatedStart && !createdStart) {
    throw new Error('搬单开始日期格式无效。');
  }
  if (rawCreatedEnd && !createdEnd) {
    throw new Error('搬单结束日期格式无效。');
  }
  if (createdStart && createdEnd && createdStart > createdEnd) {
    throw new Error('搬单开始日期不能晚于结束日期。');
  }

  const rawUnitId = String(input.unitId == null ? '' : input.unitId).trim();
  const unitId = rawUnitId.toUpperCase() === 'ALL' ? '' : rawUnitId;

  const rawOtaChannel = String(input.otaChannel == null ? '' : input.otaChannel).trim().toUpperCase();
  const otaChannel = rawOtaChannel === 'ALL' ? '' : rawOtaChannel;

  const otaOrderId = String(input.otaOrderId == null ? '' : input.otaOrderId).trim().slice(0, 200);
  const contactName = String(input.contactName == null ? '' : input.contactName).trim().slice(0, 200);

  return {
    page: clampInteger(input.page, 1, 1, 1000000),
    pageSize: clampInteger(input.pageSize, 20, 1, 100),
    unitId,
    otaChannel,
    status,
    orderType,
    otaOrderId,
    contactName,
    createdStart,
    createdEnd,
  };
}

/**
 * 分页查询文旅中台订单列表 (GET /toolkit/orders)
 */
export async function fetchToolkitOrders(
  filters: Partial<ToolkitOrderFilters> = {}
): Promise<ToolkitOrderPageResult> {
  const normalized = normalizeToolkitOrderFilters(filters);
  const queryParams = new URLSearchParams();

  queryParams.set('current', String(normalized.page));
  queryParams.set('size', String(normalized.pageSize));
  if (normalized.unitId) {
    queryParams.set('unitId', normalized.unitId);
  }
  if (normalized.otaChannel) {
    queryParams.set('otaChannel', normalized.otaChannel);
  }
  if (normalized.status) {
    queryParams.set('status', normalized.status);
  }
  if (normalized.orderType) {
    queryParams.set('orderType', normalized.orderType);
  }
  if (normalized.otaOrderId) {
    queryParams.set('otaOrderId', normalized.otaOrderId);
  }
  if (normalized.contactName) {
    queryParams.set('contactName', normalized.contactName);
  }
  if (normalized.createdStart) {
    queryParams.set('createdStart', `${normalized.createdStart} 00:00:00`);
  }
  if (normalized.createdEnd) {
    queryParams.set('createdEnd', `${normalized.createdEnd} 23:59:59`);
  }
  queryParams.set('showAll', 'true');

  const queryString = queryParams.toString();
  const url = `${ORDER_ENDPOINTS.ORDERS}${queryString ? `?${queryString}` : ''}`;

  const response = await requestPlatformApi<unknown>(url);
  const envelope = unwrapPlatformEnvelope<Record<string, unknown>>(response);

  const rawList = Array.isArray(envelope)
    ? envelope
    : Array.isArray(envelope.records)
    ? envelope.records
    : Array.isArray(envelope.list)
    ? envelope.list
    : Array.isArray(envelope.items)
    ? envelope.items
    : Array.isArray(envelope.rows)
    ? envelope.rows
    : Array.isArray(envelope.data)
    ? envelope.data
    : [];

  const records = rawList.map((item) => normalizeToolkitOrder(item as Record<string, unknown>));
  const total =
    typeof envelope.total === 'number'
      ? envelope.total
      : Number.isFinite(Number(envelope.total)) && Number(envelope.total) >= 0
      ? Number(envelope.total)
      : records.length;
  const page = Number(envelope.current ?? envelope.page) || normalized.page;
  const pageSize = Number(envelope.size ?? envelope.pageSize) || normalized.pageSize;

  return {
    records,
    page,
    pageSize,
    total,
  };
}

/**
 * 获取文旅订单 4 项核心统计指标 (GET /toolkit/orders/statistics)
 */
export async function fetchToolkitStatistics(): Promise<ToolkitOrderStatistics> {
  const response = await requestPlatformApi<unknown>(ORDER_ENDPOINTS.STATISTICS);
  const data = unwrapPlatformEnvelope<Record<string, unknown>>(response);

  return {
    today: Number(data.todayTotal ?? data.todayCount ?? data.today ?? 0),
    pending: Number(data.pendingCount ?? data.pending ?? 0),
    success: Number(data.successCount ?? data.success ?? 0),
    failed: Number(data.failedCount ?? data.failed ?? 0),
  };
}

/**
 * 获取单笔订单详情 (GET /toolkit/orders/:id)
 */
export async function fetchToolkitOrderDetails(id: string): Promise<ToolkitOrder> {
  if (!id?.trim()) throw new Error('订单 ID 不能为空');
  const response = await requestPlatformApi<unknown>(`${ORDER_ENDPOINTS.ORDERS}/${encodeURIComponent(id.trim())}`);
  const raw = unwrapPlatformEnvelope<Record<string, unknown>>(response);
  return normalizeToolkitOrder(raw);
}

/**
 * 保存修改订单 (调用中台 PUT /toolkit/orders/:id，仅保存修改草稿，不触发导入)
 */
export async function updateToolkitOrder(
  orderOrId: ToolkitOrder | string,
  draft: ToolkitOrderDraft
): Promise<void> {
  let targetOrder: ToolkitOrder;
  if (typeof orderOrId === 'string') {
    if (!orderOrId?.trim()) throw new Error('订单 ID 不能为空');
    targetOrder = await fetchToolkitOrderDetails(orderOrId.trim());
  } else {
    if (!orderOrId) throw new Error('订单数据不能为空');
    targetOrder = orderOrId;
  }
  if (!targetOrder.id?.trim()) throw new Error('订单 ID 不能为空');

  const arrival = (draft.booking.arrival || targetOrder.booking?.arrival || '').slice(0, 10);
  const departure = (draft.booking.departure || targetOrder.booking?.departure || '').slice(0, 10);
  const quantity = Math.max(1, Number(draft.booking.quantity) || 1);
  const pricing = (draft.booking.pricing || []).map((p) => ({
    date: (p.date || '').slice(0, 10),
    price: Number(p.price) || 0,
  }));
  const nightlySum = pricing.reduce((sum, p) => sum + p.price, 0);
  const totalPrice = nightlySum > 0 ? nightlySum * quantity : Number(targetOrder.booking?.totalPrice) || 0;

  const totalNights =
    pricing.length ||
    (arrival && departure && arrival < departure
      ? Math.max(1, Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86400000))
      : Number(targetOrder.booking?.nights) || 1);

  const mergedOrder = {
    ...targetOrder,
    otaOrderId: (draft.otaOrderId || targetOrder.otaOrderId || '').trim(),
    contact: {
      name: draft.contact.name.trim(),
      mobile: draft.contact.mobile.trim(),
    },
    booking: {
      ...targetOrder.booking,
      roomType: draft.booking.roomType.trim(),
      roomTypeId: (draft.booking.roomTypeId || draft.booking.roomType).trim(),
      rateCode: draft.booking.rateCode.trim(),
      paytype: (draft.booking.paytype || targetOrder.booking?.paytype || '预付全额').trim(),
      arrival,
      departure,
      nights: totalNights,
      quantity,
      pricing,
      totalPrice,
    },
    remark: (draft.remark !== undefined ? draft.remark : targetOrder.remark || '').trim(),
  };

  const response = await requestPlatformApi<unknown>(
    `${ORDER_ENDPOINTS.ORDERS}/${encodeURIComponent(targetOrder.id.trim())}`,
    {
      method: 'PUT',
      body: JSON.stringify(mergedOrder),
    }
  );
  unwrapPlatformEnvelope(response);
}

/**
 * 人工重试导入失败订单 (调用中台单条订单导入接口 POST /toolkit/orders/:id/import)
 */
export async function retryToolkitOrderImport(
  orderOrId: ToolkitOrder | string
): Promise<{ success: boolean; pmsOrderId?: string; confirmationNo?: string; batchId?: string }> {
  let targetOrder: ToolkitOrder;
  if (typeof orderOrId === 'string') {
    if (!orderOrId?.trim()) throw new Error('订单 ID 不能为空');
    targetOrder = await fetchToolkitOrderDetails(orderOrId.trim());
  } else {
    if (!orderOrId) throw new Error('订单数据不能为空');
    targetOrder = orderOrId;
  }
  if (!targetOrder.id?.trim()) throw new Error('订单 ID 不能为空');

  const response = await requestPlatformApi<unknown>(
    `${ORDER_ENDPOINTS.ORDERS}/${encodeURIComponent(targetOrder.id.trim())}/import`,
    {
      method: 'POST',
      body: JSON.stringify({ id: targetOrder.id.trim() }),
    }
  );
  const data = unwrapPlatformEnvelope<Record<string, unknown>>(response);
  return {
    success: true,
    pmsOrderId: data && typeof data === 'object' && data.pmsOrderId ? String(data.pmsOrderId) : undefined,
    confirmationNo: data && typeof data === 'object' && data.confirmationNo ? String(data.confirmationNo) : undefined,
    batchId: data && typeof data === 'object' && data.batchId ? String(data.batchId) : undefined,
  };
}

/**
 * 删除失败订单 (DELETE /toolkit/orders/:id)
 */
export async function deleteToolkitOrder(id: string): Promise<void> {
  if (!id?.trim()) throw new Error('订单 ID 不能为空');
  await requestPlatformApi<void>(`${ORDER_ENDPOINTS.ORDERS}/${encodeURIComponent(id.trim())}`, {
    method: 'DELETE',
  });
}

/**
 * 取消已成功订单 (PUT /toolkit/orders/:id/cancel)
 */
export async function cancelToolkitOrder(id: string): Promise<void> {
  if (!id?.trim()) throw new Error('订单 ID 不能为空');
  await requestPlatformApi<void>(`${ORDER_ENDPOINTS.ORDERS}/${encodeURIComponent(id.trim())}/cancel`, {
    method: 'PUT',
    body: JSON.stringify({}),
  });
}

/**
 * 查询指定酒店的内部产品选项 (房型、房价码、预订类型)
 */
export async function fetchPropertyProductOptions(
  unitId: string,
  unitType?: string
): Promise<InternalProductOptions> {
  const cleanUnitId = String(unitId || '').trim();
  if (!cleanUnitId) throw new Error('酒店单位 unitId 不能为空');

  const cleanUnitType = unitType ? String(unitType).trim() : 'Property';

  const [roomTypes, rateCodes, reservationTypes] = await Promise.all([
    fetchRoomTypes({ unitId: cleanUnitId, unitType: cleanUnitType }),
    fetchRatePlans({ unitId: cleanUnitId, unitType: cleanUnitType }),
    fetchReservationTypes({ unitId: cleanUnitId }),
  ]);

  return { roomTypes, rateCodes, reservationTypes };
}
