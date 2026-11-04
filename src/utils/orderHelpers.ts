import type {
  OrderStatus,
  ToolkitOrderAction,
  ToolkitOrderType,
  NightlyPricing,
  ToolkitOrder,
  ImportPayload,
  HotelMapping,
  PlatformProperty,
  OTAChannel,
} from '../types';

export const isOrderSuccess = (status: OrderStatus): boolean => {
  return status === 'success' || status === 'confirmed' || status === 'transferred';
};

export const formatSyncTime = (val?: string): string => {
  if (!val || !val.trim()) return '-';
  const clean = val.replace('T', ' ').trim();
  const fullMatch = clean.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
  if (fullMatch) {
    return `${fullMatch[1]} ${fullMatch[2]}`;
  }
  const timeMatch = clean.match(/^(\d{1,2}:\d{2})/);
  if (timeMatch) {
    return timeMatch[1];
  }
  return clean;
};

/**
 * 订单状态的人工操作策略字典 (严格契约)
 * - FAILED: 仅失败订单允许编辑、重新导入、删除
 * - SUCCESS: 仅成功订单允许取消
 * - 其余状态: 严格只读禁止操作
 */
const STATUS_ALLOWED_ACTIONS: Record<string, ToolkitOrderAction[]> = {
  FAILED: ['EDIT', 'IMPORT', 'DELETE'],
  SUCCESS: ['CANCEL'],
};

/**
 * 获取订单允许执行的人工操作列表
 */
export function getAllowedOrderActions(status: string): ToolkitOrderAction[] {
  const normalized = (status || '').trim().toUpperCase();
  return STATUS_ALLOWED_ACTIONS[normalized] || [];
}

/**
 * 获取操作被禁用的原因说明
 */
export function getOrderActionDisabledReason(action: ToolkitOrderAction, status: string): string {
  const normalized = (status || '').trim().toUpperCase();
  if (action === 'EDIT') {
    return normalized === 'FAILED' ? '' : '仅失败订单允许编辑';
  }
  if (action === 'IMPORT') {
    return normalized === 'FAILED' ? '' : '仅失败订单允许重新导入';
  }
  if (action === 'DELETE') {
    return normalized === 'FAILED' ? '' : '仅失败订单允许删除';
  }
  if (action === 'CANCEL') {
    return normalized === 'SUCCESS' ? '' : '仅成功订单允许取消';
  }
  return '当前状态不可操作';
}

/**
 * 人民币金额格式化工具 (千分位 + 两位小数)
 */
export function formatCurrency(amount: number | string | undefined | null): string {
  if (amount == null || amount === '') return '-';
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(num)) return String(amount);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * 根据入住和离店日期拆解并对齐每日价格明细
 * 入住日 (包含) 至 离店日 (不包含)，每日一条
 */
export function calculateNightsAndPricing(
  arrivalDate: string,
  departureDate: string,
  existingPricing: NightlyPricing[] = [],
  defaultPrice = 0
): { nights: number; pricing: NightlyPricing[]; totalPrice: number } {
  const arrival = (arrivalDate || '').trim().slice(0, 10);
  const departure = (departureDate || '').trim().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) || !/^\d{4}-\d{2}-\d{2}$/.test(departure)) {
    return { nights: 0, pricing: [], totalPrice: 0 };
  }

  const startMs = Date.parse(`${arrival}T00:00:00Z`);
  const endMs = Date.parse(`${departure}T00:00:00Z`);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { nights: 0, pricing: [], totalPrice: 0 };
  }

  const existingMap = new Map<string, number>();
  for (const item of existingPricing) {
    if (item && item.date) {
      existingMap.set(item.date.slice(0, 10), Number(item.price) || 0);
    }
  }

  const pricing: NightlyPricing[] = [];
  let totalCents = 0;
  const ONE_DAY_MS = 86400000;

  for (let t = startMs; t < endMs; t += ONE_DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    const price = existingMap.has(d) ? (existingMap.get(d) as number) : defaultPrice;
    pricing.push({ date: d, price });
    totalCents += Math.round(price * 100);
  }

  return {
    nights: pricing.length,
    pricing,
    totalPrice: Math.round(totalCents) / 100,
  };
}

/**
 * 订单状态元数据映射
 */
export function getOrderStatusMeta(status: string): {
  label: string;
  tone: 'success' | 'failed' | 'warning' | 'info' | 'neutral';
} {
  const s = (status || '').trim().toUpperCase();
  switch (s) {
    case 'SUCCESS':
    case 'CONFIRMED':
    case 'TRANSFERRED':
      return { label: '成功', tone: 'success' };
    case 'FAILED':
      return { label: '失败', tone: 'failed' };
    case 'PENDING':
      return { label: '待确认', tone: 'warning' };
    case 'IMPORTING':
    case 'PROCESSING':
      return { label: '导入中', tone: 'info' };
    case 'CANCEL':
    case 'CANCELLED':
      return { label: '已取消', tone: 'neutral' };
    default:
      return { label: status || '未知', tone: 'neutral' };
  }
}

