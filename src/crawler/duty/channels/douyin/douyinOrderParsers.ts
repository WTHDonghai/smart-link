import type {
  DutyUnhandledOrderSummary,
  RawDouyinDutyOrder,
} from '../../dutyContracts';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import { fmtDate } from '@/src/utils/template/filters';
import { isDouyinVoucherOrder } from '@/src/services/protocols/douyinProtocol';

export const DOUYIN_BOOK_ORDER_LIST_PATH = '/life/trade_view/v1/workbench/book/query/list';
export const DOUYIN_REFUND_ORDER_LIST_PATH = '/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list';
export const DOUYIN_BOOK_ORDER_DETAIL_PATH = '/life/trade_view/v1/workbench/book/query/detail';

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
  return /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|验证一下|拖动滑块|请完成验证|secsdk|captcha/i.test(norm);
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

    // 预定单号/券号（用于中台唯一订单号）
    const bookId = String(bookDetailInfo.book_id || '').trim() || undefined;
    // 抖音交易主单号
    const mainOrderId = String(orderBaseInfo.order_id || '').trim() || undefined;
    // 有after_sale_id 表示是取消单
    const afterSaleId = String(afterSaleInner.after_sale_id || '').trim() || undefined;

    // 智能识别当前条目是否为预售券/套餐券
    const isVoucher = isDouyinVoucherOrder(rec);

    // 确定唯一订单编号：如果是券取预约单号，否则取订单号
    const orderId = isVoucher
      ? (bookId || mainOrderId || '')
      : (mainOrderId || bookId || '');

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
      bookId,
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

