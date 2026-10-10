import type {
  DutyUnhandledOrderSummary,
  ExtractedOrderDetail,
  RawMeituanDutyOrder,
} from '../../dutyContracts';
import {
  filterMeituanOrder,
  type OrderFilterResult,
} from './meituanOrderFilter';
import {
  DutyExecutionError,
  MeituanDutyErrorCode,
} from './meituanDutyContracts';

import { safeFormatDate as fmtDate } from '@/src/utils/template/filters';
import { isRecord } from '@/src/utils/typeGuards';

export { fmtDate };

export interface MeituanOrderExtractionAnomaly {
  index: number;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface ExtractMeituanOrdersOptions {
  onExtractionAnomaly?: (anomaly: MeituanOrderExtractionAnomaly) => void;
}

export interface ParseMeituanOrderOptions extends ExtractMeituanOrdersOptions {
  onFilterResult?: (result: OrderFilterResult) => void;
}

// [TODO] 后续需要迁移到env 环境变量
export const MEITUAN_ORDER_LIST_URL_PATH = '/api/v1/ebooking/orders/task/list';
export const MEITUAN_ALL_ORDERS_LIST_URL_PATH = '/api/v1/ebooking/orders/list';

/**
 * 判断 URL 是否属于美团待处理订单列表的唯一接口；query 参数不影响匹配
 */
export function isMeituanListUrl(url: string): boolean {
  try {
    return new URL(url).pathname === MEITUAN_ORDER_LIST_URL_PATH;
  } catch {
    return false;
  }
}

/**
 * 判断是否为订单 Tab 切换产生的列表接口；“全部订单”实际使用 /orders/list。
 * 该谓词只用于切换生命周期屏障，不用于采集待确认订单。
 */
export function isMeituanOrderTabListUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname === MEITUAN_ORDER_LIST_URL_PATH || pathname === MEITUAN_ALL_ORDERS_LIST_URL_PATH;
  } catch {
    return false;
  }
}

/**
 * 校验文本内容是否命中人机、滑块、风控验证特征
 */
export function isMeituanRiskControlText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const norm = text.replace(/\s+/g, ' ').trim();
  return /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|验证一下|拖动滑块|请完成验证|yoda|captcha|secsdk/i.test(norm);
}

/**
 * 判断 URL 是否属于美团特定订单的 v1 详情接口
 * 显式锁定 /api/v1/ 协议版本：一旦上游升级 v2 立即 Fail-Fast，杜绝跨版本脏数据解析
 * 遵循 KISS 原则：无正则、零黑名单、直接基于标准路径比对
 */
export function isMeituanDetailUrl(url: string, targetOrderId?: string): boolean {
  if (!url) return false;
  const cleanTargetId = targetOrderId ? targetOrderId.trim() : '';

  if (cleanTargetId) {
    const prefix = `/api/v1/ebooking/orders/${cleanTargetId}`;
    return url.includes(`${prefix}?`) || url.split('?')[0].endsWith(prefix);
  }

  // 未指定目标单号时（仅用于通用诊断）：严格校验路径是否为 /api/v1/ebooking/orders/{单号}
  const path = url.split('?')[0].replace(/\/+$/, '');
  const parts = path.split('/');
  const ordersIndex = parts.indexOf('orders');
  const isV1 = parts.includes('api') && parts.includes('v1') && parts.includes('ebooking');
  return isV1 && ordersIndex !== -1 && parts.length === ordersIndex + 2 && /^\d+$/.test(parts[ordersIndex + 1]);
}

/**
 * 判断 URL 是否属于美团敏感数据解密接口（如查看姓名、电话）
 */
export function isMeituanSensitiveUrl(url: string): boolean {
  const norm = String(url || '');
  return norm.includes('/sensitiveData') || norm.includes('/confirmPhone');
}

/**
 * 校验字符串是否为真实明文电话号码（非掩码、非占位提示词）
 */
