import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext, Response } from 'playwright';
import { MeituanProductCollector } from '../../src/crawler/collectors/meituan/meituanProductCollector';
import type { ProductCrawlRequest, CollectorLogPayload } from '../../src/crawler/types';

describe('MeituanProductCollector (纯接口拦截采集模式)', () => {
  let collector: MeituanProductCollector;

  beforeEach(() => {
    collector = new MeituanProductCollector();
  });

  describe('resolveTargetUrl 目标地址解析与参数装配', () => {
    it('在未提供自定义地址时，应返回基于配置的默认美团产品地址', () => {
      const url = collector.resolveTargetUrl();
      expect(url).toContain('http');
      expect(new URL(url).pathname).toBeTruthy();
    });

    it('当传入 poiId 和 partnerId 时，应正确追加至目标 URL 的 query 参数中', () => {
      const url = collector.resolveTargetUrl('https://me.meituan.com/ebooking/merchant/product/batch-price', 'POI-8888', 'PARTNER-999');
      const parsed = new URL(url);
      expect(parsed.searchParams.get('poiId')).toBe('POI-8888');
      expect(parsed.searchParams.get('partnerId')).toBe('PARTNER-999');
    });

    it('当 partnerId 为 0 或空时，不应在 URL 中追加无效 partnerId 参数', () => {
      const url = collector.resolveTargetUrl('https://me.meituan.com/ebooking/merchant/product/batch-price', 'POI-8888', '0');
      const parsed = new URL(url);
      expect(parsed.searchParams.get('poiId')).toBe('POI-8888');
      expect(parsed.searchParams.has('partnerId')).toBe(false);
    });

    it('当传入非法目标 URL 时，应遵循 Fail-Fast 原则显式抛出错误', () => {
      expect(() => collector.resolveTargetUrl('invalid-url://bad address')).toThrow('非法的产品采集目标地址');
    });
  });

  describe('collect 接口响应拦截与数据采集', () => {
    it('绝不伪造或在页面内构造主动 fetch 调用，仅通过 response 监听拦截并清洗商品数据', async () => {
      let registeredResponseHandler: ((response: Response) => Promise<void>) | null = null;

      const mockResponse = {
        url: () => 'https://me.meituan.com/api/gw/v1/product/goods/queryListAndTag?yodaReady=h5',
        headers: () => ({ 'content-type': 'application/json;charset=utf-8' }),
        ok: () => true,
        status: () => 200,
        text: async () =>
          JSON.stringify({
            code: 10000,
            data: {
              realRoomRelations: [
                {
                  realRoomId: 'PHYS-101',
                  realRoomName: '商务大床房',
                  logicRoomRelations: [
                    {
                      goodsList: [
                        {
                          goodsId: 'GOODS-9001',
                          goodsName: '商务大床房(无早)',
                          paymentType: 0,
                          rateCodeId: 'RC-NO-MEAL',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
      } as unknown as Response;

      const evaluateSpy = vi.fn();
      const mockPage = {
        url: () => 'https://me.meituan.com/ebooking/merchant/product/batch-price?poiId=POI-1234',
        on: vi.fn((event: string, handler: (r: Response) => Promise<void>) => {
          if (event === 'response') {
            registeredResponseHandler = handler;
          }
        }),
        off: vi.fn(),
        goto: vi.fn().mockImplementation(async () => {
          // 模拟页面导航加载过程中天然触发的接口响应
          if (registeredResponseHandler) {
            await registeredResponseHandler(mockResponse);
          }
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateSpy,
      } as unknown as Page;

      const mockContext = {} as BrowserContext;
      const logs: CollectorLogPayload[] = [];
      const request: ProductCrawlRequest = {
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-1234',
        poiId: 'POI-1234',
        waitMs: 10,
      };

      const result = await collector.collect(mockPage, mockContext, request, {
        onLog: (l) => logs.push(l),
      });

      // 核心验证：严禁在页面内调用 fetch 伪造构造请求
      const hasForgedFetch = evaluateSpy.mock.calls.some((call) => {
        const fnOrStr = String(call[0]);
        return fnOrStr.includes('fetch(') || fnOrStr.includes('/api/gw/v1/product/goods/queryListAndTag');
      });
      expect(hasForgedFetch).toBe(false);

      // 验证拦截响应后清洗得到的商品项
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          otaChannelCode: 'MEITUAN',
          extUnitCode: 'POI-1234',
          otaRoomTypeId: 'GOODS-9001',
          otaRoomTypeName: '商务大床房(无早)',
          otaBasicRoomId: 'PHYS-101',
          otaBasicRoomName: '商务大床房',
          otaPayType: 'PP',
        })
      );

      // 验证在 finally 中注销了监听器
      expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('当页面重定向至登录页时，必须显式抛出登录态过期错误', async () => {
      const mockPage = {
        url: () => 'https://passport.meituan.com/account/unitlogin',
        on: vi.fn(),
        off: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const request: ProductCrawlRequest = {
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-EXPIRED',
        waitMs: 10,
      };

      await expect(collector.collect(mockPage, {} as BrowserContext, request)).rejects.toThrow(
        '美团商家账号登录态已过期'
      );
      expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('当接口未拦截到任何商品数据时，遵循 Fail-Fast 原则阻断并报错，严禁静默返回空结果', async () => {
      const mockPage = {
        url: () => 'https://me.meituan.com/ebooking/merchant/product/batch-price',
        on: vi.fn(),
        off: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      const request: ProductCrawlRequest = {
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-EMPTY',
        waitMs: 10,
      };

      await expect(collector.collect(mockPage, {} as BrowserContext, request)).rejects.toThrow(
        '美团产品接口未拦截到有效商品数据包'
      );
      expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('当传入 waitSeconds 时，应按秒转换为毫秒并输出以秒为单位的等待日志', async () => {
      let registeredResponseHandler: ((response: Response) => Promise<void>) | null = null;

      const mockResponse = {
        url: () => 'https://me.meituan.com/api/gw/v1/product/goods/queryListAndTag',
        headers: () => ({ 'content-type': 'application/json' }),
        ok: () => true,
        status: () => 200,
        text: async () =>
          JSON.stringify({
            code: 10000,
            data: {
              realRoomRelations: [
                {
                  realRoomId: 'PHYS-202',
                  realRoomName: '豪华湖景套房',
                  logicRoomRelations: [
                    {
                      goodsList: [
                        {
                          goodsId: 'GOODS-9002',
                          goodsName: '豪华湖景套房(双早)',
                          paymentType: 1,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
      } as unknown as Response;

      const mockPage = {
        url: () => 'https://me.meituan.com/ebooking/merchant/product/batch-price?poiId=POI-5555',
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
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-5555',
        waitSeconds: 6,
      };

      await collector.collect(mockPage, {} as BrowserContext, request, {
        onLog: (l) => logs.push(l),
      });

      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(6000);
      expect(logs.some((l) => l.message.includes('6 秒'))).toBe(true);
    });
  });
});
