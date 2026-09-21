import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
  MEITUAN_RAW_SAMPLE_ORDER,
  MeituanOrderProtocol,
  cleanMeituanOrder,
} from '../../../src/services/protocols/meituanProtocol';
import { cleanChannelOrder } from '../../../src/services/protocols';
import type { ChannelProtocolSchema } from '../../../src/types/template';

describe('meituanProtocol (Channel Protocol & Unified Import Baseline)', () => {
  describe('DEFAULT_MEITUAN_PROTOCOL_SCHEMA', () => {
    it('should declare valid channel code and required fields', () => {
      expect(DEFAULT_MEITUAN_PROTOCOL_SCHEMA.channelCode).toBe('MEITUAN');
      expect(DEFAULT_MEITUAN_PROTOCOL_SCHEMA.channelId).toBe('meituan');
      expect(DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields.length).toBeGreaterThanOrEqual(15);

      const requiredKeys = DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields
        .filter((f) => f.required)
        .map((f) => f.key);

      expect(requiredKeys).toContain('orderNo');
      expect(requiredKeys).toContain('roomName');
      expect(requiredKeys).toContain('checkInDate');
      expect(requiredKeys).toContain('checkOutDate');
      expect(requiredKeys).toContain('floorPrice');
    });
  });

  describe('cleanMeituanOrder & MeituanOrderProtocol', () => {
    it('should throw Fail-Fast error on null or non-object raw payload', () => {
      expect(() => cleanMeituanOrder(null)).toThrow('美团订单原始报文为空或非合法对象');
      expect(() => cleanMeituanOrder('not-json')).toThrow('美团订单原始报文为空或非合法对象');
    });

    it('should clean MEITUAN_RAW_SAMPLE_ORDER correctly using DEFAULT_MEITUAN_PROTOCOL_SCHEMA', () => {
      const channelOrder = cleanMeituanOrder(MEITUAN_RAW_SAMPLE_ORDER);

      expect(channelOrder).toBeInstanceOf(MeituanOrderProtocol);
      expect(channelOrder.channelCode).toBe('MEITUAN');

      // 1. 验证模版变量输出 (getTemplateVariables)
      const vars = channelOrder.getTemplateVariables();
      expect(vars['美团单号']).toBe('5035036057245515034');
      expect(vars['orderNo']).toBe('5035036057245515034');
      expect(vars['房型名称']).toBe('松香大床房');
      expect(vars['roomName']).toBe('松香大床房');
      expect(vars['入住人']).toBe('巨*');
      expect(vars['guestName']).toBe('巨*');
      expect(vars['结算底价']).toBe('239.00');
      expect(vars['floorPrice']).toBe('239.00');
      expect(vars['入住日期']).toBe('2026-09-15');
      expect(vars['离店日期']).toBe('2026-09-16');
      expect(vars['早餐说明']).toBe('不含早');
      expect(vars['特色权益']).toBe('延迟退房至 14:00，共 1 间');
      expect(vars['是否含权益']).toBe(true);
      expect(vars['需酒店开票']).toBe(true); // invoiceParty == 3
      expect(vars['参考开票金额']).toBe('265.55');

      // 2. 验证向统一导入协议投影 (toUnifiedOrder)
      const unified = channelOrder.toUnifiedOrder('这是已渲染的备注');
      expect(unified.otaOrderId).toBe('5035036057245515034');
      expect(unified.otaChannel).toBe('MEITUAN');
      expect(unified.unitId).toBe('1533758592');
      expect(unified.unitName).toBe('禅驿度假酒店（自贡方特恐龙王国店）');
      expect(unified.contact.name).toBe('巨*');
      expect(unified.contact.mobile).toBe('13888889999');
      expect(unified.booking.roomTypeName).toBe('松香大床房');
      expect(unified.booking.roomTypeId).toBe('2532714518'); // goodsId
      expect(unified.booking.arrival).toBe('2026-09-15');
      expect(unified.booking.departure).toBe('2026-09-16');
      expect(unified.booking.nights).toBe(1);
      expect(unified.booking.totalPrice).toBe(239);
      expect(unified.booking.floorPrice).toBe(239);
      expect(unified.booking.paytype).toBe('预付');
      expect(unified.booking.pricing).toEqual([
        { date: '2026-09-15', price: 265.55 },
      ]);
      expect(unified.remark).toBe('这是已渲染的备注');
      expect(unified.rawPayload).toBe(MEITUAN_RAW_SAMPLE_ORDER);
    });

    it('should throw ProtocolNormalizationError when required fields are missing', () => {
      const brokenPayload = {
        data: {
          // 缺少 orderId, roomName, checkInDateString, checkOutDateString, floorPrice
          someRandomField: 123,
        },
      };

      expect(() => cleanMeituanOrder(brokenPayload)).toThrow('[协议漂移告警]');
    });

    it('should support custom schema if provided', () => {
      const customSchema: ChannelProtocolSchema = {
        channelId: 'meituan_custom',
        channelCode: 'MEITUAN',
        version: '1.0',
        updatedAt: '2026-09-21',
        fields: [
          {
            key: 'orderNo',
            label: '美团单号',
            path: 'customId',
            category: 'basic',
            transform: 'string',
            enabled: true,
            required: true,
          },
        ],
      };

      const customPayload = {
        customId: 'CUSTOM-999',
        data: {
          roomName: '自定义大床房',
          checkInDateString: '2026-10-01',
          checkOutDateString: '2026-10-02',
          floorPrice: 20000,
        },
      };

      const order = cleanMeituanOrder(customPayload, customSchema);
      expect(order.getTemplateVariables()['orderNo']).toBe('CUSTOM-999');
      expect(order.toUnifiedOrder('').otaOrderId).toBe('CUSTOM-999');
    });

    it('should derive UnifiedOrderProtocol strictly from context when raw is empty object', () => {
      const pureContext = {
        orderNo: 'MT-10086',
        unitId: 'UNIT-999',
        unitName: '测试酒店',
        guestName: '张三',
        contactPhone: '13912345678',
        roomName: '豪华湖景房',
        roomTypeId: 'ROOM-888',
        rateCode: 'PROMO_BAR',
        checkInDate: '2026-11-01',
        checkOutDate: '2026-11-03',
        nights: 2,
        roomCount: 1,
        floorPrice: 600,
        pricing: [
          { date: '2026-11-01', price: 300 },
          { date: '2026-11-02', price: 300 },
        ],
      };

      const protocol = new MeituanOrderProtocol(pureContext, {});
      const unified = protocol.toUnifiedOrder('自动备注');

      expect(unified.otaOrderId).toBe('MT-10086');
      expect(unified.unitId).toBe('UNIT-999');
      expect(unified.unitName).toBe('测试酒店');
      expect(unified.contact.name).toBe('张三');
      expect(unified.contact.mobile).toBe('13912345678');
      expect(unified.booking.roomTypeName).toBe('豪华湖景房');
      expect(unified.booking.roomTypeId).toBe('ROOM-888');
      expect(unified.booking.rateCode).toBe('PROMO_BAR');
      expect(unified.booking.arrival).toBe('2026-11-01');
      expect(unified.booking.departure).toBe('2026-11-03');
      expect(unified.booking.nights).toBe(2);
      expect(unified.booking.totalPrice).toBe(600);
      expect(unified.booking.floorPrice).toBe(600);
      expect(unified.booking.pricing).toEqual([
        { date: '2026-11-01', price: 300 },
        { date: '2026-11-02', price: 300 },
      ]);
      expect(unified.remark).toBe('自动备注');
      expect(unified.rawPayload).toEqual({});
    });

    it('should derive UnifiedOrderProtocol from Chinese alias context keys', () => {
      const chineseContext = {
        美团单号: 'MT-ALIAS-1',
        门店ID: 'UNIT-CH-1',
        门店名称: '中文测试酒店',
        入住人: '李四',
        真实联系电话: '13700001111',
        房型名称: '静谧大床房',
        房型商品ID: 'GOODS-CH-1',
        价格方案: 'BAR',
        入住日期: '2026-12-01',
        离店日期: '2026-12-02',
        结算底价: 180,
      };

      const protocol = new MeituanOrderProtocol(chineseContext, {});
      const unified = protocol.toUnifiedOrder('别名备注');

      expect(unified.otaOrderId).toBe('MT-ALIAS-1');
      expect(unified.unitId).toBe('UNIT-CH-1');
      expect(unified.unitName).toBe('中文测试酒店');
      expect(unified.contact.name).toBe('李四');
      expect(unified.contact.mobile).toBe('13700001111');
      expect(unified.booking.roomTypeName).toBe('静谧大床房');
      expect(unified.booking.roomTypeId).toBe('GOODS-CH-1');
      expect(unified.booking.rateCode).toBe('BAR');
      expect(unified.booking.arrival).toBe('2026-12-01');
      expect(unified.booking.departure).toBe('2026-12-02');
      expect(unified.booking.nights).toBe(1);
      expect(unified.booking.totalPrice).toBe(180);
      expect(unified.booking.pricing).toEqual([
        { date: '2026-12-01', price: 180 },
      ]);
    });
  });

  describe('cleanChannelOrder (Channel Router)', () => {
    it('should dispatch MEITUAN channel code to cleanMeituanOrder', () => {
      const channelOrder = cleanChannelOrder('MEITUAN', MEITUAN_RAW_SAMPLE_ORDER);
      expect(channelOrder).toBeInstanceOf(MeituanOrderProtocol);
      expect(channelOrder.channelCode).toBe('MEITUAN');
    });

    it('should throw error for unsupported channel code', () => {
      expect(() => cleanChannelOrder('UNKNOWN_CHANNEL', {})).toThrow(
        '[ProtocolRouter] 暂未实现渠道「UNKNOWN_CHANNEL」的订单协议清洗器'
      );
    });
  });
});
