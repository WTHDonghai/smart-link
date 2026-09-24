/**
 * 美团订单协议规范与默认 Schema 定义 (Meituan Protocol Specification & Presets)
 * 将 150+ 繁杂字段裁剪归纳为 15 个高频业务指标
 */

import type {
  ChannelProtocolSchema,
  CleanOrderContext,
  IChannelOrderProtocol,
  OrderProtocolPricing,
  UnifiedOrderProtocol,
} from '../../types/template';
import { normalizeOrderPayload } from '../../utils/template/protocolNormalizer';

/** 美团真实订单协议样本数据 (源自生产采集报文) */
export const MEITUAN_RAW_SAMPLE_ORDER = {
  data: {
    address: 'xx市北xx路xx号',
    agreementHosting: false,
    appointmentStatus: 1110,
    aptCreatTime: 1789443464000,
    aptCreatTimeString: '2026-09-15 11:37:44',
    arriveTime: 1789452000000,
    arriveTimeStr: '2026-09-15 14:00:00',
    autoAccept: 0,
    autoOrderConfirm: 1,
    bizCardCounts: 0,
    bizEnterprisePrice: null,
    bizPromotionDetail: [],
    bizRefund: true,
    bizSmsContact: true,
    blackFlag: '',
    bookSucTime: 1789443490000,
    bookSucTimeString: '2026-09-15 11:38:10',
    booking2CancelDiffTime: 0,
    bookingTime: 1789443464000,
    bookingTimeString: '2026-09-15 11:37:44',
    breakfastInfo: [
      {
        breakfastDate: '2026-09-15 00:00:00',
        breakfastDesc: '不含早',
        paymentUnitId: '3803026324567222330',
      },
    ],
    cancelFee: 0,
    cancelOrder: false,
    cancelRules: [],
    cardCounts: 0,
    cards: [],
    channelLabel: false,
    checkInDate: 1789401600000,
    checkInDateModels: [
      {
        checkInDate: 1789401600000,
        checkInDateString: '2026-09-15 00:00:00',
        pricePerRoom: 26555,
        refundedRoomNightsCnt: 0,
        roomNightsInfo: [
          {
            checkInTimeStamp: 1789401600000,
            checkInTimeStampString: '2026-09-15 00:00:00',
            commission: 2655,
            id: '3803026324567222330',
            mtSoldPrice: 26555,
            refundMoney: 0,
            refundReason: null,
            refunded: false,
            roomType: '',
            roomUser: '',
          },
        ],
      },
    ],
    checkInDateString: '2026-09-15 00:00:00',
    checkInStatus: 4,
    checkInType: 0,
    checkOutDate: 1789488000000,
    checkOutDateString: '2026-09-16 00:00:00',
    commission: 2655,
    commissionDescModel: {
      subRatioDesc: '',
      wxAndLowSub: false,
    },
    contacts: [
      {
        carLicenses: [],
        email: '',
        identity: '',
        name: '巨*',
        phone: '13888889999',
        roomIndex: null,
      },
    ],
    containerStatus: 0,
    continueLiveOrder: false,
    crsPromotionCode: '',
    dawnFlag: 0,
    deliveryOrder: 0,
    departure: null,
    discountType: 0,
    displayedSeparatelyOutsideList: [],
    distributorId: 1,
    donationInfo: {
      charityAmount: 10,
      charityOrder: true,
    },
    dynamicCouponServicePrice: null,
    ebSaveOrder: false,
    enterpriseName: '',
    extensionRoomNum: '',
    extraPrice: -1,
    fixRoom: false,
    floorPrice: 23900,
    freeTip: 0,
    freeTipPrice: 26555,
    fuseInfo: null,
    fxFloorInvoiceInfo: null,
    goodsId: 2532714518,
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
        name: '巨*',
        phone: '',
        roomIndex: null,
      },
    ],
    hasKickOutPrice: false,
    hasPromotion: false,
    hourRoomTime: null,
    imMark: 0,
    independentDisplayPrice: [],
    inquiryPrice: false,
    insuranceClaim: 0,
    invDetailModel: null,
    invoiceDisplayInfo: {
      invoiceRequireDesc: '若客人索取发票，请贵酒店开具，参考开票金额：¥265.55',
      showDetail: false,
    },
    invoiceMark: 0,
    invoicePartyTagNewLogic: true,
    invoiceTagModel: {
      invoiceAppointment: 0,
      invoiceCanCreate: true,
      invoiceIsAppointed: false,
      invoiceMoney: 26555,
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
    memberBenefits: 0,
    memberBenefitsWord: [],
    memberCommissionRiskControlMark: 0,
    memberDisplayMode: 1,
    memberLevel: 5,
    memberMark: null,
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
        originalPrice: 2655,
        originalPriceLocal: 0,
        price: 2655,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: false,
      },
      floorAwardPrice: null,
      floorPrice: {
        originalPrice: 23900,
        originalPriceLocal: 0,
        price: 23900,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: false,
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
        partnerIncome: '￥238.90',
        refundByMoneyList: [],
        statementPeriod: '2026-09-14 至 2026-09-20',
      },
      promotionPrice: {
        originalPrice: 0,
        originalPriceLocal: 0,
        price: 0,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: false,
      },
      salePrice: {
        originalPrice: 26555,
        originalPriceLocal: 0,
        price: 26555,
        priceDesc: '',
        priceLocal: 0,
        showOriginalPrice: false,
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
    orderDisplayLabel: '新订',
    orderId: '5035036057245515034',
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
    partnerId: 4551093,
    partnerName: 'xxxx酒店有限公司',
    payTime: 1789443465000,
    payTimeString: '2026-09-15 11:37:45',
    paymentType: 0,
    poiId: 1533758592,
    poiIdStr: '1533758592',
    poiName: '西软度假酒店',
    pointDeductionTip: '',
    preSettlementInfo: {
      partnerIncome: '238.90',
      refundByMoneyList: [],
      statementPeriod: '2026-09-14 至 2026-09-20',
    },
    pretender: false,
    price: 26555,
    priceInfo: [
      {
        commission: 2655,
        date: 1789401600000,
        dateString: '2026-09-15 00:00:00',
        floorPrice: 23900,
        paymentUnitId: '3803026324567222330',
        price: 26555,
        subRatio: 0,
        subRatioDesc: '',
        wxAndLowSub: false,
      },
    ],
    rightsModelList: [
      {
        autoConfirmSource: null,
        remindMsg: '',
        rightsCode: 'YCTF',
        rightsConfirmType: '',
        rightsCostDesc: '',
        rightsId: '6000',
        rightsItemModelList: [
          {
            expandDesc: '',
            itemRemindText: '',
            itemText: '可履约（接单后自动确认）',
            itemType: 0,
          },
        ],
        rightsItemStatus: 2,
        rightsName: '延迟退房',
        rightsPerformanceStatus: 1,
        rightsServiceBriefDesc: '',
        rightsServiceDesc: '延迟退房至 14:00，共 1 间',
        rightsServiceDetailDesc: '',
        simpleStatusDesc: '可履约（接单后自动确认）',
      },
    ],
    rightsNames: ['延迟退房'],
    rightsNeedConfirm: 1,
    rightsStatus: 2,
    roomCount: 1,
    roomDesc: '',
    roomId: 993699675,
    roomName: '豪华大床房',
    status: 'CONSUMED',
    todayCheckIn: true,
    totalFee: 26555,
    totalOriginFloorPrice: 23900,
    urgent: 0,
    userId: 263280280,
  },
  message: '成功',
  status: 0,
};

