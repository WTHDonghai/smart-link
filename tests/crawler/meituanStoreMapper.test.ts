import { describe, it, expect } from 'vitest';
import {
  extractMeituanStoresFromResponses,
  getDefaultMeituanCatalogUrl,
  normalizeMeituanHotelCandidates,
  resolveMeituanTargetUrl,
  parseMeituanDropdownItem,
} from '../../src/crawler/collectors/meituan/meituanStoreMapper';

describe('meituanStoreMapper', () => {
  describe('resolveMeituanTargetUrl', () => {
    it('returns default catalog URL when input is empty or undefined', () => {
      expect(resolveMeituanTargetUrl('')).toBe(getDefaultMeituanCatalogUrl());
      expect(resolveMeituanTargetUrl('   ')).toBe(getDefaultMeituanCatalogUrl());
      expect(resolveMeituanTargetUrl(undefined)).toBe(getDefaultMeituanCatalogUrl());
    });

    it('throws explicit error when input is an invalid URL format according to Fail-Fast principle', () => {
      expect(() => resolveMeituanTargetUrl('not-a-valid-url')).toThrow(
        '非法的美团目标渠道 URL: not-a-valid-url'
      );
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

    it('extracts independent single store merchants without partnerId', () => {
      const singleStoreResponse = [
        {
          code: 0,
          msg: 'success',
          data: {
            poiInfo: {
              poiId: '778899',
              poiName: '青城山后山幽兰静舍客栈',
              cityName: '都江堰',
              categoryName: '民宿客栈',
            },
          },
        },
      ];

      const extracted = extractMeituanStoresFromResponses(singleStoreResponse);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].poiId).toBe('778899');
      expect(extracted[0].partnerId).toBe('');
      expect(extracted[0].name).toBe('青城山后山幽兰静舍客栈');
      expect(extracted[0].city).toBe('都江堰');
      expect(extracted[0].starRating).toBe('民宿客栈');
    });

    it('deduplicates independent single store merchants without partnerId by poiId', () => {
      const duplicateSingleStores = [
        {
          poiId: '778899',
          poiName: '青城山后山幽兰静舍客栈',
          cityName: '都江堰',
        },
        {
          poiId: '778899',
          poiName: '青城山后山幽兰静舍客栈 - 重复响应',
          cityName: '都江堰',
        },
      ];

      const extracted = extractMeituanStoresFromResponses(duplicateSingleStores);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].poiId).toBe('778899');
      expect(extracted[0].name).toBe('青城山后山幽兰静舍客栈');
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

      const candidates = normalizeMeituanHotelCandidates(rawStores, 'MEITUAN');
      expect(candidates).toHaveLength(1);
      const c = candidates[0];
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

  describe('parseMeituanDropdownItem', () => {
    it('extracts poiId and name from explicit attributes and clean name text', () => {
      const input = {
        fullText: '美团酒店 (109988) 已授权',
        nameText: '汉庭优佳酒店(杭州武林门中心店)',
        poiId: '109988',
        partnerId: '8801',
      };

      const result = parseMeituanDropdownItem(input);
      expect(result).not.toBeNull();
      expect(result?.poiId).toBe('109988');
      expect(result?.partnerId).toBe('8801');
      expect(result?.name).toBe('汉庭优佳酒店(杭州武林门中心店)');
      expect(result?.source).toBe('store-dropdown-dom');
    });

    it('preserves legitimate numbers inside hotel names while stripping only matched poiId', () => {
      const input = {
        fullText: '10086号城市客栈(654321)',
        nameText: '10086号城市客栈(654321)',
        poiId: '654321',
      };

      const result = parseMeituanDropdownItem(input);
      expect(result).not.toBeNull();
      expect(result?.poiId).toBe('654321');
      expect(result?.name).toBe('10086号城市客栈');
    });

    it('returns null when neither attribute nor text contains valid numeric poiId', () => {
      const input = {
        fullText: '暂无门店数据或请选择其他账号',
        nameText: '暂无门店数据',
      };

      const result = parseMeituanDropdownItem(input);
      expect(result).toBeNull();
    });
  });
});
