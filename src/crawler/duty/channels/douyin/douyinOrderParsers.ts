import type {
  DutyUnhandledOrderSummary,
  RawDouyinDutyOrder,
} from '../../dutyContracts';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import { fmtDate } from '@/src/utils/template/filters';
import { DOUYIN_RISK_TEXT_PATTERN } from '@/src/utils/douyinRiskDiagnostics';
import { isDouyinVoucherOrder } from '@/src/services/protocols/douyinProtocol';

export const DOUYIN_BOOK_ORDER_LIST_PATH = '/life/trade_view/v1/workbench/book/query/list';
export const DOUYIN_REFUND_ORDER_LIST_PATH = '/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list';
export const DOUYIN_BOOK_ORDER_DETAIL_PATH = '/life/trade_view/v1/workbench/book/query/detail';
export const DOUYIN_SECRET_NUM_PATH = '/life/trade_view/v1/common/get_secret_num';

/**
 * 抖音详情区「一键复制」按钮定位选择器（真实手机号获取通道的唯一触发入口）
 * 依据 docs/channels/douyin/02-order-api-spec.md §4 同接口双语义调研结论：
 * 1. 电话图标通道触发 get_secret_num 返回隐私虚拟号（带「转」分机），已废弃；
 * 2. 「一键复制」触发同接口返回真实手机号（show_type: 2）；
 * 3. 作用域必须限定 #detailSection，防止误点列表卡片等其他区域的复制控件。
 */
export const DOUYIN_COPY_ORDER_BUTTON_SELECTOR = '#detailSection button:has-text("一键复制")';

/**
 * 真实大陆手机号格式（11 位、1[3-9] 号段、无分机后缀）
 * 隐私虚拟号携带「转xxxx」分机后缀，天然被此格式排除
 */
const REAL_MAINLAND_MOBILE_PATTERN = /^1[3-9]\d{9}$/;

/**
 * 判断 URL 是否属于抖音隐私号/联系电话接口
 */
export function isDouyinSecretNumUrl(url: string): boolean {
  try {
    return new URL(url).pathname === DOUYIN_SECRET_NUM_PATH;
  } catch {
    return url.includes(DOUYIN_SECRET_NUM_PATH);
  }
}

/**
 * 纯函数：从 get_secret_num 接口响应中提取真实手机号（仅接受纯大陆手机号格式）
 * 遵循 Fail-Fast 原则：状态码非 0、结构无效或无合格条目立即返回 null，绝不返回虚拟号或兜底值
 * @param payload 接口响应 JSON 对象或序列化字符串
 */
export function extractDouyinRealPhoneFromSecretNumResponse(payload: unknown): string | null {
  let json: Record<string, unknown>;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return null;
    }
  } else if (payload && typeof payload === 'object') {
    json = payload as Record<string, unknown>;
  } else {
    return null;
  }

  // 业务状态码双写校验 (docs/channels/douyin/02-order-api-spec.md §1)：
  // status_code（新风格）与 BaseResp.StatusCode（旧风格）同时存在，任一非 0 即业务失败
  const baseRespCode = (json.BaseResp as Record<string, unknown> | undefined)?.StatusCode;
  if ((json.status_code !== undefined && json.status_code !== 0)
    || (baseRespCode !== undefined && baseRespCode !== 0)) {
    return null;
  }

  const secretNums = json.secret_nums;
  if (!secretNums || typeof secretNums !== 'object') {
    return null;
  }

  // 遍历全部密文条目：跳过虚拟号（带「转」分机）与非真实手机号格式，返回首个真实号
  for (const item of Object.values(secretNums as Record<string, { phone?: unknown }>)) {
    if (item && typeof item === 'object' && item.phone) {
      const phone = String(item.phone).trim();
      if (REAL_MAINLAND_MOBILE_PATTERN.test(phone)) {
        return phone;
      }
    }
  }

  return null;
}

/**
 * 纯函数：将真实手机号回写进详情报文（根级 decryptedPhone + guest_info 联系人 + 嵌套 data.data 字符串）
 * 供协议层融合覆盖脱敏电话（docs/channels/douyin/02-order-api-spec.md §4.2 第 5 步）
 */
export function applyDouyinDecryptedPhone(
  rawDetail: Record<string, unknown>,
  decryptedPhone: string
): Record<string, unknown> {
  const resultDetail = JSON.parse(JSON.stringify(rawDetail)) as Record<string, unknown>;
  resultDetail.decryptedPhone = decryptedPhone;

  const writeGuestInfo = (guestInfo: Record<string, unknown>): void => {
    const userList = Array.isArray(guestInfo.user_list) ? guestInfo.user_list : [];
    if (userList[0] && typeof userList[0] === 'object') {
      (userList[0] as Record<string, unknown>).phone = decryptedPhone;
    }
    if (guestInfo.buyer && typeof guestInfo.buyer === 'object') {
      (guestInfo.buyer as Record<string, unknown>).phone = decryptedPhone;
    }
  };

  if (resultDetail.guest_info && typeof resultDetail.guest_info === 'object') {
    writeGuestInfo(resultDetail.guest_info as Record<string, unknown>);
  }

  // 抖音标准嵌套字符串结构 data.data 同步回写，保证下游按嵌套路径取数一致
  const innerDataObj = resultDetail.data as Record<string, unknown> | undefined;
  if (innerDataObj && typeof innerDataObj.data === 'string') {
    try {
      const parsedInner = JSON.parse(innerDataObj.data) as Record<string, unknown>;
      if (parsedInner && typeof parsedInner === 'object' && parsedInner.guest_info) {
        writeGuestInfo(parsedInner.guest_info as Record<string, unknown>);
        innerDataObj.data = JSON.stringify(parsedInner);
      }
    } catch {
      // 嵌套结构非 JSON 时保持原样
    }
  }

  return resultDetail;
}