/** 美团精炼协议 Schema：将 150+ 字段裁剪精简为 16 个高频核心业务指标 */
export const DEFAULT_MEITUAN_PROTOCOL_SCHEMA: ChannelProtocolSchema = {
  channelId: 'meituan',
  channelCode: 'MEITUAN',
  version: '2026.09',
  updatedAt: '2026-09-16 12:00:00',
  fields: [
    // 1. 基础信息
    {
      key: 'orderNo',
      label: '美团单号',
      path: 'data.orderId',
      category: 'basic',
      transform: 'string',
      sampleValue: '5035036057245515034',
      description: '美团平台订单唯一流水号',
      enabled: true,
      required: true,
    },
    {
      key: 'orderStatus',
      label: '订单状态',
      path: 'data.orderDisplayLabel',
      category: 'basic',
      transform: 'string',
      sampleValue: '新订',
      description: '美团前台展示状态标签',
      enabled: true,
    },
    {
      key: 'orderTime',
      label: '下单时间',
      path: 'data.aptCreatTimeString',
      category: 'basic',
      transform: 'string',
      sampleValue: '2026-09-15 11:37:44',
      description: '客人下单创建时间',
      enabled: true,
    },

    // 2. 酒店房型与门店
    {
      key: 'unitId',
      label: '门店ID',
      path: 'data.poiId',
      category: 'hotel',
      transform: 'string',
      sampleValue: '1533758592',
      description: '美团商家门店或POI唯一标识',
      enabled: true,
    },
    {
      key: 'unitName',
      label: '门店名称',
      path: 'data.poiName',
      category: 'hotel',
      transform: 'string',
      sampleValue: '禅驿度假酒店（自贡方特恐龙王国店）',
      description: '美团商家门店名称',
      enabled: true,
    },
    {
      key: 'roomTypeId',
      label: '房型商品ID',
      path: 'data.goodsId',
      category: 'hotel',
      transform: 'string',
      sampleValue: '2532714518',
      description: '美团售卖产品或房型ID',
      enabled: true,
    },
    {
      key: 'rateCode',
      label: '价格方案',
      path: 'data.ratePlanName',
      category: 'hotel',
      transform: 'string',
      sampleValue: 'OTA',
      description: '美团价格方案代码或名称',
      enabled: true,
    },
    {
      key: 'roomName',
      label: '房型名称',
      path: 'data.roomName',
      category: 'hotel',
      transform: 'string',
      sampleValue: '松香大床房',
      description: '美团售卖房型物理名称',
      enabled: true,
      required: true,
    },
    {
      key: 'roomCount',
      label: '房间间数',
      path: 'data.roomCount',
      category: 'hotel',
      transform: 'string',
      sampleValue: '1',
      description: '本次预订房间数量',
      enabled: true,
    },

    // 3. 入离时间
    {
      key: 'checkInDate',
      label: '入住日期',
      path: 'data.checkInDateString',
      category: 'date',
      transform: 'date',
      sampleValue: '2026-09-15',
      description: '客人登记入住日期',
      enabled: true,
      required: true,
    },
    {
      key: 'checkOutDate',
      label: '离店日期',
      path: 'data.checkOutDateString',
      category: 'date',
      transform: 'date',
      sampleValue: '2026-09-16',
      description: '客人离店退房日期',
      enabled: true,
      required: true,
    },
    {
      key: 'arriveTime',
      label: '预计到店时间',
      path: 'data.arriveTimeStr',
      category: 'date',
      transform: 'string',
      sampleValue: '2026-09-15 14:00:00',
      description: '客人预计抵达酒店时间',
      enabled: true,
    },

    // 4. 住客与联系人
    {
      key: 'guestName',
      label: '入住人',
      path: 'data.guests[*].name',
      category: 'guest',
      transform: 'string',
      sampleValue: '巨*',
      description: '全部入住人姓名 (多住客自动拼接)',
      enabled: true,
    },
    {
      key: 'guestPhone',
      label: '联系电话',
      path: 'data.contacts[*].phone',
      category: 'guest',
      transform: 'maskPhone',
      sampleValue: '138****9999',
      description: '预留联系人手机号 (脱敏用于模版展示)',
      enabled: true,
    },
    {
      key: 'contactPhone',
      label: '真实联系电话',
      path: 'data.contacts[0].phone',
      category: 'guest',
      transform: 'string',
      sampleValue: '13888889999',
      description: '预留联系人未脱敏真实手机号',
      enabled: true,
    },

    // 5. 财务结算 (分转元)
    {
      key: 'floorPrice',
      label: '结算底价',
      path: 'data.floorPrice',
      category: 'finance',
      transform: 'centsToYuan',
      sampleValue: '239.00',
      description: '美团与酒店结算底价 (元)',
      enabled: true,
      required: true,
    },
    {
      key: 'salePrice',
      label: 'OTA售价',
      path: 'data.price',
      category: 'finance',
      transform: 'centsToYuan',
      sampleValue: '265.55',
      description: '美团对外销售实收价格 (元)',
      enabled: true,
    },
    {
      key: 'partnerIncome',
      label: '预结算收益',
      path: 'data.orderBasePriceModel.preSettlementInfo.partnerIncome',
      category: 'finance',
      transform: 'string',
      sampleValue: '￥238.90',
      description: '账期预结算预计收入',
      enabled: true,
    },

    // 6. 权益服务
    {
      key: 'breakfast',
      label: '早餐说明',
      path: 'data.breakfastInfo[0].breakfastDesc',
      category: 'rights',
      transform: 'string',
      sampleValue: '不含早',
      description: '套餐是否含早餐说明',
      enabled: true,
    },
    {
      key: 'rightsDesc',
      label: '特色权益',
      path: 'data.rightsModelList[0].rightsServiceDesc',
      category: 'rights',
      transform: 'string',
      sampleValue: '延迟退房至 14:00，共 1 间',
      description: '如延迟退房等会员专享礼遇',
      enabled: true,
    },
    {
      key: 'hasRights',
      label: '是否含权益',
      path: '',
      category: 'rights',
      transform: 'boolean',
      conditionExpr: 'data.rightsModelList.length > 0',
      sampleValue: 'true',
      description: '订单是否包含附加权益',
      enabled: true,
    },

    // 7. 发票信息
    {
      key: 'needInvoice',
      label: '需酒店开票',
      path: '',
      category: 'invoice',
      transform: 'boolean',
      conditionExpr: 'data.invoiceTagModel.invoiceParty == 3',
      sampleValue: 'true',
      description: '美团标记需酒店开具发票',
      enabled: true,
    },
    {
      key: 'invoiceMoney',
      label: '参考开票金额',
      path: 'data.invoiceTagModel.invoiceMoney',
      category: 'invoice',
      transform: 'centsToYuan',
      sampleValue: '265.55',
      description: '开票参考金额 (元)',
      enabled: true,
    },
  ],
};

