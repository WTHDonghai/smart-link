import type { OTAChannelMappingRecord } from '../types';
import { resolveChannelMeta } from './channelMeta';

export interface DutyChannelConfig {
  code: string;
  name: string;
  desc: string;
  mappingCount: number;
  pmsChannelNames: string[];
}

const KNOWN_DUTY_DESCRIPTIONS: Record<string, string> = {
  MEITUAN: '美团待处理订单自动发现与导入',
  MEITUAN_BIZ: '美团商旅独立订单列表自动同步',
  DOUYIN: '抖音新订/退款订单业务协同值守',
  CTRIP: '携程管家订单同步与确认号回填',
  TONGCHENG: '同程艺龙订单实时监听与回填',
  FLIGGY: '飞猪订单自动化处理与确认',
  QUNAR: '去哪儿订单协同与自动化导入',
  RED: '小红书订单自动化值守',
};

/**
 * 根据接口获取的 OTA 渠道映射记录，动态提取当前用户已映射的待值守渠道配置列表。
 *
 * 遵循 Fail-Fast 与纯函数规范：
 * 1. 过滤已失效 (status === 'I') 或缺少渠道标识的异常数据；
 * 2. 按照 otaChannelCode 进行规范化大写去重与聚合；
 * 3. 优先读取映射返回的渠道名称，并智能关联已知业务能力与文旅系统渠道名称。
 */
export function deriveMappedDutyChannels(
  mappings: readonly OTAChannelMappingRecord[] | null | undefined
): DutyChannelConfig[] {
  if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
    return [];
  }

  const channelMap = new Map<
    string,
    {
      code: string;
      name: string;
      mappingCount: number;
      pmsChannelNames: Set<string>;
    }
  >();

  for (const m of mappings) {
    if (!m || typeof m !== 'object') continue;
    if (m.status && String(m.status).trim().toUpperCase() === 'I') continue;

    const rawCode = m.otaChannelCode;
    if (!rawCode || typeof rawCode !== 'string') continue;

    const code = rawCode.trim().toUpperCase();
    if (!code) continue;

    const meta = resolveChannelMeta(code);
    const resolvedName =
      (m.otaChannelName && m.otaChannelName.trim() && m.otaChannelName.trim() !== code)
        ? m.otaChannelName.trim()
        : meta.name;

    const pmsName = (m.channelName || m.channelCode || '').trim();

    const existing = channelMap.get(code);
    if (!existing) {
      const pmsSet = new Set<string>();
      if (pmsName) pmsSet.add(pmsName);
      channelMap.set(code, {
        code,
        name: resolvedName,
        mappingCount: 1,
        pmsChannelNames: pmsSet,
      });
    } else {
      existing.mappingCount += 1;
      if (pmsName) existing.pmsChannelNames.add(pmsName);
      // 如果之前未取到更友好的名称，且当前记录有更友好的名称，更新之
      if (existing.name === code && resolvedName !== code) {
        existing.name = resolvedName;
      }
    }
  }

  const result: DutyChannelConfig[] = [];
  for (const item of channelMap.values()) {
    const defaultDesc = KNOWN_DUTY_DESCRIPTIONS[item.code];
    const pmsList = Array.from(item.pmsChannelNames);
    let desc = '';

    if (defaultDesc) {
      desc = defaultDesc;
    } else if (pmsList.length > 0) {
      desc = `已关联接收系统: ${pmsList.join('、')}`;
    } else {
      desc = `${item.name}业务协同自动化值守`;
    }

    result.push({
      code: item.code,
      name: item.name,
      desc,
      mappingCount: item.mappingCount,
      pmsChannelNames: pmsList,
    });
  }

  return result;
}
