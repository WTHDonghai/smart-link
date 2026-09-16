/**
 * 抖音订单协议规范与默认 Schema 定义 (Douyin Protocol Specification & Presets)
 * 深度清洗并裁剪为 16 项高频核心业务指标
 */

import type { ChannelProtocolSchema } from '../../types/template';

/** 抖音真实订单协议样本数据 (源自生产采集报文) */
export const DOUYIN_RAW_SAMPLE_ORDER = {
  action_list: [
    {
      action: 'fill_confirm_number',
      action_name: '填写确认号',
      color_scheme: '',
      disable: false,
      disable_type: 0,
      hover: '',
    },
    {
      action: 'stuff_confirm_number',
      action_name: '填写确认号',
      color_scheme: '',
      disable: false,
      disable_type: 0,
      hover: '',
    },
    {
      action: 'send_cancel_book_sms',
      action_name: '协助取消/退款',
      color_scheme: '',
      disable: false,
      disable_type: 0,
      hover: '',
    },
  ],
  after_sale_info: {
    can_partial_refund: true,
    can_refund_amount: 49600,
    can_refund_for_user: true,
    cancel_audit_choice: 2,
    early_checkout_after_sale_id: null,
    early_checkout_book_after_sale_id: null,
    is_hotel_early_checkout: null,
    not_refund_reason: '',
    refund_apply_phase: 1,
    refund_audit_choice: 2,
    send_sms_after_sale_type_list: [2, 1],
  },
  amount_info: {
    currency: '￥',
    exchange_rate: '',
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
    customer_service_msg: '',
    hotel_name: '淮安日月洲度假村(西游乐园店)',
    is_first_day_reserved_room: false,
    merchant_msg: {
      can_edit: true,
      text: '',
    },
    poi_life_account_id: '7130223634133092383',
    privilege: '',
    remark_info: {
      question_and_answer_list: [],
      remark_info_str: '',
    },
  },
  book_product_info: {
    product_id: '1806538013686795',
  },
  guest_info: {
    buyer: {
      name: ' ',
      phone: '',
      phone_ciphertext: 'MDYEDFKQpuN6GNuDquzE5AQUx5HGBeSI27KB+nGyI8HSlW8kUogEEAuMN+fI6KLrG5om15OsQrw=',
    },
    user_list: [
      {
        birthday: '',
        gender: null,
        id_card_no: '',
        id_card_no_ciphertext: 'MDYEDNK1gGxLat9dwuE4VQQULr1lTOOft3TGGbXyWM0aqQ+gBTwEEDYeIeTM3bUBw1xy+0+PnJM=',
        license_type: null,
        license_validity: null,
        name: '刘彩霞',
        phone: '*******5090',
        phone_ciphertext: 'MEEEDG1lT1r6k855MuKJoAQfO5DaZT+ffaP6ty8M2/HlStDGOsZu0dTT/a3+IzIxwgQQkbRrT83ybN46Pble+HAnow==',
      },
    ],
  },
  order_base_info: {
    multi_book_remain_room_nights: null,
    multi_book_total_room_nights: null,
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
      key: 'hotelName',
      label: '酒店名称',
      path: 'book_detail_info.hotel_name',
      category: 'hotel',
      transform: 'string',
      sampleValue: '淮安日月洲度假村(西游乐园店)',
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

/** 抖音团购搬单默认智能备注模板 */
export const DEFAULT_DOUYIN_REMARK_TEMPLATE =
  '【抖音团购核销】主单号:{抖音主单号} | 预约单:{预约单号} (确认号:{确认号})\n' +
  '房型:{房型名称} x {房间间数}间 | 客人:{入住人} ({联系电话})\n' +
  '入离:{入住日期}至{离店日期} | 实付:¥{实付金额}\n' +
  '{{#if 是否含餐}}套餐:{早餐说明} | {{/if}}门票:{门票权益}';
