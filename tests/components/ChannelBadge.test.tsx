import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChannelBadge } from '../../src/components/common/ChannelBadge';

describe('ChannelBadge 渠道图徽通用组件', () => {
  it('正确渲染美团渠道图徽 [美] 与暖橙色样式', () => {
    const html = renderToStaticMarkup(
      <ChannelBadge channel={{ otaChannelCode: 'MEITUAN' }} size="sm" />
    );

    expect(html).toContain('>美</div>');
    expect(html).toContain('bg-[#fff1e0]');
    expect(html).toContain('text-[#ff7d00]');
    expect(html).toContain('title="美团"');
    expect(html).toContain('aria-label="美团"');
  });

  it('正确渲染美团商旅渠道图徽 [商] 与科技蓝样式，绝非 OTA', () => {
    const html = renderToStaticMarkup(
      <ChannelBadge channel={{ otaChannelId: 'meituan_biz' }} size="sm" />
    );

    expect(html).toContain('>商</div>');
    expect(html).toContain('bg-[#eef2ff]');
    expect(html).toContain('text-[#004ac6]');
    expect(html).toContain('title="美团商旅"');
    expect(html).not.toContain('>OTA</div>');
  });

  it('支持传入不同的尺寸规格 (xs, sm, md, lg)', () => {
    const htmlXs = renderToStaticMarkup(<ChannelBadge channelCode="MEITUAN" size="xs" />);
    expect(htmlXs).toContain('w-6 h-6');
    expect(htmlXs).toContain('text-[11px]');

    const htmlSm = renderToStaticMarkup(<ChannelBadge channelCode="MEITUAN" size="sm" />);
    expect(htmlSm).toContain('w-7 h-7');
    expect(htmlSm).toContain('text-xs');

    const htmlMd = renderToStaticMarkup(<ChannelBadge channelCode="MEITUAN" size="md" />);
    expect(htmlMd).toContain('w-8 h-8');
    expect(htmlMd).toContain('text-sm');

    const htmlLg = renderToStaticMarkup(<ChannelBadge channelCode="MEITUAN" size="lg" />);
    expect(htmlLg).toContain('w-9 h-9');
    expect(htmlLg).toContain('text-sm');
  });

  it('支持直接通过 channelCode 或 channelId 渲染', () => {
    const html = renderToStaticMarkup(<ChannelBadge channelCode="DOUYIN" />);
    expect(html).toContain('>抖</div>');
    expect(html).toContain('title="抖音"');
  });

  it('当 showTooltip 为 false 时不输出 title 属性', () => {
    const html = renderToStaticMarkup(<ChannelBadge channelCode="CTRIP" showTooltip={false} />);
    expect(html).toContain('>携</div>');
    expect(html).not.toContain('title=');
  });
});
