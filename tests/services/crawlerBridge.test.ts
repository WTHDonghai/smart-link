import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  collectHotelsByChannel,
  syncChromeProfileByChannel,
} from '../../src/services/crawlerBridge';
import type { HotelCrawlResult, HotelCrawlDiagnostics } from '../../src/crawler/types';

describe('crawlerBridge (collectHotelsByChannel)', () => {
  const originalFetch = global.fetch;

  const createMockDiagnostics = (durationMs = 2000): HotelCrawlDiagnostics => ({
    targetUrl: 'https://me.meituan.com/catalog',
    source: 'meituan-network-json',
    scannedCount: 1,
    discoveredCount: 1,
    verifiedEmpty: false,
    durationMs,
    warnings: [],
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it('当 channelCode 为空或全空格时，应直接抛出 Fail-Fast 异常', async () => {
    await expect(collectHotelsByChannel('')).rejects.toThrow('采集渠道编码 channelCode 不能为空');
    await expect(collectHotelsByChannel('   ')).rejects.toThrow('采集渠道编码 channelCode 不能为空');
  });

  describe('Electron 原生 IPC 分支', () => {
    it('当处于 Electron 环境且采集成功时，应优先调用 IPC 并返回全大写 channelCode', async () => {
      const mockIpcResult: HotelCrawlResult = {
        success: true,
        channelCode: 'MEITUAN',
        hotels: [
          {
            otaChannelId: 'MEITUAN',
            otaChannelCode: 'MEITUAN',
            otaHotelId: 'POI-1001',
            otaHotelName: '杭州西湖国宾馆',
            city: '杭州',
            source: 'meituan-network-json',
          },
        ],
        diagnostics: createMockDiagnostics(2500),
      };

      const collectHotelsMock = vi.fn().mockResolvedValue(mockIpcResult);

      (window as unknown as { electron: { crawler: { collectHotels: typeof collectHotelsMock } } }).electron = {
        crawler: {
          collectHotels: collectHotelsMock,
        },
      };

      const result = await collectHotelsByChannel('meituan', { headless: true });

      expect(collectHotelsMock).toHaveBeenCalledTimes(1);
      expect(collectHotelsMock).toHaveBeenCalledWith({
        channelCode: 'MEITUAN',
        headless: true,
      });

      expect(result.success).toBe(true);
      expect(result.channelCode).toBe('MEITUAN');
      expect(result.hotels).toHaveLength(1);
      expect(result.hotels[0].otaHotelId).toBe('POI-1001');
    });

    it('当处于 Electron 环境但采集失败 (success: false) 时，必须 Fail-Fast 抛出错误', async () => {
      const mockFailedIpcResult: HotelCrawlResult = {
        success: false,
        channelCode: 'MEITUAN',
        error: '美团商家账号登录态已过期，请重新登录',
        hotels: [],
        diagnostics: createMockDiagnostics(800),
      };

      const collectHotelsMock = vi.fn().mockResolvedValue(mockFailedIpcResult);

      (window as unknown as { electron: { crawler: { collectHotels: typeof collectHotelsMock } } }).electron = {
        crawler: {
          collectHotels: collectHotelsMock,
        },
      };

      await expect(collectHotelsByChannel('MEITUAN')).rejects.toThrow(
        '美团商家账号登录态已过期，请重新登录'
      );
    });

    it('当 IPC 返回失败且未附带具体 error 字符串时，应使用标准兜底报错文案抛出', async () => {
      const mockFailedIpcResult: HotelCrawlResult = {
        success: false,
        channelCode: 'CTRIP',
        hotels: [],
        diagnostics: createMockDiagnostics(500),
      };

      const collectHotelsMock = vi.fn().mockResolvedValue(mockFailedIpcResult);

      (window as unknown as { electron: { crawler: { collectHotels: typeof collectHotelsMock } } }).electron = {
        crawler: {
          collectHotels: collectHotelsMock,
        },
      };

      await expect(collectHotelsByChannel('ctrip')).rejects.toThrow('「CTRIP」渠道采集失败');
    });
  });

  describe('Web / HTTP 分支回退', () => {
    it('当无 window.electron 上下文时，应自动平滑回退走本地 HTTP 接口', async () => {
      const mockApiResponse = {
        success: true,
        channelCode: 'MEITUAN_BIZ',
        hotels: [
          {
            otaChannelId: 'MEITUAN_BIZ',
            otaChannelCode: 'MEITUAN_BIZ',
            otaHotelId: 'MT-BIZ-01',
            otaHotelName: '上海静安香格里拉大酒店',
            city: '上海',
            source: 'meituan-network-json',
          },
        ],
        diagnostics: createMockDiagnostics(1800),
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });
      global.fetch = fetchMock;

      const result = await collectHotelsByChannel(' meituan_biz ', { waitMs: 3000 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, requestOptions] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/crawler/hotels/collect');
      expect(requestOptions.method).toBe('POST');

      const parsedBody = JSON.parse(requestOptions.body as string);
      expect(parsedBody.channelCode).toBe('MEITUAN_BIZ');
      expect(parsedBody.waitMs).toBe(3000);

      expect(result.success).toBe(true);
      expect(result.channelCode).toBe('MEITUAN_BIZ');
      expect(result.hotels).toHaveLength(1);
    });

    it('当 HTTP 接口返回错误状态码或业务失败时，应如实抛出错误', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          error: '网关内部错误：浏览器进程崩溃',
        }),
      });
      global.fetch = fetchMock;

      await expect(collectHotelsByChannel('MEITUAN')).rejects.toThrow(
        '网关内部错误：浏览器进程崩溃'
      );
    });
  });

  describe('syncChromeProfileByChannel', () => {
    it('在 Electron 原生环境下应优先通过 IPC 执行并返回同步数据', async () => {
      const mockSyncResult = {
        success: true,
        sourceDir: '/Users/test/Chrome/Default',
        sourceProfile: 'Default',
        targetDir: '/Users/test/.chrome-profile/meituan',
        message: '同步成功',
      };

      const syncProfileMock = vi.fn().mockResolvedValue(mockSyncResult);

      (window as unknown as { electron: { crawler: { syncProfile: typeof syncProfileMock } } }).electron = {
        crawler: {
          syncProfile: syncProfileMock,
        },
      };

      const result = await syncChromeProfileByChannel('meituan');

      expect(syncProfileMock).toHaveBeenCalledTimes(1);
      expect(syncProfileMock).toHaveBeenCalledWith('MEITUAN');
      expect(result.success).toBe(true);
      expect(result.sourceProfile).toBe('Default');
    });

    it('在 Electron 原生环境下若同步失败，必须 Fail-Fast 抛出错误', async () => {
      const mockFailedResult = {
        success: false,
        message: '未在系统 Chrome 中找到配置文件 Local State',
      };

      const syncProfileMock = vi.fn().mockResolvedValue(mockFailedResult);

      (window as unknown as { electron: { crawler: { syncProfile: typeof syncProfileMock } } }).electron = {
        crawler: {
          syncProfile: syncProfileMock,
        },
      };

      await expect(syncChromeProfileByChannel('MEITUAN')).rejects.toThrow(
        '未在系统 Chrome 中找到配置文件 Local State'
      );
    });

    it('在 Web 纯浏览器环境下应平滑回退走 HTTP POST /api/crawler/profile/sync', async () => {
      const mockApiResponse = {
        success: true,
        data: {
          success: true,
          sourceDir: '/Users/test/Chrome/Default',
          sourceProfile: 'Default',
          targetDir: '/Users/test/.chrome-profile/meituan',
          message: 'HTTP 同步成功',
        },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });
      global.fetch = fetchMock;

      const result = await syncChromeProfileByChannel(' meituan ');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, requestOptions] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/crawler/profile/sync');
      expect(requestOptions.method).toBe('POST');

      const parsedBody = JSON.parse(requestOptions.body as string);
      expect(parsedBody.channelCode).toBe('MEITUAN');
      expect(result.message).toBe('HTTP 同步成功');
    });
  });
});
