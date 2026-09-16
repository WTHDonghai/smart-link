import { describe, it, expect } from 'vitest';
import { hotelCollectorRegistry } from '../../src/crawler/registry';
import type { ChannelHotelCollector } from '../../src/crawler/collectors/base';

describe('hotelCollectorRegistry', () => {
  it('registers meituan and meituanbiz by default', () => {
    const meituan = hotelCollectorRegistry.get('meituan');
    expect(meituan).not.toBeNull();
    expect(meituan?.channelId).toBe('meituan');
    expect(meituan?.channelCode).toBe('MEITUAN');
    expect(meituan?.defaultTargetUrl).toContain('me.meituan.com');

    const meituanbiz = hotelCollectorRegistry.get('meituanbiz');
    expect(meituanbiz).not.toBeNull();
    expect(meituanbiz?.channelId).toBe('meituanbiz');
    expect(meituanbiz?.channelCode).toBe('MEITUANBIZ');
  });

  it('is case-insensitive when querying channels', () => {
    const collector = hotelCollectorRegistry.get('MeiTuan');
    expect(collector).not.toBeNull();
    expect(collector?.channelId).toBe('meituan');
  });

  it('returns null for unregistered channel', () => {
    const collector = hotelCollectorRegistry.get('unregistered_ota');
    expect(collector).toBeNull();
  });

  it('allows registering a new channel collector dynamically', () => {
    const mockCollector: ChannelHotelCollector = {
      channelId: 'mock_channel',
      channelCode: 'MOCK_CHANNEL',
      defaultTargetUrl: 'https://mock.ota.com/hotels',
      resolveTargetUrl: (url) => url || 'https://mock.ota.com/hotels',
      collect: async () => [],
    };

    hotelCollectorRegistry.register(mockCollector);

    const retrieved = hotelCollectorRegistry.get('mock_channel');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.channelId).toBe('mock_channel');
    expect(retrieved?.defaultTargetUrl).toBe('https://mock.ota.com/hotels');
  });

  it('returns supported channel IDs list', () => {
    const ids = hotelCollectorRegistry.getSupportedChannelIds();
    expect(ids).toContain('meituan');
    expect(ids).toContain('meituanbiz');
  });
});