export function isPlainPhoneNumber(phone: unknown): boolean {
  const t = String(phone || '').trim();
  if (!t || t.includes('*')) return false;
  if (/^(查看电话|获取电话|显示电话|解密|未知|无|暂无|点击查看|联系客人|平台保护|隐私保护)$/i.test(t)) {
    return false;
  }
  return /^1[3-9]\d{9}(#\d{1,8})?$/.test(t) || /^(0\d{2,3}-?)?\d{7,8}$/.test(t);
}

/**
 * 从美团敏感数据解密接口（/sensitiveData/ 或 /confirmPhone）响应报文中解析真实客人姓名与手机号
 */
export function parseMeituanSensitiveResponse(
  payload: unknown
): { guestName?: string; guestMobile?: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  let guestName = '';
  let guestMobile = '';

  const isPlainName = (name: string): boolean => {
    const t = name.trim();
    if (!t || t.includes('*')) return false;
    return !/^(查看姓名|获取姓名|显示姓名|解密|未知|无|暂无|点击查看|联系客人|平台保护|隐私保护)$/.test(t);
  };

  const isPlainPhone = (phone: string): boolean => isPlainPhoneNumber(phone);

  // 1. 尝试从 sensitiveDataList 中提取
  const rawLists: unknown[] = [];
  if (Array.isArray(data.sensitiveDataList)) rawLists.push(...data.sensitiveDataList);
  if (data.data && typeof data.data === 'object') {
    const nestedData = data.data as Record<string, unknown>;
    if (Array.isArray(nestedData.sensitiveDataList)) rawLists.push(...nestedData.sensitiveDataList);
  }
  if (Array.isArray(root.sensitiveDataList)) rawLists.push(...root.sensitiveDataList);

  for (const item of rawLists) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const infos = Array.isArray(rec.guestInfos) ? rec.guestInfos : [];
      for (const info of infos) {
        if (info && typeof info === 'object') {
          const g = info as Record<string, unknown>;
          const n = String(g.name || '').trim();
          const p = String(g.phone || g.mobile || '').trim();
          if (n && isPlainName(n) && !guestName) guestName = n;
          if (p && isPlainPhone(p) && !guestMobile) guestMobile = p;
        }
      }
    }
  }

  // 2. 尝试从 confirmPhone 或顶层直接属性提取
  const directPhone = String(data.phone || data.mobile || root.phone || root.mobile || '').trim();
  if (directPhone && isPlainPhone(directPhone) && !guestMobile) {
    guestMobile = directPhone;
  }

  const directName = String(data.name || data.guestName || root.name || root.guestName || '').trim();
  if (directName && isPlainName(directName) && !guestName) {
    guestName = directName;
  }

  if (!guestName && !guestMobile) return null;
  return {
    guestName: guestName || undefined,
    guestMobile: guestMobile || undefined,
  };
}

export const extractMeituanSensitiveDataFromPayload = parseMeituanSensitiveResponse;

/**
 * 将敏感解密数据（明文客人姓名、明文电话）反向融合/替换到美团原始详情报文中。
 * 遵循极简与单一真实源原则，直接更新原始响应中的客人与联系人字段，
 * 避免执行器自行拆解字段或重复校验，交由后续解析器与清洗流水线统一处理。
 */
