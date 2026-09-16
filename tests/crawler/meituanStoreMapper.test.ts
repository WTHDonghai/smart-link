import { describe, it, expect } from 'vitest';
import {
  extractMeituanStoresFromResponses,
  normalizeMeituanHotelCandidates,
  resolveMeituanTargetUrl,
  DEFAULT_MEITUAN_CATALOG_URL,
} from '../../src/crawler/collectors/meituan/meituanStoreMapper';

describe('meituanStoreMapper', () => {
  describe('resolveMeituanTargetUrl', () => {
    it('returns default catalog URL when input is empty or invalid', () => {
      expect(resolveMeituanTargetUrl('')).toBe(DEFAULT_MEITUAN_CATALOG_URL);
      expect(resolveMeituanTargetUrl('   ')).toBe(DEFAULT_MEITUAN_CATALOG_URL);
      expect(resolveMeituanTargetUrl(undefined)).toBe(DEFAULT_MEITUAN_CATALOG_URL);
      expect(resolveMeituanTargetUrl('not-a-valid-url')).toBe(DEFAULT_MEITUAN_CATALOG_URL);
    });

    it('converges custom domain URL to batch-price pathname and strips hash/iUrl', () => {
      const input = 'https://me.meituan.com/ebooking/merchant/order/list?iUrl=foo#hashSection';
      const output = resolveMeituanTargetUrl(input);
      expect(output).toBe('https://me.meituan.com/ebooking/merchant/product/batch-price');
    });

    it('preserves other necessary query parameters while enforcing batch-price path', () => {
      const input = 'https://me.meituan.com/custom/path?partnerId=998877';
      const output = resolveMeituanTargetUrl(input);
      expect(output).toBe('https://me.meituan.com/ebooking/merchant/product/batch-price?partnerId=998877');
    });
  });

  describe('extractMeituanStoresFromResponses', () => {
    it('extracts stores from standard poiInfos response format', () => {
      const mockResponses = [
        {
          code: 0,
          msg: 'success',
          data: {
            partnerId: '880011',
            poiList: [
              {
                poiId: '109923',
                poiName: '全季酒店(杭州西湖店)',
                cityName: '杭州',
                starRating: '高档型',
              },
              {
                poiId: '109924',
                poiName: '桔子酒店(杭州武林门店)',
                cityName: '杭州',
                starRating: '舒适型',
              },
            ],
          },
        },
      ];

      const extracted = extractMeituanStoresFromResponses(mockResponses);
      expect(extracted).toHaveLength(2);

      expect(extracted[0].poiId).toBe('109923');
      expect(extracted[0].partnerId).toBe('880011');
      expect(extracted[0].name).toBe('全季酒店(杭州西湖店)');
      expect(extracted[0].city).toBe('杭州');

      expect(extracted[1].poiId).toBe('109924');
      expect(extracted[1].partnerId).toBe('880011');
      expect(extracted[1].name).toBe('桔子酒店(杭州武林门店)');
    });

    it('extracts stores from deep nested structures and vendorId fallback', () => {
      const mockNested = [
        {
          status: 200,
          payload: {
            account: {
              vendorId: '776655',
              hotels: [
                {
                  hotelId: '554433',
                  hotelName: '成都宽窄巷子精品酒店',
                  city: '成都',
                },
              ],
            },
          },
        },
      ];

      const extracted = extractMeituanStoresFromResponses(mockNested);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].poiId).toBe('554433');
      expect(extracted[0].partnerId).toBe('776655');
      expect(extracted[0].name).toBe('成都宽窄巷子精品酒店');
      expect(extracted[0].city).toBe('成都');
    });

    it('deduplicates identical stores across multiple network responses by partnerId:poiId', () => {
      const duplicateResponses = [
        {
          partnerId: '880011',
          poiId: '109923',
          poiName: '全季酒店(杭州西湖店)',
        },
        {
          partnerId: '880011',
          poiId: '109923',
          poiName: '全季酒店(杭州西湖店) - 重复响应',
        },
      ];

      const extracted = extractMeituanStoresFromResponses(duplicateResponses);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].poiId).toBe('109923');
      expect(extracted[0].name).toBe('全季酒店(杭州西湖店)');
    });

    it('ignores invalid or empty records safely', () => {
      const invalid = [null, undefined, '', 123, {}, { poiId: '123' }, { name: '仅有名称无ID' }];
      const extracted = extractMeituanStoresFromResponses(invalid);
      expect(extracted).toHaveLength(0);
    });
  });

  describe('normalizeMeituanHotelCandidates', () => {
    it('normalizes extracted store items to DiscoveredHotelCandidate contracts', () => {
      const rawStores = [
        {
          poiId: '20201',
          partnerId: '5501',
          name: '三亚亚特兰蒂斯酒店',
          city: '三亚',
          starRating: '豪华五星型',
          source: 'network-response',
        },
      ];

      const candidates = normalizeMeituanHotelCandidates(rawStores, 'meituan', 'MEITUAN');
      expect(candidates).toHaveLength(1);
      const c = candidates[0];
      expect(c.otaChannelId).toBe('meituan');
      expect(c.otaChannelCode).toBe('MEITUAN');
      expect(c.otaHotelId).toBe('20201');
      expect(c.otaHotelName).toBe('三亚亚特兰蒂斯酒店');
      expect(c.partnerId).toBe('5501');
      expect(c.city).toBe('三亚');
      expect(c.starRating).toBe('豪华五星型');
      expect(c.source).toBe('network-response');
    });

    it('skips stores with missing poiId or missing name', () => {
      const incomplete = [
        { poiId: '', partnerId: '5501', name: '无ID酒店' },
        { poiId: '12345', partnerId: '5501', name: '' },
      ];
      const candidates = normalizeMeituanHotelCandidates(incomplete);
      expect(candidates).toHaveLength(0);
    });
  });
});
