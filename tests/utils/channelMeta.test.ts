import { describe, it, expect } from 'vitest';
import {
  resolveChannelMeta,
  KNOWN_CHANNEL_METAS,
  type ChannelCandidate,
} from '../../src/utils/channelMeta';

describe('resolveChannelMeta 统一渠道图徽与元数据解析纯函数', () => {
  const mockConfiguredChannels: ChannelCandidate[] = [
    {
      id: 'meituan',
      name: '美团',
      code: 'MEITUAN',
      short: '美',
      bgColor: 'bg-[#fff1e0]',
      textColor: 'text-[#ff7d00]',
    },
    {
      id: 'meituanbiz',
      name: '美团商旅',
      code: 'MEITUAN_BIZ',
      short: '商',
      bgColor: 'bg-[#eef2ff]',
      textColor: 'text-[#004ac6]',
    },
    {
      id: 'custom_dy',
      name: '定制抖音',
      code: 'DOUYIN_CUSTOM',
      short: '音',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-700',
    },
  ];

  it('空输入或 undefined 时返回默认安全 OTA 占位元数据', () => {
    const emptyMeta = resolveChannelMeta(null);
    expect(emptyMeta.short).toBe('OTA');
    expect(emptyMeta.name).toBe('OTA');
    expect(emptyMeta.bgColor).toBe('bg-blue-100');
    expect(emptyMeta.textColor).toBe('text-blue-700');

    const undefinedMeta = resolveChannelMeta(undefined);
    expect(undefinedMeta.short).toBe('OTA');
  });

  it('如果对象自身已具备合法短名与配色，优先复用自身定义', () => {
    const selfMeta = resolveChannelMeta({
      name: '自营渠道',
      short: '营',
      bgColor: 'bg-emerald-100',
      textColor: 'text-emerald-700',
    });

    expect(selfMeta.short).toBe('营');
    expect(selfMeta.name).toBe('自营渠道');
    expect(selfMeta.bgColor).toBe('bg-emerald-100');
    expect(selfMeta.textColor).toBe('text-emerald-700');
  });

  it('优先从已配置 channels 列表中精确匹配', () => {
    const matched = resolveChannelMeta(
      { otaChannelId: 'meituan', otaChannelCode: 'MEITUAN' },
      mockConfiguredChannels
    );

    expect(matched.short).toBe('美');
    expect(matched.name).toBe('美团');
    expect(matched.bgColor).toBe('bg-[#fff1e0]');
    expect(matched.textColor).toBe('text-[#ff7d00]');
  });

  it('支持传入纯字符串渠道代码或渠道 ID', () => {
    const fromStringCode = resolveChannelMeta('MEITUAN', mockConfiguredChannels);
    expect(fromStringCode.short).toBe('美');

    const fromStringBiz = resolveChannelMeta('MEITUAN_BIZ', mockConfiguredChannels);
    expect(fromStringBiz.short).toBe('商');
  });

  it('针对带有破折号/下划线的 ID/CODE 进行归一化模糊匹配', () => {
    // meituan_biz 匹配 meituanbiz
    const matchedWithUnderscore = resolveChannelMeta(
      { otaChannelId: 'meituan_biz' },
      mockConfiguredChannels
    );
    expect(matchedWithUnderscore.short).toBe('商');
    expect(matchedWithUnderscore.name).toBe('美团商旅');

    // DOUYIN-CUSTOM 匹配 DOUYIN_CUSTOM
    const matchedCustom = resolveChannelMeta(
      { otaChannelCode: 'DOUYIN-CUSTOM' },
      mockConfiguredChannels
    );
    expect(matchedCustom.short).toBe('音');
    expect(matchedCustom.bgColor).toBe('bg-purple-100');
  });

  it('在无配置渠道列表时，内置规则能够 100% 正确解析美团与美团商旅，绝不显示为 OTA', () => {
    const mt = resolveChannelMeta({ otaChannelCode: 'MEITUAN' });
    expect(mt.short).toBe('美');
    expect(mt.name).toBe('美团');
    expect(mt.bgColor).toBe('bg-[#fff1e0]');
    expect(mt.textColor).toBe('text-[#ff7d00]');

    const mtBiz = resolveChannelMeta({ otaChannelCode: 'MEITUAN_BIZ' });
    expect(mtBiz.short).toBe('商');
    expect(mtBiz.name).toBe('美团商旅');
    expect(mtBiz.bgColor).toBe('bg-[#eef2ff]');
    expect(mtBiz.textColor).toBe('text-[#004ac6]');
    expect(mtBiz).toEqual(KNOWN_CHANNEL_METAS.meituanbiz);
  });

  it('内置规则覆盖抖音、携程、同程、飞猪、去哪儿、小红书等主流渠道', () => {
    expect(resolveChannelMeta({ otaChannelCode: 'DOUYIN' }).short).toBe('抖');
    expect(resolveChannelMeta({ otaChannelCode: 'CTRIP' }).short).toBe('携');
    expect(resolveChannelMeta({ otaChannelCode: 'TONGCHENG' }).short).toBe('同');
    expect(resolveChannelMeta({ otaChannelCode: 'FLIGGY' }).short).toBe('猪');
    expect(resolveChannelMeta({ otaChannelCode: 'QUNAR' }).short).toBe('去');
    expect(resolveChannelMeta({ otaChannelCode: 'XIAOHONGSHU' }).short).toBe('红');
  });

  it('完全未知的渠道回退为截取代码前两位，不报错崩溃', () => {
    const unknownMeta = resolveChannelMeta({ otaChannelCode: 'AIRBNB' });
    expect(unknownMeta.short).toBe('AI');
    expect(unknownMeta.name).toBe('AIRBNB');
    expect(unknownMeta.bgColor).toBe('bg-blue-100');
    expect(unknownMeta.textColor).toBe('text-blue-700');
  });
});
