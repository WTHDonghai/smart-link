import { describe, it, expect } from 'vitest';
import {
  extractProductsFromRealRoomRelations,
  extractProductsFromFlatList,
  parseMeituanProductCandidates,
} from '../../src/crawler/collectors/meituan/meituanProductMapper';

describe('meituanProductMapper', () => {
  describe('extractProductsFromRealRoomRelations', () => {
    it('当输入为空或无 realRoomRelations 时应返回 null', () => {
      expect(extractProductsFromRealRoomRelations(null, 'POI-100')).toBeNull();
      expect(extractProductsFromRealRoomRelations({}, 'POI-100')).toBeNull();
      expect(extractProductsFromRealRoomRelations({ data: {} }, 'POI-100')).toBeNull();
      expect(extractProductsFromRealRoomRelations({ data: { realRoomRelations: [] } }, 'POI-100')).toBeNull();
    });

    it('正确解析真实树结构，并正确处理支付类型 0 -> PP / 1 -> PS 以及房型和商品名', () => {
      const mockPayload = {
        code: 0,
        data: {
          realRoomRelations: [
            {
              realRoomId: 'RR-101',
              realRoomName: '物理豪华大床房',
              logicRoomRelations: [
                {
                  goodsList: [
                    {
                      goodsId: 'G-1001',
                      goodsName: '预付特惠含单早',
                      paymentType: 0, // 0 -> PP
                      rateCodeId: 'RC-PREPAY',
                    },
                    {
                      goodsId: 'G-1002',
                      goodsName: '现付标准价',
                      paymentType: 1, // 1 -> PS
                      rateCodeId: 'RC-POSTPAY',
                    },
                    {
                      // 缺少 goodsId 的无效节点应被跳过
                      goodsName: '无ID商品',
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      const result = extractProductsFromRealRoomRelations(mockPayload, 'POI-100', 'MEITUAN');
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);

      const [first, second] = result!;

      expect(first).toEqual({
        otaChannelCode: 'MEITUAN',
        extUnitCode: 'POI-100',
        otaRoomTypeId: 'G-1001',
        otaRoomTypeName: '预付特惠含单早',
        otaBasicRoomId: 'RR-101',
        otaBasicRoomName: '物理豪华大床房',
        otaRateCodeId: 'RC-PREPAY',
        otaPayType: 'PP',
        source: 'meituan-catalog-tree',
        raw: expect.objectContaining({ goodsId: 'G-1001' }),
      });

      expect(second).toEqual({
        otaChannelCode: 'MEITUAN',
        extUnitCode: 'POI-100',
        otaRoomTypeId: 'G-1002',
        otaRoomTypeName: '现付标准价',
        otaBasicRoomId: 'RR-101',
        otaBasicRoomName: '物理豪华大床房',
        otaRateCodeId: 'RC-POSTPAY',
        otaPayType: 'PS',
        source: 'meituan-catalog-tree',
        raw: expect.objectContaining({ goodsId: 'G-1002' }),
      });
    });
  });

  describe('extractProductsFromFlatList', () => {
    it('当输入为空时返回空数组', () => {
      expect(extractProductsFromFlatList(null, 'POI-100')).toEqual([]);
      expect(extractProductsFromFlatList(undefined, 'POI-100')).toEqual([]);
    });

    it('平铺对象中仅提取具备 goodsId 与 goodsName 的商品，坚决忽略仅有 roomId/roomName 的纯物理房型节点', () => {
      const mockResponseBody = {
        catalog: [
          // 纯物理房型节点：只有 roomId 和 roomName，严禁被当作商品
          {
            roomId: 'PHYSICAL-99',
            roomName: '纯物理行政套房',
            roomCount: 10,
          },
          // 真实商品节点：具备 goodsId 与 goodsName，附带关联物理房型信息
          {
            goodsId: 'G-5001',
            goodsName: '行政套房行政礼遇价',
            realRoomId: 'PHYSICAL-99',
            realRoomName: '纯物理行政套房',
            rateCodeId: 'RC-VIP',
            payType: 0,
          },
          // 另一个商品节点：使用 productId / productName
          {
            productId: 'P-6001',
            productName: '秒杀双床房',
            basicRoomId: 'BR-202',
            basicRoomName: '标准双床房',
            rpId: 'RATE-FLASH',
            paymentType: 1,
          },
        ],
      };

      const candidates = extractProductsFromFlatList(mockResponseBody, 'POI-100', 'MEITUAN');

      expect(candidates).toHaveLength(2);
      expect(candidates.some((c) => c.otaRoomTypeId === 'PHYSICAL-99')).toBe(false);

      expect(candidates[0]).toEqual({
        otaChannelCode: 'MEITUAN',
        extUnitCode: 'POI-100',
        otaRoomTypeId: 'G-5001',
        otaRoomTypeName: '行政套房行政礼遇价',
        otaBasicRoomId: 'PHYSICAL-99',
        otaBasicRoomName: '纯物理行政套房',
        otaRateCodeId: 'RC-VIP',
        otaPayType: 'PP',
        source: 'meituan-catalog-flat',
        raw: expect.objectContaining({ goodsId: 'G-5001' }),
      });

      expect(candidates[1]).toEqual({
        otaChannelCode: 'MEITUAN',
        extUnitCode: 'POI-100',
        otaRoomTypeId: 'P-6001',
        otaRoomTypeName: '秒杀双床房',
        otaBasicRoomId: 'BR-202',
        otaBasicRoomName: '标准双床房',
        otaRateCodeId: 'RATE-FLASH',
        otaPayType: 'PS',
        source: 'meituan-catalog-flat',
        raw: expect.objectContaining({ productId: 'P-6001' }),
      });
    });

    it('遇到包含循环引用的复杂嵌套结构时能够防环终止且正常提取候选', () => {
      const circularGoods: Record<string, unknown> = {
        goodsId: 'G-CIRCULAR',
        goodsName: '防环大床房',
        realRoomId: 'RR-SAFE',
        realRoomName: '防环物理房',
      };
      // 构造循环引用
      circularGoods.self = circularGoods;
      circularGoods.nested = { parent: circularGoods };

      const candidates = extractProductsFromFlatList(circularGoods, 'POI-100', 'MEITUAN');
      expect(candidates).toHaveLength(1);
      expect(candidates[0].otaRoomTypeId).toBe('G-CIRCULAR');
      expect(candidates[0].otaRoomTypeName).toBe('防环大床房');
    });
  });

  describe('parseMeituanProductCandidates', () => {
    it('多数据包合并与依据 otaRoomTypeId + otaBasicRoomId 复合去重', () => {
      // 数据包 1：树结构
      const payload1 = {
        data: {
          realRoomRelations: [
            {
              realRoomId: 'ROOM-A',
              realRoomName: '大床房A',
              logicRoomRelations: [
                {
                  goodsList: [
                    { goodsId: 'G-01', goodsName: '商品1', paymentType: 0 },
                    { goodsId: 'G-02', goodsName: '商品2', paymentType: 1 },
                  ],
                },
              ],
            },
          ],
        },
      };

      // 数据包 2：平铺结构（包含重复的 G-01+ROOM-A，以及同 goodsId 但不同房型的 G-01+ROOM-B，以及新商品 G-03）
      const payload2 = {
        items: [
          // 重复项：应被去重忽略
          {
            goodsId: 'G-01',
            goodsName: '商品1_重复包',
            realRoomId: 'ROOM-A',
            realRoomName: '大床房A',
          },
          // 相同 goodsId 但不同 physical room：属于不同复合实体，应保留
          {
            goodsId: 'G-01',
            goodsName: '商品1_跨房型',
            realRoomId: 'ROOM-B',
            realRoomName: '大床房B',
          },
          // 全新商品
          {
            goodsId: 'G-03',
            goodsName: '商品3_独立',
            realRoomId: 'ROOM-C',
            realRoomName: '家庭房C',
          },
        ],
      };

      const results = parseMeituanProductCandidates([payload1, payload2], 'POI-100', 'MEITUAN');

      expect(results).toHaveLength(4);
      // 第一个 G-01 保留来自树结构的解析（'meituan-catalog-tree'）
      expect(results[0].otaRoomTypeId).toBe('G-01');
      expect(results[0].otaBasicRoomId).toBe('ROOM-A');
      expect(results[0].source).toBe('meituan-catalog-tree');

      expect(results[1].otaRoomTypeId).toBe('G-02');
      expect(results[1].otaBasicRoomId).toBe('ROOM-A');

      expect(results[2].otaRoomTypeId).toBe('G-01');
      expect(results[2].otaBasicRoomId).toBe('ROOM-B');

      expect(results[3].otaRoomTypeId).toBe('G-03');
      expect(results[3].otaBasicRoomId).toBe('ROOM-C');
    });

    it('当接口返回非 10000 的业务错误信封时，必须 Fail-Fast 抛出明确异常中断流水线', () => {
      const errorPayload1 = {
        code: 403,
        msg: '无门店产品权限',
      };
      expect(() =>
        parseMeituanProductCandidates([errorPayload1], 'POI-100', 'MEITUAN')
      ).toThrow('美团产品接口返回业务错误: 无门店产品权限');

      const errorPayload2 = {
        code: 500,
        message: '美团商家网关异常',
      };
      expect(() =>
        parseMeituanProductCandidates([errorPayload2], 'POI-100', 'MEITUAN')
      ).toThrow('美团产品接口返回业务错误: 美团商家网关异常');

      const errorPayload3 = {
        code: 'ERR_AUTH',
        error: '登录凭证已失效',
      };
      expect(() =>
        parseMeituanProductCandidates([errorPayload3], 'POI-100', 'MEITUAN')
      ).toThrow('美团产品接口返回业务错误: 登录凭证已失效');

      const errorPayload4 = {
        code: 0,
        message: '其它系统的 0 代码在该接口同样视为异常',
      };
      expect(() =>
        parseMeituanProductCandidates([errorPayload4], 'POI-100', 'MEITUAN')
      ).toThrow('美团产品接口返回业务错误: 其它系统的 0 代码在该接口同样视为异常');
    });

    it('当接口返回 code 为 10000 字符串或数字时，视为正常业务信封正常解析', () => {
      const validPayload = {
        code: 10000,
        error: null,
        data: {
          realRoomRelations: [],
        },
      };
      const results = parseMeituanProductCandidates([validPayload], 'POI-100', 'MEITUAN');
      expect(results).toEqual([]);
    });

    it('能直接解析美团真实 queryListAndTag 响应（含 code: 10000, rpCustomName, paymentType: 0 等）', () => {
      const realSample = {
        code: 10000,
        error: null,
        traceId: '2698672274943435976',
        data: {
          realRoomRelations: [
            {
              realRoomId: 38287230,
              realRoomName: '天萌亲子双床房',
              isConfirmed: 1,
              logicRoomRelations: [
                {
                  roomBaseInfo: {
                    roomId: 404221760,
                    roomName: '天萌亲子双床房',
                  },
                  goodsList: [
                    {
                      goodsId: 1314830652,
                      goodsName: '天萌亲子双床房-不含早-入住当天18:00前免费取消-商旅专享',
                      paymentType: 0,
                      rpCustomName: '商旅专享',
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      const candidates = parseMeituanProductCandidates([realSample], 'POI-TEST', 'MEITUAN');
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        otaChannelCode: 'MEITUAN',
        extUnitCode: 'POI-TEST',
        otaRoomTypeId: '1314830652',
        otaRoomTypeName: '天萌亲子双床房-不含早-入住当天18:00前免费取消-商旅专享',
        otaBasicRoomId: '38287230',
        otaBasicRoomName: '天萌亲子双床房',
        otaRateCodeId: '商旅专享',
        otaPayType: 'PP',
        source: 'meituan-catalog-tree',
      });
    });
  });
});
