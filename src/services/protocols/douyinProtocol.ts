/**
 * 抖音订单协议规范与默认 Schema 定义 (Douyin Protocol Specification & Presets)
 * 深度清洗并裁剪为 16 项高频核心业务指标
 */

import type {
  ChannelProtocolSchema,
  CleanOrderContext,
  IChannelOrderProtocol,
  OrderProtocolPricing,
  UnifiedOrderProtocol,
} from '../../types/template';
import { normalizeOrderPayload } from '../../utils/template/protocolNormalizer';

/** 抖音真实订单协议样本数据 (源自生产采集报文) */
export const DOUYIN_RAW_SAMPLE_ORDER = {
  amount_info: {
    currency: '￥',
    exchange_rate: '123',
    makeup_amount: 0,
    origin_amount: 51490,
    oversea_currency_style: false,
    pay_amount: 49600,
    pay_discount_amount: 0,
    product_origin_amount: 51490,
  },
  book_detail_info: {
    accept_type: '商家后台接单',
    book_apply_time: 1787876046,
    book_end_time: 1788624000,
    book_id: '800014640948279296216700077',
    book_night_count: 1,
    book_order_id: '1116402292364180077',
    book_room_count: 1,
    book_start_time: 1788537600,
    confirm_number: {
      can_edit: true,
      text: '2608280008',
    },
    customer_service_msg: '客户服务消息',
    hotel_name: '西软洲度假村',
    is_first_day_reserved_room: false,
    merchant_msg: {
      text: '这里是上架备注信息',
    },
    poi_life_account_id: '7130223634133092383',
    remark_info: {
      question_and_answer_list: [],
      remark_info_str: '这里是备注信息',
    },
  },
  book_product_info: {
    product_id: '1806538013686795',
  },
  guest_info: {
    buyer: {
      name: '购买人名称',
      phone: '是购买人手机号',
      phone_ciphertext: 'MDYEDFKQpuN6GNuDquzE5AQUx5HGBeSI27KB+nGyI8HSlW8kUogEEAuMN+fI6KLrG5om15OsQrw=',
    },
    user_list: [
      {
        name: '刘彩霞',
        phone: '*******5090',
        phone_ciphertext: 'MEEEDG1lT1r6k855MuKJoAQfO5DaZT+ffaP6ty8M2/HlStDGOsZu0dTT/a3+IzIxwgQQkbRrT83ybN46Pble+HAnow==',
      },
    ],
  },
  order_base_info: {
    order_id: '1116431119643540077',
    order_tag_list: [],
    pay_time: 1787871206,
  },
  order_fee: {
    bill_commissions: [
      {
        amount: -3992,
        name: '',
        title: '软件服务费',
      },
      {
        amount: -1497,
        name: '',
        title: '达人服务费',
      },
    ],
    bill_commissions_amount: -5489,
    payment_total_amount: 49900,
  },
  sale_product_info: {
    cancel_rule: '',
    combo_product_name: '',
    commodity_meal: '自助早餐（2份）',
    commodity_meal_num: 1,
    commodity_play: '文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），晨曦儿童乐园游玩（1份），3D打印体验（1份），健身房（1份），自助洗衣房（1份），树屋探险乐园（1份），乐园指定文创店9折（1份）',
    commodity_play_num: 9,
    commodity_room: '',
    commodity_room_num: 0,
    commodity_ticket: '双人西游乐园门票一次入园（1份）',
    commodity_ticket_num: 1,
    order_refund_policy: '整单未预约，顾客可随时申请退款，过期自动退全额\n预约成功后，取消预约分阶段退款不同金额，规则如下',
    order_refund_policy_priority: '',
    physical_room_name: '豪华大床房',
    product_id: '1874664066064411',
    product_name: '错峰大促｜豪华房1晚含早+双人西游乐园+景区接驳+儿童活动',
    product_tag: ['预售券'],
    product_type: 12,
    product_type_name: '预售券',
    refund_rule: [
      {
        label: '预约成功30分钟内',
        value: '免费取消',
      },
      {
        label: '入住前1天 00:00 前',
        value: '免费取消',
      },
      {
        label: '入住前1天 00:00 后',
        value: '不可取消',
      },
    ],
    room_sale_mode: 1,
  },
  status_info: {
    color_type: 'primary',
    count_down: 0,
    detail_status_arr: [],
    hover: false,
    title: '待入住',
  },
};

