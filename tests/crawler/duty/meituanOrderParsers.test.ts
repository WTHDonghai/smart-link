import { describe, it, expect } from 'vitest';
import {
  fmtDate,
  isMeituanListUrl,
  isMeituanOrderTabListUrl,
  isMeituanDetailUrl,
  isMeituanSensitiveUrl,
  parseMeituanOrderListResponse,
  extractMeituanOrdersFromPayload,
  parseMeituanOrderDetailResponse,
  parseMeituanSensitiveResponse,
  mergeSensitiveDataIntoRawDetail,
  hasPlainMobileNumber,
  isPlainPhoneNumber,
  extractValidOrderId,
  isMeituanCancelOrder,
} from '@/src/crawler/duty/channels/meituan/meituanOrderParsers';
import {
  DutyExecutionError,
  MeituanDutyErrorCode,
} from '@/src/crawler/duty/channels/meituan/meituanDutyContracts';

function captureParseError(payload: unknown): DutyExecutionError {
  try {
    parseMeituanOrderListResponse(payload);
  } catch (error) {
    if (error instanceof DutyExecutionError) return error;
    throw new Error(`Expected DutyExecutionError, received ${String(error)}`);
  }
  throw new Error('Expected malformed payload to fail fast');
}

describe('meituanOrderParsers (Pure Parsing Functions)', () => {
  describe('fmtDate', () => {
    it('should format standard date strings correctly', () => {
      expect(fmtDate('2026-09-20')).toBe('2026-09-20');
      expect(fmtDate('2026/09/20')).toBe('2026-09-20');
      expect(fmtDate('2026.09.20')).toBe('2026-09-20');
      expect(fmtDate('2026年09月20日')).toBe('2026-09-20');
      expect(fmtDate('2026-9-5')).toBe('2026-09-05');
    });

    it('should format compact date strings', () => {
      expect(fmtDate('20260920')).toBe('2026-09-20');
    });

    it('should pad current year for short date strings', () => {
      const currentYear = new Date().getFullYear();
      expect(fmtDate('09-20')).toBe(`${currentYear}-09-20`);
      expect(fmtDate('9/5')).toBe(`${currentYear}-09-05`);
      expect(fmtDate('09月20日')).toBe(`${currentYear}-09-20`);
    });

    it('should parse timestamp numbers and numeric strings', () => {
      // 2026-09-20 00:00:00 UTC approx timestamp: 1790000000000 or similar
      const d = new Date('2026-09-20T12:00:00Z');
      const ms = d.getTime();
      const sec = Math.floor(ms / 1000);

      expect(fmtDate(ms)).toMatch(/^2026-09-20/);
      expect(fmtDate(sec)).toMatch(/^2026-09-20/);
      expect(fmtDate(String(ms))).toMatch(/^2026-09-20/);
      expect(fmtDate(String(sec))).toMatch(/^2026-09-20/);
    });

    it('should return empty string for invalid or empty inputs', () => {
      expect(fmtDate('')).toBe('');
      expect(fmtDate(null)).toBe('');
      expect(fmtDate(undefined)).toBe('');
      expect(fmtDate('not-a-date')).toBe('');
      expect(fmtDate(-1)).toBe('');
    });
  });

  describe('URL matching predicates', () => {
    it('isMeituanListUrl should only match the fixed task list endpoint path', () => {
      expect(isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/orders/task/list')).toBe(true);
      expect(
        isMeituanListUrl(
          'https://eb.meituan.com/api/v1/ebooking/orders/task/list?yodaReady=h5&csecplatform=4&csecversion=4.3.0'
        )
      ).toBe(true);
      expect(isMeituanListUrl('https://eb.meituan.com/orders/task/list')).toBe(false);
      expect(isMeituanListUrl('https://eb.meituan.com/orders/list?status=1')).toBe(false);
      expect(isMeituanListUrl('https://eb.meituan.com/orders/unhandled')).toBe(false);
      expect(isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/orders/list')).toBe(false);
      expect(isMeituanListUrl('http://localhost:3000/api/mock/orders')).toBe(false);
      expect(isMeituanListUrl('/api/v1/ebooking/orders/task/list')).toBe(false);

      // 敏感数据与详情不是列表接口。
      expect(isMeituanListUrl('https://eb.meituan.com/orders/sensitiveData')).toBe(false);
      expect(isMeituanListUrl('https://eb.meituan.com/orders/confirmPhone')).toBe(false);
      expect(
        isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/orders/sensitiveData/12345')
      ).toBe(false);
      expect(isMeituanListUrl('https://eb.meituan.com/other/url')).toBe(false);
      expect(isMeituanListUrl('')).toBe(false);
      expect(isMeituanListUrl('not-a-url')).toBe(false);
    });

    it('isMeituanOrderTabListUrl should accept both tab list endpoints as lifecycle barriers', () => {
      expect(
        isMeituanOrderTabListUrl('https://eb.meituan.com/api/v1/ebooking/orders/task/list?scenario=0')
      ).toBe(true);
      expect(isMeituanOrderTabListUrl('https://eb.meituan.com/api/v1/ebooking/orders/list?status=1')).toBe(true);
      expect(isMeituanOrderTabListUrl('https://eb.meituan.com/api/v1/ebooking/orders/unhandled')).toBe(false);
      expect(isMeituanOrderTabListUrl('/api/v1/ebooking/orders/list')).toBe(false);
    });

    it('isMeituanDetailUrl should match detail URLs strictly bound to v1 contract', () => {
      const realDetailUrl =
        'https://eb.meituan.com/api/v1/ebooking/orders/5035036087660556214?userId=295692068&pageRequestSource=1';

      // 1. 真实生产带参数详情 URL 命中
      expect(isMeituanDetailUrl(realDetailUrl, '5035036087660556214')).toBe(true);

      // 2. 纯路径格式命中
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v1/ebooking/orders/5035036087660556214', '5035036087660556214')).toBe(true);

      // 3. 通用诊断（未传 targetOrderId 时）命中
      expect(isMeituanDetailUrl(realDetailUrl)).toBe(true);
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v1/ebooking/orders/12345')).toBe(true);

      // 4. 严格防串单：单号不匹配时坚决返回 false
      expect(isMeituanDetailUrl(realDetailUrl, '9999999999999999999')).toBe(false);
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v1/ebooking/orders/OTHER_999', '12345')).toBe(false);

      // 5. 天然拒绝 task/list 与 sensitiveData，无需黑名单
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v1/ebooking/orders/task/list?scenario=0', '5035036087660556214')).toBe(false);
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v1/ebooking/orders/task/list')).toBe(false);
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v1/ebooking/orders/sensitiveData/5035036087660556214', '5035036087660556214')).toBe(false);
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v1/ebooking/orders/sensitiveData/5035036087660556214')).toBe(false);

      // 6. Fail-Fast：若美团接口协议升级至 v2，立即返回 false 阻断，杜绝跨版本脏数据解析
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v2/ebooking/orders/5035036087660556214', '5035036087660556214')).toBe(false);
    });

    it('isMeituanSensitiveUrl should match sensitive data URLs', () => {
      expect(isMeituanSensitiveUrl('https://eb.meituan.com/orders/sensitiveData')).toBe(true);
      expect(isMeituanSensitiveUrl('https://eb.meituan.com/confirmPhone?orderId=123')).toBe(true);
      expect(isMeituanSensitiveUrl('https://eb.meituan.com/orders/list')).toBe(false);
    });

  });

  describe('parseMeituanOrderListResponse & extractMeituanOrdersFromPayload', () => {
    it('合法空列表应解析为空数组', () => {
      expect(parseMeituanOrderListResponse({ data: { list: [] } })).toEqual([]);
      expect(extractMeituanOrdersFromPayload({ data: { orders: [] } })).toEqual([]);
    });

    it('畸形列表 envelope 必须 Fail-Fast，不得伪装成空列表成功', () => {
      const malformedPayloads: Array<[unknown, string]> = [
        [null, '美团列表响应必须为 JSON 对象或订单数组'],
        [{}, '美团列表响应缺少已知订单列表字段'],
        [{ data: 123 }, '美团列表响应 data 字段必须为对象'],
        [{ data: { results: null } }, '美团列表响应 data.results 字段必须为数组'],
        [{ data: {} }, '美团列表响应 data 缺少已知订单列表字段'],
        [{ data: { foo: [] } }, '美团列表响应 data 缺少已知订单列表字段'],
      ];

      for (const [payload, expectedMessage] of malformedPayloads) {
        expect(() => parseMeituanOrderListResponse(payload)).toThrow(DutyExecutionError);
        expect(() => extractMeituanOrdersFromPayload(payload)).toThrow(DutyExecutionError);

        const dutyError = captureParseError(payload);
        expect(dutyError.errorCode).toBe(MeituanDutyErrorCode.LIST_BUSINESS_FAILED);
        expect(dutyError.retryable).toBe(false);
        expect(dutyError.message).toContain(expectedMessage);
      }

      const businessError = captureParseError({ code: 1, data: { results: [] } });
      expect(businessError.errorCode).toBe(MeituanDutyErrorCode.LIST_BUSINESS_FAILED);
      expect(businessError.retryable).toBe(false);
      expect(businessError.message).toBe('[LIST_BUSINESS_FAILED] 美团列表接口业务状态码失败 (code=1)');
    });

    it('should extract orders from various nested structures', () => {
      const payload = {
        data: {
          list: [
            {
              orderId: 'MT-1001',
              poiId: 'HOTEL-1',
              poiName: '度假酒店',
              status: 'NEW',
              statusText: '待确认',
              roomName: '豪华大床房',
              ratePlanName: '含早',
              checkInDateString: '2026-09-20',
              checkOutDateString: '2026-09-22',
              nights: 2,
              roomCount: 1,
              totalFee: 88800, // cents -> 888
              guestName: '张三',
              guestMobile: '13800138000',
              cancelOrder: false,
            },
            {
              orderId: 'MT-1002',
              poiId: 'HOTEL-1',
              hotelName: '度假酒店',
              status: 'CANCELED',
              roomTypeName: '双床房',
              arrival: '2026-09-21',
              departure: '2026-09-22',
              totalPrice: 400,
              cancelOrder: true,
            },
          ],
        },
      };

      const summaries = parseMeituanOrderListResponse(payload);
      expect(summaries).toHaveLength(2);
      expect(summaries[0]).toEqual({
        orderId: 'MT-1001',
        hotelId: 'HOTEL-1',
        hotelName: '度假酒店',
        cancelOrder: false,
        orderDisplayLabel: '待确认',
      });
      expect(summaries[1]).toEqual({
        orderId: 'MT-1002',
        hotelId: 'HOTEL-1',
        hotelName: '度假酒店',
        cancelOrder: true,
        orderDisplayLabel: 'CANCELED',
      });

      const rawOrders = extractMeituanOrdersFromPayload(payload);
      expect(rawOrders[0].totalAmount).toBe(888);
      expect(rawOrders[0].nights).toBe(2);
      expect(rawOrders[0].contacts).toEqual([{ name: '张三', phone: '13800138000' }]);
      expect(rawOrders[1].totalAmount).toBe(400);
      expect(rawOrders[1].nights).toBe(1);
    });

    it('should parse real Meituan E-booking data.results structure', () => {
      const realPayload = {
        data: {
          results: [
            {
              orderId: '5035036069802774638',
              poiId: 781913923,
              poiName: '成都安得天馨Wellness Resort酒店',
              status: 'NEW_ORDER',
              orderDisplayLabel: '新订',
              roomName: '安澜大床客房[错峰出游]',
              rpInfo: '【不含早】2026-09-29 18:00:00前可取消',
              checkInDateString: '2026-09-29 00:00:00',
              checkOutDateString: '2026-09-30 00:00:00',
              totalFee: 29548,
              roomCount: 1,
              cancelOrder: false,
              contacts: [{ name: '王***', phone: '' }],
            },
          ],
          total: 1,
        },
        message: '成功',
        status: 0,
      };

      const summaries = parseMeituanOrderListResponse(realPayload);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual({
        orderId: '5035036069802774638',
        hotelId: '781913923',
        hotelName: '成都安得天馨Wellness Resort酒店',
        cancelOrder: false,
        orderDisplayLabel: '新订',
      });

      const rawOrders = extractMeituanOrdersFromPayload(realPayload);
      expect(rawOrders).toHaveLength(1);
      expect(rawOrders[0].orderId).toBe('5035036069802774638');
      expect(rawOrders[0].checkInDate).toBe('2026-09-29');
      expect(rawOrders[0].checkOutDate).toBe('2026-09-30');
      expect(rawOrders[0].nights).toBe(1);
      expect(rawOrders[0].totalAmount).toBe(295.48);
      expect(rawOrders[0].ratePlanName).toBe('【不含早】2026-09-29 18:00:00前可取消');
    });
  });

  describe('parseMeituanOrderDetailResponse', () => {
    it('should return null for invalid payload', () => {
      expect(parseMeituanOrderDetailResponse(null)).toBeNull();
      expect(parseMeituanOrderDetailResponse('string')).toBeNull();
    });

    it('should return null when targetOrderId mismatches', () => {
      const payload = {
        data: {
          orderId: 'MT-1001',
        },
      };
      expect(parseMeituanOrderDetailResponse(payload, 'MT-9999')).toBeNull();
    });

    it('should parse complete order details from data.orderDetail', () => {
      const payload = {
        data: {
          orderDetail: {
            orderId: 'MT-8888',
            poiId: 'POI-123',
            poiName: '海景度假村',
            guestName: '李四',
            guestMobile: '13912345678',
            roomName: '海景套房',
            ratePlanName: '连住特惠',
            checkInDateString: '2026-09-25',
            checkOutDateString: '2026-09-27',
            nights: 2,
            roomCount: 1,
            totalFee: 120000, // 1200
          },
        },
      };

      const detail = parseMeituanOrderDetailResponse(payload, 'MT-8888');
      expect(detail).not.toBeNull();
      expect(detail?.otaOrderId).toBe('MT-8888');
      expect(detail?.otaChannel).toBe('MEITUAN');
      expect(detail?.unitId).toBe('POI-123');
      expect(detail?.unitName).toBe('海景度假村');
      expect(detail?.guestName).toBe('李四');
      expect(detail?.guestMobile).toBe('13912345678');
      expect(detail?.roomTypeName).toBe('海景套房');
      expect(detail?.ratePlanName).toBe('连住特惠');
      expect(detail?.arrival).toBe('2026-09-25');
      expect(detail?.departure).toBe('2026-09-27');
      expect(detail?.nights).toBe(2);
      expect(detail?.totalPrice).toBe(1200);
    });

    it('should derive checkIn/checkOut from roomNightPriceModels when dates are missing', () => {
      const payload = {
        data: {
          orderId: 'MT-9999',
          guestName: '王五',
          roomTypeName: '标准大床房',
          roomNightPriceModels: [
            { dateStr: '2026-10-01', price: 300 },
            { dateStr: '2026-10-02', price: 300 },
          ],
        },
      };

      const detail = parseMeituanOrderDetailResponse(payload, 'MT-9999');
      expect(detail?.arrival).toBe('2026-10-01');
      expect(detail?.departure).toBe('2026-10-03');
      expect(detail?.nights).toBe(2);
    });

    it('should extract guest remarks from orderObj.remark, memo, or specialRequirement', () => {
      const payloadWithRemark = {
        data: {
          orderDetail: {
            orderId: 'MT-8888',
            roomName: '大床房',
            checkInDateString: '2026-10-01',
            checkOutDateString: '2026-10-02',
            nights: 1,
            totalPrice: 200,
            guestName: '李四',
            specialRequirement: '需要高楼层且无烟房',
          },
        },
      };

      const detail = parseMeituanOrderDetailResponse(payloadWithRemark);
      expect(detail?.remark).toBe('需要高楼层且无烟房');
    });
  });

  describe('parseMeituanSensitiveResponse', () => {
    it('should return null for non-object payload or when no sensitive data found', () => {
      expect(parseMeituanSensitiveResponse(null)).toBeNull();
      expect(parseMeituanSensitiveResponse({})).toBeNull();
      expect(parseMeituanSensitiveResponse({ data: {} })).toBeNull();
    });

    it('should extract guest name and phone from sensitiveDataList and ignore masked values', () => {
      const payload = {
        data: {
          sensitiveDataList: [
            {
              guestInfos: [
                { name: '张*三', phone: '138****0000' }, // masked -> should be ignored
                { name: '张小三', phone: '13800138000' }, // plain
              ],
            },
          ],
        },
      };

      const result = parseMeituanSensitiveResponse(payload);
      expect(result).toEqual({
        guestNames: ['张小三'],
        guestMobile: '13800138000',
      });
    });

    it('should collect all decrypted guest names in order for multi-guest orders', () => {
      const payload = {
        data: {
          sensitiveDataList: [
            {
              guestInfos: [
                { name: '李四', phone: '13800138000' },
                { name: '王五' },
                { name: '李四' }, // 重复住客名去重
              ],
            },
          ],
        },
      };

      const result = parseMeituanSensitiveResponse(payload);
      expect(result?.guestNames).toEqual(['李四', '王五']);
      expect(result?.guestMobile).toBe('13800138000');
    });

    it('should filter out placeholder strings like "查看姓名" or "点击查看"', () => {
      const payload = {
        data: {
          sensitiveDataList: [
            {
              guestInfos: [
                { name: '查看姓名', phone: '13800138000' },
              ],
            },
          ],
        },
      };

      const result = parseMeituanSensitiveResponse(payload);
      expect(result?.guestNames).toEqual([]);
      expect(result?.guestMobile).toBe('13800138000');
    });

    it('should extract from top-level phone/mobile and name', () => {
      const payload = {
        data: {
          phone: '13987654321',
          name: '赵六',
        },
      };

      const result = parseMeituanSensitiveResponse(payload);
      expect(result).toEqual({
        guestNames: ['赵六'],
        guestMobile: '13987654321',
      });
    });
  });

  describe('mergeSensitiveDataIntoRawDetail', () => {
    it('should return rawPayload directly when rawPayload or sensitive is invalid/empty', () => {
      expect(mergeSensitiveDataIntoRawDetail(null, { guestNames: ['张三'] })).toBeNull();
      expect(mergeSensitiveDataIntoRawDetail('not-object', { guestNames: ['张三'] })).toBe('not-object');

      const original = { data: { orderDetail: { guestName: '张*' } } };
      expect(mergeSensitiveDataIntoRawDetail(original, null)).toBe(original);
      expect(mergeSensitiveDataIntoRawDetail(original, { guestNames: ['张*'] })).toBe(original);
      expect(mergeSensitiveDataIntoRawDetail(original, { guestNames: [] })).toBe(original);
    });

    it('should replace masked guestName and guestMobile in data.orderDetail and contacts', () => {
      const rawPayload = {
        code: 0,
        data: {
          orderDetail: {
            orderId: 'MT-RAW-001',
            guestName: '李*',
            guestMobile: '138****8888',
            roomName: '豪华江景房',
            contacts: [
              { name: '李*', phone: '138****8888' },
            ],
          },
        },
      };

      const merged = mergeSensitiveDataIntoRawDetail(rawPayload, {
        guestNames: ['李小龙'],
        guestMobile: '13812345678',
      }) as typeof rawPayload;

      expect(merged.data.orderDetail.guestName).toBe('李小龙');
      expect(merged.data.orderDetail.guestMobile).toBe('13812345678');
      expect(merged.data.orderDetail.contacts[0].name).toBe('李小龙');
      expect(merged.data.orderDetail.contacts[0].phone).toBe('13812345678');

      // 验证交给 parseMeituanOrderDetailResponse 解析时能成功产出明文
      const parsed = parseMeituanOrderDetailResponse(merged, 'MT-RAW-001');
      expect(parsed?.guestName).toBe('李小龙');
      expect(parsed?.guestMobile).toBe('13812345678');
    });

    it('should unmask every guest entry by index for multi-guest orders (两客人两间房场景)', () => {
      const rawPayload = {
        code: 0,
        data: {
          orderDetail: {
            orderId: 'MT-MULTI-GUEST-001',
            guestName: '李*',
            guests: [
              { name: '李*' },
              { name: '王*' },
            ],
            contacts: [
              { name: '李*', phone: '138****0000' },
              { name: '王*', phone: '' },
            ],
          },
        },
      };

      const merged = mergeSensitiveDataIntoRawDetail(rawPayload, {
        guestNames: ['李四', '王五'],
        guestMobile: '13800138000',
      }) as typeof rawPayload;

      const orderDetail = merged.data.orderDetail;
      // 标量字段回写首位（主）住客
      expect(orderDetail.guestName).toBe('李四');
      // 多住客按索引逐一回写，第二位客人不再残留王*；首位住客同步回写明文电话
      expect(orderDetail.guests).toEqual([{ name: '李四', phone: '13800138000' }, { name: '王五' }]);
      expect(orderDetail.contacts).toEqual([
        { name: '李四', phone: '13800138000' },
        { name: '王五', phone: '' },
      ]);
    });

    it('should append missing guest entries when decrypted names outnumber array entries (合并串场景)', () => {
      const rawPayload = {
        data: {
          guests: [{ name: '李四，王*' }],
        },
      };

      const merged = mergeSensitiveDataIntoRawDetail(rawPayload, {
        guestNames: ['李四', '王五'],
      }) as { data: { guests: Array<{ name: string }> } };

      expect(merged.data.guests).toEqual([{ name: '李四' }, { name: '王五' }]);
    });

    it('should leave later guest entries untouched when fewer decrypted names are available', () => {
      const rawPayload = {
        data: {
          guests: [{ name: '李*' }, { name: '王*' }],
        },
      };

      const merged = mergeSensitiveDataIntoRawDetail(rawPayload, {
        guestNames: ['李四'],
      }) as { data: { guests: Array<{ name: string }> } };

      // 仅解密出首位住客时，第二位保持原样（由推单边界 GUEST_INFO_MASKED 显式阻断）
      expect(merged.data.guests).toEqual([{ name: '李四' }, { name: '王*' }]);
    });

    it('should replace sensitive data across multiple possible container shapes (order, root)', () => {
      const payloadOrder = {
        data: {
          order: {
            orderId: 'MT-ORD-002',
            customerName: '王*',
            customerMobile: '139****0000',
            guests: [{ name: '王*' }],
          },
        },
      };

      const mergedOrder = mergeSensitiveDataIntoRawDetail(payloadOrder, {
        guestNames: ['王大拿'],
        guestMobile: '13900001111',
      }) as { data: { order: { guestName: string; guestMobile: string; guests: Array<{ name: string }> } } };

      expect(mergedOrder.data.order.guestName).toBe('王大拿');
      expect(mergedOrder.data.order.guestMobile).toBe('13900001111');
      expect(mergedOrder.data.order.guests[0].name).toBe('王大拿');
    });
  });

  describe('isPlainPhoneNumber', () => {
    it('should validate 11-digit mobile numbers and landlines', () => {
      expect(isPlainPhoneNumber('13800138000')).toBe(true);
      expect(isPlainPhoneNumber('13800138000#1234')).toBe(true);
      expect(isPlainPhoneNumber('021-12345678')).toBe(true);
      expect(isPlainPhoneNumber('075588888888')).toBe(true);
    });

    it('should reject masked phone numbers with asterisk', () => {
      expect(isPlainPhoneNumber('138****8000')).toBe(false);
      expect(isPlainPhoneNumber('138****8000#123')).toBe(false);
    });

    it('should reject placeholder text and empty values', () => {
      expect(isPlainPhoneNumber('查看电话')).toBe(false);
      expect(isPlainPhoneNumber('联系客人')).toBe(false);
      expect(isPlainPhoneNumber('暂无')).toBe(false);
      expect(isPlainPhoneNumber('未知')).toBe(false);
      expect(isPlainPhoneNumber('')).toBe(false);
      expect(isPlainPhoneNumber(null)).toBe(false);
      expect(isPlainPhoneNumber(undefined)).toBe(false);
    });
  });

  describe('hasPlainMobileNumber', () => {
    it('should return true if sensitive contains plain guestMobile without asterisk', () => {
      expect(hasPlainMobileNumber(null, { guestMobile: '13812345678' })).toBe(true);
      expect(hasPlainMobileNumber({}, { guestMobile: '13812345678' })).toBe(true);
    });

    it('should return false if sensitive guestMobile contains asterisk or placeholder', () => {
      expect(hasPlainMobileNumber(null, { guestMobile: '138****5678' })).toBe(false);
      expect(hasPlainMobileNumber({}, { guestMobile: '138****5678' })).toBe(false);
      expect(hasPlainMobileNumber(null, { guestMobile: '查看电话' })).toBe(false);
    });

    it('should check rawDetail when sensitive has no plain mobile', () => {
      const rawWithPlain = {
        data: {
          orderDetail: {
            guestMobile: '13987654321',
          },
        },
      };
      expect(hasPlainMobileNumber(rawWithPlain, null)).toBe(true);
      expect(hasPlainMobileNumber(rawWithPlain, { guestMobile: '139****4321' })).toBe(true);

      const rawWithMasked = {
        data: {
          orderDetail: {
            guestMobile: '139****4321',
          },
        },
      };
      expect(hasPlainMobileNumber(rawWithMasked, null)).toBe(false);

      const rawWithPlaceholder = {
        data: {
          orderDetail: {
            guestMobile: '查看电话',
          },
        },
      };
      expect(hasPlainMobileNumber(rawWithPlaceholder, null)).toBe(false);

      const rawEmpty = {};
      expect(hasPlainMobileNumber(rawEmpty, null)).toBe(false);
    });

    it('should scan contacts and guests arrays for plain mobile numbers', () => {
      const rawWithContacts = {
        data: {
          orderDetail: {
            guestMobile: '139****4321', // masked on top
            contacts: [
              { name: '张三', phone: '13800138000' }, // plain in contacts
            ],
          },
        },
      };
      expect(hasPlainMobileNumber(rawWithContacts, null)).toBe(true);

      const rawWithGuests = {
        data: {
          orderDetail: {
            guests: [
              { name: '李四', mobile: '13700137000' }, // plain in guests
            ],
          },
        },
      };
      expect(hasPlainMobileNumber(rawWithGuests, null)).toBe(true);
    });
  });

  describe('extractValidOrderId (阶段一订单号提取，约定 string 契约)', () => {
    it('字符串订单号按原始形态直取，支持渠道特殊标识符', () => {
      expect(extractValidOrderId({ orderId: '5035036081700000001' })).toBe('5035036081700000001');
      expect(extractValidOrderId({ orderId: 'MT#2026.09:001' })).toBe('MT#2026.09:001');
      expect(extractValidOrderId({ orderId: 'ORD-999_SPECIAL' })).toBe('ORD-999_SPECIAL');
      expect(extractValidOrderId({ orderId: ' 5035036081700000001 ' })).toBe('5035036081700000001');
    });

    it('美团协议唯一事实为 orderId，非 orderId 候选字段应返回 null', () => {
      expect(extractValidOrderId({ orderID: 'MT_123456' })).toBeNull();
      expect(extractValidOrderId({ otaOrderId: 'ORD-999' })).toBeNull();
      expect(extractValidOrderId({ orderNo: 'NO-888' })).toBeNull();
    });

    it('非字符串、空白或缺失订单号视为契约违规返回 null', () => {
      expect(extractValidOrderId({ orderId: 88990011 })).toBeNull();
      expect(extractValidOrderId({ orderId: true })).toBeNull();
      expect(extractValidOrderId({ orderId: {} })).toBeNull();
      expect(extractValidOrderId({ orderId: [] })).toBeNull();
      expect(extractValidOrderId({ orderId: '' })).toBeNull();
      expect(extractValidOrderId({ orderId: '   ' })).toBeNull();
      expect(extractValidOrderId(null)).toBeNull();
      expect(extractValidOrderId(undefined)).toBeNull();
    });
  });

  describe('isMeituanCancelOrder (阶段一取消订单状态识别)', () => {
    it('应以 status === CANCELED 为唯一判定标准（真实样本验证值）', () => {
      expect(isMeituanCancelOrder({ status: 'CANCELED' })).toBe(true);
      expect(isMeituanCancelOrder({ status: 'canceled' })).toBe(true);
    });

    it('label 取消文案不再作为判定依据（status 唯一标准）', () => {
      expect(isMeituanCancelOrder({ orderDisplayLabel: '取消' })).toBe(false);
      expect(isMeituanCancelOrder({ orderDisplayLabel: '新订', status: 'NEW_ORDER' })).toBe(false);
    });
  });
});

