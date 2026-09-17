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
      rateCode: String(booking.rateCode || raw.rateCode || '').trim(),
      paytype: String(booking.paytype || raw.paytype || '').trim(),
      nights,
      quantity,
      totalPrice,
      pricing,
    },
    status: rawStatus,
    errorMessage: raw.errorMessage ? String(raw.errorMessage) : undefined,
    pmsOrderId: raw.pmsOrderId ? String(raw.pmsOrderId) : undefined,
    remark: raw.remark ? String(raw.remark) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    allowedActions: getAllowedOrderActions(rawStatus),
  };
}

/**
 * 分页查询文旅中台订单列表
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

  const response = await requestPlatformApi<{
    records?: Record<string, unknown>[];
    list?: Record<string, unknown>[];
    items?: Record<string, unknown>[];
    total?: number;
    current?: number;
    page?: number;
    size?: number;
  }>(url);

  const rawList = response.records || response.list || response.items || (Array.isArray(response) ? response : []);
  const records = rawList.map((item) => normalizeToolkitOrder(item as Record<string, unknown>));
  const total = Number(response.total) || records.length;
  const page = Number(response.current || response.page) || filters.page || 1;
  const pageSize = Number(response.size) || filters.pageSize || 20;

  return {
    records,
    page,
    pageSize,
    total,
  };
}

/**
 * 获取文旅订单 4 项核心统计指标
 */
export async function fetchToolkitStatistics(): Promise<ToolkitOrderStatistics> {
  const data = await requestPlatformApi<{
    todayTotal?: number;
    todayCount?: number;
    pendingCount?: number;
    successCount?: number;
    failedCount?: number;
  }>(ORDER_ENDPOINTS.STATISTICS);

  return {
    today: Number(data.todayTotal ?? data.todayCount ?? 0),
    pending: Number(data.pendingCount ?? 0),
    success: Number(data.successCount ?? 0),
    failed: Number(data.failedCount ?? 0),
  };
}

/**
 * 获取单笔订单详情
 */
export async function fetchToolkitOrderDetails(id: string): Promise<ToolkitOrder> {
  if (!id?.trim()) throw new Error('订单 ID 不能为空');
  const raw = await requestPlatformApi<Record<string, unknown>>(`${ORDER_ENDPOINTS.ORDERS}/${encodeURIComponent(id.trim())}`);
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

  const data = await requestPlatformApi<{
    roomTypes?: Array<{ code: string; name: string }>;
    rateCodes?: Array<{ rateCode: string; name: string }>;
    reservationTypes?: Array<{ code: string; name: string }>;
  }>(`${ORDER_ENDPOINTS.OPTIONS}?${query.toString()}`);

  return {
    roomTypes: Array.isArray(data.roomTypes) ? data.roomTypes : [],
    rateCodes: Array.isArray(data.rateCodes) ? data.rateCodes : [],
    reservationTypes: Array.isArray(data.reservationTypes) ? data.reservationTypes : [],
  };
}