/** 抖音精炼协议 Schema：将繁杂报文裁剪精简为 16 个高频业务指标 */
export const DEFAULT_DOUYIN_PROTOCOL_SCHEMA: ChannelProtocolSchema = {
  channelId: 'douyin',
  channelCode: 'DOUYIN',
  version: '2026.09',
  updatedAt: '2026-09-16 12:50:00',
  fields: [
    // 1. 基础单号与状态
    {
      key: 'orderNo',
      label: '抖音主单号',
      path: 'order_base_info.order_id',
      category: 'basic',
      transform: 'string',
      sampleValue: '1116431119643540077',
      description: '抖音电商交易主单号',
      enabled: true,
      required: true,
    },
    {
      key: 'bookId',
      label: '预约单号',
      path: 'book_detail_info.book_id',
      category: 'basic',
      transform: 'string',
      sampleValue: '800014640948279296216700077',
      description: '酒店预订核销流水号',
      enabled: true,
      required: true,
    },
    {
      key: 'confirmNo',
      label: '确认号',
      path: 'book_detail_info.confirm_number.text',
      category: 'basic',
      transform: 'string',
      sampleValue: '2608280008',
      description: '商家后台确认码',
      enabled: true,
    },
    {
      key: 'orderStatus',
      label: '订单状态',
      path: 'status_info.title',
      category: 'basic',
      transform: 'string',
      sampleValue: '待入住',
      description: '抖音预订状态标签',
      enabled: true,
    },

    // 2. 酒店房型
    {
      key: 'hotelId',
      label: '门店ID',
      path: 'book_detail_info.poi_life_account_id',
      category: 'hotel',
      transform: 'string',
      sampleValue: '7130223634133092383',
      description: '预订酒店门店ID',
      enabled: true,
    },
    {
      key: 'hotelName',
      label: '酒店名称',
      path: 'book_detail_info.hotel_name',
      category: 'hotel',
      transform: 'string',
      sampleValue: '西软洲度假村',
      description: '预订酒店门店名称',
      enabled: true,
    },
    {
      key: 'roomName',
      label: '房型名称',
      path: 'sale_product_info.physical_room_name',
      category: 'hotel',
      transform: 'string',
      sampleValue: '豪华大床房',
      description: '入住物理房型名称',
      enabled: true,
      required: true,
    },
    {
      key: 'productName',
      label: '团购商品名',
      path: 'sale_product_info.product_name',
      category: 'hotel',
      transform: 'string',
      sampleValue: '错峰大促｜豪华房1晚含早+双人西游乐园+景区接驳+儿童活动',
      description: '抖音售卖套餐券商品名称',
      enabled: true,
    },
    {
      key: 'roomCount',
      label: '房间间数',
      path: 'book_detail_info.book_room_count',
      category: 'hotel',
      transform: 'string',
      sampleValue: '1',
      description: '预订房间数量',
      enabled: true,
    },
    {
      key: 'nights',
      label: '间夜数',
      path: 'book_detail_info.book_night_count',
      category: 'hotel',
      transform: 'string',
      sampleValue: '1',
      description: '间夜数',
      enabled: true,
      required: true,
    },
    {
      key: 'roomTypeId',
      label: '房型商品ID',
      path: 'sale_product_info.product_id',
      category: 'hotel',
      transform: 'string',
      sampleValue: '1874664066064411',
      description: '抖音房型商品或团购商品ID',
      enabled: true,
    },

    // 3. 入离时间 (10位秒级时间戳)
    {
      key: 'checkInDate',
      label: '入住日期',
      path: 'book_detail_info.book_start_time',
      category: 'date',
      transform: 'date',
      sampleValue: '2026-09-05',
      description: '预订入住起始日期',
      enabled: true,
      required: true,
    },
    {
      key: 'checkOutDate',
      label: '离店日期',
      path: 'book_detail_info.book_end_time',
      category: 'date',
      transform: 'date',
      sampleValue: '2026-09-06',
      description: '预订离店截止日期',
      enabled: true,
      required: true,
    },

    // 4. 客人联系人
    {
      key: 'guestName',
      label: '入住人',
      path: 'guest_info.user_list[*].name',
      category: 'guest',
      transform: 'string',
      sampleValue: '刘彩霞',
      description: '实际入住客人姓名 (多住客自动拼接)',
      enabled: true,
    },
    {
      key: 'guestPhone',
      label: '联系电话',
      path: 'guest_info.user_list[*].phone',
      category: 'guest',
      transform: 'maskPhone',
      sampleValue: '*******5090',
      description: '预留联系人手机号 (多住客自动脱敏拼接)',
      enabled: true,
    },

    // 5. 财务结算 (分转元)
    {
      key: 'payAmount',
      label: '实付金额',
      path: 'amount_info.pay_amount',
      category: 'finance',
      transform: 'centsToYuan',
      sampleValue: '496.00',
      description: '顾客最终实付支付金额 (元)',
      enabled: true,
      required: true,
    },
    // 实收金额
    {
      key: 'payTotalAmount',
      label: '实收金额',
      path: 'order_fee.payment_total_amount',
      category: 'finance',
      transform: 'centsToYuan',
      sampleValue: '496.00',
      description: '实收金额 (元)',
      enabled: true,
      required: true,
    },
    {
      key: 'totalAmount',
      label: '售卖原价',
      path: 'amount_info.origin_amount',
      category: 'finance',
      transform: 'centsToYuan',
      sampleValue: '514.90',
      description: '套餐售卖挂牌原价 (元)',
      enabled: true,
    },
    {
      key: 'paytype',
      label: '支付方式',
      path: 'order_base_info.pay_type',
      category: 'finance',
      transform: 'string',
      sampleValue: '预付',
      description: '抖音支付方式 (预付/现付)',
      enabled: true,
    },

    // 6. 权益礼遇
    {
      key: 'breakfast',
      label: '早餐说明',
      path: 'sale_product_info.commodity_meal',
      category: 'rights',
      transform: 'string',
      sampleValue: '自助早餐（2份）',
      description: '套餐餐食详情',
      enabled: true,
    },
    {
      key: 'hasMeal',
      label: '是否含餐',
      path: '',
      category: 'rights',
      transform: 'boolean',
      conditionExpr: 'sale_product_info.commodity_meal_num > 0',
      sampleValue: 'true',
      description: '套餐是否包含早餐餐食',
      enabled: true,
    },
    {
      key: 'ticket',
      label: '门票权益',
      path: 'sale_product_info.commodity_ticket',
      category: 'rights',
      transform: 'string',
      sampleValue: '双人西游乐园门票一次入园（1份）',
      description: '包含的景区游乐门票',
      enabled: true,
    },
    {
      key: 'play',
      label: '玩乐权益',
      path: 'sale_product_info.commodity_play',
      category: 'rights',
      transform: 'string',
      sampleValue: '文创伴手礼（1份），乐园观光车往返接送（1份）...',
      description: '伴手礼/游玩项目权益',
      enabled: true,
    },
  ],
};

