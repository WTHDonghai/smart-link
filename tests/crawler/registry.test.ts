import { describe, it, expect } from 'vitest';
import { hotelCollectorRegistry } from '../../src/crawler/registry';
import type { ChannelHotelCollector } from '../../src/crawler/collectors/base';

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