export function mergeSensitiveDataIntoRawDetail(
  rawPayload: unknown,
  sensitive: { guestName?: string; guestMobile?: string } | null
): unknown {
  if (!rawPayload || typeof rawPayload !== 'object' || !sensitive) {
    return rawPayload;
  }

  const plainName =
    sensitive.guestName && !sensitive.guestName.includes('*')
      ? sensitive.guestName.trim()
      : '';
  const plainPhone =
    sensitive.guestMobile && !sensitive.guestMobile.includes('*')
      ? sensitive.guestMobile.trim()
      : '';

  if (!plainName && !plainPhone) {
    return rawPayload;
  }

  // 浅拷贝 root 及其 data 层
  const root = { ...(rawPayload as Record<string, unknown>) };
  const data =
    root.data && typeof root.data === 'object'
      ? { ...(root.data as Record<string, unknown>) }
      : null;
  if (data) {
    root.data = data;
  }

  // 收集所有需要更新的订单层级对象
  const targetContainers: Record<string, unknown>[] = [];
  if (data) {
    if (data.orderDetail && typeof data.orderDetail === 'object') {
      data.orderDetail = { ...(data.orderDetail as Record<string, unknown>) };
      targetContainers.push(data.orderDetail as Record<string, unknown>);
    }
    if (data.order && typeof data.order === 'object') {
      data.order = { ...(data.order as Record<string, unknown>) };
      targetContainers.push(data.order as Record<string, unknown>);
    }
    targetContainers.push(data);
  }
  if (root.orderDetail && typeof root.orderDetail === 'object') {
    root.orderDetail = { ...(root.orderDetail as Record<string, unknown>) };
    targetContainers.push(root.orderDetail as Record<string, unknown>);
  }
  targetContainers.push(root);

  for (const container of targetContainers) {
    if (plainName) {
      container.guestName = plainName;
      if ('customerName' in container) container.customerName = plainName;
      if ('contactName' in container) container.contactName = plainName;
    }
    if (plainPhone) {
      container.guestMobile = plainPhone;
      if ('customerMobile' in container) container.customerMobile = plainPhone;
      if ('contactPhone' in container) container.contactPhone = plainPhone;
      if ('phone' in container) container.phone = plainPhone;
      if ('mobile' in container) container.mobile = plainPhone;
    }

    // 同步更新 contacts / guests 列表首位
    for (const key of ['contacts', 'guests']) {
      if (Array.isArray(container[key])) {
        container[key] = (container[key] as unknown[]).map((c, idx) => {
          if (c && typeof c === 'object' && idx === 0) {
            const updated = { ...(c as Record<string, unknown>) };
            if (plainName) updated.name = plainName;
            if (plainPhone) {
              updated.phone = plainPhone;
              if ('mobile' in updated) updated.mobile = plainPhone;
            }
            return updated;
          }
          return c;
        });
      }
    }
  }

  return root;
}

/**
 * 判断原始订单详情或已捕获敏感数据中是否已包含明文联系电话（无星号掩码）
 * 用于“智能跳过电话脱敏”策略，避免 1 秒内双重脱敏触发商户后台风控
 */
export function hasPlainMobileNumber(
  rawDetail: unknown,
  sensitive?: { guestMobile?: string } | null
): boolean {
  if (isPlainPhoneNumber(sensitive?.guestMobile)) {
    return true;
  }
  if (!rawDetail || typeof rawDetail !== 'object') {
    return false;
  }
  const root = rawDetail as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object') ? (root.data as Record<string, unknown>) : null;
  const orderDetail = data && data.orderDetail && typeof data.orderDetail === 'object'
    ? (data.orderDetail as Record<string, unknown>)
    : (data && data.order && typeof data.order === 'object'
      ? (data.order as Record<string, unknown>)
      : (data || (root.orderDetail && typeof root.orderDetail === 'object' ? root.orderDetail as Record<string, unknown> : root)));

  // 1. 检查直接属性
  const directCandidates = [orderDetail.guestMobile, orderDetail.phone, orderDetail.mobile];
  for (const c of directCandidates) {
    if (isPlainPhoneNumber(c)) return true;
  }

  // 2. 检查 contacts 与 guests 数组
  const rawContacts = Array.isArray(orderDetail.contacts)
    ? orderDetail.contacts
    : Array.isArray(orderDetail.guests)
      ? orderDetail.guests
      : [];
  for (const item of rawContacts) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      if (isPlainPhoneNumber(rec.phone || rec.mobile)) return true;
    }
  }

  return false;
}

/**
 * 从美团订单列表 API 报文中解析出 RawMeituanDutyOrder 列表。
 * 列表 envelope 契约失败时立即抛错，绝不把畸形响应伪装成“成功采集 0 笔”。
 */
const MEITUAN_LIST_FIELD_PRIORITY = ['results', 'list', 'orders', 'orderList', 'items'] as const;
const MEITUAN_ROOT_LIST_FIELD_PRIORITY = ['results', 'orders', 'list'] as const;

/**
 * 提取美团订单号（约定为 string 类型，按美团原始形态直取，仅做空白规整）。
 * 缺失、非字符串或空白视为渠道契约违规，返回 null 由调用方归因为提取解析异常。
 */