/**
 * 抖音订单协议封装实体
 */
export class DouyinOrderProtocol implements IChannelOrderProtocol {
  public readonly channelCode = 'DOUYIN';
  public readonly context: CleanOrderContext;
  public readonly raw: Record<string, unknown>;

  constructor(context: CleanOrderContext, raw: Record<string, unknown>) {
    this.context = context;
    this.raw = raw;
  }

  public get(key: string): unknown {
    return this.context[key];
  }

  public getTemplateVariables(): CleanOrderContext {
    return this.context;
  }

  /**
   * 将抖音专属订单数据投影为中台标准 UnifiedOrderProtocol
   */
  public toUnifiedOrder(renderedRemark: string): UnifiedOrderProtocol {
    const otaOrderId = String(
      this.context.orderNo ||
      this.context.otaOrderId ||
      this.context.bookOrderId ||
      this.context['抖音单号'] ||
      ''
    ).trim();

    const unitId = String(this.context.unitId || this.context.hotelId || this.context['门店ID'] || '').trim() || undefined;
    const unitName = String(this.context.unitName || this.context.hotelName || this.context['门店名称'] || '').trim() || undefined;

    const guestName = String(
      this.context.guestName ||
      this.context['入住人'] ||
      ''
    ).trim();

    const guestMobile = String(
      this.context.guestPhone ||
      this.context['联系电话'] ||
      ''
    ).trim();

    const roomTypeName = String(
      this.context.roomName ||
      this.context.productName ||
      this.context['房型名称'] ||
      ''
    ).trim();

    const arrival = String(this.context.checkInDate || this.context['入住日期'] || '').slice(0, 10);
    const departure = String(this.context.checkOutDate || this.context['离店日期'] || '').slice(0, 10);

    let nights = Number(this.context.nights || this.context['间夜数'] || 0);
    const quantity = Math.max(1, Number(this.context.roomCount || this.context['房间间数'] || 1));
    const totalPrice = Number(this.context.payTotalAmount ?? 0);

    // TODO: 单类型为“预售券”（套餐券预约）：
    // play_methods_v2.is_hotel_presale = true
    // product_info_v2.sku.product_type_name = "预售券"
    // 预售券是用户先购买固定总价的套餐券，后续再发起预约入离。抖音后台对于预售券不会直接生成日历房格式的 order_fee_by_day 每日排期价。
    // 按日价格计算：预授权根据间夜平摊推导
    // 日历房：order_fee.order_fee_by_day.details
    let pricing: OrderProtocolPricing[] = [];
    if (arrival && departure) {
      const nightlyPrice = Math.round((totalPrice / nights) * 100) / 100;
      pricing = Array.from({ length: nights }, (_, i) => {
        const d = new Date(`${arrival}T00:00:00.000Z`);
        if (!Number.isNaN(d.getTime())) {
          d.setUTCDate(d.getUTCDate() + i);
          return { date: d.toISOString().slice(0, 10), price: nightlyPrice };
        }
        return { date: arrival, price: nightlyPrice };
      });
    }

    const roomTypeId = String(
      this.context.roomTypeId ||
      this.context['房型商品ID'] ||
      this.context['房型ID'] ||
      this.context.productId ||
      ''
    ).trim();
    if (!roomTypeId) {
      throw new Error(`[DouyinProtocol] 订单「${otaOrderId || 'UNKNOWN'}」缺少必要关键字段: 房型商品ID (roomTypeId)`);
    }

    const rateCode = ''

    const paytype = String(
      this.context.paytype ||
      this.context['支付方式'] ||
      '预付'
    ).trim();
    if (!paytype) {
      throw new Error(`[DouyinProtocol] 订单「${otaOrderId || 'UNKNOWN'}」缺少必要关键字段: 支付方式 (paytype)`);
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
        paytype,
        pricing,
      },
      remark: renderedRemark,
      rawPayload: this.raw,
    };
  }
}

