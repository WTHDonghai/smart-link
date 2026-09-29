import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeOrderPayload,
  ProtocolNormalizationError,
} from '../../src/utils/template/protocolNormalizer';
import {
  DOUYIN_RAW_SAMPLE_ORDER,
  DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
  cleanDouyinOrder,
} from '../../src/services/protocols/douyinProtocol';
import fs from 'node:fs';
import path from 'node:path';
import { renderTemplate } from '../../src/utils/template/templateEngine';
import { formatDate } from '../../src/utils/template/filters';

const SAMPLE_DOUYIN_REMARK_TEMPLATE =
  '【抖音团购核销】主单号:{抖音主单号} | 预约单:{预约单号} (确认号:{确认号})\n' +
  '房型:{房型名称} x {房间间数}间 | 客人:{入住人} ({联系电话})\n' +
  '入离:{入住日期}至{离店日期} | 实付:¥{实付金额}\n' +
  '{{#if 是否含餐}}套餐:{早餐说明} | {{/if}}门票:{门票权益}';

describe('douyinProtocol (Douyin Group-Buy & Booking Protocol)', () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalTZ !== undefined) {
      process.env.TZ = originalTZ;
    } else {
      delete process.env.TZ;
    }
  });

  it('correctly handles 10-digit Unix timestamp (seconds) into standard YYYY-MM-DD', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai');
    process.env.TZ = 'Asia/Shanghai';
    // 1788537600 秒对应 2026-09-05 00:00:00 GMT+8
    const formatted = formatDate(1788537600);
    expect(formatted).toBe('2026-09-05');
  });

  it('successfully cleans Douyin raw payload into 16 canonical business fields', () => {
    const cleanCtx = normalizeOrderPayload(
      DOUYIN_RAW_SAMPLE_ORDER,
      DEFAULT_DOUYIN_PROTOCOL_SCHEMA
    );

    // 基础三单号与状态
    expect(cleanCtx.orderNo).toBe('1116431119643540077');
    expect(cleanCtx['抖音主单号']).toBe('1116431119643540077');
    expect(cleanCtx.bookId).toBe('800014640948279296216700077');
    expect(cleanCtx['预约单号']).toBe('800014640948279296216700077');
    expect(cleanCtx.confirmNo).toBe('2608280008');
    expect(cleanCtx['确认号']).toBe('2608280008');
    expect(cleanCtx.orderStatus).toBe('待入住');

    // 酒店与物理房型
    expect(cleanCtx.hotelId).toBe('7130223634133092383');
    expect(cleanCtx['门店ID']).toBe('7130223634133092383');
    expect(cleanCtx.hotelName).toBe('淮安日月洲度假村(西游乐园店)');
    expect(cleanCtx['酒店名称']).toBe('淮安日月洲度假村(西游乐园店)');
    expect(cleanCtx.roomName).toBe('豪华大床房');
    expect(cleanCtx.productName).toContain('错峰大促｜豪华房1晚含早');
    expect(cleanCtx.roomCount).toBe('1');

    // 住客信息
    expect(cleanCtx.guestName).toBe('刘彩霞');
    expect(cleanCtx.guestPhone).toBe('*******5090');

    // 财务金额 (分转元)
    expect(cleanCtx.payAmount).toBe('496.00');
    expect(cleanCtx['实付金额']).toBe('496.00');
    expect(cleanCtx.totalAmount).toBe('514.90');

    // 团购权益
    expect(cleanCtx.breakfast).toBe('自助早餐（2份）');
    expect(cleanCtx.hasMeal).toBe(true);
    expect(cleanCtx.ticket).toBe('双人西游乐园门票一次入园（1份）');
    expect(cleanCtx.play).toContain('文创伴手礼');
  });

  it('renders default Douyin remark template end-to-end with real data', () => {
    const cleanCtx = normalizeOrderPayload(
      DOUYIN_RAW_SAMPLE_ORDER,
      DEFAULT_DOUYIN_PROTOCOL_SCHEMA
    );
    const rendered = renderTemplate(SAMPLE_DOUYIN_REMARK_TEMPLATE, cleanCtx);

    expect(rendered).toContain('【抖音团购核销】主单号:1116431119643540077');
    expect(rendered).toContain('预约单:800014640948279296216700077');
    expect(rendered).toContain('确认号:2608280008');
    expect(rendered).toContain('房型:豪华大床房 x 1间');
    expect(rendered).toContain('客人:刘彩霞 (*******5090)');
    expect(rendered).toContain('实付:¥496.00');
    expect(rendered).toContain('套餐:自助早餐（2份）');
    expect(rendered).toContain('门票:双人西游乐园门票一次入园（1份）');
  });

  it('triggers Fail-Fast warning when Douyin critical booking ID or room name is missing', () => {
    const corruptedDouyinPayload = {
      order_base_info: {
        order_id: '1116431119643540077',
      },
      // 缺失 book_detail_info.book_id 与 sale_product_info.physical_room_name
    };

    expect(() =>
      normalizeOrderPayload(corruptedDouyinPayload, DEFAULT_DOUYIN_PROTOCOL_SCHEMA)
    ).toThrowError(ProtocolNormalizationError);

    try {
      normalizeOrderPayload(corruptedDouyinPayload, DEFAULT_DOUYIN_PROTOCOL_SCHEMA);
      expect.unreachable('应当抛出 ProtocolNormalizationError 异常');
    } catch (e) {
      const err = e as ProtocolNormalizationError;
      expect(err.warning.channelCode).toBe('DOUYIN');
      expect(err.warning.missingRequiredFields.some((f) => f.includes('预约单号'))).toBe(true);
      expect(err.warning.missingRequiredFields.some((f) => f.includes('房型名称'))).toBe(true);
    }
  });

  it('correctly handles multiple guests in Douyin guest_info.user_list', () => {
    const multiUserOrder = {
      ...DOUYIN_RAW_SAMPLE_ORDER,
      guest_info: {
        ...DOUYIN_RAW_SAMPLE_ORDER.guest_info,
        user_list: [
          { name: '刘彩霞', phone: '13800005090' },
          { name: '王小明', phone: '13911118888' },
        ],
      },
    };

    const cleanCtx = normalizeOrderPayload(multiUserOrder, DEFAULT_DOUYIN_PROTOCOL_SCHEMA);
    expect(cleanCtx.guestName).toBe('刘彩霞、王小明');
    expect(cleanCtx.guestPhone).toBe('138****5090、139****8888');

    const rendered = renderTemplate(SAMPLE_DOUYIN_REMARK_TEMPLATE, cleanCtx);
    expect(rendered).toContain('客人:刘彩霞、王小明 (138****5090、139****8888)');
  });

  it('correctly derives nights and pricing breakdown from arrival and departure dates when nights is not in context', () => {
    const rawOrder = {
      ...DOUYIN_RAW_SAMPLE_ORDER,
      book_detail_info: {
        ...DOUYIN_RAW_SAMPLE_ORDER.book_detail_info,
        book_start_time: 1790812800, // 2026-10-01
        book_end_time: 1791158400, // 2026-10-05 (4 nights)
      },
      amount_info: {
        ...DOUYIN_RAW_SAMPLE_ORDER.amount_info,
        pay_amount: 80000, // 800 元
      },
    };

    const protocol = cleanDouyinOrder(rawOrder);
    const unified = protocol.toUnifiedOrder('测试备注');

    expect(unified.booking.roomTypeId).toBe('1874664066064411');
    expect(unified.booking.rateCode).toBe('预售券');
    expect(unified.booking.paytype).toBe('预付');
    expect(unified.booking.arrival).toBe('2026-10-01');
    expect(unified.booking.departure).toBe('2026-10-05');
    expect(unified.booking.nights).toBe(4);
    expect(unified.booking.totalPrice).toBe(800);
    expect(unified.booking.pricing).toHaveLength(4);
    expect(unified.booking.pricing[0]).toEqual({ date: '2026-10-01', price: 200 });
    expect(unified.booking.pricing[1]).toEqual({ date: '2026-10-02', price: 200 });
    expect(unified.booking.pricing[2]).toEqual({ date: '2026-10-03', price: 200 });
    expect(unified.booking.pricing[3]).toEqual({ date: '2026-10-04', price: 200 });
  });

  it('fails fast when toUnifiedOrder lacks required fields and does not use hardcoded fallbacks', () => {
    const invalidProtocol = cleanDouyinOrder({
      order_base_info: { order_id: '123' },
      book_detail_info: { book_id: '456', book_start_time: 1788537600, book_end_time: 1788624000 },
      sale_product_info: { physical_room_name: '大床房' },
      amount_info: { pay_amount: 10000 },
    });
    // Missing roomTypeId / productId and rateCode
    expect(() => invalidProtocol.toUnifiedOrder('测试')).toThrow(/缺少必要关键字段/);
  });

  it('defensively unwraps and cleans order when passed a full list API response wrapper', () => {
    const listResponseWrapper = {
      status_code: 0,
      status_msg: '',
      data: {
        count: 1,
        data: [
          JSON.stringify(DOUYIN_RAW_SAMPLE_ORDER),
        ],
      },
    };

    // 传入外层包装对象及目标单号，验证防御性解包生效，不会报字段缺失/协议漂移告警
    const protocol = cleanDouyinOrder(listResponseWrapper, null, '1116431119643540077');
    expect(protocol.get('orderNo')).toBe('1116431119643540077');
    expect(protocol.get('bookId')).toBe('800014640948279296216700077');
    expect(protocol.get('roomName')).toBe('豪华大床房');

    const unified = protocol.toUnifiedOrder('自动化入单测试');
    expect(unified.otaOrderId).toBe('1116431119643540077');
    expect(unified.booking.roomTypeName).toBe('豪华大床房');
    expect(unified.booking.totalPrice).toBe(496);
  });

  it('end-to-end cleans real production detail API fixture provided by merchant workbench', () => {
    const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealOrderDetail.json');
    const rawDetailPayload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

    // 针对用户真实报错的订单「1112769276121338025」执行清洗
    const protocol = cleanDouyinOrder(rawDetailPayload, null, '1112769276121338025');

    expect(protocol.get('orderNo')).toBe('1112769276121338025');
    expect(protocol.get('bookId')).toBe('800000449770071274116238025');
    expect(protocol.get('roomName')).toBe('海洋主题家庭房');
    expect(protocol.get('checkInDate')).toBe('2026-10-01');
    expect(protocol.get('checkOutDate')).toBe('2026-10-02');
    expect(protocol.get('payAmount')).toBe('1272.98'); // 127298 分 -> 1272.98 元
    expect(protocol.get('guestName')).toBe('谢佳安');
    expect(protocol.get('guestPhone')).toBe('*******3150');

    const unified = protocol.toUnifiedOrder('【中台自动导入】');
    expect(unified.otaOrderId).toBe('1112769276121338025');
    expect(unified.otaChannel).toBe('DOUYIN');
    expect(unified.unitId).toBe('7130223634133092383');
    expect(unified.unitName).toBe('淮安日月洲度假村(西游乐园店)');
    expect(unified.contact.name).toBe('谢佳安');
    expect(unified.contact.mobile).toBe('*******3150');
    expect(unified.booking.roomTypeName).toBe('海洋主题家庭房');
    expect(unified.booking.roomTypeId).toBe('1874909917667332');
    expect(unified.booking.rateCode).toBe('预售券');
    expect(unified.booking.arrival).toBe('2026-10-01');
    expect(unified.booking.departure).toBe('2026-10-02');
    expect(unified.booking.nights).toBe(1);
    expect(unified.booking.totalPrice).toBe(1272.98);
    expect(unified.booking.paytype).toBe('预付');
  });
});
