import { describe, it, expect } from 'vitest';
import {
  isDouyinSaleProductResponseUrl,
  parseDouyinSaleProductResponse,
  DOUYIN_SALE_PRODUCT_ENDPOINT_PATH,
} from '../../src/crawler/collectors/douyin/douyinSaleProductMapper';

describe('douyinSaleProductMapper 预售房型与销售SKU清洗器', () => {
  const sampleValidResponse = {
    status_code: 0,
    status_msg: 'success',
    sale_product_group: [
      {
        product_list: [
          {
            sku_id: 'SKU-KING-101',
            physical_room_id: 'PHYS-KING-01',
            physical_room_name: '豪华大床房',
            sale_product_id: 'SP-1001',
            sale_product_name: '预售通兑大床房',
          },
          {
            sku_id: 'SKU-TWIN-102',
            physical_room_id: 'PHYS-TWIN-02',
            physical_room_name: '高级双床房',
            sale_product_id: 'SP-1002',
            sale_product_name: '预售通兑双床房',
          },
        ],
      },
    ],
  };

  describe('isDouyinSaleProductResponseUrl 端点匹配', () => {
    it('正确匹配预售房型标准接口路径', () => {
      expect(isDouyinSaleProductResponseUrl(`https://life.douyin.com${DOUYIN_SALE_PRODUCT_ENDPOINT_PATH}`)).toBe(true);
      expect(isDouyinSaleProductResponseUrl(`https://life.douyin.com${DOUYIN_SALE_PRODUCT_ENDPOINT_PATH}?query=1`)).toBe(true);
      expect(isDouyinSaleProductResponseUrl('/life/hotel/query_sale_product')).toBe(true);
    });

    it('拒绝无关或其他渠道端点', () => {
      expect(isDouyinSaleProductResponseUrl('https://life.douyin.com/life/booking/product/list')).toBe(false);
      expect(isDouyinSaleProductResponseUrl('https://life.douyin.com/life/tobias/merge/products/list')).toBe(false);
      expect(isDouyinSaleProductResponseUrl('')).toBe(false);
    });
  });

  describe('parseDouyinSaleProductResponse 解析与清洗', () => {
    it('正常解析完整的预售房型分组并建立 SKU 映射索引', () => {
      const bindings = parseDouyinSaleProductResponse(sampleValidResponse);

      expect(bindings).toHaveLength(2);
      expect(bindings[0]).toEqual({
        skuId: 'SKU-KING-101',
        otaBasicRoomId: 'PHYS-KING-01',
        otaBasicRoomName: '豪华大床房',
        saleProductId: 'SP-1001',
        saleProductName: '预售通兑大床房',
      });
      expect(bindings[1]).toEqual({
        skuId: 'SKU-TWIN-102',
        otaBasicRoomId: 'PHYS-TWIN-02',
        otaBasicRoomName: '高级双床房',
        saleProductId: 'SP-1002',
        saleProductName: '预售通兑双床房',
      });
    });

    it('当接口返回业务错误时，应 Fail-Fast 显式抛出异常', () => {
      const errorResponse = {
        status_code: 10001,
        status_msg: '无此商家房型权限',
      };
      expect(() => parseDouyinSaleProductResponse(errorResponse)).toThrow(
        '抖音预售房型接口返回业务错误: 无此商家房型权限'
      );
    });

    it('当缺少 sale_product_group 时，应抛出结构错误', () => {
      expect(() => parseDouyinSaleProductResponse({ status_code: 0 })).toThrow(
        '缺少 sale_product_group 分组数组'
      );
    });

    it('当同一个 SKU 对应多个不同的物理房型时，必须阻断并抛出冲突错误', () => {
      const conflictResponse = {
        status_code: 0,
        sale_product_group: [
          {
            product_list: [
              {
                sku_id: 'SKU-SAME',
                physical_room_id: 'PHYS-1',
                physical_room_name: '房型一',
                sale_product_id: 'SP-1',
                sale_product_name: '产品一',
              },
              {
                sku_id: 'SKU-SAME',
                physical_room_id: 'PHYS-2',
                physical_room_name: '房型二',
                sale_product_id: 'SP-2',
                sale_product_name: '产品二',
              },
            ],
          },
        ],
      };
      expect(() => parseDouyinSaleProductResponse(conflictResponse)).toThrow(
        'SKU SKU-SAME 对应多个不同的物理房型或销售产品'
      );
    });

    it('当遇到不安全的 numeric ID 时，遵循红线规范报错拒绝', () => {
      const unsafeResponse = {
        status_code: 0,
        sale_product_group: [
          {
            product_list: [
              {
                sku_id: Number.MAX_SAFE_INTEGER + 10,
                physical_room_id: 'PHYS-1',
                physical_room_name: '房型一',
                sale_product_id: 'SP-1',
                sale_product_name: '产品一',
              },
            ],
          },
        ],
      };
      expect(() => parseDouyinSaleProductResponse(unsafeResponse)).toThrow('不安全的 numeric ID');
    });

    it('当缺少 physical_room_name 或 sale_product_name 时，应抛出错误', () => {
      const missingNameResponse = {
        status_code: 0,
        sale_product_group: [
          {
            product_list: [
              {
                sku_id: 'SKU-1',
                physical_room_id: 'PHYS-1',
                physical_room_name: '',
                sale_product_id: 'SP-1',
                sale_product_name: '产品一',
              },
            ],
          },
        ],
      };
      expect(() => parseDouyinSaleProductResponse(missingNameResponse)).toThrow(
        '缺少 physical_room_name 或 sale_product_name'
      );
    });
  });
});
