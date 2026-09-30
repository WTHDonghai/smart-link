import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  isDouyinBookOrderListUrl,
  isDouyinRefundOrderListUrl,
  isDouyinOrderListUrl,
  isDouyinOrderDetailUrl,
  isDouyinRiskControlText,
  extractDouyinOrdersFromPayload,
  parseDouyinOrderListResponse,
  parseDouyinBookOrderListResponse,
  parseDouyinRefundOrderListResponse,
  extractDouyinOrderFromResponse,
} from '@/src/crawler/duty/channels/douyin/douyinOrderParsers';
import { DutyExecutionError } from '@/src/crawler/duty/dutyContracts';
import { DouyinDutyErrorCode } from '@/src/crawler/duty/channels/douyin/douyinDutyContracts';

describe('douyinOrderParsers (Pure Parsing Functions & Contract Verification)', () => {
  describe('URL matching predicates', () => {
    it('isDouyinBookOrderListUrl should match book order list URL path', () => {
      expect(
        isDouyinBookOrderListUrl('https://life.douyin.com/life/trade_view/v1/workbench/book/query/list?aid=123')
      ).toBe(true);
      expect(
        isDouyinBookOrderListUrl('https://seller.douyin.com/life/trade_view/v1/workbench/book/query/list')
      ).toBe(true);
      expect(
        isDouyinBookOrderListUrl('https://life.douyin.com/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list')
      ).toBe(false);
      expect(isDouyinBookOrderListUrl('invalid-url')).toBe(false);
      expect(isDouyinBookOrderListUrl('/life/trade_view/v1/workbench/book/query/list')).toBe(false);
    });

    it('isDouyinRefundOrderListUrl should match refund order list URL path', () => {
      expect(
        isDouyinRefundOrderListUrl('https://life.douyin.com/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list?foo=bar')
      ).toBe(true);
      expect(
        isDouyinRefundOrderListUrl('https://life.douyin.com/life/trade_view/v1/workbench/book/query/list')
      ).toBe(false);
      expect(isDouyinRefundOrderListUrl('')).toBe(false);
      expect(isDouyinRefundOrderListUrl('/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list')).toBe(false);
    });

    it('isDouyinOrderDetailUrl should match book order detail URL path', () => {
      expect(
        isDouyinOrderDetailUrl('https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?root_life_account_id=7063009395525584896&life_biz_view_id=22&life_account_biz_ids=')
      ).toBe(true);
      expect(
        isDouyinOrderDetailUrl('https://life.douyin.com/life/trade_view/v1/workbench/book/query/list')
      ).toBe(false);
      expect(isDouyinOrderDetailUrl('')).toBe(false);
    });

    it('isDouyinOrderListUrl should match book list or refund list, but not detail endpoint', () => {
      expect(
        isDouyinOrderListUrl('https://life.douyin.com/life/trade_view/v1/workbench/book/query/list')
      ).toBe(true);
      expect(
        isDouyinOrderListUrl('https://life.douyin.com/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list')
      ).toBe(true);
      expect(
        isDouyinOrderListUrl('https://life.douyin.com/life/trade_view/v1/workbench/book/query/detail?root_life_account_id=123')
      ).toBe(false);
      expect(isDouyinOrderListUrl('https://life.douyin.com/life/other/endpoint')).toBe(false);
    });
  });

  describe('isDouyinRiskControlText', () => {
    it('should correctly detect risk control keywords', () => {
      expect(isDouyinRiskControlText('请完成安全验证')).toBe(true);
      expect(isDouyinRiskControlText('操作频繁，请稍后再试')).toBe(true);
      expect(isDouyinRiskControlText('拖动滑块完成验证')).toBe(true);
      expect(isDouyinRiskControlText('secsdk captcha')).toBe(true);
      expect(isDouyinRiskControlText('登录验证码已发送')).toBe(true);
    });

    it('should return false for normal business text', () => {
      expect(isDouyinRiskControlText('新订待确认')).toBe(false);
      expect(isDouyinRiskControlText('买家申请取消/退款')).toBe(false);
      expect(isDouyinRiskControlText('')).toBe(false);
    });
  });

  describe('extractDouyinOrdersFromPayload with Real Production Fixtures', () => {
    it('should parse real production book order list fixture with serialized JSON string item', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealBookOrderList.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const orders = extractDouyinOrdersFromPayload(payload, false);
      expect(orders).toHaveLength(1);

      const first = orders[0];
      expect(first.orderId).toBe('800000522465461174916676823');
      expect(first.bookId).toBe('800000522465461174916676823');
      expect(first.mainOrderId).toBe('1113572432327416823');
      expect(first.hotelId).toBe('7130223634133092383');
      expect(first.hotelName).toBe('淮安日月洲度假村(西游乐园店)');
      expect(first.roomName).toBe('豪华家庭房');
      expect(first.productName).toContain('豪华家庭房1晚含早');
      expect(first.checkInDate).toBe('2026-09-24');
      expect(first.checkOutDate).toBe('2026-09-25');
      expect(first.nights).toBe(1);
      expect(first.quantity).toBe(1);
      expect(first.totalAmount).toBe(705); // 70500 分 -> 705 元
      expect(first.contacts).toEqual([{ name: '吕克', phone: '*******9109' }]);
      expect(first.cancelOrder).toBe(false);
      expect(first.orderDisplayLabel).toBe('新订');
      expect(first.orderTime).toBe('2026-09-24 23:04:26');
    });

    it('should parse real production refund order list fixture with afterSaleId and cancelOrder', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealRefundOrderList.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const orders = extractDouyinOrdersFromPayload(payload, true);
      expect(orders).toHaveLength(1);

      const refundOrder = orders[0];
      expect(refundOrder.orderId).toBe('800000263678588854916054527');
      expect(refundOrder.bookId).toBe('800000263678588854916054527');
      expect(refundOrder.mainOrderId).toBe('1112732801688054527');
      expect(refundOrder.afterSaleId).toBe('768912266776597510130734527');
      expect(refundOrder.cancelOrder).toBe(true);
      expect(refundOrder.totalAmount).toBe(500); // 50000 分 -> 500 元
      expect(refundOrder.orderDisplayLabel).toBe('已取消');
      expect(refundOrder.hotelName).toBe('淮安日月洲度假村(西游乐园店)');
      expect(refundOrder.contacts).toEqual([{ name: '王丽俐', phone: '*******8890' }]);
    });

    it('should prioritize refund amount for cancel/refund orders in partial refund scenarios', () => {
      // 模拟部分退款单：支付了 1000 元 (100000 分)，仅申请退款 200 元 (20000 分)
      const partialRefundPayload = {
        status_code: 0,
        data: {
          data: [
            {
              order_base_info: { order_id: '111222333' },
              after_sale_info_v2: {
                after_sale_info: { after_sale_id: '999888', refund_amount: 20000 },
              },
              amount_info: { pay_amount: 100000, refund_amount: 20000 },
              status_info_v2: { title: '买家申请部分退款' },
            },
          ],
        },
      };

      const orders = extractDouyinOrdersFromPayload(partialRefundPayload, true);
      expect(orders).toHaveLength(1);
      expect(orders[0].cancelOrder).toBe(true);
      expect(orders[0].totalAmount).toBe(200); // 20000 分 -> 200 元，而非 1000 元
    });
  });

  describe('DutyUnhandledOrderSummary derivation', () => {
    it('parseDouyinOrderListResponse should handle direct call with cancel flag', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealRefundOrderList.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const summaries = parseDouyinOrderListResponse(payload, true);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].orderId).toBe('800000263678588854916054527');
      expect(summaries[0].cancelOrder).toBe(true);
      expect(summaries[0].afterSaleId).toBe('768912266776597510130734527');
    });

    it('parseDouyinBookOrderListResponse should derive correct summaries', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealBookOrderList.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const summaries = parseDouyinBookOrderListResponse(payload);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual({
        orderId: '800000522465461174916676823',
        hotelId: '7130223634133092383',
        hotelName: '淮安日月洲度假村(西游乐园店)',
        cancelOrder: false,
        afterSaleId: undefined,
        orderDisplayLabel: '新订',
      });
    });

    it('parseDouyinRefundOrderListResponse should derive correct cancel summaries', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealRefundOrderList.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const summaries = parseDouyinRefundOrderListResponse(payload);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual({
        orderId: '800000263678588854916054527',
        hotelId: undefined,
        hotelName: '淮安日月洲度假村(西游乐园店)',
        cancelOrder: true,
        afterSaleId: '768912266776597510130734527',
        orderDisplayLabel: '已取消',
      });
    });
  });

  describe('Fail-Fast error handling', () => {
    it('should throw DutyExecutionError when status_code !== 0', () => {
      const errorPayload = {
        status_code: 10001,
        status_msg: '商户登录凭据已过期',
      };

      let thrown: DutyExecutionError | null = null;
      try {
        extractDouyinOrdersFromPayload(errorPayload);
      } catch (err) {
        thrown = err as DutyExecutionError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.errorCode).toBe(DouyinDutyErrorCode.LIST_BUSINESS_FAILED);
      expect(thrown?.message).toContain('code: 10001');
      expect(thrown?.message).toContain('商户登录凭据已过期');
    });

    it('should use default message when status_msg is missing or empty', () => {
      const errorPayload = {
        status_code: 500,
      };

      let thrown: DutyExecutionError | null = null;
      try {
        extractDouyinOrdersFromPayload(errorPayload);
      } catch (err) {
        thrown = err as DutyExecutionError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.errorCode).toBe(DouyinDutyErrorCode.LIST_BUSINESS_FAILED);
      expect(thrown?.message).toContain('code: 500');
      expect(thrown?.message).toContain('未知业务异常');
    });

    it('should throw DutyExecutionError when item JSON string is malformed', () => {
      const corruptedPayload = {
        status_code: 0,
        data: {
          data: ['{ this is not valid json }'],
        },
      };

      let thrown: DutyExecutionError | null = null;
      try {
        extractDouyinOrdersFromPayload(corruptedPayload);
      } catch (err) {
        thrown = err as DutyExecutionError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.errorCode).toBe(DouyinDutyErrorCode.LIST_BUSINESS_FAILED);
      expect(thrown?.message).toContain('反序列化失败');
    });

    it('should throw DutyExecutionError when status_code is missing or undefined (Fail-Fast)', () => {
      const missingStatusPayload = {
        data: {
          data: [],
        },
      };

      let thrown: DutyExecutionError | null = null;
      try {
        extractDouyinOrdersFromPayload(missingStatusPayload);
      } catch (err) {
        thrown = err as DutyExecutionError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.errorCode).toBe(DouyinDutyErrorCode.LIST_BUSINESS_FAILED);
      expect(thrown?.message).toContain('code: undefined');
    });

    it('should safely ignore primitive JSON strings like "null" or "123"', () => {
      const primitivePayload = {
        status_code: 0,
        data: {
          data: ['null', '123', 'true'],
        },
      };

      const orders = extractDouyinOrdersFromPayload(primitivePayload);
      expect(orders).toEqual([]);
    });

    it('should throw LIST_BUSINESS_FAILED for non-object or null payload (Fail-Fast)', () => {
      expect(() => extractDouyinOrdersFromPayload(null)).toThrowError(DutyExecutionError);
      expect(() => extractDouyinOrdersFromPayload(undefined)).toThrowError(DutyExecutionError);
      expect(() => extractDouyinOrdersFromPayload('string')).toThrowError(DutyExecutionError);
    });
  });

  describe('extractDouyinOrderFromResponse', () => {
    it('should extract target order from real book order list fixture with serialized JSON string', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealBookOrderList.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      // 提取目标单号
      const order = extractDouyinOrderFromResponse(payload, '1113572432327416823');
      expect(order).not.toBeNull();
      const baseInfo = order?.order_base_info as Record<string, unknown>;
      expect(baseInfo.order_id).toBe('1113572432327416823');
      const bookInfo = order?.book_detail_info as Record<string, unknown>;
      expect(bookInfo.book_id).toBe('800000522465461174916676823');
    });

    it('should extract target order by book_id from real book order list fixture', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealBookOrderList.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const order = extractDouyinOrderFromResponse(payload, '800000522465461174916676823');
      expect(order).not.toBeNull();
      const baseInfo = order?.order_base_info as Record<string, unknown>;
      expect(baseInfo.order_id).toBe('1113572432327416823');
    });

    it('should return null when targetOrderId is not in the list', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealBookOrderList.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const order = extractDouyinOrderFromResponse(payload, 'NON-EXISTENT-ID');
      expect(order).toBeNull();
    });

    it('should return the object directly when input is already a single unboxed order record', () => {
      const singleOrder = {
        order_base_info: { order_id: '1112769276121338025' },
        book_detail_info: { book_id: '800000449770071274116238025' },
        sale_product_info: { physical_room_name: '海洋主题家庭房' },
      };

      const extracted = extractDouyinOrderFromResponse(singleOrder, '1112769276121338025');
      expect(extracted).toBe(singleOrder);
    });

    it('should extract order when wrapped in data: { order_base_info: ... }', () => {
      const wrapped = {
        data: {
          order_base_info: { order_id: '1112769276121338025' },
          book_detail_info: { book_id: '800000449770071274116238025' },
        },
      };

      const extracted = extractDouyinOrderFromResponse(wrapped, '1112769276121338025');
      expect(extracted).toEqual(wrapped.data);
    });

    it('should extract order from real production detail API fixture with data.data as a serialized JSON string', () => {
      const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/douyinRealOrderDetail.json');
      const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

      const extracted = extractDouyinOrderFromResponse(payload, '1112665199685496539');
      expect(extracted).not.toBeNull();
      const baseInfo = extracted?.order_base_info as Record<string, unknown>;
      expect(baseInfo.order_id).toBe('1112665199685496539');
      const bookInfo = extracted?.book_detail_info as Record<string, unknown>;
      expect(bookInfo.book_id).toBe('800000263871637635716526539');
      expect(bookInfo.hotel_name).toBe('淮安日月洲度假村(西游乐园店)');
      expect(bookInfo.book_start_time).toBe(1794758400);
      expect(bookInfo.book_end_time).toBe(1794844800);

      const saleProduct = extracted?.sale_product_info as Record<string, unknown>;
      expect(saleProduct.physical_room_name).toBe('豪华大床房');
      expect(saleProduct.product_id).toBe('1874906660640768');

      const amountInfo = extracted?.amount_info as Record<string, unknown>;
      expect(amountInfo.pay_amount).toBe(49429);

      const guestInfo = extracted?.guest_info as Record<string, unknown>;
      const userList = guestInfo.user_list as Array<{ name: string; phone: string }>;
      expect(userList[0].name).toBe('赵锴');
      expect(userList[0].phone).toBe('*******3563');
    });

    it('should return null for null/undefined or non-object inputs', () => {
      expect(extractDouyinOrderFromResponse(null, '123')).toBeNull();
      expect(extractDouyinOrderFromResponse(undefined, '123')).toBeNull();
      expect(extractDouyinOrderFromResponse('not-json', '123')).toBeNull();
    });
  });
});
