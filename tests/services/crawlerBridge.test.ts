import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectHotelsByChannel,
  syncChromeProfileByChannel,
} from '../../src/services/crawlerBridge';
import type { HotelCrawlResult } from '../../src/crawler/types';

const hostWindow = window as unknown as { host?: { crawler?: unknown } };

afterEach(() => {
  delete hostWindow.host;
  vi.restoreAllMocks();
});

describe('crawlerBridge', () => {
  it('requires the desktop crawler API', async () => {
    delete hostWindow.host;
    await expect(collectHotelsByChannel('MEITUAN')).rejects.toThrow(
      '门店采集仅支持桌面端'
    );
    await expect(syncChromeProfileByChannel()).rejects.toThrow(
      '门店采集仅支持桌面端'
    );
  });

  it('collects through IPC and normalizes the channel code', async () => {
    const collectHotels = vi.fn().mockResolvedValue({
      success: true,
      channelCode: 'MEITUAN',
      hotels: [],
    });
    hostWindow.host = { crawler: { collectHotels } };

    const result = await collectHotelsByChannel('meituan', { headless: true });

    expect(collectHotels).toHaveBeenCalledWith({
      channelCode: 'MEITUAN',
      headless: true,
    });
    expect(result.channelCode).toBe('MEITUAN');
  });

  it('fails fast when IPC reports a failed crawl', async () => {
    const failedResult: HotelCrawlResult = {
      success: false,
      channelCode: 'MEITUAN',
      hotels: [],
      error: '登录态已过期',
      diagnostics: {
        targetUrl: 'https://me.meituan.com/catalog',
        source: 'meituan-network-json',
        scannedCount: 0,
        discoveredCount: 0,
        verifiedEmpty: true,
        durationMs: 0,
        warnings: [],
      },
    };
    hostWindow.host = { crawler: { collectHotels: vi.fn().mockResolvedValue(failedResult) } };

    await expect(collectHotelsByChannel('MEITUAN')).rejects.toThrow('登录态已过期');
  });

  it('syncs the Chrome profile through IPC', async () => {
    const syncProfile = vi.fn().mockResolvedValue({
      success: true,
      sourceDir: '/Chrome/Default',
      sourceProfile: 'Default',
      targetDir: '/SmartLink/Meitu',
      message: 'ok',
    });
    hostWindow.host = { crawler: { syncProfile } };

    const result = await syncChromeProfileByChannel('meituan');

    expect(syncProfile).toHaveBeenCalledWith('MEITUAN');
    expect(result.success).toBe(true);
  });
});
