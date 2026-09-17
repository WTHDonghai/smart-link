import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../src/store';
import {
  HotelSyncView,
  resolveChannelMeta,
  KNOWN_CHANNEL_METAS,
} from '../../src/components/hotels/HotelSyncView';
import {
  setSelectedCrawlChannel,
  setIsScraping,
  upsertDiscoveredHotels,
} from '../../src/store/slices/hotelSlice';
import type { DiscoveredHotelCandidate } from '../../src/crawler/types';

describe('resolveChannelMeta 渠道徽标解析引擎', () => {
  const mockConfiguredChannels = [
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
  ];

  it('准确将 MEITUAN 与 meituan 解析为美团徽标 [美]，绝非 OTA', () => {
    const metaFromCode = resolveChannelMeta(
      { otaChannelCode: 'MEITUAN', otaChannelId: 'meituan' },
      mockConfiguredChannels
    );
    expect(metaFromCode.short).toBe('美');
    expect(metaFromCode.name).toBe('美团');
    expect(metaFromCode.bgColor).toBe('bg-[#fff1e0]');
    expect(metaFromCode.textColor).toBe('text-[#ff7d00]');

    // 仅有 otaChannelCode
    const metaOnlyCode = resolveChannelMeta(
      { otaChannelCode: 'MEITUAN', otaChannelId: '' },
      mockConfiguredChannels
    );
    expect(metaOnlyCode.short).toBe('美');
  });

  it('准确将 MEITUAN_BIZ、meituanbiz 以及 meituan_biz 解析为美团商旅徽标 [商]，绝非 OTA', () => {
    // 典型后端返回格式：code: MEITUAN_BIZ, id: meituan_biz
    const metaWithUnderscore = resolveChannelMeta(
      { otaChannelCode: 'MEITUAN_BIZ', otaChannelId: 'meituan_biz' },
      mockConfiguredChannels
    );
    expect(metaWithUnderscore.short).toBe('商');
    expect(metaWithUnderscore.name).toBe('美团商旅');
    expect(metaWithUnderscore.bgColor).toBe('bg-[#eef2ff]');
    expect(metaWithUnderscore.textColor).toBe('text-[#004ac6]');

    // 无全局 channels 时仍能通过内置规则匹配美团商旅
    const metaFallback = resolveChannelMeta(
      { otaChannelCode: 'MEITUAN_BIZ', otaChannelId: '' },
      []
    );
    expect(metaFallback.short).toBe('商');
    expect(metaFallback.name).toBe('美团商旅');
    expect(metaFallback).toEqual(KNOWN_CHANNEL_METAS.meituanbiz);
  });

  it('准确识别抖音、携程、同程等主流渠道徽标', () => {
    expect(resolveChannelMeta({ otaChannelCode: 'DOUYIN', otaChannelId: 'douyin' }).short).toBe('抖');
    expect(resolveChannelMeta({ otaChannelCode: 'CTRIP', otaChannelId: 'ctrip' }).short).toBe('携');
    expect(resolveChannelMeta({ otaChannelCode: 'TONGCHENG', otaChannelId: 'tongcheng' }).short).toBe('同');
  });
});

describe('HotelSyncView 渠道选择与采集按钮强联动交互', () => {
  it('默认未选择渠道时：采集按钮禁用置灰，文案显示为「请先选择采集渠道」', () => {
    const store = createAppStore();
    // 确保初始状态为空
    expect(store.getState().hotel.selectedCrawlChannel).toBe('');

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <HotelSyncView />
      </Provider>
    );

    // 采集按钮必须包含禁用属性与自解释文案
    expect(html).toContain('请先选择采集渠道');
    expect(html).toContain('disabled=""');
    expect(html).toContain('bg-[#f1f5f9]');
    expect(html).toContain('border-[#e2e8f0]');
    // 确保已彻底移除冗余的状态说明
    expect(html).not.toContain('已就绪');
    expect(html).not.toContain('提示：请先选择目标渠道');
  });

  it('选中美团渠道后：采集按钮变为激活状态，文案动态切换为「启动「美团」门店采集」', () => {
    const store = createAppStore();
    store.dispatch(setSelectedCrawlChannel('meituan'));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <HotelSyncView />
      </Provider>
    );

    expect(html).toContain('启动「美团」门店采集');
    // 按钮应处于主色激活样式，而非置灰引导态
    expect(html).toContain('bg-[#004ac6]');
    expect(html).toContain('title="点击立即启动「美团」门店采集"');
    expect(html).not.toContain('title="请先在左侧选择要采集的渠道"');
    expect(html).not.toContain('已就绪');
  });

  it('选中美团商旅渠道后：文案动态切换为「启动「美团商旅」门店采集」', () => {
    const store = createAppStore();
    store.dispatch(setSelectedCrawlChannel('meituanbiz'));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <HotelSyncView />
      </Provider>
    );

    expect(html).toContain('启动「美团商旅」门店采集');
    expect(html).not.toContain('已就绪');
  });

  it('采集中状态时：按钮禁用并展示转圈 Loading 与「正在采集「美团」门店...」', () => {
    const store = createAppStore();
    store.dispatch(setSelectedCrawlChannel('meituan'));
    store.dispatch(setIsScraping(true));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <HotelSyncView />
      </Provider>
    );

    expect(html).toContain('正在采集「美团」门店...');
    expect(html).toContain('animate-spin');
    expect(html).toContain('disabled=""');
  });

  it('表格行中的美团和美团商旅门店必须呈现专属徽标 [美] 和 [商]，绝不降级为 OTA', () => {
    const store = createAppStore();
    const mockHotels: DiscoveredHotelCandidate[] = [
      {
        otaChannelId: 'meituan',
        otaChannelCode: 'MEITUAN',
        otaHotelId: 'mt-001',
        otaHotelName: '美团测试酒店',
        source: 'collector-meituan',
      },
      {
        otaChannelId: 'meituan_biz',
        otaChannelCode: 'MEITUAN_BIZ',
        otaHotelId: 'mtbiz-002',
        otaHotelName: '美团商旅签约酒店',
        source: 'collector-meituanbiz',
      },
    ];

    store.dispatch(upsertDiscoveredHotels(mockHotels));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <HotelSyncView />
      </Provider>
    );

    // 美团徽标断言
    expect(html).toContain('美团测试酒店');
    expect(html).toContain('title="美团"');
    expect(html).toContain('>美</div>');

    // 美团商旅徽标断言
    expect(html).toContain('美团商旅签约酒店');
    expect(html).toContain('title="美团商旅"');
    expect(html).toContain('>商</div>');

    // 严密断言：不存在 OTA 徽标
    expect(html).not.toContain('>OTA</div>');
  });
});