export function extractValidOrderId(rec: unknown): string | null {
  if (!isRecord(rec)) return null;
  const orderId = rec.orderId;
  return typeof orderId === 'string' && orderId.trim() !== '' ? orderId.trim() : null;
}

/**
 * 信封定位与校验：从美团列表响应中定位并校验原始条目数组 (unknown[])。
 * 只负责信封层（code/结构/列表字段），条目级提取由 extractMeituanOrdersFromPayload 负责。
 */
function resolveMeituanOrderItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) {
    throw new DutyExecutionError('美团列表响应必须为 JSON 对象或订单数组', MeituanDutyErrorCode.LIST_BUSINESS_FAILED, false);
  }

  if (payload.code !== undefined && payload.code !== 0) {
    throw new DutyExecutionError(
      `美团列表接口业务状态码失败 (code=${String(payload.code)})`,
      MeituanDutyErrorCode.LIST_BUSINESS_FAILED,
      false
    );
  }

  const data = payload.data;
  if (data !== undefined) {
    if (!isRecord(data)) {
      throw new DutyExecutionError('美团列表响应 data 字段必须为对象', MeituanDutyErrorCode.LIST_BUSINESS_FAILED, false);
    }
    const field = MEITUAN_LIST_FIELD_PRIORITY.find((key) => Object.hasOwn(data, key));
    if (field) {
      const list = data[field];
      if (!Array.isArray(list)) {
        throw new DutyExecutionError(
          `美团列表响应 data.${field} 字段必须为数组 (实际: ${typeof list})`,
          MeituanDutyErrorCode.LIST_BUSINESS_FAILED,
          false
        );
      }
      return list;
    }
    throw new DutyExecutionError(
      `美团列表响应 data 缺少已知订单列表字段: ${MEITUAN_LIST_FIELD_PRIORITY.join('/')}`,
      MeituanDutyErrorCode.LIST_BUSINESS_FAILED,
      false
    );
  }

  const field = MEITUAN_ROOT_LIST_FIELD_PRIORITY.find((key) => Object.hasOwn(payload, key));
  if (field) {
    const list = payload[field];
    if (!Array.isArray(list)) {
      throw new DutyExecutionError(
        `美团列表响应 ${field} 字段必须为数组 (实际: ${typeof list})`,
        MeituanDutyErrorCode.LIST_BUSINESS_FAILED,
        false
      );
    }
    return list;
  }

  throw new DutyExecutionError(
    `美团列表响应缺少已知订单列表字段: ${MEITUAN_ROOT_LIST_FIELD_PRIORITY.join('/')}`,
    MeituanDutyErrorCode.LIST_BUSINESS_FAILED,
    false
  );
}

/**
 * 阶段一：纯函数订单提取解析算子 (Extractor / Data Source)
 * 从美团原始列表中解析提取出标准订单实体 (RawMeituanDutyOrder[])。
 * 格式损坏或缺少主键的条目在此阶段归因为提取解析异常 (Extraction Anomaly)，不进入后续业务过滤。
 */
