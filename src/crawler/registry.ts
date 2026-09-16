import type { ChannelHotelCollector } from './collectors/base';
import { MeituanHotelCollector } from './collectors/meituan/meituanCollector';

class HotelCollectorRegistry {
  private collectors = new Map<string, ChannelHotelCollector>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    const meituanCollector = new MeituanHotelCollector();
    this.register(meituanCollector);

    // 美团商旅复用美团底层体系
    this.register({
      channelId: 'meituanbiz',
      channelCode: 'MEITUANBIZ',
      defaultTargetUrl: meituanCollector.defaultTargetUrl,
      resolveTargetUrl: (url) => meituanCollector.resolveTargetUrl(url),
      collect: (page, ctx, opts) => meituanCollector.collect(page, ctx, opts),
    });
  }

  public register(collector: ChannelHotelCollector): void {
    this.collectors.set(collector.channelId.toLowerCase(), collector);
  }

  public get(channelId: string): ChannelHotelCollector | null {
    if (!channelId) return null;
    return this.collectors.get(channelId.toLowerCase()) || null;
  }

  public getSupportedChannelIds(): string[] {
    return Array.from(this.collectors.keys());
  }
}

export const hotelCollectorRegistry = new HotelCollectorRegistry();
