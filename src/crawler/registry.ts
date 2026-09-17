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

    // 美团商旅复用美团底层体系 (支持 MEITUAN_BIZ 及 MEITUANBIZ)
    const meituanBizCollector: ChannelHotelCollector = {
      channelCode: 'MEITUAN_BIZ',
      defaultTargetUrl: meituanCollector.defaultTargetUrl,
      resolveTargetUrl: (url) => meituanCollector.resolveTargetUrl(url),
      collect: (page, ctx, opts) => meituanCollector.collect(page, ctx, opts),
    };
    this.register(meituanBizCollector);
    // 兼容 MEITUANBIZ 无下划线大写形式
    this.collectors.set('MEITUANBIZ', meituanBizCollector);
  }

  public register(collector: ChannelHotelCollector): void {
    const code = collector.channelCode.trim().toUpperCase();
    this.collectors.set(code, collector);
  }

  public get(channelCode: string): ChannelHotelCollector | null {
    if (!channelCode) return null;
    const cleanCode = channelCode.trim().toUpperCase();
    return this.collectors.get(cleanCode) || this.collectors.get(cleanCode.replace(/[-_]/g, '')) || null;
  }

  public getSupportedChannelCodes(): string[] {
    return Array.from(new Set(Array.from(this.collectors.values()).map((c) => c.channelCode)));
  }

  public getSupportedChannelIds(): string[] {
    return this.getSupportedChannelCodes();
  }
}

export const hotelCollectorRegistry = new HotelCollectorRegistry();