export function extractMeituanOrdersFromPayload(
  payload: unknown,
  options?: ExtractMeituanOrdersOptions
): RawMeituanDutyOrder[] {
  const rawList = resolveMeituanOrderItems(payload);
  const orders: RawMeituanDutyOrder[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!isRecord(item)) {
      options?.onExtractionAnomaly?.({
        index: i,
        reason: '订单原始载荷为空或非对象',
      });
      continue;
    }

    const orderId = extractValidOrderId(item);
    if (!orderId) {
      // 取证仅保留原始 orderId（类型/空串/缺失三态对应三种不同诊断）与可读 label，原样不筛
      const evidence: Record<string, unknown> = {};
      if (item.orderId !== undefined) evidence.orderId = item.orderId;
      if (typeof item.orderDisplayLabel === 'string') evidence.orderDisplayLabel = item.orderDisplayLabel;

      options?.onExtractionAnomaly?.({
        index: i,
        reason: '缺少有效订单号主键 (orderId)',
        evidence,
      });
      continue;
    }

    // status 为取消/改签双判定的唯一标准，契约担保恒存在；非字符串或空白即条目级契约违规
    const status = typeof item.status === 'string' ? item.status.trim() : '';
    if (!status) {
      const evidence: Record<string, unknown> = {};
      if (item.status !== undefined) evidence.status = item.status;
      options?.onExtractionAnomaly?.({
        index: i,
        reason: '缺少有效订单状态字段 (status)',
        evidence,
      });
      continue;
    }

    const rec = item;
    const checkInDate = fmtDate(rec.checkInDateString || rec.checkInDate || rec.arrival);
    const checkOutDate = fmtDate(rec.checkOutDateString || rec.checkOutDate || rec.departure);

    let nights = Number(rec.nights || rec.nightCount || 0);
    if (!nights && checkInDate && checkOutDate) {
      const diff = Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / 86400000);
      if (diff > 0) nights = diff;
    }

    // 严禁 rawTotal > 1000 无依据盲猜：美团接口 totalFee 规范单位为分 (cents)
    const totalAmount =
      rec.totalFee != null
        ? Number(rec.totalFee) / 100
        : Number(rec.totalPrice ?? rec.price ?? 0);

    const contacts: Array<{ name: string; phone: string }> = [];
    const rawContacts = Array.isArray(rec.contacts) ? rec.contacts : Array.isArray(rec.guests) ? rec.guests : [];
    for (const contact of rawContacts) {
      if (isRecord(contact)) {
        contacts.push({
          name: String(contact.name || '').trim(),
          phone: String(contact.phone || contact.mobile || '').trim(),
        });
      }
    }
    if (contacts.length === 0 && (rec.guestName || rec.guestMobile)) {
      contacts.push({
        name: String(rec.guestName || '').trim(),
        phone: String(rec.guestMobile || '').trim(),
      });
    }

    let rescheduledOrderId: string | undefined;
    if (typeof rec.rescheduledOrderId === 'string' && rec.rescheduledOrderId.trim()) {
      rescheduledOrderId = rec.rescheduledOrderId.trim();
    } else if (typeof rec.rescheduledOrderId === 'number' && Number.isSafeInteger(rec.rescheduledOrderId)) {
      rescheduledOrderId = String(rec.rescheduledOrderId);
    }


    const reversePriceTmcOrderTag =
      typeof rec.reversePriceTmcOrderTag === 'string' && rec.reversePriceTmcOrderTag.trim()
        ? rec.reversePriceTmcOrderTag.trim()
        : undefined;

    orders.push({
      orderId,
      hotelId: String(rec.poiId || rec.hotelId || '').trim() || undefined,
      hotelName: String(rec.poiName || rec.hotelName || '').trim() || undefined,
      orderDisplayLabel: String(rec.orderDisplayLabel || rec.statusText || rec.status || '新订').trim(),
      orderTime: String(rec.aptCreatTimeString || rec.orderTime || '').trim() || undefined,
      roomName: String(rec.roomName || rec.roomTypeName || '').trim(),
      ratePlanName: String(rec.ratePlanName || rec.rpInfo || rec.rpCustomName || rec.rateCode || '').trim(),
      checkInDate,
      checkOutDate,
      nights,
      quantity: Number(rec.roomCount || rec.quantity || 1),
      totalAmount,
      contacts,
      status,
      rescheduledOrderId,
      reversePriceTmcOrderTag,
      raw: rec,
    });
  }

  return orders;
}

/**
 * 判断美团订单是否为取消订单（status 唯一判定标准）。
 * 依据真实取消样本 (tests/fixtures/meituanCancelDetail.json)：status === 'CANCELED'。
 * 供阶段一概要提取使用，动态赋予 DutyUnhandledOrderSummary 的 cancelOrder 标识。
 */
export function isMeituanCancelOrder(rec: Partial<RawMeituanDutyOrder>): boolean {
  return !!rec && typeof rec.status === 'string' && rec.status.trim().toUpperCase() === 'CANCELED';
}

