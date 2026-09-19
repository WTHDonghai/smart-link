import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeOrderPayload,
  ProtocolNormalizationError,
} from '../../src/utils/template/protocolNormalizer';
import {
  DOUYIN_RAW_SAMPLE_ORDER,
  DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
} from '../../src/services/protocols/douyinProtocol';
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
    expect(cleanCtx.hotelName).toBe('淮安日月洲度假村(西游乐园店)');
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
});
