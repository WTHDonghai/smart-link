/**
 * 渠道订单协议统一检索与路由入口 (Channel Protocol Router)
 * 各渠道协议由各自模块独立维护，本模块提供统一的协议定义检索接口
 */

import type { ChannelProtocolSchema, IChannelOrderProtocol } from '../../types/template';
import { normalizeOtaChannelCode } from '@/src/config/otaUrls';
import {
  DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
  MEITUAN_RAW_SAMPLE_ORDER,
  MeituanOrderProtocol,
  cleanMeituanOrder,
} from './meituanProtocol';
import {
  DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
  DOUYIN_RAW_SAMPLE_ORDER,
  DouyinOrderProtocol,
  cleanDouyinOrder,
  isDouyinVoucherOrder,
} from './douyinProtocol';

export {
  DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
  MEITUAN_RAW_SAMPLE_ORDER,
  MeituanOrderProtocol,
  cleanMeituanOrder,
  DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
  DOUYIN_RAW_SAMPLE_ORDER,
  DouyinOrderProtocol,
  cleanDouyinOrder,
  isDouyinVoucherOrder,
};

/**
 * 根据渠道标识或大写渠道代码获取对应的预设订单协议 Schema
 */
export function getChannelProtocolSchema(channelCodeOrId: string): ChannelProtocolSchema | null {
  const normalized = String(channelCodeOrId || '').trim().toUpperCase();

  if (normalized === 'MEITUAN' || normalized === 'MEITUANBIZ' || normalized.includes('MEITUAN')) {
    return DEFAULT_MEITUAN_PROTOCOL_SCHEMA;
  }

  if (normalized === 'DOUYIN' || normalized.includes('DOUYIN')) {
    return DEFAULT_DOUYIN_PROTOCOL_SCHEMA;
  }

  return null;
}

/**
 * 统一渠道订单清洗路由器：根据渠道代码路由至具体渠道订单协议清洗器，产出强类型的 IChannelOrderProtocol 实体
 */
export function cleanChannelOrder(
  channelCode: string,
  rawPayload: unknown,
  customSchema?: ChannelProtocolSchema | null,
  targetOrderId?: string
): IChannelOrderProtocol {
  // 复用全局渠道码归一化：MTBIZ / MEITUAN_BUSINESS 等全部别名变体统一收敛为规范码，
  // 杜绝本路由器自行维护别名级联导致覆盖不全（如 MEITUANBIZ 能识别而 MTBIZ 漏过）
  const normalized = normalizeOtaChannelCode(channelCode);

  if (normalized.includes('MEITUAN')) {
    return cleanMeituanOrder(rawPayload, customSchema, targetOrderId, normalized);
  }

  if (normalized === 'DOUYIN' || normalized.includes('DOUYIN')) {
    return cleanDouyinOrder(rawPayload, customSchema, targetOrderId);
  }

  throw new Error(`[ProtocolRouter] 暂未实现渠道「${channelCode}」的订单协议清洗器`);
}