/**
 * 完整两阶段流水线：从美团订单列表 API 报文中解析并过滤出待处理订单概要列表 (DutyUnhandledOrderSummary[])
 * 阶段一：提取解析为 RawMeituanDutyOrder[]（数据源）
 * 阶段二：通过 filterMeituanOrder 进行业务规则过滤（改签/商旅拦截，新订/取消放行）
 */
export function parseMeituanOrderListResponse(
  payload: unknown,
  options?: ParseMeituanOrderOptions
): DutyUnhandledOrderSummary[] {
  // 阶段一：数据源提取
  const rawOrders = extractMeituanOrdersFromPayload(payload, {
    onExtractionAnomaly: options?.onExtractionAnomaly,
  });

  // 阶段二：业务规则过滤
  const allowedSummaries: DutyUnhandledOrderSummary[] = [];
  for (const rawOrder of rawOrders) {
    const filterResult = filterMeituanOrder(rawOrder);
    options?.onFilterResult?.(filterResult);
    if (!filterResult.allowed) {
      continue;
    }

    allowedSummaries.push({
      orderId: rawOrder.orderId,
      hotelId: rawOrder.hotelId,
      hotelName: rawOrder.hotelName,
      cancelOrder: isMeituanCancelOrder(rawOrder),
      orderDisplayLabel: rawOrder.orderDisplayLabel,
    });
  }

  return allowedSummaries;
}

/**
 * 从美团订单详情响应报文中解析出高精度结构化字段（绝不兜底假数据）
 * 兼容多层嵌套结构（如 data.orderDetail、data.order、data）、时间戳日期与间夜价格明细
 */
