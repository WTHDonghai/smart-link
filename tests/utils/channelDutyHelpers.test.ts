import { describe, it, expect } from 'vitest';
import { deriveMappedDutyChannels } from '../../src/utils/channelDutyHelpers';
import type { OTAChannelMappingRecord } from '../../src/types';

describe('deriveMappedDutyChannels 渠道映射向值守配置派生工具测试', () => {
  it('当输入为 null, undefined 或空数组时返回空数组', () => {
    expect(deriveMappedDutyChannels(null)).toEqual([]);
    expect(deriveMappedDutyChannels(undefined)).toEqual([]);
    expect(deriveMappedDutyChannels([])).toEqual([]);
  });

  it('正常解析单一映射，并填充已知业务描述与渠道元数据', () => {
    const mappings: OTAChannelMappingRecord[] = [
      {
        id: 'map-1',
        mappingId: 'map-1',
        otaChannelCode: 'MEITUAN',
        otaChannelName: '美团酒店',
        channelId: 'pms-1',
        channelCode: 'MT_DIRECT',
        channelName: '美团直连',
        status: 'A',
      },
    ];

    const result = deriveMappedDutyChannels(mappings);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      code: 'MEITUAN',
      name: '美团酒店',
      desc: '美团待处理订单自动发现与导入',
      mappingCount: 1,
      pmsChannelNames: ['美团直连'],
    });
  });

  it('支持多个渠道，并过滤 status 为 "I" 的无效记录', () => {
    const mappings: OTAChannelMappingRecord[] = [
      {
        id: 'map-1',
        mappingId: 'map-1',
        otaChannelCode: 'MEITUAN',
        otaChannelName: '美团酒店',
        channelId: 'pms-1',
        channelCode: 'MT_DIRECT',
        channelName: '美团直连',
        status: 'A',
      },
      {
        id: 'map-2',
        mappingId: 'map-2',
        otaChannelCode: 'CTRIP',
        otaChannelName: '携程旅行',
        channelId: 'pms-2',
        channelCode: 'CT_PMS',
        channelName: '携程通道',
        status: 'I', // 应该被过滤
      },
      {
        id: 'map-3',
        mappingId: 'map-3',
        otaChannelCode: 'DOUYIN',
        otaChannelName: '抖音生活服务',
        channelId: 'pms-3',
        channelCode: 'DY_PMS',
        channelName: '抖音通道',
        status: 'A',
      },
    ];

    const result = deriveMappedDutyChannels(mappings);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.code)).toEqual(['MEITUAN', 'DOUYIN']);
    expect(result[1].desc).toBe('抖音新订/退款订单业务协同值守');
  });

  it('对同一 OTA 渠道的多条不同映射进行去重聚合，并统计 mappingCount 与关联的接收系统', () => {
    const mappings: OTAChannelMappingRecord[] = [
      {
        id: 'map-1',
        mappingId: 'map-1',
        otaChannelCode: 'MEITUAN',
        otaChannelName: '美团酒店',
        channelId: 'pms-1',
        channelCode: 'MT_ROOM1',
        channelName: '美团客房部',
        status: 'A',
      },
      {
        id: 'map-2',
        mappingId: 'map-2',
        otaChannelCode: 'MEITUAN',
        otaChannelName: '美团酒店',
        channelId: 'pms-2',
        channelCode: 'MT_VIP',
        channelName: '美团VIP渠道',
        status: 'A',
      },
    ];

    const result = deriveMappedDutyChannels(mappings);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('MEITUAN');
    expect(result[0].mappingCount).toBe(2);
    expect(result[0].pmsChannelNames).toEqual(['美团客房部', '美团VIP渠道']);
  });

  it('未知渠道但合法时，自动生成包含关联接收系统的描述', () => {
    const mappings: OTAChannelMappingRecord[] = [
      {
        id: 'map-x',
        mappingId: 'map-x',
        otaChannelCode: 'CUSTOM_OTA',
        otaChannelName: '自建海外渠道',
        channelId: 'pms-99',
        channelCode: 'OVERSEAS_01',
        channelName: '海外系统01',
        status: 'A',
      },
    ];

    const result = deriveMappedDutyChannels(mappings);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('CUSTOM_OTA');
    expect(result[0].name).toBe('自建海外渠道');
    expect(result[0].desc).toBe('已关联接收系统: 海外系统01');
  });
});
