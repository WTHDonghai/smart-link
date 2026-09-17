import type { ChannelMeta } from '../types';

export type { ChannelMeta };

export interface ChannelIdentitySource {
  otaChannelId?: string;
  otaChannelCode?: string;
  channelId?: string;
  channelCode?: string;
  id?: string;
  code?: string;
  name?: string;
  short?: string;
  bgColor?: string;
  textColor?: string;
}

export interface ChannelCandidate {
  id: string;
  name: string;
  code?: string;
  short?: string;
  bgColor?: string;
  textColor?: string;
}

export const KNOWN_CHANNEL_METAS: Record<string, ChannelMeta> = {
  meituan: {
    name: '美团',
    short: '美',
    bgColor: 'bg-[#fff1e0]',
    textColor: 'text-[#ff7d00]',
  },
  meituanbiz: {
    name: '美团商旅',
    short: '商',
    bgColor: 'bg-[#eef2ff]',
    textColor: 'text-[#004ac6]',
  },
  douyin: {
    name: '抖音',
    short: '抖',
    bgColor: 'bg-[#0f172a]',
    textColor: 'text-white',
  },
  ctrip: {
    name: '携程旅行',
    short: '携',
    bgColor: 'bg-[#2577e3]',
    textColor: 'text-white',
  },
  tongcheng: {
    name: '同程旅行',
    short: '同',
    bgColor: 'bg-[#0fc26a]',
    textColor: 'text-white',
  },
  fliggy: {
    name: '飞猪旅行',
    short: '猪',
    bgColor: 'bg-[#ffeedd]',
    textColor: 'text-[#ff5000]',
  },
};

/**
 * 统一精准解析渠道图徽元数据：
 * 优先匹配已配置 channels 列表，次级根据渠道代码与特征智能推断，彻底杜绝 MEITUAN 与 MEITUAN_BIZ 降级为 OTA
 */
export function resolveChannelMeta(
  source: ChannelIdentitySource | string | null | undefined,
  channels: readonly ChannelCandidate[] = []
): ChannelMeta {
  if (!source) {
    return {
      name: 'OTA',
      short: 'OTA',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-700',
    };
  }

  const rawObj: ChannelIdentitySource =
    typeof source === 'string'
      ? { channelCode: source, channelId: source }
      : source;

  // 若对象自身已具备完整的短名与配色定义且不是占位默认 OTA，优先复用
  if (rawObj.short && rawObj.bgColor && rawObj.textColor && rawObj.short !== 'OTA') {
    return {
      name: rawObj.name || rawObj.code || rawObj.channelCode || 'OTA',
      short: rawObj.short,
      bgColor: rawObj.bgColor,
      textColor: rawObj.textColor,
    };
  }

  const channelId = String(rawObj.otaChannelId || rawObj.channelId || rawObj.id || '').trim();
  const channelCode = String(rawObj.otaChannelCode || rawObj.channelCode || rawObj.code || '').trim();

  // 1. 优先从全局已配置渠道列表中精确/归一化查找
  const matchedChannel = channels.find((c) => {
    if (channelId && c.id.toLowerCase() === channelId.toLowerCase()) return true;
    if (channelCode && c.code && c.code.toUpperCase() === channelCode.toUpperCase()) return true;
    const normCId = c.id.replace(/[-_]/g, '').toLowerCase();
    const normHId = channelId.replace(/[-_]/g, '').toLowerCase();
    if (normHId && normCId === normHId) return true;
    const normCCode = (c.code || '').replace(/[-_]/g, '').toUpperCase();
    const normHCode = channelCode.replace(/[-_]/g, '').toUpperCase();
    if (normHCode && normCCode === normHCode) return true;
    return false;
  });

  if (matchedChannel && matchedChannel.short) {
    return {
      name: matchedChannel.name,
      short: matchedChannel.short,
      bgColor: matchedChannel.bgColor || 'bg-blue-100',
      textColor: matchedChannel.textColor || 'text-blue-700',
    };
  }

  // 2. 内置主流渠道特征匹配规则（确保 MEITUAN 与 MEITUAN_BIZ 无论何种边界均精准渲染徽标）
  const combined = `${channelCode}_${channelId}`.toUpperCase().replace(/[-_]/g, '');
  if (combined.includes('MEITUANBIZ') || combined.includes('MTBIZ') || combined.includes('BUSINESS')) {
    return KNOWN_CHANNEL_METAS.meituanbiz;
  }
  if (combined.includes('MEITUAN') || combined.includes('MT')) {
    return KNOWN_CHANNEL_METAS.meituan;
  }
  if (combined.includes('DOUYIN') || combined.includes('DY')) {
    return KNOWN_CHANNEL_METAS.douyin;
  }
  if (combined.includes('CTRIP') || combined.includes('XIECHENG')) {
    return KNOWN_CHANNEL_METAS.ctrip;
  }
  if (combined.includes('TONGCHENG') || combined.includes('TC')) {
    return KNOWN_CHANNEL_METAS.tongcheng;
  }
  if (combined.includes('FLIGGY') || combined.includes('FEIZHU')) {
    return KNOWN_CHANNEL_METAS.fliggy;
  }

  return {
    name: matchedChannel?.name || rawObj.name || channelCode || channelId || 'OTA',
    short: channelCode ? channelCode.slice(0, 2) : 'OTA',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
  };
}