/**
 * 判断 URL 是否属于抖音新订/变更订单列表接口
 */
export function isDouyinBookOrderListUrl(url: string): boolean {
  try {
    return new URL(url).pathname === DOUYIN_BOOK_ORDER_LIST_PATH;
  } catch {
    return false;
  }
}

/**
 * 判断 URL 是否属于抖音取消/退款订单列表接口
 */
export function isDouyinRefundOrderListUrl(url: string): boolean {
  try {
    return new URL(url).pathname === DOUYIN_REFUND_ORDER_LIST_PATH;
  } catch {
    return false;
  }
}

/**
 * 判断 URL 是否属于抖音订单详情接口
 */
export function isDouyinOrderDetailUrl(url: string): boolean {
  try {
    return new URL(url).pathname === DOUYIN_BOOK_ORDER_DETAIL_PATH;
  } catch {
    return false;
  }
}

/**
 * 判断 URL 是否属于任一抖音订单列表接口（新订/变更 或 取消/退款）
 */
export function isDouyinOrderListUrl(url: string): boolean {
  return isDouyinBookOrderListUrl(url) || isDouyinRefundOrderListUrl(url);
}

/**
 * 校验文本内容是否命中人机、滑块、风控验证特征
 */
export function isDouyinRiskControlText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const norm = text.replace(/\s+/g, ' ').trim();
  return DOUYIN_RISK_TEXT_PATTERN.test(norm);
}

/**
 * 从抖音订单列表 API 报文中解析出 RawDouyinDutyOrder 列表
 * 遵循 Fail-Fast 原则：严格校验业务状态码与报文合法性，解析失败立即阻断
 * @param payload API 响应对象
 * @param defaultIsCancel 是否为取消/退款 Tab 来源
 */
