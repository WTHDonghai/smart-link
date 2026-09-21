import { describe, it, expect } from 'vitest';
import {
  isDouyinProductListResponseUrl,
  isDouyinCalendarRoomResponseUrl,
  parseDouyinProductResponse,
  expandDouyinProductsByPhysicalRoom,
  DOUYIN_PRODUCT_LIST_ENDPOINT_PATH,
} from '../../src/crawler/collectors/douyin/douyinProductMapper';
import type { DouyinSaleProductRoomBinding } from '../../src/crawler/collectors/douyin/douyinSaleProductMapper';

describe('douyinProductMapper 商品管理与1:N房型展开清洗器', () => {
  const sampleProductListResponse = {
    status_code: 0,
    status_msg: '',
    cursor: '2',
    total: 2,
    product_detail_list: [
      {
        product: {
          product_id: 'PROD-1001',
          product_name: '豪华亲子大礼包房型',
          poi_id_list: ['POI-1'],
        },
        sku_list: [
          {
            sku_id: 'SKU-001',
            bind_sku_list: [
              {
                poi_id: 'POI-1',
                sku_ids: ['SKU-001', 'SKU-002'],
              },
            ],
          },
        ],
      },
      {
        product: {
          product_id: 'PROD-1002',
          product_name: '商务行政特惠房',
          poi_id_list: ['POI-1'],
        },
        sku_list: [
          {
            sku_id: 'SKU-003',
            bind_sku_list: [
              {
                poi_id: 'POI-1',
                sku_ids: ['SKU-003'],
              },
            ],
          },
        ],
      },
    ],
  };

  const sampleSnapshotBindings: DouyinSaleProductRoomBinding[] = [
    {
      skuId: 'SKU-001',
      otaBasicRoomId: 'PHYS-KING',
      otaBasicRoomName: '豪华大床房',
      saleProductId: 'SP-1',
      saleProductName: '预售大床',
    },
    {
      skuId: 'SKU-002',
      otaBasicRoomId: 'PHYS-TWIN',
      otaBasicRoomName: '豪华双床房',
      saleProductId: 'SP-2',
      saleProductName: '预售双床',
    },
    {
      skuId: 'SKU-003',
      otaBasicRoomId: 'PHYS-EXEC',
      otaBasicRoomName: '行政套房',
      saleProductId: 'SP-3',
      saleProductName: '预售行政',
    },
  ];

  describe('端点匹配与日历房门禁', () => {
    it('正确识别商品管理列表端点', () => {
      expect(isDouyinProductListResponseUrl(`https://life.douyin.com${DOUYIN_PRODUCT_LIST_ENDPOINT_PATH}`)).toBe(true);
      expect(isDouyinProductListResponseUrl('/life/tobias/merge/products/list')).toBe(true);
    });

    it('正确识别并拒绝日历房商品端点', () => {
      expect(isDouyinCalendarRoomResponseUrl('https://life.douyin.com/life/booking/product/list')).toBe(true);
      expect(isDouyinCalendarRoomResponseUrl('/life/booking/product/list')).toBe(true);
      expect(isDouyinCalendarRoomResponseUrl('/life/tobias/merge/products/list')).toBe(false);
    });
  });

  describe('parseDouyinProductResponse 商品解析', () => {
    it('正确解析商品列表并提取关联的 boundSkuIds', () => {
      const result = parseDouyinProductResponse(sampleProductListResponse, 'EXT-888');

      expect(result.cursor).toBe('2');
      expect(result.total).toBe(2);
      expect(result.products).toHaveLength(2);

      expect(result.products[0]).toEqual({
        otaChannelCode: 'DOUYIN',
        extUnitCode: 'EXT-888',
        otaRoomTypeId: 'PROD-1001',
        otaRoomTypeName: '豪华亲子大礼包房型',
        boundSkuIds: ['SKU-001', 'SKU-002'],
      });

      expect(result.products[1]).toEqual({
        otaChannelCode: 'DOUYIN',
        extUnitCode: 'EXT-888',
        otaRoomTypeId: 'PROD-1002',
        otaRoomTypeName: '商务行政特惠房',
        boundSkuIds: ['SKU-003'],
      });
    });

    it('当返回业务错误时，应抛出异常', () => {
      const errorResp = {
        status_code: 50001,
        status_msg: '商户登录过期',
      };
      expect(() => parseDouyinProductResponse(errorResp, 'EXT-888')).toThrow('商户登录过期');
    });

    it('当单页中出现重复的 product_id 时，必须 Fail-Fast 报错', () => {
      const dupResp = {
        status_code: 0,
        product_detail_list: [
          sampleProductListResponse.product_detail_list[0],
          sampleProductListResponse.product_detail_list[0],
        ],
      };
      expect(() => parseDouyinProductResponse(dupResp, 'EXT-888')).toThrow(
        '单页内出现重复 product_id: PROD-1001'
      );
    });
  });

  describe('expandDouyinProductsByPhysicalRoom 1:N 物理房型展开与去重', () => {
    it('将一个多 SKU 商品正确展开为多个物理房型产品映射候选', () => {
      const parseResult = parseDouyinProductResponse(sampleProductListResponse, 'EXT-888');
      const candidates = expandDouyinProductsByPhysicalRoom(
        parseResult.products,
        sampleSnapshotBindings,
        'EXT-888'
      );

      // PROD-1001 绑定 2 个 SKU (分别对应 PHYS-KING 和 PHYS-TWIN)，PROD-1002 绑定 1 个 SKU (PHYS-EXEC)
      // 总共展开为 3 项
      expect(candidates).toHaveLength(3);

      expect(candidates[0]).toEqual({
        otaChannelCode: 'DOUYIN',
        extUnitCode: 'EXT-888',
        otaRoomTypeId: 'PROD-1001',
        otaRoomTypeName: '豪华亲子大礼包房型',
        otaBasicRoomId: 'PHYS-KING',
        otaBasicRoomName: '豪华大床房',
        otaPayType: 'PP',
        source: 'douyin-product-network',
      });

      expect(candidates[1]).toEqual({
        otaChannelCode: 'DOUYIN',
        extUnitCode: 'EXT-888',
        otaRoomTypeId: 'PROD-1001',
        otaRoomTypeName: '豪华亲子大礼包房型',
        otaBasicRoomId: 'PHYS-TWIN',
        otaBasicRoomName: '豪华双床房',
        otaPayType: 'PP',
        source: 'douyin-product-network',
      });

      expect(candidates[2]).toEqual({
        otaChannelCode: 'DOUYIN',
        extUnitCode: 'EXT-888',
        otaRoomTypeId: 'PROD-1002',
        otaRoomTypeName: '商务行政特惠房',
        otaBasicRoomId: 'PHYS-EXEC',
        otaBasicRoomName: '行政套房',
        otaPayType: 'PP',
        source: 'douyin-product-network',
      });
    });

    it('当不同 SKU 指向同一个物理房型时，应通过复合 Identity 幂等折叠去重', () => {
      const duplicatePhysicalBindings: DouyinSaleProductRoomBinding[] = [
        {
          skuId: 'SKU-001',
          otaBasicRoomId: 'PHYS-SAME',
          otaBasicRoomName: '相同房型',
          saleProductId: 'SP-1',
          saleProductName: '产品一',
        },
        {
          skuId: 'SKU-002',
          otaBasicRoomId: 'PHYS-SAME',
          otaBasicRoomName: '相同房型',
          saleProductId: 'SP-2',
          saleProductName: '产品二',
        },
      ];

      const singleProduct = [
        {
          otaChannelCode: 'DOUYIN' as const,
          extUnitCode: 'EXT-888',
          otaRoomTypeId: 'PROD-1001',
          otaRoomTypeName: '测试商品',
          boundSkuIds: ['SKU-001', 'SKU-002'],
        },
      ];

      const candidates = expandDouyinProductsByPhysicalRoom(
        singleProduct,
        duplicatePhysicalBindings,
        'EXT-888'
      );

      // 虽然有 2 个 SKU，但指向同一物理房型，因此去重折叠为 1 行
      expect(candidates).toHaveLength(1);
      expect(candidates[0].otaBasicRoomId).toBe('PHYS-SAME');
    });

    it('当商品绑定的 SKU 在预售快照中缺失时，必须立即 Fail-Fast 报错阻断', () => {
      const incompleteBindings: DouyinSaleProductRoomBinding[] = [
        {
          skuId: 'SKU-001',
          otaBasicRoomId: 'PHYS-KING',
          otaBasicRoomName: '豪华大床房',
          saleProductId: 'SP-1',
          saleProductName: '预售大床',
        },
      ];

      const parseResult = parseDouyinProductResponse(sampleProductListResponse, 'EXT-888');

      expect(() =>
        expandDouyinProductsByPhysicalRoom(parseResult.products, incompleteBindings, 'EXT-888')
      ).toThrow('绑定的销售 SKU「SKU-002」未在当前预售房型快照中出现');
    });
  });
});