export function parseMeituanOrderDetailResponse(
  payload: unknown,
  targetOrderId?: string
): Partial<ExtractedOrderDetail> | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  // 解构核心详情对象（可能位于 data.orderDetail 或 data.order 或顶层 data）
  const orderObj = (
    (data.orderDetail && typeof data.orderDetail === 'object' ? data.orderDetail : null) ||
    (data.order && typeof data.order === 'object' ? data.order : null) ||
    (root.orderDetail && typeof root.orderDetail === 'object' ? root.orderDetail : null) ||
    data
  ) as Record<string, unknown>;

  const orderId = String(
    orderObj.orderId ||
      orderObj.orderID ||
      orderObj.otaOrderId ||
      orderObj.orderNo ||
      data.orderId ||
      data.orderID ||
      data.otaOrderId ||
      root.orderId ||
      ''
  ).trim();

  if (targetOrderId && orderId && orderId !== targetOrderId) {
    return null;
  }

  // 解析入住与离店日期（优先取入离日期字段，再取时间戳或通用别名，最后从 roomNightPriceModels 提取）
  let checkInDate = fmtDate(
    orderObj.checkInDateString ||
      orderObj.checkInDate ||
      orderObj.arrival ||
      orderObj.inDate ||
      orderObj.startDate ||
      orderObj.bizDay ||
      data.checkInDateString ||
      data.checkInDate ||
      data.arrival
  );

  let checkOutDate = fmtDate(
    orderObj.checkOutDateString ||
      orderObj.checkOutDate ||
      orderObj.departure ||
      orderObj.outDate ||
      orderObj.endDate ||
      data.checkOutDateString ||
      data.checkOutDate ||
      data.departure
  );

  // 若顶层未直接提供入住/离店日期，尝试从间夜价格明细中推导
  if (!checkInDate || !checkOutDate) {
    const priceList = Array.isArray(orderObj.roomNightPriceModels)
      ? orderObj.roomNightPriceModels
      : Array.isArray(orderObj.priceInfoConstitute)
      ? orderObj.priceInfoConstitute
      : Array.isArray(orderObj.priceInfo)
      ? orderObj.priceInfo
      : Array.isArray(data.roomNightPriceModels)
      ? data.roomNightPriceModels
      : [];

    if (priceList.length > 0) {
      const dates: string[] = [];
      for (const item of priceList) {
        if (item && typeof item === 'object') {
          const itemRec = item as Record<string, unknown>;
          const d = fmtDate(itemRec.dateStr || itemRec.dateString || itemRec.bizDay || itemRec.date);
          if (d && !dates.includes(d)) dates.push(d);
        }
      }
      dates.sort();
      if (dates.length > 0) {
        if (!checkInDate) checkInDate = dates[0];
        if (!checkOutDate) {
          const lastDate = new Date(dates[dates.length - 1]);
          if (!Number.isNaN(lastDate.getTime())) {
            lastDate.setDate(lastDate.getDate() + 1);
            const y = lastDate.getFullYear();
            const m = String(lastDate.getMonth() + 1).padStart(2, '0');
            const d = String(lastDate.getDate()).padStart(2, '0');
            checkOutDate = `${y}-${m}-${d}`;
          }
        }
      }
    }
  }

  let nights = Number(
    orderObj.nights || orderObj.nightCount || orderObj.liveDays || data.nights || data.nightCount || 0
  );
  if (!nights && checkInDate && checkOutDate) {
    const diff = Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / 86400000);
    if (diff > 0) nights = diff;
  }

  // 严禁 rawTotal > 1000 无依据盲猜：美团接口 totalFee 规范单位为分 (cents)
  const totalCents = orderObj.totalFee ?? data.totalFee;
  const totalPrice =
    totalCents != null
      ? Number(totalCents) / 100
      : Number(orderObj.totalPrice ?? orderObj.price ?? data.totalPrice ?? data.price ?? 0);

  let guestName = '';
  let guestMobile = '';
  const rawContacts = Array.isArray(orderObj.contacts)
    ? orderObj.contacts
    : Array.isArray(orderObj.guests)
    ? orderObj.guests
    : Array.isArray(data.contacts)
    ? data.contacts
    : Array.isArray(data.guests)
    ? data.guests
    : [];

  for (const c of rawContacts) {
    if (c && typeof c === 'object') {
      const cRec = c as Record<string, unknown>;
      const n = String(cRec.name || '').trim();
      const p = String(cRec.phone || cRec.mobile || '').trim();
      if (n && !guestName) guestName = n;
      if (p && !guestMobile) guestMobile = p;
    }
  }
  if (!guestName) {
    guestName = String(
      orderObj.guestName ||
        orderObj.customerName ||
        orderObj.contactName ||
        data.guestName ||
        data.customerName ||
        data.contactName ||
        ''
    ).trim();
  }
  if (!guestMobile) {
    guestMobile = String(
      orderObj.guestMobile ||
        orderObj.customerMobile ||
        orderObj.contactPhone ||
        data.guestMobile ||
        data.customerMobile ||
        data.contactPhone ||
        ''
    ).trim();
  }

  const roomTypeName = String(
    orderObj.roomName ||
      orderObj.roomTypeName ||
      orderObj.roomTitle ||
      data.roomName ||
      data.roomTypeName ||
      data.roomTitle ||
      ''
  ).trim();

  const ratePlanName = String(
    orderObj.ratePlanName ||
      orderObj.rateCode ||
      orderObj.productName ||
      data.ratePlanName ||
      data.rateCode ||
      data.productName ||
      ''
  ).trim();

  const quantity = Number(
    orderObj.roomCount || orderObj.quantity || data.roomCount || data.quantity || 1
  );
  const unitId =
    String(orderObj.poiId || orderObj.hotelId || data.poiId || data.hotelId || '').trim() ||
    undefined;
  const unitName =
    String(orderObj.poiName || orderObj.hotelName || data.poiName || data.hotelName || '').trim() ||
    undefined;

  const remarkCandidate =
    orderObj.remark ??
    orderObj.memo ??
    orderObj.specialRequirement ??
    data.remark ??
    data.memo ??
    data.specialRequirement ??
    root.remark ??
    root.memo ??
    '';
  const remark = String(remarkCandidate).trim() || undefined;

  return {
    otaOrderId: orderId || targetOrderId,
    otaChannel: 'MEITUAN',
    unitId,
    unitName,
    guestName,
    guestMobile,
    roomTypeName,
    ratePlanName,
    arrival: checkInDate,
    departure: checkOutDate,
    nights,
    quantity,
    totalPrice,
    remark,
    raw: (orderObj || data) as Record<string, unknown>,
  };
}

export const extractMeituanOrderDetailFromPayload = parseMeituanOrderDetailResponse;
