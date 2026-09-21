import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectHotelsByChannel,
  syncChromeProfileByChannel,
  collectProductsByHotel,
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
      '自动化采集功能仅支持桌面端'
    );
    await expect(syncChromeProfileByChannel()).rejects.toThrow(
      '自动化采集功能仅支持桌面端'
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

  describe('collectProductsByHotel', () => {
    it('缺少 channelCode 时快速失败抛错', async () => {
      hostWindow.host = { crawler: { collectProducts: vi.fn() } };
      await expect(
        collectProductsByHotel({ channelCode: '', extUnitCode: 'POI-1' })
      ).rejects.toThrow('采集渠道编码 channelCode 不能为空');
    });

    it('缺少 extUnitCode 时快速失败抛错', async () => {
      hostWindow.host = { crawler: { collectProducts: vi.fn() } };
      await expect(
        collectProductsByHotel({ channelCode: 'MEITUAN', extUnitCode: '   ' })
      ).rejects.toThrow('产品采集缺少外部门店编码 extUnitCode');
    });

    it('IPC 返回失败时快速抛出包含错误原因的异常', async () => {
      const failedResult = {
        success: false,
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-1',
        products: [],
        error: '美团账号未具备此门店产品管理权限',
      };
      hostWindow.host = {
        crawler: { collectProducts: vi.fn().mockResolvedValue(failedResult) },
      };

      await expect(
        collectProductsByHotel({ channelCode: 'MEITUAN', extUnitCode: 'POI-1' })
      ).rejects.toThrow('美团账号未具备此门店产品管理权限');
    });

    it('正常传参时规范化渠道名并正确返回结果', async () => {
      const mockProducts = [
        {
          otaChannelCode: 'MEITUAN',
          extUnitCode: 'POI-1',
          otaRoomTypeId: 'G-100',
          otaRoomTypeName: '特惠大床房',
        },
      ];
      const collectProducts = vi.fn().mockResolvedValue({
        success: true,
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-1',
        products: mockProducts,
      });
      hostWindow.host = { crawler: { collectProducts } };

      const result = await collectProductsByHotel({
        channelCode: 'meituan',
        extUnitCode: 'POI-1',
        headless: true,
      });

      expect(collectProducts).toHaveBeenCalledWith({
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-1',
        headless: true,
      });
      expect(result.success).toBe(true);
      expect(result.products).toEqual(mockProducts);
    });
  });
});
