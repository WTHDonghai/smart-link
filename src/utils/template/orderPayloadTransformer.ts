/**
 * 订单协议与中台载荷转换器 (Order Protocol & Payload Transformer)
 * 职责：
 * 1. 模版渲染：直接以模版上下文变量字典驱动模版引擎，求值生成最终 Remark 文本；
 * 2. 入单组装：直接将 UnifiedOrderProtocol 统一导入协议实体转换为中台入单请求契约 (ImportPayload)。
 */

import type { ImportPayload } from '../../types';
import type { UnifiedOrderProtocol } from '../../types/template';
import { renderTemplate } from './templateEngine';
import { logger } from '../../services/logger';

/**
 * 基于通用上下文变量字典渲染备注文本
 *
 * @param variables 模版上下文变量字典
 * @param template 远端获取的备注模版
 * @param fallbackRemark 兜底备注
 * @returns 最终生成的 Remark 备注字符串
 */
export function renderRemarkFromVariables(
  variables: Record<string, unknown>,
  template?: string | null,
  fallbackRemark: string = ''
): string {
  if (!template || !template.trim()) {
    return fallbackRemark;
  }

  try {
    const rendered = renderTemplate(template.trim(), variables);
    if (rendered && rendered.trim()) {
      return rendered.trim();
    }
    return fallbackRemark;
  } catch (error) {
    logger.warn('[模版求值] 订单备注模版渲染异常，降级使用原始备注', {
      module: 'DUTY_TASK',
      details: error instanceof Error ? error.message : String(error),
      meta: {
        template,
        error: error instanceof Error ? error.stack || error.message : String(error),
      },
    });
    return fallbackRemark;
  }
}

/**
 * 将统一订单导入协议 (UnifiedOrderProtocol) 组装为中台入单请求契约载荷 (ImportPayload)
 *
 * @param unifiedOrder 标准化统一订单协议实体 (内部已包含渲染好的 remark)
 * @param extUnitCode 文旅中台外部物理酒店/单元编码
 * @returns 符合中台契约的 ImportPayload
 */
export function buildImportPayloadFromUnifiedOrder(
  unifiedOrder: UnifiedOrderProtocol,
  extUnitCode: string | null
): ImportPayload {
  return {
    extUnitCode,
    orders: [
      {
        otaOrderId: unifiedOrder.otaOrderId,
        otaChannel: unifiedOrder.otaChannel,
        contact: {
          name: unifiedOrder.contact.name,
          mobile: unifiedOrder.contact.mobile || '',
        },
        booking: {
          roomType: unifiedOrder.booking.roomTypeName,
          originRoomType: unifiedOrder.booking.originRoomType || unifiedOrder.booking.roomTypeName,
          rateCode: unifiedOrder.booking.rateCode,
          arrival: unifiedOrder.booking.arrival,
          departure: unifiedOrder.booking.departure,
          roomTypeId: unifiedOrder.booking.roomTypeId,
          nights: unifiedOrder.booking.nights,
          quantity: unifiedOrder.booking.quantity,
          totalPrice: unifiedOrder.booking.totalPrice,
          paytype: unifiedOrder.booking.paytype,
          pricing: unifiedOrder.booking.pricing,
        },
        remark: unifiedOrder.remark,
      },
    ],
  };
}
