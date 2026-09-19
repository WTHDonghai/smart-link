/**
 * 订单协议对齐与清洗器 (Order Protocol Normalizer)
 * 职责：接收渠道原始抓取报文，依据渠道协议定义完成数据清洗，输出程序内部统一的 OrderProtocolData
 */

import type { ExtractedOrderDetail } from '../../crawler/duty/dutyContracts';
import type {
  OrderProtocolData,
  OrderProtocolPricing,
  CleanOrderContext,
  ChannelProtocolSchema,
} from '../../types/template';
import { getChannelProtocolSchema } from '../../services/protocols';
import { normalizeOrderPayload } from './protocolNormalizer';

/**
 * 将渠道原始订单详情清洗并对齐为程序内部统一的订单协议领域实体
 *
 * 核心流程：
 * 1. 提取入离日期、间夜数与按日价格明细；
 * 2. 依据渠道协议 Schema 执行清洗（normalizeOrderPayload）提取业务变量与派生条件；
 * 3. 输出标准化、强类型的 OrderProtocolData 实体。
 *
 * @param detail 渠道页面抓取的订单详情数据
 * @param channelCode 执行渠道标识（如 MEITUAN, DOUYIN）
 * @param customSchema 可选的自定义渠道协议 Schema（未提供时按 channelCode 路由预设协议）
 */
export function alignOrderToProtocol(
  detail: ExtractedOrderDetail,
  channelCode: string,
  customSchema?: ChannelProtocolSchema | null
): OrderProtocolData {
  const otaChannel = (detail.otaChannel || channelCode || 'OTA').trim().toUpperCase();
  const stayNights = Math.max(1, detail.nights || 1);
  const rawRemark = String((detail.raw as Record<string, unknown> | undefined)?.remark || '');

  // 1. 解析按日价格明细 (Pricing)
  const rawPricing = Array.isArray((detail.raw as Record<string, unknown> | undefined)?.pricing)
    ? ((detail.raw as Record<string, unknown>).pricing as Array<{ date?: string; price?: number }>)
    : [];

  let pricing: OrderProtocolPricing[] = [];
  if (rawPricing.length === stayNights && rawPricing.every((p) => p.date && typeof p.price === 'number')) {
    pricing = rawPricing.map((p) => ({
      date: String(p.date),
      price: Number(p.price),
    }));
  } else {
    const nightlyPrice = Math.round((detail.totalPrice / stayNights) * 100) / 100;
    pricing = Array.from({ length: stayNights }, (_, i) => {
      const d = new Date(`${detail.arrival}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return {
        date: d.toISOString().slice(0, 10),
        price: nightlyPrice,
      };
    });
  }

  // 2. 房型商品 ID 与支付方式
  const rawGoodsId =
    (detail.raw as Record<string, unknown> | undefined)?.goodsId ||
    (detail.raw as Record<string, unknown> | undefined)?.roomTypeId;
  const roomTypeId = rawGoodsId ? String(rawGoodsId).trim() : 'ROOM_DEFAULT';

  const rawPaytype =
    (detail.raw as Record<string, unknown> | undefined)?.paymentType ||
    (detail.raw as Record<string, unknown> | undefined)?.paytype;
  const paytype = rawPaytype ? String(rawPaytype).trim() : '预付';

  // 3. 构造基础标准业务上下文
  const contextVariables: CleanOrderContext = {
    'OTA订单号': detail.otaOrderId,
    'otaOrderId': detail.otaOrderId,
    'orderNo': detail.otaOrderId,
    '入住人': detail.guestName,
    '住客': detail.guestName,
    '住客姓名': detail.guestName,
    'guestName': detail.guestName,
    '联系电话': detail.guestMobile || '',
    'guestMobile': detail.guestMobile || '',
    'phone': detail.guestMobile || '',
    '房型名称': detail.roomTypeName,
    'roomTypeName': detail.roomTypeName,
    'roomName': detail.roomTypeName,
    '间夜数': `${stayNights}间夜`,
    'nights': stayNights,
    '房间数': `${detail.quantity || 1}间`,
    'quantity': detail.quantity || 1,
    'roomCount': detail.quantity || 1,
    '底价': String(detail.totalPrice),
    'floorPrice': detail.totalPrice,
    'totalPrice': detail.totalPrice,
    '实付金额': String(detail.totalPrice),
    'payAmount': detail.totalPrice,
    '入住离店日期': `${detail.arrival}至${detail.departure}`,
    'checkInOutDate': `${detail.arrival}至${detail.departure}`,
    '入住日期': detail.arrival,
    'arrival': detail.arrival,
    'checkInDate': detail.arrival,
    '离店日期': detail.departure,
    'departure': detail.departure,
    'checkOutDate': detail.departure,
    '渠道来源': otaChannel,
    'otaChannel': otaChannel,
    'channel': otaChannel,
    '支付方式': paytype,
    'paytype': paytype,
    '备注': rawRemark,
    'remark': rawRemark,
  };

  // 4. 获取渠道协议 Schema，执行报文归一化清洗
  const schema = customSchema !== undefined ? customSchema : getChannelProtocolSchema(otaChannel);

  if (detail.raw && typeof detail.raw === 'object' && schema) {
    try {
      const normalized = normalizeOrderPayload(detail.raw, schema);
      for (const [k, v] of Object.entries(normalized)) {
        if (v !== '' && v !== undefined && v !== null) {
          contextVariables[k] = v;
        }
      }
    } catch {
      // 报文结构与 Schema 存在轻微差异时保留基础上下文
    }

    contextVariables.raw = detail.raw as Record<string, unknown>;
    if (
      (detail.raw as Record<string, unknown>).data &&
      typeof (detail.raw as Record<string, unknown>).data === 'object'
    ) {
      contextVariables.data = (detail.raw as Record<string, unknown>).data as Record<string, unknown>;
    }
  }

  return {
    otaOrderId: detail.otaOrderId,
    otaChannel,
    unitId: detail.unitId,
    unitName: detail.unitName,
    guestName: detail.guestName,
    guestMobile: detail.guestMobile || '',
    roomTypeName: detail.roomTypeName,
    originRoomType: detail.roomTypeName,
    roomTypeId,
    rateCode: detail.ratePlanName || 'OTA',
    arrival: detail.arrival,
    departure: detail.departure,
    nights: stayNights,
    quantity: detail.quantity || 1,
    totalPrice: detail.totalPrice,
    paytype,
    pricing,
    contextVariables,
    rawRemark,
    rawPayload: detail.raw,
  };
}