/**
 * 校验特定订单条目实体是否匹配目标订单号（匹配 order_id / book_id / after_sale_id）
 */
function isDouyinOrderMatch(rec: Record<string, unknown>, cleanTargetId: string): boolean {
  if (!cleanTargetId) return true;
  const baseInfo = rec.order_base_info as Record<string, unknown> | undefined;
  const bookInfo = rec.book_detail_info as Record<string, unknown> | undefined;
  const afterSaleInfo = rec.after_sale_info as Record<string, unknown> | undefined;
  const afterSaleV2 = rec.after_sale_info_v2 as Record<string, unknown> | undefined;
  const afterSaleInner = (afterSaleV2?.after_sale_info || {}) as Record<string, unknown>;

  const oId = String(baseInfo?.order_id || rec.order_id || rec.otaOrderId || '').trim();
  const bId = String(bookInfo?.book_id || bookInfo?.book_order_id || rec.book_id || '').trim();
  const aId = String(afterSaleInfo?.after_sale_order_id || afterSaleInner.after_sale_id || rec.after_sale_id || '').trim();

  return oId === cleanTargetId || bId === cleanTargetId || aId === cleanTargetId;
}

/**
 * 纯函数：从任何抖音响应报文（单条订单、列表包装根响应、或嵌套 data 结构）中精准提取匹配特定订单号的单条原始实体
 * 遵循 Fail-Fast：返回纯净的单条订单 Record<string, unknown>，未找到则返回 null
 * @param payload 待解包的任意报文
 * @param targetOrderId 目标订单号（可为主单号 order_id 或预约单号 book_id / 售后单号 after_sale_id）
 */
