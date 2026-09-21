/**
 * 渠道订单协议统一检索与路由入口 (Channel Protocol Router)
 * 各渠道协议由各自模块独立维护，本模块提供统一的协议定义检索接口
 */

import type { ChannelProtocolSchema } from '../../types/template';
import {
  DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
  MEITUAN_RAW_SAMPLE_ORDER,
} from './meituanProtocol';
import {
  DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
  DOUYIN_RAW_SAMPLE_ORDER,
} from './douyinProtocol';

export {
  DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
  MEITUAN_RAW_SAMPLE_ORDER,
  DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
  DOUYIN_RAW_SAMPLE_ORDER,
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
