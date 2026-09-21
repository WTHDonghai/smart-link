import { describe, it, expect } from 'vitest';
import {
  renderRemarkFromVariables,
  buildImportPayloadFromUnifiedOrder,
} from '../../src/utils/template/orderPayloadTransformer';
import type { UnifiedOrderProtocol } from '../../src/types/template';

describe('orderPayloadTransformer (UnifiedOrderProtocol & Remark Rendering)', () => {
  const sampleContext = {
    'OTA订单号': 'MT-888999',
    '入住人': '王五',
    '房型名称': '豪华商务套房',
    '间夜数': '2间夜',
    '底价': '1200',
    '渠道来源': 'MEITUAN',
    '需酒店开票': true,
  };

  const sampleUnifiedOrder: UnifiedOrderProtocol = {
    otaOrderId: 'MT-888999',
    otaChannel: 'MEITUAN',
    unitId: 'HOTEL-101',
    contact: {
      name: '王五',
      mobile: '13900001111',
    },
    booking: {
      roomTypeName: '豪华商务套房',
      originRoomType: '豪华商务套房',
      roomTypeId: 'RT-VIP',
      rateCode: 'OTA_PROMO',
      arrival: '2026-09-25',
      departure: '2026-09-27',
      nights: 2,
      quantity: 1,
      totalPrice: 1200,
      floorPrice: 1200,
      paytype: '预付',
      pricing: [
        { date: '2026-09-25', price: 600 },
        { date: '2026-09-26', price: 600 },
      ],
    },
    remark: '【MEITUAN】单号:MT-888999 | 住客:王五',
  };

  describe('renderRemarkFromVariables', () => {
    it('should evaluate template expressions and assemble text based on context variables', () => {
      const template =
        '【{{渠道来源}}】单号:{{OTA订单号}} | 住客:{{入住人}} | 房型:{{房型名称}} | {{#if 需酒店开票}}请开专票{{#else}}不开票{{/if}}';

      const remark = renderRemarkFromVariables(sampleContext, template);
      expect(remark).toBe('【MEITUAN】单号:MT-888999 | 住客:王五 | 房型:豪华商务套房 | 请开专票');
    });

    it('should fallback to raw remark when template is null or empty', () => {
      expect(renderRemarkFromVariables(sampleContext, null, '原始备注: 无烟房')).toBe('原始备注: 无烟房');
      expect(renderRemarkFromVariables(sampleContext, '', '原始备注: 无烟房')).toBe('原始备注: 无烟房');
      expect(renderRemarkFromVariables(sampleContext, '   ', '原始备注: 无烟房')).toBe('原始备注: 无烟房');
    });

    it('should fallback to raw remark when template has syntax error', () => {
      const brokenTemplate = '【单号】{{#if unclosedTag}}文本内容';
      const remark = renderRemarkFromVariables(sampleContext, brokenTemplate, '原始备注: 无烟房');
      expect(remark).toBe('原始备注: 无烟房');
    });
  });

  describe('buildImportPayloadFromUnifiedOrder', () => {
    it('should transform UnifiedOrderProtocol and remark into standard ImportPayload contract', () => {
      const payload = buildImportPayloadFromUnifiedOrder(sampleUnifiedOrder, 'EXT-HOTEL-88');

      expect(payload).toEqual({
        extUnitCode: 'EXT-HOTEL-88',
        orders: [
          {
            otaOrderId: 'MT-888999',
            otaChannel: 'MEITUAN',
            contact: {
              name: '王五',
              mobile: '13900001111',
            },
            booking: {
              roomType: '豪华商务套房',
              originRoomType: '豪华商务套房',
              rateCode: 'OTA_PROMO',
              arrival: '2026-09-25',
              departure: '2026-09-27',
              roomTypeId: 'RT-VIP',
              nights: 2,
              quantity: 1,
              totalPrice: 1200,
              paytype: '预付',
              pricing: [
                { date: '2026-09-25', price: 600 },
                { date: '2026-09-26', price: 600 },
              ],
            },
            remark: '【MEITUAN】单号:MT-888999 | 住客:王五',
          },
        ],
      });
    });
  });
});