export function extractDouyinOrdersFromPayload(
  payload: unknown,
  defaultIsCancel = false
): RawDouyinDutyOrder[] {
  if (!payload || typeof payload !== 'object') {
    throw new DutyExecutionError(
      '抖音订单列表接口返回非对象合法报文',
      DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
      false
    );
  }

  const root = payload as Record<string, unknown>;

  // 1. 业务状态码校验 (Fail-Fast: 仅当 status_code === 0 时合法放行，缺失或非0立即阻断)
  if (root.status_code !== 0) {
    const statusMsg = String(root.status_msg || '未知业务异常').trim();
    throw new DutyExecutionError(
      `抖音订单列表接口返回错误 (code: ${root.status_code}, msg: ${statusMsg})`,
      DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
      false
    );
  }

  // 2. 忠实于调研文档：两类订单接口统一从 root.data.data 提取订单列表
  const data = root.data as Record<string, unknown> | undefined;
  const rawList = Array.isArray(data?.data) ? data.data : [];

  const orders: RawDouyinDutyOrder[] = [];

  for (const item of rawList) {
    let rec: Record<string, unknown>;

    // 抖音接口特色：data.data 中每个元素通常为独立被序列化的 JSON 字符串
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object') continue;
        rec = parsed as Record<string, unknown>;
      } catch (err) {
        throw new DutyExecutionError(
          `抖音订单条目 JSON 反序列化失败: ${err instanceof Error ? err.message : String(err)}`,
          DouyinDutyErrorCode.LIST_BUSINESS_FAILED,
          false
        );
      }
    } else if (item && typeof item === 'object') {
      rec = item as Record<string, unknown>;
    } else {
      continue;
    }

    // 订单基础信息
    const orderBaseInfo = (rec.order_base_info || {}) as Record<string, unknown>;
    // 预约信息
    const bookDetailInfo = (rec.book_detail_info || {}) as Record<string, unknown>;
    const saleProductInfo = (rec.sale_product_info || {}) as Record<string, unknown>;
    // 金额信息
    const amountInfo = (rec.amount_info || {}) as Record<string, unknown>;
    // 订单状态信息(新单，取消单等)
    const statusInfoV2 = (rec.status_info_v2 || {}) as Record<string, unknown>;
    const metaData = (rec.meta_data || {}) as Record<string, unknown>;
    // 用户信息
    const guestInfo = (rec.guest_info || {}) as Record<string, unknown>;
    // 取消/退单信息
    const afterSaleInfoV2 = (rec.after_sale_info_v2 || {}) as Record<string, unknown>;
    const afterSaleInner = (afterSaleInfoV2.after_sale_info || {}) as Record<string, unknown>;

    // 预约单号（优先取界面展示的 book_order_id，兜底取 book_id）
    const bookOrderId = String(bookDetailInfo.book_order_id || bookDetailInfo.book_id || '').trim() || undefined;
    // 抖音交易主单号（订单编号）
    const mainOrderId = String(orderBaseInfo.order_id || '').trim() || undefined;
    // 有after_sale_id 表示是取消单
    const afterSaleId = String(afterSaleInner.after_sale_id || '').trim() || undefined;

    // 智能识别当前条目是否为预售券/套餐券
    const isVoucher = isDouyinVoucherOrder(rec);

    // 确定唯一订单编号：如果是券取预约单号，否则取订单号
    const orderId = isVoucher
      ? (bookOrderId || mainOrderId || '')
      : (mainOrderId || bookOrderId || '');

    if (!orderId) continue;

    const hotelId = String(
      bookDetailInfo.poi_life_account_id ||
      ''
    ).trim() || undefined;

    const hotelName = String(
      bookDetailInfo.hotel_name ||
      ''
    ).trim() || undefined;

    // 判定是否为取消/退款订单
    const cancelOrder = Boolean(
      defaultIsCancel || // 优先使用参数
      afterSaleId || // 是否存在取消单号
      metaData.view_type === 'hotel_after_sale' ||
      metaData.main_data_key === 'after_sale_main_data' ||
      (statusInfoV2.title && /取消|退款|售后/.test(String(statusInfoV2.title)))
    );

    const orderDisplayLabel = String(
      statusInfoV2.title || (cancelOrder ? '已取消' : '新订')
    ).trim();

    const checkInDate = fmtDate(bookDetailInfo.book_start_time);
    const checkOutDate = fmtDate(bookDetailInfo.book_end_time);

    let nights = Number(bookDetailInfo.book_night_count || 0);

    // 针对取消/退款单优先取退款金额，正常订单优先取实付金额
    const rawPayAmount = Number(
      cancelOrder
        ? (afterSaleInner.refund_amount ?? amountInfo.refund_amount ?? 0)
        : (amountInfo.pay_amount ?? amountInfo.origin_amount ?? 0)
    );

    // 抖音金额以分计量，折算为元并收敛浮点精度
    const totalAmount = rawPayAmount > 0 ? Math.round(rawPayAmount) / 100 : 0;

    const contacts: Array<{ name: string; phone?: string }> = [];
    const userList = Array.isArray(guestInfo.user_list) ? guestInfo.user_list : [];
    for (const u of userList) {
      if (u && typeof u === 'object') {
        const uRec = u as Record<string, unknown>;
        const name = String(uRec.name || '').trim();
        const phone = String(uRec.phone || '').trim();
        if (name) {
          contacts.push({ name, phone: phone || undefined });
        }
      }
    }

    const roomName = String(saleProductInfo.physical_room_name || '').trim();
    const productName = String(saleProductInfo.product_name || '').trim() || undefined;
    const productId = String(saleProductInfo.product_id || '').trim();

    orders.push({
      orderId,
      bookId: bookOrderId,
      mainOrderId,
      isVoucher,
      afterSaleId,
      hotelId,
      hotelName,
      orderDisplayLabel,
      orderTime: orderBaseInfo.pay_time
        ? fmtDate(orderBaseInfo.pay_time, 'YYYY-MM-DD HH:mm:ss')
        : undefined,
      roomName,
      productName,
      productId,
      checkInDate,
      checkOutDate,
      nights,
      quantity: Number(bookDetailInfo.book_room_count || 1),
      totalAmount,
      contacts,
      cancelOrder,
      raw: rec,
    });
  }

  return orders;
}

/**
 * 纯函数：从抖音订单列表 API 报文中解析出待处理订单概要列表 (DutyUnhandledOrderSummary[])
 * @param payload API 响应对象
 * @param defaultIsCancel 是否为取消/退款 Tab 来源
 */
export function parseDouyinOrderListResponse(
  payload: unknown,
  defaultIsCancel = false
): DutyUnhandledOrderSummary[] {
  const rawOrders = extractDouyinOrdersFromPayload(payload, defaultIsCancel);
  return rawOrders.map((o) => ({
    orderId: o.orderId,
    hotelId: o.hotelId,
    hotelName: o.hotelName,
    cancelOrder: o.cancelOrder,
    afterSaleId: o.afterSaleId,
    orderDisplayLabel: o.orderDisplayLabel,
  }));
}

/**
 * 从「新订/变更」列表 API 报文中解析出待处理新订单概要
 */
export function parseDouyinBookOrderListResponse(payload: unknown): DutyUnhandledOrderSummary[] {
  return parseDouyinOrderListResponse(payload, false);
}

/**
 * 从「取消/退款」列表 API 报文中解析出待处理取消/退款订单概要
 */
export function parseDouyinRefundOrderListResponse(payload: unknown): DutyUnhandledOrderSummary[] {
  return parseDouyinOrderListResponse(payload, true);
}

export { extractDouyinOrderFromResponse } from '@/src/services/protocols/douyinProtocol';