/** 美团订单协议实现类 (实现 IChannelOrderProtocol) */
export class MeituanOrderProtocol implements IChannelOrderProtocol {
  public readonly channelCode = 'MEITUAN';

  constructor(
    public readonly context: CleanOrderContext,
    public readonly raw: Record<string, unknown>
  ) {}

  /** 供模版引擎渲染的上下文变量字典 (100% 对齐 DEFAULT_MEITUAN_PROTOCOL_SCHEMA) */
  public getTemplateVariables(): CleanOrderContext {
    return this.context;
  }

  /**
   * 承上启下：将美团专属订单数据投影为中台标准 UnifiedOrderProtocol
   * 核心刚性约束：100% 消费清洗后的 this.context，绝对禁止直接读取 this.raw 提取业务字段！
   */
  public toUnifiedOrder(renderedRemark: string): UnifiedOrderProtocol {
    const otaOrderId = String(
      this.context.orderNo ||
      this.context.otaOrderId ||
      this.context['美团单号'] ||
      ''
    ).trim();

    const unitId = String(this.context.unitId || this.context['门店ID'] || '').trim() || undefined;
    const unitName = String(this.context.unitName || this.context['门店名称'] || '').trim() || undefined;

    const guestName = String(
      this.context.guestName ||
      this.context['入住人'] ||
      this.context['住客'] ||
      this.context['住客姓名'] ||
      ''
    ).trim();

    const guestMobile = String(
      this.context.contactPhone ||
      this.context['真实联系电话'] ||
      this.context.guestPhone ||
      this.context['联系电话'] ||
      ''
    ).trim();

    const roomTypeName = String(
      this.context.roomName ||
      this.context.roomTypeName ||
      this.context['房型名称'] ||
      ''
    ).trim();

    const roomTypeId = String(
      this.context.roomTypeId ||
      this.context['房型商品ID'] ||
      this.context['房型ID'] ||
      'ROOM_DEFAULT'
    ).trim();

    const rateCode = String(
      this.context.rateCode ||
      this.context['价格方案'] ||
      'OTA'
    ).trim();

    const arrival = String(this.context.checkInDate || this.context['入住日期'] || '').slice(0, 10);
    const departure = String(this.context.checkOutDate || this.context['离店日期'] || '').slice(0, 10);

    let nights = Math.max(1, Number(this.context.nights || this.context['间夜数'] || 0));
    if ((!nights || Number.isNaN(nights)) && arrival && departure) {
      const diff = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000);
      nights = diff > 0 ? diff : 1;
    }

