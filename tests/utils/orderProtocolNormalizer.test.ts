import { describe, it, expect } from 'vitest';
import { alignOrderToProtocol } from '../../src/utils/template/orderProtocolNormalizer';
import type { ExtractedOrderDetail } from '../../src/crawler/duty/dutyContracts';

describe('orderProtocolNormalizer (Raw Order -> Domain Order Protocol)', () => {
  const sampleMeituanDetail: ExtractedOrderDetail = {
    otaOrderId: 'MT-100200300',
    otaChannel: 'MEITUAN',
    unitId: 'HOTEL-UNIT-1',
    unitName: '自贡迎宾大酒店',
    guestName: '张小泉',
    guestMobile: '13812345678',
    roomTypeName: '高级商务大床房',
    arrival: '2026-09-20',
    departure: '2026-09-22',
    nights: 2,
    quantity: 1,
    totalPrice: 600,
    raw: {
      remark: '客人要求高楼层',
      goodsId: 'GOODS-999',
      paymentType: '预付',
      data: {
        orderId: 'MT-100200300',
        roomName: '高级商务大床房',
        floorPrice: 50000,
        checkInDateString: '2026-09-20 00:00:00',
        checkOutDateString: '2026-09-22 00:00:00',
        invoiceTagModel: {
          invoiceParty: 3,
          invoiceMoney: 60000,
        },
      },
    },
  };

  it('should align raw Meituan order into structured OrderProtocolData and clean variables', () => {
    const protocolData = alignOrderToProtocol(sampleMeituanDetail, 'MEITUAN');

    expect(protocolData.otaOrderId).toBe('MT-100200300');
    expect(protocolData.otaChannel).toBe('MEITUAN');
    expect(protocolData.unitId).toBe('HOTEL-UNIT-1');
    expect(protocolData.guestName).toBe('张小泉');
    expect(protocolData.guestMobile).toBe('13812345678');
    expect(protocolData.roomTypeName).toBe('高级商务大床房');
    expect(protocolData.roomTypeId).toBe('GOODS-999');
    expect(protocolData.arrival).toBe('2026-09-20');
    expect(protocolData.departure).toBe('2026-09-22');
    expect(protocolData.nights).toBe(2);
    expect(protocolData.quantity).toBe(1);
    expect(protocolData.totalPrice).toBe(600);
    expect(protocolData.paytype).toBe('预付');
    expect(protocolData.rawRemark).toBe('客人要求高楼层');

    // 验证按日价格明细均分
    expect(protocolData.pricing).toHaveLength(2);
    expect(protocolData.pricing[0]).toEqual({ date: '2026-09-20', price: 300 });
    expect(protocolData.pricing[1]).toEqual({ date: '2026-09-21', price: 300 });

    // 验证协议上下文变量
    expect(protocolData.contextVariables['OTA订单号']).toBe('MT-100200300');
    expect(protocolData.contextVariables['入住人']).toBe('张小泉');
    expect(protocolData.contextVariables['房型名称']).toBe('高级商务大床房');
    expect(protocolData.contextVariables['需酒店开票']).toBe(true);
    expect(protocolData.contextVariables['结算底价']).toBe('500.00');
  });

  it('should preserve explicit raw pricing array when provided in detail.raw', () => {
    const detailWithPricing: ExtractedOrderDetail = {
      ...sampleMeituanDetail,
      raw: {
        ...sampleMeituanDetail.raw,
        pricing: [
          { date: '2026-09-20', price: 280 },
          { date: '2026-09-21', price: 320 },
        ],
      },
    };

    const protocolData = alignOrderToProtocol(detailWithPricing, 'MEITUAN');
    expect(protocolData.pricing).toEqual([
      { date: '2026-09-20', price: 280 },
      { date: '2026-09-21', price: 320 },
    ]);
  });

  it('should handle order without raw payload gracefully with standard context variables', () => {
    const simpleDetail: ExtractedOrderDetail = {
      otaOrderId: 'SIMPLE-123',
      otaChannel: 'CTRIP',
      guestName: '李四',
      roomTypeName: '大床房',
      arrival: '2026-10-01',
      departure: '2026-10-02',
      nights: 1,
      quantity: 1,
      totalPrice: 200,
    };

    const protocolData = alignOrderToProtocol(simpleDetail, 'CTRIP');
    expect(protocolData.otaOrderId).toBe('SIMPLE-123');
    expect(protocolData.roomTypeId).toBe('ROOM_DEFAULT');
    expect(protocolData.pricing).toEqual([{ date: '2026-10-01', price: 200 }]);
    expect(protocolData.contextVariables['入住人']).toBe('李四');
    expect(protocolData.contextVariables['间夜数']).toBe('1间夜');
  });
});
