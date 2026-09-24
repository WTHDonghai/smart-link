import { describe, it, expect } from 'vitest';
import { cleanMeituanOrder } from '../../../src/services/protocols/meituanProtocol';

/**
 * 美团生产真实报文样本（由一线业务提供的真实报文）
 * 包含优惠券、神券、会员折扣、priceInfo 每日结算价以及取消状态等全套指标
 */
export const MEITUAN_PRODUCTION_REAL_ORDER_SAMPLE = {
  data: {
    address: '成都市长寿路6号附6号',
    agreementHosting: false,
    appointmentStatus: 1070,
    aptCreatTime: 1790234311000,
    aptCreatTimeString: '2026-09-24 15:18:31',
    arriveTime: 1790661600000,
    arriveTimeStr: '2026-09-29 14:00:00',
    autoAccept: 0,
    autoOrderConfirm: 1,
    bizCardCounts: 11732,
    bizEnterprisePrice: null,
    bizPromotionDetail: [
      {
        additionalText: '',
        bizMoney: 413,
        bizMoneyLocal: 0,
        bizPromotionType: 1,
        hoverText: '',
        hoverType: 0,
        tagInfo: '首住折扣',
        tagInfo4En: 'New Guest Discount',
      },
      {
        additionalText: '',
        bizMoney: 1000,
        bizMoneyLocal: 0,
        bizPromotionType: 1,
        hoverText: '',
        hoverType: 0,
        tagInfo: '马上来财',
        tagInfo4En: '马上来财',
      },
      {
        additionalText: '',
        bizMoney: 2064,
        bizMoneyLocal: 0,
        bizPromotionType: 1,
        hoverText: '',
        hoverType: 0,
        tagInfo: '天天特价',
        tagInfo4En: 'Basic Deal',
      },
      {
        additionalText: '',
        bizMoney: 2064,
        bizMoneyLocal: 0,
        bizPromotionType: 2,
        hoverText: '',
        hoverType: 0,
        tagInfo: '美团神券',
        tagInfo4En: '美团神券',
      },
      {
        additionalText: '',
        bizMoney: 6191,
        bizMoneyLocal: 0,
        bizPromotionType: 1,
        hoverText: '',
        hoverType: 0,
        tagInfo: '黄金会员8.5折',
        tagInfo4En: '黄金会员8.5折',
      },
    ],
    bizRefund: false,
    bizSmsContact: true,
    blackFlag: '',
    bookSucTime: 1790234506000,
    bookSucTimeString: '2026-09-24 15:21:46',
    booking2CancelDiffTime: 0,
    bookingTime: 1790234311000,
    bookingTimeString: '2026-09-24 15:18:31',
    breakfastInfo: [
      {
        breakfastDate: '2026-09-29 00:00:00',
        breakfastDesc: '不含早',
        paymentUnitId: '3803962976768182158',
      },
    ],
    cancelFee: 0,
    cancelOrder: false,
    cancelRules: [],
    cardCounts: 1876,
    cards: [
      {
        activeTag: null,
        activityId: 680279116226435500,
        comment: '',
        money: 2400,
        status: 1,
        title: '酒店神券',
      },
      {
        activeTag: 11,
        activityId: 1410671016,
        comment: '此活动由商家发起，活动促销费由商家承担',
        money: 500,
        status: null,
        title: '首住折扣',
      },
      {
        activeTag: 2,
        activityId: 1342857567,
        comment: '本活动为津贴层活动，与同津贴层及人群层活动不可叠加，与其它基础层商促活动可叠加。每间夜立减X元。',
        money: 1000,
        status: null,
        title: '马上来财（满减）',
      },
      {
        activeTag: 0,
        activityId: 1429616971,
        comment: '美团酒店会员尽享折扣',
        money: 7100,
        status: null,
        title: '会员价-安得天馨酒店-781913923-1664625157412',
      },
      {
        activeTag: 2,
        activityId: 72057594117151650,
        comment: '此活动由商家发起，活动促销费由商家承担',
        money: 2400,
        status: null,
        title: '天天特价',
      },
      {
        activeTag: 0,
        activityId: 2098789727,
        comment: '2024C4优价最终版-2026新逻辑',
        money: 1876,
        status: null,
        title: '2024C4优价最终版-2026新逻辑',
      },
    ],
    channelLabel: false,
    checkInDate: 1790611200000,
    checkInDateModels: [
      {
        checkInDate: 1790611200000,
        checkInDateString: '2026-09-29 00:00:00',
        pricePerRoom: 46900,
        refundedRoomNightsCnt: 1,
        roomNightsInfo: [
          {
            checkInTimeStamp: 1790611200000,
            checkInTimeStampString: '2026-09-29 00:00:00',
            commission: 5628,
            id: '3803962976768182158',
            mtSoldPrice: 46900,
            refundMoney: 0,
            refundReason: null,
            refunded: false,
            roomType: '',
            roomUser: '',
          },
        ],
      },
    ],
    checkInDateString: '2026-09-29 00:00:00',
    checkInStatus: 8,
    checkInType: 0,
    checkOutDate: 1790697600000,
    checkOutDateString: '2026-09-30 00:00:00',
    commission: 5628,
    commissionDescModel: {
      subRatioDesc: '',
      wxAndLowSub: false,
    },
    contacts: [
      {
        carLicenses: [],
        email: '',
        identity: '',
        name: '刘**',
        phone: '',
        roomIndex: null,
      },
    ],
    containerStatus: 0,
    continueLiveOrder: false,
    crsPromotionCode: '',
    dawnFlag: 0,
    deliveryOrder: 0,
    departure: null,
    discountType: 2,
    displayedSeparatelyOutsideList: [],
    distributorId: 1,
    donationInfo: null,
    dynamicCouponServicePrice: null,
    ebSaveOrder: false,
    enterpriseName: '',
    extensionRoomNum: '',
    extraPrice: -1,
    fixRoom: true,
    floorPrice: 29540,
    freeTip: 0,
    freeTipPrice: 46900,
    fuseInfo: null,
    fxFloorInvoiceInfo: null,
    goodsId: 1089535731,
    goodsInfos: [],
    goodsTagCode: 0,
    goodsType: 1,
    goodsVersion: 1,
    greenChannelMark: 0,
    guaranteeType: 0,
    guests: [
      {
        carLicenses: [],
        email: '',
        identity: '',
        name: '刘**',
        phone: '',
        roomIndex: null,
      },
    ],
    hasKickOutPrice: false,
    hasPromotion: true,
    hourRoomTime: null,
    imMark: 0,
    independentDisplayPrice: [],
    inquiryPrice: false,
    insuranceClaim: 0,
    invDetailModel: null,
    invoiceDisplayInfo: {
      invoiceRequireDesc: '若客人索取发票，请贵酒店开具，参考开票金额：¥0.00',
      showDetail: false,
    },
    invoiceMark: 0,
    invoicePartyTagNewLogic: true,
    invoiceTagModel: {
      invoiceAppointment: 0,
      invoiceCanCreate: true,
      invoiceIsAppointed: false,
      invoiceMoney: 0,
      invoiceParty: 3,
    },
    isAdvertise: false,
    isCashPayChange: false,
    isOccupiedTransSuc: null,
    keyTags: [],
    kickOutNewPolicyOrder: false,
    kickOutPrice: null,
    longAcceptTimeMark: false,
    lookSensitive: true,
    lowerCarbon: null,
    memberBenefits: 1,
    memberBenefitsWord: ['黄金会员专享8.5折'],
    memberCommissionRiskControlMark: 0,
    memberDisplayMode: 1,
    memberLevel: 3,
    memberMark: 0,
    modifyGuest: false,
    newOrderId: '',
    nonRoomAddOnPopInfo: null,
    nonRoomOrder: null,
    occupiedMark: 0,
    offLine: 0,
    orderBasePriceModel: {
      amountDetailList: [],
      bizPromotionDetails: [],
      commission: {
        originalPrice: 5628,
        originalPriceLocal: 0,
        price: 5628,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: false,
      },
      floorAwardPrice: null,
      floorPrice: {
        originalPrice: 41272,
        originalPriceLocal: 0,
        price: 29540,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: true,
      },
      kickOutPrice: {
        originalPrice: 0,
        originalPriceLocal: 0,
        price: 0,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: false,
      },
      preSettlementInfo: {
        partnerIncome: '￥0.00',
        refundByMoneyList: [],
        statementPeriod: '2026-09-28 至 2026-10-04',
      },
      promotionPrice: {
        originalPrice: 11732,
        originalPriceLocal: 0,
        price: 11732,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: false,
      },
      salePrice: {
        originalPrice: 46900,
        originalPriceLocal: 0,
        price: 35168,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: true,
      },
      subRatio: {
        originalPrice: 0,
        originalPriceLocal: 0,
        price: 0,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: false,
      },
    },
    orderContacts: [],
    orderDisplayLabel: '取消',
    orderId: '5035036080553098350',
    orderLabel: 0,
    orderPassAdPrice: null,
    orderPricePattern: 1,
    orderStatusExplain: '',
    orderType: 4,
    originOrRescheduled: 0,
    ownerPhones: [],
    packageBaseInfos: [],
    packageMark: 0,
    packageRoom: 2,
    partnerId: 4536482,
    partnerName: '四川常寿顺顺酒店管理有限公司',
    payTime: 1790234399000,
    payTimeString: '2026-09-24 15:19:59',
    paymentType: 0,
    poiId: 781913923,
    poiIdStr: '781913923',
    poiName: '成都安得天馨Wellness Resort酒店',
    pointDeductionTip: '',
    preSettlementInfo: {
      partnerIncome: '0.00',
      refundByMoneyList: [],
      statementPeriod: '2026-09-28 至 2026-10-04',
    },
    pretender: false,
    price: 35168,
    priceInfo: [
      {
        commission: 5628,
        date: 1790611200000,
        dateString: '2026-09-29 00:00:00',
        floorPrice: 29540,
        paymentUnitId: '3803962976768182158',
        price: 35168,
        subRatio: 1200,
        subRatioDesc: '',
        wxAndLowSub: false,
      },
    ],
    priceInfoConstitute: [
      {
        commission: 5628,
        date: 1790611200000,
        dateString: '2026-09-29 00:00:00',
        floorPrice: 29540,
        paymentUnitId: '3803962976768182158',
        price: 35168,
        subRatio: 1200,
        subRatioDesc: '',
        wxAndLowSub: false,
      },
    ],
    priceMode: 9,
    realCommission: 5628,
    realFloorPrice: 29540,
    roomCount: 1,
    roomDesc: '',
    roomId: 293357882,
    roomName: '安澜大床客房[错峰出游]',
    status: 'CANCELED',
    totalFee: 31624,
    totalOriginFloorPrice: 41272,
    userId: 1789870279,
  },
  message: '成功',
  status: 0,
};

