import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HotelCollectionEngine } from '../../src/crawler/engine';
import { hotelCollectorRegistry } from '../../src/crawler/registry';
import { createPersistentBrowserSession } from '../../src/crawler/browserManager';
import type { ChannelHotelCollector } from '../../src/crawler/collectors/base';

vi.mock('../../src/crawler/browserManager', () => ({
  createPersistentBrowserSession: vi.fn(),
}));

describe('HotelCollectionEngine 渠道并发互斥与执行保护', () => {
  let engine: HotelCollectionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new HotelCollectionEngine();
  });

  it('未注册适配器的渠道采集请求应立即阻断并抛出异常', async () => {
    await expect(
      engine.collectHotels({ channelCode: 'UNREGISTERED_CHANNEL' })
    ).rejects.toThrow('渠道「UNREGISTERED_CHANNEL」暂未注册门店自动化采集适配器。');
  });

  it('同一渠道已在采集执行中时，重复调用必须阻断并抛出互斥异常', async () => {
    let resolveFirstSession: (value: unknown) => void;
    const sessionPromise = new Promise((resolve) => {
      resolveFirstSession = resolve;
    });

    const mockSession = {
      context: {} as never,
      page: {
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as never,
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createPersistentBrowserSession).mockImplementation(async () => {
      await sessionPromise;
      return mockSession;
    });

    const mockCollector: ChannelHotelCollector = {
      channelCode: 'MOCK_BUSY_CHANNEL',
      defaultTargetUrl: 'https://mock.test/hotels',
      resolveTargetUrl: (url) => url || 'https://mock.test/hotels',
      collect: vi.fn().mockResolvedValue([]),
    };
    hotelCollectorRegistry.register(mockCollector);

    // 发起第一个采集任务（保持 pending）
    const firstJobPromise = engine.collectHotels({
      channelCode: 'MOCK_BUSY_CHANNEL',
      headless: true,
    });

    expect(engine.isChannelActive('MOCK_BUSY_CHANNEL')).toBe(true);

    // 发起同渠道第二个并发采集任务，必须立即抛出互斥异常
    await expect(
      engine.collectHotels({
        channelCode: 'MOCK_BUSY_CHANNEL',
        headless: true,
      })
    ).rejects.toThrow('渠道「MOCK_BUSY_CHANNEL」门店采集任务正在执行中，请勿重复发起。');

    // 大小写不同但同渠道名同样应互斥
    await expect(
      engine.collectHotels({
        channelCode: 'mock_busy_channel',
        headless: true,
      })
    ).rejects.toThrow('渠道「MOCK_BUSY_CHANNEL」门店采集任务正在执行中，请勿重复发起。');

    // 释放第一个任务完成
    resolveFirstSession!(undefined);
    const firstResult = await firstJobPromise;
    expect(firstResult.success).toBe(true);

    // 任务完成后锁应被释放
    expect(engine.isChannelActive('MOCK_BUSY_CHANNEL')).toBe(false);

    // 再次发起采集任务应可正常执行
    const secondJob = await engine.collectHotels({
      channelCode: 'MOCK_BUSY_CHANNEL',
      headless: true,
    });
    expect(secondJob.success).toBe(true);
  });

  it('不同渠道之间的采集任务可以并发执行互不干扰', async () => {
    let resolveChannelA: () => void;
    let resolveChannelB: () => void;

    const promiseA = new Promise<void>((r) => { resolveChannelA = r; });
    const promiseB = new Promise<void>((r) => { resolveChannelB = r; });

    const mockSession = {
      context: {} as never,
      page: {
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as never,
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createPersistentBrowserSession).mockResolvedValue(mockSession);

    const collectorA: ChannelHotelCollector = {
      channelCode: 'CHANNEL_A',
      defaultTargetUrl: 'https://a.test',
      resolveTargetUrl: (u) => u || 'https://a.test',
      collect: async () => {
        await promiseA;
        return [];
      },
    };

    const collectorB: ChannelHotelCollector = {
      channelCode: 'CHANNEL_B',
      defaultTargetUrl: 'https://b.test',
      resolveTargetUrl: (u) => u || 'https://b.test',
      collect: async () => {
        await promiseB;
        return [];
      },
    };

    hotelCollectorRegistry.register(collectorA);
    hotelCollectorRegistry.register(collectorB);

    const taskA = engine.collectHotels({ channelCode: 'CHANNEL_A', headless: true });
    const taskB = engine.collectHotels({ channelCode: 'CHANNEL_B', headless: true });

    expect(engine.isChannelActive('CHANNEL_A')).toBe(true);
    expect(engine.isChannelActive('CHANNEL_B')).toBe(true);

    resolveChannelA!();
    resolveChannelB!();

    const [resA, resB] = await Promise.all([taskA, taskB]);
    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);

    expect(engine.isChannelActive('CHANNEL_A')).toBe(false);
    expect(engine.isChannelActive('CHANNEL_B')).toBe(false);
  });

  it('当采集过程发生异常时，finally 必须可靠释放渠道互斥锁', async () => {
    const mockSession = {
      context: {} as never,
      page: {
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as never,
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(createPersistentBrowserSession).mockResolvedValue(mockSession);

    const failingCollector: ChannelHotelCollector = {
      channelCode: 'CHANNEL_FAIL',
      defaultTargetUrl: 'https://fail.test',
      resolveTargetUrl: (u) => u || 'https://fail.test',
      collect: vi.fn().mockRejectedValue(new Error('网络请求严重超时')),
    };
    hotelCollectorRegistry.register(failingCollector);

    const result = await engine.collectHotels({ channelCode: 'CHANNEL_FAIL', headless: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('网络请求严重超时');

    // 锁必须已从 Set 中删除
    expect(engine.isChannelActive('CHANNEL_FAIL')).toBe(false);
    expect(mockSession.close).toHaveBeenCalledTimes(1);
  });
});