export function extractDouyinOrderFromResponse(
  payload: unknown,
  targetOrderId?: string
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;

  const cleanTargetId = String(targetOrderId || '').trim();
  const root = payload as Record<string, unknown>;

  // 1. 如果输入本身就是已解包的单条订单实体（包含 order_base_info、book_detail_info 或 sale_product_info）
  if (
    (root.order_base_info && typeof root.order_base_info === 'object') ||
    (root.book_detail_info && typeof root.book_detail_info === 'object') ||
    (root.sale_product_info && typeof root.sale_product_info === 'object')
  ) {
    if (isDouyinOrderMatch(root, cleanTargetId)) {
      return root;
    }
  }

  // 2. 检查外层是否包裹了 data: { order_base_info: ... } 单条结构
  if (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) {
    const innerData = root.data as Record<string, unknown>;
    if (
      (innerData.order_base_info && typeof innerData.order_base_info === 'object') ||
      (innerData.book_detail_info && typeof innerData.book_detail_info === 'object') ||
      (innerData.sale_product_info && typeof innerData.sale_product_info === 'object')
    ) {
      if (isDouyinOrderMatch(innerData, cleanTargetId)) {
        return innerData;
      }
    }
  }

  // 3. 检查是否为列表响应或详情接口响应（root.data.data 可能是 string、string[] 或 Record<string, unknown>）
  const listCandidates: unknown[] = [];
  if (root.data && typeof root.data === 'object') {
    const d = root.data as Record<string, unknown>;
    if (typeof d.data === 'string') {
      listCandidates.push(d.data);
    } else if (Array.isArray(d.data)) {
      listCandidates.push(...d.data);
    } else if (d.data && typeof d.data === 'object') {
      listCandidates.push(d.data);
    }

    // 抖音详情接口备用容器 dito_data.meta_data
    if (d.dito_data && typeof d.dito_data === 'object') {
      const dito = d.dito_data as Record<string, unknown>;
      if (typeof dito.meta_data === 'string') {
        listCandidates.push(dito.meta_data);
      } else if (dito.meta_data && typeof dito.meta_data === 'object') {
        listCandidates.push(dito.meta_data);
      }
    }
  }
  if (Array.isArray(root.data)) {
    listCandidates.push(...root.data);
  }

  for (const item of listCandidates) {
    let rec: Record<string, unknown> | null = null;
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          rec = parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      rec = item as Record<string, unknown>;
    }

    if (!rec) continue;

    if (isDouyinOrderMatch(rec, cleanTargetId)) {
      return rec;
    }
  }

  return null;
}

/**
 * 抖音订单原始报文清洗入口函数
 */
export function cleanDouyinOrder(
  rawPayload: unknown,
  customSchema?: ChannelProtocolSchema | null,
  targetOrderId?: string
): DouyinOrderProtocol {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('[DouyinProtocol] 抖音订单原始报文为空或非合法对象');
  }

  // 防御性解包：若传入的是外层包裹（如列表接口根响应包装、含 data.data 的集合报文等），自动解包提取目标订单的单条实体
  const extracted = extractDouyinOrderFromResponse(rawPayload, targetOrderId);
  const rawRecord = (extracted || rawPayload) as Record<string, unknown>;
  const schema = customSchema || DEFAULT_DOUYIN_PROTOCOL_SCHEMA;

  // 定位抖音数据层
  const data = (rawRecord.data && typeof rawRecord.data === 'object' ? rawRecord.data : rawRecord) as Record<string, unknown>;

  const context = normalizeOrderPayload(data, schema);

  if (!context.orderNo && targetOrderId) {
    context.orderNo = targetOrderId;
    context['抖音单号'] = targetOrderId;
  }
  if (context.orderNo) {
    context['OTA订单号'] = context.orderNo;
    context['抖音单号'] = context.orderNo;
    context.otaOrderId = context.orderNo;
  }

  if (!context.hotelId && (data.book_detail_info as Record<string, unknown> | undefined)?.poi_life_account_id) {
    context.hotelId = String((data.book_detail_info as Record<string, unknown>).poi_life_account_id);
  }
  if (context.hotelId) {
    context.unitId = context.hotelId;
    context['门店ID'] = context.hotelId;
  }
  if (context.hotelName) {
    context.unitName = context.hotelName;
    context['门店名称'] = context.hotelName;
  }

  if (context.roomTypeId) {
    context['房型ID'] = context.roomTypeId;
    context['房型商品ID'] = context.roomTypeId;
  } else if (data.book_product_info && typeof data.book_product_info === 'object' && (data.book_product_info as Record<string, unknown>).product_id) {
    context.roomTypeId = String((data.book_product_info as Record<string, unknown>).product_id);
    context['房型ID'] = context.roomTypeId;
    context['房型商品ID'] = context.roomTypeId;
  }

  // 补齐并归一化支付方式 (预付/现付)
  context.paytype = '预付';
  if (context.paytype) {
    context['支付方式'] = context.paytype;
  }

  // 融合由探测器在浏览器会话中解密出的明文手机号
  const decryptedPhone =
    (rawPayload as Record<string, unknown> | undefined)?.decryptedPhone ||
    (rawRecord as Record<string, unknown> | undefined)?.decryptedPhone;
  if (decryptedPhone && (!context.guestPhone || String(context.guestPhone).includes('*'))) {
    context.guestPhone = String(decryptedPhone);
    context['联系电话'] = context.guestPhone;
  }

  return new DouyinOrderProtocol(context, rawRecord);
}