/**
 * 类型守卫：判定外部输入是否为受支持的文旅中台订单类型枚举
 */
export function isToolkitOrderType(value: unknown): value is ToolkitOrderType {
  return value === 'NEW' || value === 'MODIFY' || value === 'CANCEL' || value === 'CANCELLED';
}

/**
 * 订单类型元数据映射
 */
export function getOrderTypeMeta(orderType?: ToolkitOrderType | string): {
  label: string;
  tone: 'success' | 'failed' | 'warning' | 'info' | 'neutral';
} {
  const t = (orderType || '').trim().toUpperCase();
  switch (t) {
    case 'NEW':
      return { label: '新订', tone: 'info' };
    case 'MODIFY':
      return { label: '修改', tone: 'warning' };
    case 'CANCEL':
    case 'CANCELLED':
      return { label: '取消', tone: 'neutral' };
    default:
      return { label: orderType || '-', tone: 'neutral' };
  }
}

export interface OrderFilterSelectOption {
  label: string;
  value: string;
  subtext?: string;
}

const CANONICAL_ORDER_TYPES: readonly ('NEW' | 'MODIFY' | 'CANCEL')[] = ['NEW', 'MODIFY', 'CANCEL'];

/**
 * 订单类型下拉选项（由 getOrderTypeMeta 单一数据源派生，杜绝标签漂移）
 */
export const ORDER_TYPE_OPTIONS: OrderFilterSelectOption[] = CANONICAL_ORDER_TYPES.map((value) => ({
  label: getOrderTypeMeta(value).label,
  value,
}));

function isMeaningfulHotelName(name: string | undefined, id: string): name is string {
  if (!name) return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed !== id && trimmed !== '待关联中台酒店';
}

/**
 * 纯函数：解析订单对应的酒店名称
 * 优先级：订单自身有效 unitName -> 中台组织单位名称 (pmsProperties) -> 门店映射中的中台酒店名/OTA门店名 -> unitId 兜底
 */
export function resolveOrderHotelName(
  order: Pick<ToolkitOrder, 'unitId' | 'unitName'> & { otaChannel?: string },
  hotels: readonly HotelMapping[] = [],
  pmsProperties: readonly PlatformProperty[] = []
): string {
  const unitId = String(order.unitId || '').trim();
  const unitName = String(order.unitName || '').trim();

  if (isMeaningfulHotelName(unitName, unitId)) {
    return unitName;
  }

  if (unitId) {
    const matchedProp = pmsProperties.find(
      (p) => String(p.id).trim() === unitId || (p.code && String(p.code).trim() === unitId)
    );
    if (matchedProp && isMeaningfulHotelName(matchedProp.name, unitId)) {
      return matchedProp.name.trim();
    }

    const orderChannel = String(order.otaChannel || '').trim().toUpperCase();
    const matchedMappings = hotels.filter(
      (h) =>
        String(h.unitId || '').trim() === unitId ||
        String(h.pmsHotelId || '').trim() === unitId ||
        String(h.unitCode || '').trim() === unitId ||
        String(h.extUnitCode || '').trim() === unitId ||
        String(h.otaHotelId || '').trim() === unitId
    );

    const preferredMapping =
      (orderChannel
        ? matchedMappings.find(
            (h) => String(h.otaChannelCode || h.otaChannelId || '').trim().toUpperCase() === orderChannel
          )
        : undefined) || matchedMappings[0];

    if (preferredMapping) {
      if (isMeaningfulHotelName(preferredMapping.unitName, unitId)) {
        return preferredMapping.unitName.trim();
      }
      if (
        isMeaningfulHotelName(preferredMapping.pmsHotelName, unitId) &&
        preferredMapping.pmsHotelName.trim() !== String(preferredMapping.pmsHotelId || '').trim()
      ) {
        return preferredMapping.pmsHotelName.trim();
      }
      if (isMeaningfulHotelName(preferredMapping.otaHotelName, unitId)) {
        return preferredMapping.otaHotelName.trim();
      }
    }
  }

  return unitName || unitId || '-';
}

/**
 * 纯函数：根据中台酒店列表、酒店映射与当前订单列表构建去重后的酒店筛选下拉选项
 */
