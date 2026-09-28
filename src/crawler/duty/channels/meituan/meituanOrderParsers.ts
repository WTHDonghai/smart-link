import type {
  DutyUnhandledOrderSummary,
  ExtractedOrderDetail,
  RawMeituanDutyOrder,
} from '../../dutyContracts';

import { safeFormatDate as fmtDate } from '@/src/utils/template/filters';

export { fmtDate };

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
 * 从美团订单列表 API 报文中解析出 RawMeituanDutyOrder 列表
 */
export function extractMeituanOrdersFromPayload(payload: unknown): RawMeituanDutyOrder[] {
  if (!payload || typeof payload !== 'object') return [];

  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  const rawList: unknown[] =
    Array.isArray(data.results) ? data.results :
    Array.isArray(data.list) ? data.list :
    Array.isArray(data.orders) ? data.orders :
    Array.isArray(data.orderList) ? data.orderList :
    Array.isArray(data.items) ? data.items :
    Array.isArray(root.results) ? root.results :
    Array.isArray(root.orders) ? root.orders :
    Array.isArray(root.list) ? root.list :
    Array.isArray(payload) ? payload : [];

  const orders: RawMeituanDutyOrder[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const orderId = String(rec.orderId || rec.orderID || rec.otaOrderId || rec.orderNo || '').trim();
    if (!orderId) continue;

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
    for (const c of rawContacts) {
      if (c && typeof c === 'object') {
        const cRec = c as Record<string, unknown>;
        contacts.push({
          name: String(cRec.name || '').trim(),
          phone: String(cRec.phone || cRec.mobile || '').trim(),
        });
      }
    }
    if (contacts.length === 0 && (rec.guestName || rec.guestMobile)) {
      contacts.push({
        name: String(rec.guestName || '').trim(),
        phone: String(rec.guestMobile || '').trim(),
      });
    }

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
      cancelOrder: Boolean(
        rec.cancelOrder ||
        rec.status === 'CANCEL' ||
        rec.status === 'CANCELED' ||
        rec.status === 'CANCEL_ORDER' ||
        rec.status === 'CUSTOMER_CANCEL'
      ),
      raw: rec,
    });
  }

  return orders;
}

/**
 * 纯函数：从美团订单列表 API 报文中解析出待处理订单概要列表 (DutyUnhandledOrderSummary[])
 */
export function parseMeituanOrderListResponse(payload: unknown): DutyUnhandledOrderSummary[] {
  const rawOrders = extractMeituanOrdersFromPayload(payload);
  return rawOrders.map((o) => ({
    orderId: o.orderId,
    hotelId: o.hotelId,
    hotelName: o.hotelName,
    cancelOrder: o.cancelOrder,
    orderDisplayLabel: o.orderDisplayLabel,
  }));
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
