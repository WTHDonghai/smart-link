import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext, Response } from 'playwright';
import {
  DouyinSaleProductCollector,
  DOUYIN_SALE_PRODUCT_PAGE_URL,
} from '../../src/crawler/collectors/douyin/douyinSaleProductCollector';
import type { ProductCrawlRequest, CollectorLogPayload } from '../../src/crawler/types';

describe('DouyinSaleProductCollector (预售房型快照采集器)', () => {
  let collector: DouyinSaleProductCollector;

  beforeEach(() => {
    collector = new DouyinSaleProductCollector();
  });

  describe('resolveTargetUrl 目标地址规范化', () => {
    it('在未提供自定义地址时，返回默认预售房型地址', () => {
      const url = collector.resolveTargetUrl();
      expect(url).toBe(DOUYIN_SALE_PRODUCT_PAGE_URL);
    });

    it('将传入的带参数 URL 规范化为预售房型干净路径', () => {
      const url = collector.resolveTargetUrl('https://life.douyin.com/p/goods-list?groupid=123#frag');
      expect(url).toBe('https://life.douyin.com/p/travel-goods/hotel/saleproduct/list');
    });

    it('当传入非法 URL 时，应抛出错误', () => {
      expect(() => collector.resolveTargetUrl('bad-protocol://invalid address')).toThrow(
        '非法的抖音预售房型目标地址'
      );
    });
  });

  describe('collect 页面导航与接口拦截', () => {
    it('成功拦截预售房型接口并返回规范化绑定快照', async () => {
      let registeredResponseHandler: ((response: Response) => Promise<void>) | null = null;

      const mockResponse = {
        url: () => 'https://life.douyin.com/life/hotel/query_sale_product',
        ok: () => true,
        text: async () =>
          JSON.stringify({
            status_code: 0,
            status_msg: 'success',
            sale_product_group: [
              {
                product_list: [
                  {
                    sku_id: 'SKU-001',
                    physical_room_id: 'PHYS-001',
                    physical_room_name: '高级商务大床房',
                    sale_product_id: 'SP-001',
                    sale_product_name: '预售单晚含早大床房',
                  },
                ],
              },
            ],
          }),
      } as unknown as Response;

      const mockPage = {
        url: () => DOUYIN_SALE_PRODUCT_PAGE_URL,
        on: vi.fn((event: string, handler: (r: Response) => Promise<void>) => {
          if (event === 'response') {
            registeredResponseHandler = handler;
          }
        }),
        off: vi.fn(),
        goto: vi.fn().mockImplementation(async () => {
          if (registeredResponseHandler) {
            await registeredResponseHandler(mockResponse);
          }
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const logs: CollectorLogPayload[] = [];
      const request: ProductCrawlRequest = {
        channelCode: 'DOUYIN',
        extUnitCode: 'LA-8888',
        otaHotelName: '测试酒店',
        waitMs: 10,
      };

      const result = await collector.collect(mockPage, {} as BrowserContext, request, {
        onLog: (l) => logs.push(l),
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        skuId: 'SKU-001',
        otaBasicRoomId: 'PHYS-001',
        otaBasicRoomName: '高级商务大床房',
        saleProductId: 'SP-001',
        saleProductName: '预售单晚含早大床房',
      });
      expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('当重定向至登录页时，必须显式抛出登录态过期错误', async () => {
      const mockPage = {
        url: () => 'https://passport.douyin.com/login',
        on: vi.fn(),
        off: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const request: ProductCrawlRequest = {
        channelCode: 'DOUYIN',
        extUnitCode: 'LA-8888',
        waitMs: 10,
      };

      await expect(collector.collect(mockPage, {} as BrowserContext, request)).rejects.toThrow(
        '抖音商家账号登录态已过期'
      );
      expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('当接口未拦截到数据时，应 Fail-Fast 报错阻断', async () => {
      const mockPage = {
        url: () => DOUYIN_SALE_PRODUCT_PAGE_URL,
        on: vi.fn(),
        off: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const request: ProductCrawlRequest = {
        channelCode: 'DOUYIN',
        extUnitCode: 'LA-EMPTY',
        waitMs: 10,
      };

      await expect(collector.collect(mockPage, {} as BrowserContext, request)).rejects.toThrow(
        '抖音预售房型接口未拦截到有效房型关系数据'
      );
      expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('当传入 waitSeconds 时，应按秒转换为毫秒并输出以秒为单位的日志', async () => {
      let registeredResponseHandler: ((response: Response) => Promise<void>) | null = null;

      const mockResponse = {
        url: () => 'https://life.douyin.com/life/hotel/query_sale_product',
        ok: () => true,
        text: async () =>
          JSON.stringify({
            status_code: 0,
            status_msg: 'success',
            sale_product_group: [
              {
                product_list: [
                  {
                    sku_id: 'SKU-002',
                    physical_room_id: 'PHYS-002',
                    physical_room_name: '豪华大床房',
                    sale_product_id: 'SP-002',
                    sale_product_name: '豪华特惠房',
                  },
                ],
              },
            ],
          }),
      } as unknown as Response;

      const mockPage = {
        url: () => DOUYIN_SALE_PRODUCT_PAGE_URL,
        on: vi.fn((event: string, handler: (r: Response) => Promise<void>) => {
          if (event === 'response') {
            registeredResponseHandler = handler;
          }
        }),
        off: vi.fn(),
        goto: vi.fn().mockImplementation(async () => {
          if (registeredResponseHandler) {
            await registeredResponseHandler(mockResponse);
          }
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const logs: CollectorLogPayload[] = [];
      const request: ProductCrawlRequest = {
        channelCode: 'DOUYIN',
        extUnitCode: 'LA-8888',
        waitSeconds: 5,
      };

      await collector.collect(mockPage, {} as BrowserContext, request, {
        onLog: (l) => logs.push(l),
      });

      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(5000);
      expect(logs.some((l) => l.message.includes('5 秒'))).toBe(true);
    });
  });
});
