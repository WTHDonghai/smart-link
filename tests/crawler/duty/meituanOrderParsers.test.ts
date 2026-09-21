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
  isMeituanRiskControlText,
} from '../../../src/crawler/duty/meituanOrderParsers';

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

    it('isMeituanDetailUrl should match detail URLs', () => {
      expect(isMeituanDetailUrl('https://eb.meituan.com/api/v1/ebooking/orders/12345')).toBe(true);
      expect(isMeituanDetailUrl('https://eb.meituan.com/orders/detail?id=123')).toBe(true);
      expect(isMeituanDetailUrl('https://eb.meituan.com/ebooking/orders/123')).toBe(true);
      expect(isMeituanDetailUrl('https://eb.meituan.com/orders/12345', '12345')).toBe(true);

      // Exclude list and sensitive
      expect(isMeituanDetailUrl('https://eb.meituan.com/orders/task/list')).toBe(false);
      expect(isMeituanDetailUrl('https://eb.meituan.com/orders/sensitiveData')).toBe(false);
    });

    it('isMeituanSensitiveUrl should match sensitive data URLs', () => {
      expect(isMeituanSensitiveUrl('https://eb.meituan.com/orders/sensitiveData')).toBe(true);
      expect(isMeituanSensitiveUrl('https://eb.meituan.com/confirmPhone?orderId=123')).toBe(true);
      expect(isMeituanSensitiveUrl('https://eb.meituan.com/orders/list')).toBe(false);
    });

  });

  describe('parseMeituanOrderListResponse & extractMeituanOrdersFromPayload', () => {
    it('should return empty array for empty payload or non-object', () => {
      expect(parseMeituanOrderListResponse(null)).toEqual([]);
      expect(parseMeituanOrderListResponse({})).toEqual([]);
      expect(parseMeituanOrderListResponse({ data: { list: [] } })).toEqual([]);
      expect(extractMeituanOrdersFromPayload({ data: { orders: [] } })).toEqual([]);
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
              orderID: 'MT-1002',
              poiId: 'HOTEL-1',
              hotelName: '度假酒店',
              status: 'CANCEL',
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
        orderDisplayLabel: 'CANCEL',
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
        guestName: '张小三',
        guestMobile: '13800138000',
      });
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
      expect(result?.guestName).toBeUndefined();
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
        guestName: '赵六',
        guestMobile: '13987654321',
      });
    });
  });

  describe('isMeituanRiskControlText', () => {
    it('should detect risk control and captcha keywords correctly', () => {
      expect(isMeituanRiskControlText('请完成安全验证')).toBe(true);
      expect(isMeituanRiskControlText('系统检测到人机异常')).toBe(true);
      expect(isMeituanRiskControlText('您的访问过于频繁，请稍后再试')).toBe(true);
      expect(isMeituanRiskControlText('操作频繁，请重试')).toBe(true);
      expect(isMeituanRiskControlText('请拖动滑块完成验证')).toBe(true);
      expect(isMeituanRiskControlText('yoda-verify-popup')).toBe(true);
      expect(isMeituanRiskControlText('secsdk-captcha-drag-wrapper')).toBe(true);
      expect(isMeituanRiskControlText('captcha_token_missing')).toBe(true);
    });

    it('should return false for normal business text', () => {
      expect(isMeituanRiskControlText('待确认订单列表正常渲染')).toBe(false);
      expect(isMeituanRiskControlText('豪华景观大床房 2026-09-20')).toBe(false);
      expect(isMeituanRiskControlText('')).toBe(false);
      expect(isMeituanRiskControlText(null as unknown as string)).toBe(false);
    });
  });

  describe('mergeSensitiveDataIntoRawDetail', () => {
    it('should return rawPayload directly when rawPayload or sensitive is invalid/empty', () => {
      expect(mergeSensitiveDataIntoRawDetail(null, { guestName: '张三' })).toBeNull();
      expect(mergeSensitiveDataIntoRawDetail('not-object', { guestName: '张三' })).toBe('not-object');

      const original = { data: { orderDetail: { guestName: '张*' } } };
      expect(mergeSensitiveDataIntoRawDetail(original, null)).toBe(original);
      expect(mergeSensitiveDataIntoRawDetail(original, { guestName: '张*' })).toBe(original);
      expect(mergeSensitiveDataIntoRawDetail(original, {})).toBe(original);
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
        guestName: '李小龙',
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
        guestName: '王大拿',
        guestMobile: '13900001111',
      }) as { data: { order: { guestName: string; guestMobile: string; guests: Array<{ name: string }> } } };

      expect(mergedOrder.data.order.guestName).toBe('王大拿');
      expect(mergedOrder.data.order.guestMobile).toBe('13900001111');
      expect(mergedOrder.data.order.guests[0].name).toBe('王大拿');
    });
  });
});

