import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext, Response, Locator } from 'playwright';
import {
  DouyinProductCollector,
} from '../../src/crawler/collectors/douyin/douyinProductCollector';
import { douyinSaleProductCollector } from '../../src/crawler/collectors/douyin/douyinSaleProductCollector';
import type { ProductCrawlRequest, CollectorLogPayload } from '../../src/crawler/types';

describe('DouyinProductCollector (商品管理采集器)', () => {
  let collector: DouyinProductCollector;

  beforeEach(() => {
    collector = new DouyinProductCollector();
    vi.restoreAllMocks();
  });

  describe('resolveTargetUrl 目标地址规范化', () => {
    it('在未提供自定义地址时，返回默认带 tobias 参数的商品管理地址', () => {
      const url = collector.resolveTargetUrl();
      expect(url).toContain('/p/goods-list');
      const parsed = new URL(url);
      expect(parsed.searchParams.get('industry')).toBe('tobias');
      expect(parsed.searchParams.get('menu_tab')).toBe('navi_product_info');
    });

    it('当传入非法 URL 时，应抛出错误', () => {
      expect(() => collector.resolveTargetUrl('bad-protocol://invalid url')).toThrow(
        '非法的产品采集目标地址'
      );
    });
  });

  describe('collect 全链路采集与展开', () => {
    it('先采集预售房型快照，再操作商品管理页面筛选并展开商品', async () => {
      // 1. Mock 预售快照采集
      vi.spyOn(douyinSaleProductCollector, 'collect').mockResolvedValue([
        {
          skuId: 'SKU-K1',
          otaBasicRoomId: 'PHYS-K1',
          otaBasicRoomName: '豪华大床房',
          saleProductId: 'SP-1',
          saleProductName: '预售大床',
        },
      ]);

      let registeredResponseHandler: ((response: Response) => Promise<void>) | null = null;

      const mockResponse = {
        url: () => 'https://life.douyin.com/life/tobias/merge/products/list',
        ok: () => true,
        text: async () =>
          JSON.stringify({
            status_code: 0,
            cursor: '1',
            total: 1,
            product_detail_list: [
              {
                product: {
                  product_id: 'PROD-888',
                  product_name: '抖音大促大床房',
                  poi_id_list: ['POI-1'],
                },
                sku_list: [
                  {
                    sku_id: 'SKU-K1',
                    bind_sku_list: [
                      {
                        poi_id: 'POI-1',
                        sku_ids: ['SKU-K1'],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
      } as unknown as Response;

      // Mock Locator helpers
      const createMockLocator = (options: { isVisible?: boolean; count?: number } = {}) => {
        const loc = {
          isVisible: vi.fn().mockResolvedValue(options.isVisible ?? true),
          waitFor: vi.fn().mockResolvedValue(undefined),
          click: vi.fn().mockResolvedValue(undefined),
          fill: vi.fn().mockResolvedValue(undefined),
          count: vi.fn().mockResolvedValue(options.count ?? 1),
          first: () => loc,
          filter: () => loc,
          locator: () => loc,
          evaluate: vi.fn().mockResolvedValue(false),
        };
        return loc as unknown as Locator;
      };

      const mockPage = {
        url: () => 'https://life.douyin.com/p/goods-list',
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
        locator: vi.fn().mockImplementation(() => createMockLocator()),
      } as unknown as Page;

      const logs: CollectorLogPayload[] = [];
      const request: ProductCrawlRequest = {
        channelCode: 'DOUYIN',
        extUnitCode: 'LA-1001',
        otaHotelName: '希尔顿欢朋酒店',
        waitMs: 10,
      };

      const result = await collector.collect(mockPage, {} as BrowserContext, request, {
        onLog: (l) => logs.push(l),
      });

      expect(douyinSaleProductCollector.collect).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        otaChannelCode: 'DOUYIN',
        extUnitCode: 'LA-1001',
        otaRoomTypeId: 'PROD-888',
        otaRoomTypeName: '抖音大促大床房',
        otaBasicRoomId: 'PHYS-K1',
        otaBasicRoomName: '豪华大床房',
        otaPayType: 'PP',
        source: 'douyin-product-network',
      });
      expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('当缺少 extUnitCode 或 otaHotelName 时，应立即 Fail-Fast 报错', async () => {
      const mockPage = {} as Page;
      await expect(
        collector.collect(mockPage, {} as BrowserContext, { channelCode: 'DOUYIN', extUnitCode: '' })
      ).rejects.toThrow('缺少外部门店编码 extUnitCode');

      await expect(
        collector.collect(mockPage, {} as BrowserContext, { channelCode: 'DOUYIN', extUnitCode: 'LA-1', otaHotelName: '' })
      ).rejects.toThrow('缺少门店名称 otaHotelName');
    });

    it('当重定向至登录页时，抛出登录态过期错误', async () => {
      vi.spyOn(douyinSaleProductCollector, 'collect').mockResolvedValue([
        {
          skuId: 'SKU-1',
          otaBasicRoomId: 'PHYS-1',
          otaBasicRoomName: '房型',
          saleProductId: 'SP-1',
          saleProductName: '产品',
        },
      ]);

      const mockPage = {
        url: () => 'https://passport.douyin.com/login',
        on: vi.fn(),
        off: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const request: ProductCrawlRequest = {
        channelCode: 'DOUYIN',
        extUnitCode: 'LA-1',
        otaHotelName: '测试酒店',
        waitMs: 10,
      };

      await expect(collector.collect(mockPage, {} as BrowserContext, request)).rejects.toThrow(
        '抖音商家账号登录态已过期'
      );
      expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('当传入 waitSeconds 时，首屏等待时间应按秒转换并在日志中以秒输出', async () => {
      vi.spyOn(douyinSaleProductCollector, 'collect').mockResolvedValue([
        {
          skuId: 'SKU-K1',
          otaBasicRoomId: 'PHYS-K1',
          otaBasicRoomName: '豪华大床房',
          saleProductId: 'SP-1',
          saleProductName: '预售大床',
        },
      ]);

      let registeredResponseHandler: ((response: Response) => Promise<void>) | null = null;

      const mockResponse = {
        url: () => 'https://life.douyin.com/life/tobias/merge/products/list',
        ok: () => true,
        text: async () =>
          JSON.stringify({
            status_code: 0,
            cursor: '1',
            total: 1,
            product_detail_list: [
              {
                product: {
                  product_id: 'PROD-888',
                  product_name: '抖音大促大床房',
                  poi_id_list: ['POI-1'],
                },
                sku_list: [
                  {
                    sku_id: 'SKU-K1',
                    bind_sku_list: [{ poi_id: 'POI-1', sku_ids: ['SKU-K1'] }],
                  },
                ],
              },
            ],
          }),
      } as unknown as Response;

      const createMockLocator = () => {
        const loc = {
          isVisible: vi.fn().mockResolvedValue(true),
          waitFor: vi.fn().mockResolvedValue(undefined),
          click: vi.fn().mockResolvedValue(undefined),
          fill: vi.fn().mockResolvedValue(undefined),
          count: vi.fn().mockResolvedValue(1),
          first: () => loc,
          filter: () => loc,
          locator: () => loc,
          evaluate: vi.fn().mockResolvedValue(false),
        };
        return loc as unknown as Locator;
      };

      const mockPage = {
        url: () => 'https://life.douyin.com/p/goods-list',
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
        locator: vi.fn().mockImplementation(() => createMockLocator()),
      } as unknown as Page;

      const logs: CollectorLogPayload[] = [];
      const request: ProductCrawlRequest = {
        channelCode: 'DOUYIN',
        extUnitCode: 'LA-1001',
        otaHotelName: '希尔顿欢朋酒店',
        waitSeconds: 4,
      };

      await collector.collect(mockPage, {} as BrowserContext, request, {
        onLog: (l) => logs.push(l),
      });

      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(4000);
      expect(logs.some((l) => l.message.includes('4 秒'))).toBe(true);
    });
  });
});
