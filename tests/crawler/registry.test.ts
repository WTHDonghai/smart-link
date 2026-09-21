import { describe, it, expect } from 'vitest';
import { hotelCollectorRegistry, productCollectorRegistry } from '../../src/crawler/registry';
import type { ChannelHotelCollector, ChannelProductCollector } from '../../src/crawler/collectors/base';

describe('hotelCollectorRegistry', () => {
  it('registers MEITUAN and MEITUAN_BIZ by default', () => {
    const meituan = hotelCollectorRegistry.get('MEITUAN');
    expect(meituan).not.toBeNull();
    expect(meituan?.channelCode).toBe('MEITUAN');
    expect(meituan?.defaultTargetUrl).toContain('me.meituan.com');

    const meituanbiz = hotelCollectorRegistry.get('MEITUAN_BIZ');
    expect(meituanbiz).not.toBeNull();
    expect(meituanbiz?.channelCode).toBe('MEITUAN_BIZ');
  });

  it('is case-insensitive when querying channels', () => {
    const collector = hotelCollectorRegistry.get('MeiTuan');
    expect(collector).not.toBeNull();
    expect(collector?.channelCode).toBe('MEITUAN');
  });

  it('returns null for unregistered channel', () => {
    const collector = hotelCollectorRegistry.get('unregistered_ota');
    expect(collector).toBeNull();
  });

  it('allows registering a new channel collector dynamically', () => {
    const mockCollector: ChannelHotelCollector = {
      channelCode: 'MOCK_CHANNEL',
      defaultTargetUrl: 'https://mock.ota.com/hotels',
      resolveTargetUrl: (url) => url || 'https://mock.ota.com/hotels',
      collect: async () => [],
    };

    hotelCollectorRegistry.register(mockCollector);

    const retrieved = hotelCollectorRegistry.get('MOCK_CHANNEL');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.channelCode).toBe('MOCK_CHANNEL');
    expect(retrieved?.defaultTargetUrl).toBe('https://mock.ota.com/hotels');
  });

  it('returns supported channel codes list dynamically', () => {
    const codes = hotelCollectorRegistry.getSupportedChannelCodes();
    expect(codes).toContain('MEITUAN');
    expect(codes).toContain('MEITUAN_BIZ');
    expect(codes).toContain('MOCK_CHANNEL');
  });
});

describe('productCollectorRegistry', () => {
  it('registers MEITUAN, MEITUAN_BIZ, and DOUYIN by default', () => {
    const meituan = productCollectorRegistry.get('MEITUAN');
    expect(meituan).not.toBeNull();
    expect(meituan?.channelCode).toBe('MEITUAN');

    const meituanbiz = productCollectorRegistry.get('MEITUAN_BIZ');
    expect(meituanbiz).not.toBeNull();
    expect(meituanbiz?.channelCode).toBe('MEITUAN_BIZ');

    const douyin = productCollectorRegistry.get('DOUYIN');
    expect(douyin).not.toBeNull();
    expect(douyin?.channelCode).toBe('DOUYIN');

    const dy = productCollectorRegistry.get('DY');
    expect(dy).not.toBeNull();
    expect(dy?.channelCode).toBe('DOUYIN');
  });

  it('is case-insensitive when querying product collectors', () => {
    const douyin = productCollectorRegistry.get('DouYin');
    expect(douyin).not.toBeNull();
    expect(douyin?.channelCode).toBe('DOUYIN');
  });

  it('returns null for unregistered channel', () => {
    const collector = productCollectorRegistry.get('unknown_ota');
    expect(collector).toBeNull();
  });

  it('allows registering a new product collector dynamically', () => {
    const mockCollector: ChannelProductCollector = {
      channelCode: 'MOCK_PRODUCT_CHANNEL',
      resolveTargetUrl: () => 'https://mock.ota.com/products',
      collect: async () => [],
    };

    productCollectorRegistry.register(mockCollector);

    const retrieved = productCollectorRegistry.get('MOCK_PRODUCT_CHANNEL');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.channelCode).toBe('MOCK_PRODUCT_CHANNEL');
  });
});

