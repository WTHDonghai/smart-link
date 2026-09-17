import { requestPlatformApi, TOOLKIT_MODULE } from './platformApi';
import { getAllowedOrderActions } from '../utils/orderHelpers';
import type {
  ToolkitOrder,
  ToolkitOrderStatistics,
  ToolkitOrderFilters,
  ToolkitOrderPageResult,
  ToolkitOrderDraft,
  InternalProductOptions,
} from '../types';

export const ORDER_ENDPOINTS = {
  ORDERS: `/${TOOLKIT_MODULE}/orders`,
  STATISTICS: `/${TOOLKIT_MODULE}/orders/statistics`,
  OPTIONS: `/${TOOLKIT_MODULE}/orders/options`,
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

  return {
    id: String(raw.id || raw.orderId || '').trim(),
    unitId: String(raw.unitId || raw.propertyId || '').trim(),
    unitName: String(raw.unitName || raw.propertyName || raw.hotelName || '').trim(),
    otaChannel: String(raw.otaChannel || raw.platform || raw.channelCode || '').trim().toUpperCase(),
    otaOrderId: String(raw.otaOrderId || raw.orderId || '').trim(),
    contact: {
      name: String(contact.name || raw.guestName || '').trim(),
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
    errorMessage: raw.errorMessage || raw.error ? String(raw.errorMessage || raw.error).trim() : undefined,
    pmsOrderId: raw.pmsOrderId || raw.confirmationNo ? String(raw.pmsOrderId || raw.confirmationNo).trim() : undefined,
    remark: raw.remark || raw.remarks ? String(raw.remark || raw.remarks).trim() : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt).trim() : undefined,
    allowedActions: getAllowedOrderActions(rawStatus),
  };
}

/**
 * 分页查询文旅中台订单列表 (GET /toolkit/orders)
 */
export async function fetchToolkitOrders(
  filters: Partial<ToolkitOrderFilters> = {}
): Promise<ToolkitOrderPageResult> {
  const queryParams = new URLSearchParams();
  if (filters.page) queryParams.set('current', String(filters.page));
  if (filters.pageSize) queryParams.set('size', String(filters.pageSize));
  if (filters.status && filters.status !== 'all' && filters.status !== 'ALL') {
    queryParams.set('status', filters.status.toUpperCase());
  }
  if (filters.query?.trim()) queryParams.set('query', filters.query.trim());
  if (filters.arrivalStart) queryParams.set('arrivalStart', `${filters.arrivalStart} 00:00:00`);
  if (filters.arrivalEnd) queryParams.set('arrivalEnd', `${filters.arrivalEnd} 23:59:59`);
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
    : [];

  const records = rawList.map((item) => normalizeToolkitOrder(item as Record<string, unknown>));
  const total = Number(envelope.total) || records.length;
  const page = Number(envelope.current || envelope.page) || filters.page || 1;
  const pageSize = Number(envelope.size || envelope.pageSize) || filters.pageSize || 20;

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
 * 编辑更新订单草稿 (PUT /toolkit/orders/:id)
 */
export async function updateToolkitOrder(id: string, draft: ToolkitOrderDraft): Promise<void> {
  if (!id?.trim()) throw new Error('订单 ID 不能为空');
  await requestPlatformApi<void>(`${ORDER_ENDPOINTS.ORDERS}/${encodeURIComponent(id.trim())}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  });
}

/**
 * 单单重新导入 (POST /toolkit/orders/:id/import)
 */
export async function importToolkitOrder(id: string): Promise<void> {
  if (!id?.trim()) throw new Error('订单 ID 不能为空');
  await requestPlatformApi<void>(`${ORDER_ENDPOINTS.ORDERS}/${encodeURIComponent(id.trim())}/import`, {
    method: 'POST',
    body: JSON.stringify({ id: id.trim() }),
  });
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
  if (!unitId?.trim()) throw new Error('酒店单位 unitId 不能为空');
  const query = new URLSearchParams({ unitId: unitId.trim() });
  if (unitType) query.set('unitType', unitType.trim());

  const response = await requestPlatformApi<unknown>(`${ORDER_ENDPOINTS.OPTIONS}?${query.toString()}`);
  const data = unwrapPlatformEnvelope<Record<string, unknown>>(response);

  return {
    roomTypes: Array.isArray(data.roomTypes) ? (data.roomTypes as Array<{ code: string; name: string }>) : [],
    rateCodes: Array.isArray(data.rateCodes) ? (data.rateCodes as Array<{ rateCode: string; name: string }>) : [],
    reservationTypes: Array.isArray(data.reservationTypes) ? (data.reservationTypes as Array<{ code: string; name: string }>) : [],
  };
}