describe('美团真实接口原始报文测试验证 (Meituan Production Raw Payload Verification)', () => {
  it('应能够直接接收并清洗美团生产完整原始报文，精确提取所有字段', () => {
    const channelOrder = cleanMeituanOrder(MEITUAN_PRODUCTION_REAL_ORDER_SAMPLE);

    // 1. 验证模版上下文变量字典 (getTemplateVariables)
    const vars = channelOrder.getTemplateVariables();
    expect(vars['美团单号']).toBe('5035036080553098350');
    expect(vars['orderNo']).toBe('5035036080553098350');
    expect(vars['订单状态']).toBe('取消');
    expect(vars['orderStatus']).toBe('取消');
    expect(vars['门店ID']).toBe('781913923');
    expect(vars['门店名称']).toBe('成都安得天馨Wellness Resort酒店');
    expect(vars['房型商品ID']).toBe('1089535731');
    expect(vars['房型名称']).toBe('安澜大床客房[错峰出游]');
    expect(vars['入住人']).toBe('刘**');
    expect(vars['入住日期']).toBe('2026-09-29');
    expect(vars['离店日期']).toBe('2026-09-30');
    expect(vars['间夜数']).toBe(1);
    expect(vars['结算底价']).toBe('295.40');
    expect(vars['OTA售价']).toBe('351.68');
    expect(vars['早餐说明']).toBe('不含早');
    expect(vars['需酒店开票']).toBe(true);
    expect(vars['参考开票金额']).toBe('0.00');

    // 2. 验证每日价格 pricing：必须严格来自 priceInfo[0].floorPrice (295.40)，绝不取 checkInDateModels 的 469.00
    expect(vars['pricing']).toEqual([
      { date: '2026-09-29', price: 295.4 },
    ]);
    expect(vars['每日价格']).toEqual([
      { date: '2026-09-29', price: 295.4 },
    ]);

    // 3. 验证投影为中台标准 UnifiedOrderProtocol 实体
    const unified = channelOrder.toUnifiedOrder('【自动入单】渠道无早，已由系统处理');
    expect(unified.otaOrderId).toBe('5035036080553098350');
    expect(unified.otaChannel).toBe('MEITUAN');
    expect(unified.unitId).toBe('781913923');
    expect(unified.unitName).toBe('成都安得天馨Wellness Resort酒店');
    expect(unified.contact.name).toBe('刘**');
    expect(unified.booking.roomTypeName).toBe('安澜大床客房[错峰出游]');
    expect(unified.booking.roomTypeId).toBe('1089535731');
    expect(unified.booking.arrival).toBe('2026-09-29');
    expect(unified.booking.departure).toBe('2026-09-30');
    expect(unified.booking.nights).toBe(1);
    expect(unified.booking.quantity).toBe(1);
    expect(unified.booking.totalPrice).toBe(295.4);
    expect(unified.booking.floorPrice).toBe(295.4);
    expect(unified.booking.paytype).toBe('预付');
    expect(unified.booking.pricing).toEqual([
      { date: '2026-09-29', price: 295.4 },
    ]);
    expect(unified.remark).toBe('【自动入单】渠道无早，已由系统处理');
  });
});