    const quantity = Math.max(1, Number(this.context.roomCount || this.context['房间间数'] || 1));
    const rawTotal = Number(this.context.floorPrice ?? this.context['结算底价'] ?? this.context.salePrice ?? 0);
    const totalPrice = Number.isFinite(rawTotal) ? rawTotal : 0;
    const floorPrice = totalPrice;

    // 按日价格计算：直接消费 context.pricing，若无则根据间夜平摊推导
    let pricing: OrderProtocolPricing[] = [];
    if (Array.isArray(this.context.pricing) && this.context.pricing.length > 0) {
      pricing = this.context.pricing as OrderProtocolPricing[];
    } else if (Array.isArray(this.context['每日价格']) && (this.context['每日价格'] as OrderProtocolPricing[]).length > 0) {
      pricing = this.context['每日价格'] as OrderProtocolPricing[];
    } else if (arrival && departure) {
      const nightlyPrice = Math.round((totalPrice / nights) * 100) / 100;
      pricing = Array.from({ length: nights }, (_, i) => {
        const d = new Date(`${arrival}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return { date: d.toISOString().slice(0, 10), price: nightlyPrice };
      });
    }

    return {
      otaOrderId,
      otaChannel: this.channelCode,
      unitId,
      unitName,
      contact: {
        name: guestName,
        mobile: guestMobile,
      },
      booking: {
        roomTypeName,
        originRoomType: roomTypeName,
        roomTypeId,
        rateCode,
        arrival,
        departure,
        nights,
        quantity,
        totalPrice,
        floorPrice,
        paytype: '预付',
        pricing,
      },
      remark: renderedRemark,
      rawPayload: this.raw, // 仅作为原始只读存档透传，不参与任何逻辑提取
    };
  }
}

/**
 * 美团订单原始报文清洗入口函数
 * 依据 DEFAULT_MEITUAN_PROTOCOL_SCHEMA (或用户自定义 Schema) 执行清洗并返回强类型 MeituanOrderProtocol 实体
 */
export function cleanMeituanOrder(
  rawPayload: unknown,
  customSchema?: ChannelProtocolSchema | null,
  targetOrderId?: string
): MeituanOrderProtocol {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('[MeituanProtocol] 美团订单原始报文为空或非合法对象');
  }

  const rawRecord = rawPayload as Record<string, unknown>;
  const schema = customSchema || DEFAULT_MEITUAN_PROTOCOL_SCHEMA;

  // 1. 直接定位美团报文数据主体（真实报文统一位于 data 节点下）
  const data = (rawRecord.data && typeof rawRecord.data === 'object' ? rawRecord.data : rawRecord) as Record<string, unknown>;

  // 基础字段轻量补齐（兼容 flat mock 报文）
  if (data.orderId == null && (data.otaOrderId != null || targetOrderId != null)) {
    data.orderId = data.otaOrderId ?? targetOrderId;
  }
  if (data.roomName == null && data.roomTypeName != null) {
    data.roomName = data.roomTypeName;
  }
  if (data.checkInDateString == null && (data.checkInDate != null || data.arrival != null)) {
    data.checkInDateString = String(data.checkInDate ?? data.arrival);
  }
  if (data.checkOutDateString == null && (data.checkOutDate != null || data.departure != null)) {
    data.checkOutDateString = String(data.checkOutDate ?? data.departure);
  }
  if (data.floorPrice == null) {
    data.floorPrice = data.totalFee ?? data.price ?? data.totalPrice;
  }
  if (data.guestName && (!Array.isArray(data.guests) || data.guests.length === 0)) {
    data.guests = [{ name: data.guestName }];
  }
  if (data.guestMobile && (!Array.isArray(data.contacts) || data.contacts.length === 0)) {
    data.contacts = [{ phone: data.guestMobile }];
  }

  const normalizedRaw: Record<string, unknown> = {
    ...rawRecord,
    data,
  };

  // 2. 依据 Schema 执行标准化清洗并做契约检测
  const context = normalizeOrderPayload(normalizedRaw, schema);

  // 3. 补齐业务单号与常用别名映射
  if (!context.orderNo && targetOrderId) {
    context.orderNo = targetOrderId;
    context['美团单号'] = targetOrderId;
  }
  if (context.orderNo) {
    context['OTA订单号'] = context.orderNo;
    context['美团单号'] = context.orderNo;
    context.otaOrderId = context.orderNo;
  }

  // 补齐门店与房型关键字段同义词
  if (context.unitId) context['门店ID'] = context.unitId;
  if (context.unitName) context['门店名称'] = context.unitName;
  if (context.roomTypeId) context['房型ID'] = context.roomTypeId;
  if (context.roomTypeId) context['房型商品ID'] = context.roomTypeId;
  if (context.rateCode) context['价格方案'] = context.rateCode;

  // 计算间夜数
  if (!context.nights && context.checkInDate && context.checkOutDate) {
    const diff = Math.round((Date.parse(String(context.checkOutDate)) - Date.parse(String(context.checkInDate))) / 86400000);
    context.nights = diff > 0 ? diff : 1;
    context['间夜数'] = context.nights;
  }

  // 标准化每日价格 (OrderProtocolPricing[])：直接从美团真实报文的 data.priceInfo 取值
  const rawPriceInfo = Array.isArray(data.priceInfo)
    ? (data.priceInfo as Array<Record<string, unknown>>)
    : [];

  let pricing: OrderProtocolPricing[] = rawPriceInfo
    .map((item) => ({
      date: String(item.dateString || item.date || '').slice(0, 10),
      price: Math.round(((Number(item.floorPrice ?? item.price ?? 0)) / 100) * 100) / 100,
    }))
    .filter((p) => Boolean(p.date));

  // 仅在原始接口报文未提供 priceInfo 明细且存在入离日期时，根据总价平摊推导
  if (pricing.length === 0 && context.checkInDate && context.checkOutDate) {
    const nights = Math.max(1, Number(context.nights || 1));
    const totalPrice = Number(context.floorPrice ?? context.salePrice ?? 0);
    const nightlyPrice = Math.round((totalPrice / nights) * 100) / 100;
    const arrivalStr = String(context.checkInDate);
    pricing = Array.from({ length: nights }, (_, i) => {
      const d = new Date(`${arrivalStr}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return { date: d.toISOString().slice(0, 10), price: nightlyPrice };
    });
  }
  context.pricing = pricing;
  context['每日价格'] = pricing;

  // 别名一致性
  if (context.guestName) context['住客'] = context.guestName;
  if (context.guestName) context['住客姓名'] = context.guestName;
  if (context.roomName) context['roomTypeName'] = context.roomName;
  if (context.floorPrice != null) context['底价'] = context.floorPrice;
  if (context.checkInDate) context['arrival'] = context.checkInDate;
  if (context.checkOutDate) context['departure'] = context.checkOutDate;
  if (context.checkInDate && context.checkOutDate) {
    context['入住离店日期'] = `${context.checkInDate}至${context.checkOutDate}`;
    context['checkInOutDate'] = `${context.checkInDate}至${context.checkOutDate}`;
  }

  return new MeituanOrderProtocol(context, rawRecord);
}
