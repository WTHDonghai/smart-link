/**
 * 订单协议与中台载荷转换器 (Order Protocol & Payload Transformer)
 * 职责：
 * 1. 模版渲染：直接以 OrderProtocolData 实体驱动模版引擎，求值生成最终 Remark 文本；
 * 2. 入单组装：直接将 OrderProtocolData 实体转换为中台入单请求契约 (ImportPayload)。
 */

import type { ImportPayload } from '../../types';
import type { OrderProtocolData } from '../../types/template';
import { renderTemplate } from './templateEngine';

/**
 * 基于订单协议数据实体求值并渲染备注文本
 *
 * @param protocolData 已对齐清洗的订单协议实体
 * @param template 远端获取的备注模版（若为 null/空或渲染异常，兜底使用 protocolData.rawRemark）
 * @returns 最终生成的 Remark 备注字符串
 */
export function renderRemarkFromProtocol(
  protocolData: OrderProtocolData,
  template?: string | null
): string {
  const fallbackRemark = protocolData.rawRemark || '';

  if (!template || !template.trim()) {
    return fallbackRemark;
  }

  try {
    const rendered = renderTemplate(template.trim(), protocolData.contextVariables);
    if (rendered && rendered.trim()) {
      return rendered.trim();
    }
    return fallbackRemark;
  } catch {
    // 模版语法编译错误或求值异常，安全降级回原备注
    return fallbackRemark;
  }
}

/**
 * 将订单协议实体及渲染后的 Remark 组装为中台入单请求载荷 (ImportPayload)
 *
 * @param protocolData 已对齐清洗的订单协议实体
 * @param extUnitCode 文旅中台外部物理酒店/单元编码
 * @param remark 已渲染或已兜底的最终备注文本
 * @returns 符合线缆契约的 ImportPayload
 */
export function buildImportPayloadFromProtocol(
  protocolData: OrderProtocolData,
  extUnitCode: string | null,
  remark: string
): ImportPayload {
  return {
    extUnitCode,
    orders: [
      {
        otaOrderId: protocolData.otaOrderId,
        otaChannel: protocolData.otaChannel,
        contact: {
          name: protocolData.guestName,
          mobile: protocolData.guestMobile || '',
        },
        booking: {
          roomType: protocolData.roomTypeName,
          originRoomType: protocolData.originRoomType || protocolData.roomTypeName,
          rateCode: protocolData.rateCode,
          arrival: protocolData.arrival,
          departure: protocolData.departure,
          roomTypeId: protocolData.roomTypeId,
          nights: protocolData.nights,
          quantity: protocolData.quantity,
          totalPrice: protocolData.totalPrice,
          paytype: protocolData.paytype,
          pricing: protocolData.pricing,
        },
        remark,
      },
    ],
  };
}