export function buildOrderHotelOptions(
  hotels: readonly HotelMapping[],
  orders: readonly ToolkitOrder[],
  pmsProperties: readonly PlatformProperty[] = []
): OrderFilterSelectOption[] {
  const map = new Map<string, OrderFilterSelectOption>();

  for (const prop of pmsProperties) {
    const id = String(prop.id || '').trim();
    const name = String(prop.name || '').trim();
    if (id && name && !map.has(id)) {
      map.set(id, {
        label: name,
        value: id,
        subtext: prop.code && prop.code !== name ? prop.code : undefined,
      });
    }
  }

  for (const h of hotels) {
    const id = String(h.unitId || h.pmsHotelId || '').trim();
    if (!id) continue;
    const resolvedName = resolveOrderHotelName(
      { unitId: id, unitName: h.unitName || '', otaChannel: h.otaChannelCode },
      hotels,
      pmsProperties
    );
    const otaName = String(h.otaHotelName || '').trim();
    if (!map.has(id)) {
      map.set(id, {
        label: resolvedName,
        value: id,
        subtext: otaName && otaName !== resolvedName ? otaName : undefined,
      });
    }
  }

  for (const ord of orders) {
    const id = String(ord.unitId || '').trim();
    if (!id || map.has(id)) continue;
    const resolvedName = resolveOrderHotelName(ord, hotels, pmsProperties);
    map.set(id, {
      label: resolvedName,
      value: id,
    });
  }

  return Array.from(map.values());
}

export type OrderChannelOptionCandidate = Pick<OTAChannel, 'id' | 'code' | 'name' | 'isMapped'>;

/**
 * 纯函数：根据已映射渠道或全量渠道目录构建去重后的渠道筛选下拉选项
 */
export function buildOrderChannelOptions(
  channels: readonly OrderChannelOptionCandidate[],
  catalogFallback: readonly OrderChannelOptionCandidate[]
): OrderFilterSelectOption[] {
  const mapped = channels.filter((c) => c.isMapped);
  const source = mapped.length > 0 ? mapped : catalogFallback;
  const seen = new Set<string>();
  const list: OrderFilterSelectOption[] = [];
  for (const c of source) {
    const code = String(c.code || c.id || '').trim().toUpperCase();
    if (code && !seen.has(code)) {
      seen.add(code);
      list.push({
        label: c.name || code,
        value: code,
        subtext: code,
      });
    }
  }
  return list;
}

/**
 * 将前端/中台 ToolkitOrder 实体转换为中台统一入单接口 (POST /toolkit/orders/import) 载荷 (ImportPayload)
 */
export function buildImportPayloadFromOrder(order: ToolkitOrder): ImportPayload {
  if (!order) {
    throw new Error('订单数据不能为空');
  }
  const otaOrderId = (order.otaOrderId || order.id || '').trim();
  if (!otaOrderId) {
    throw new Error('订单编号不能为空');
  }

  const rateCode = (order.booking?.rateCode || '').trim();
  if (!rateCode) {
    throw new Error(`订单「${otaOrderId}」缺少房价方案代码 (rateCode)，请编辑指定后再重新导入`);
  }

  const arrival = (order.booking?.arrival || '').slice(0, 10);
  const departure = (order.booking?.departure || '').slice(0, 10);
  const existingPricing = (order.booking?.pricing || []).map((p) => ({
    date: (p.date || '').slice(0, 10),
    price: Number(p.price) || 0,
  }));

  let defaultNightPrice = existingPricing[0]?.price || 0;
  const rawTotalPrice = Number(order.booking?.totalPrice);
  if (existingPricing.length === 0 && Number.isFinite(rawTotalPrice) && rawTotalPrice > 0) {
    const diffMs = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
    const nightsFromDates = Number.isFinite(diffMs) && diffMs > 0 ? Math.round(diffMs / 86400000) : 0;
    const estimatedNights = Math.max(1, Number(order.booking?.nights) || nightsFromDates || 1);
    defaultNightPrice = Math.round((rawTotalPrice / estimatedNights) * 100) / 100;
  }

  const pricingResult =
    arrival && departure && arrival < departure
      ? calculateNightsAndPricing(arrival, departure, existingPricing, defaultNightPrice)
      : {
          nights: Number(order.booking?.nights) || 1,
          pricing: existingPricing,
          totalPrice: Number(order.booking?.totalPrice) || 0,
        };

  const quantity = Math.max(1, Number(order.booking?.quantity) || 1);
  const totalPrice = Number(order.booking?.totalPrice) || pricingResult.totalPrice * quantity;
  const roomType = (order.booking?.roomType || order.booking?.roomTypeId || '').trim();
  const roomTypeId = (order.booking?.roomTypeId || order.booking?.roomType || '').trim();

  return {
    extUnitCode: order.unitId ? order.unitId.trim() : null,
    orders: [
      {
        otaOrderId,
        otaChannel: (order.otaChannel || '').trim().toUpperCase(),
        contact: {
          name: (order.contact?.name || '').trim(),
          mobile: (order.contact?.mobile || '').trim(),
        },
        booking: {
          roomType,
          originRoomType: order.booking?.roomType ? order.booking.roomType.trim() : undefined,
          rateCode,
          arrival,
          departure,
          roomTypeId,
          nights: pricingResult.nights || 1,
          quantity,
          totalPrice,
          paytype: (order.booking?.paytype || '预付全额').trim(),
          pricing: pricingResult.pricing,
        },
        remark: (order.remark || '').trim(),
      },
    ],
  };
}
