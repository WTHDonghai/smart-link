import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeToolkitOrder,
  normalizeToolkitOrderFilters,
  ORDER_STATUSES,
  fetchToolkitOrders,
  fetchToolkitStatistics,
  fetchToolkitOrderDetails,
  updateToolkitOrder,
  retryToolkitOrderImport,
  deleteToolkitOrder,
  cancelToolkitOrder,
  fetchPropertyProductOptions,
  ORDER_ENDPOINTS,
} from '../../src/services/toolkitOrderApi';
import * as platformApi from '../../src/services/platformApi';
import type { ToolkitOrder } from '../../src/types';

vi.mock('../../src/services/platformApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/platformApi')>();
  return {
    ...actual,
    requestPlatformApi: vi.fn(),
    TOOLKIT_MODULE: 'toolkit',
  };
});

describe('toolkitOrderApi', () => {
  const mockRequest = vi.mocked(platformApi.requestPlatformApi);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizeToolkitOrder', () => {
    it('normalizes raw API payload into a typed ToolkitOrder', () => {
      const raw = {
        id: 'ord_1001',
        unitId: 'unit_99',
        unitName: '西湖度假酒店',
        otaChannel: 'MEITUAN',
        otaOrderId: 'MT20260917001',
        guestName: '张三',
        guestMobile: '13800001111',
        booking: {
          arrival: '2026-10-01',
          departure: '2026-10-03',
          roomType: '大床房',
          rateCode: 'BAR',
          paytype: 'PREPAY',
          quantity: 1,
          totalPrice: 450,
          pricing: [
            { date: '2026-10-01', price: 200 },
            { date: '2026-10-02', price: 250 },
          ],
        },
        status: 'FAILED',
        errorMessage: '房型未映射',
      };

      const result = normalizeToolkitOrder(raw);

      expect(result.id).toBe('ord_1001');
      expect(result.unitId).toBe('unit_99');
      expect(result.unitName).toBe('西湖度假酒店');
      expect(result.otaChannel).toBe('MEITUAN');
      expect(result.contact.name).toBe('张三');
      expect(result.contact.mobile).toBe('13800001111');
      expect(result.booking.nights).toBe(2);
      expect(result.booking.totalPrice).toBe(450);
      expect(result.status).toBe('FAILED');
      expect(result.errorMessage).toBe('房型未映射');
      expect(result.allowedActions).toEqual(['EDIT', 'IMPORT', 'DELETE']);
    });

    it('assigns CANCEL allowedAction for SUCCESS status', () => {
      const result = normalizeToolkitOrder({ id: '1', status: 'SUCCESS' });
      expect(result.status).toBe('SUCCESS');
      expect(result.allowedActions).toEqual(['CANCEL']);
    });
  });

  describe('normalizeToolkitOrderFilters', () => {
    it('exports the standard ORDER_STATUSES constant', () => {
      expect(ORDER_STATUSES).toEqual([
        'PENDING',
        'SUCCESS',
        'FAILED',
        'CANCEL',
        'IMPORTING',
      ]);
    });

    it('provides standard default filter values', () => {
      const filters = normalizeToolkitOrderFilters({});
      expect(filters.page).toBe(1);
      expect(filters.pageSize).toBe(20);
      expect(filters.status).toBe('');
      expect(filters.query).toBe('');
      expect(filters.arrivalStart).toBe('');
      expect(filters.arrivalEnd).toBe('');
    });

    it('normalizes status and converts "all" / "ALL" to empty string', () => {
      expect(normalizeToolkitOrderFilters({ status: 'all' }).status).toBe('');
      expect(normalizeToolkitOrderFilters({ status: 'ALL' }).status).toBe('');
      expect(normalizeToolkitOrderFilters({ status: 'pending' }).status).toBe('PENDING');
      expect(normalizeToolkitOrderFilters({ status: 'SUCCESS' }).status).toBe('SUCCESS');
    });

    it('throws when status is unsupported', () => {
      expect(() => normalizeToolkitOrderFilters({ status: 'UNKNOWN_STATUS' })).toThrow(
        '不支持的订单状态：UNKNOWN_STATUS'
      );
    });

    it('validates arrival date formats and rejects invalid dates', () => {
      expect(() => normalizeToolkitOrderFilters({ arrivalStart: '2026-99-99' })).toThrow(
        '入住开始日期格式无效。'
      );
      expect(() => normalizeToolkitOrderFilters({ arrivalEnd: 'invalid-date' })).toThrow(
        '入住结束日期格式无效。'
      );
    });

    it('rejects inverted arrival date ranges (arrivalStart > arrivalEnd)', () => {
      expect(() =>
        normalizeToolkitOrderFilters({
          arrivalStart: '2026-10-06',
          arrivalEnd: '2026-10-05',
        })
      ).toThrow('入住开始日期不能晚于结束日期。');
    });

    it('clamps page and pageSize to valid boundaries', () => {
      const filters1 = normalizeToolkitOrderFilters({ page: 0, pageSize: 200 });
      expect(filters1.page).toBe(1);
      expect(filters1.pageSize).toBe(100);

      const filters2 = normalizeToolkitOrderFilters({ page: -10, pageSize: -5 });
      expect(filters2.page).toBe(1);
      expect(filters2.pageSize).toBe(1);

      const filters3 = normalizeToolkitOrderFilters({ page: NaN, pageSize: NaN });
      expect(filters3.page).toBe(1);
      expect(filters3.pageSize).toBe(20);
    });

    it('trims query and preserves unitId / otaChannel', () => {
      const filters = normalizeToolkitOrderFilters({
        query: '   李四   ',
        unitId: 'unit_123',
        otaChannel: 'meituan',
      });
      expect(filters.query).toBe('李四');
      expect(filters.unitId).toBe('unit_123');
      expect(filters.otaChannel).toBe('MEITUAN');
    });
  });

  describe('fetchToolkitOrders', () => {
    it('queries orders with proper query parameters including unitId and otaChannel', async () => {
      mockRequest.mockResolvedValueOnce({
        records: [
          { id: '1', otaOrderId: 'O1', status: 'FAILED' },
          { id: '2', otaOrderId: 'O2', status: 'SUCCESS' },
        ],
        total: 2,
        current: 1,
        size: 20,
      });

      const result = await fetchToolkitOrders({
        page: 1,
        pageSize: 20,
        status: 'FAILED',
        query: '张三',
        arrivalStart: '2026-10-01',
        arrivalEnd: '2026-10-05',
        unitId: 'unit_100',
        otaChannel: 'MEITUAN',
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const urlCalled = mockRequest.mock.calls[0][0];
      expect(urlCalled).toContain(ORDER_ENDPOINTS.ORDERS);
      expect(urlCalled).toContain('current=1');
      expect(urlCalled).toContain('size=20');
      expect(urlCalled).toContain('status=FAILED');
      expect(urlCalled).toContain('query=%E5%BC%A0%E4%B8%89');
      expect(urlCalled).toContain('arrivalStart=2026-10-01+00%3A00%3A00');
      expect(urlCalled).toContain('arrivalEnd=2026-10-05+23%3A59%3A59');
      expect(urlCalled).toContain('unitId=unit_100');
      expect(urlCalled).toContain('otaChannel=MEITUAN');
      expect(urlCalled).toContain('showAll=true');

      expect(result.total).toBe(2);
      expect(result.records).toHaveLength(2);
      expect(result.records[0].allowedActions).toEqual(['EDIT', 'IMPORT', 'DELETE']);
      expect(result.records[1].allowedActions).toEqual(['CANCEL']);
    });

    it('correctly handles empty result with total: 0 without reverting to fallback length', async () => {
      mockRequest.mockResolvedValueOnce({
        records: [],
        total: 0,
        current: 1,
        size: 20,
      });

      const result = await fetchToolkitOrders({ page: 1, pageSize: 20 });
      expect(result.total).toBe(0);
      expect(result.records).toEqual([]);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('parses alternative nested lists like list or rows', async () => {
      mockRequest.mockResolvedValueOnce({
        list: [{ id: 'ord_row_1', otaOrderId: 'OT-ROW-1', status: 'PENDING' }],
        total: 1,
      });

      const result = await fetchToolkitOrders();
      expect(result.total).toBe(1);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].otaOrderId).toBe('OT-ROW-1');
      expect(result.records[0].status).toBe('PENDING');
    });
  });

  describe('fetchToolkitStatistics', () => {
    it('returns normalized 4 metrics', async () => {
      mockRequest.mockResolvedValueOnce({
        todayTotal: 42,
        pendingCount: 5,
        successCount: 30,
        failedCount: 7,
      });

      const stats = await fetchToolkitStatistics();

      expect(mockRequest).toHaveBeenCalledWith(ORDER_ENDPOINTS.STATISTICS);
      expect(stats).toEqual({
        today: 42,
        pending: 5,
        success: 30,
        failed: 7,
      });
    });
  });

  describe('fetchToolkitOrderDetails', () => {
    it('fetches order details by id', async () => {
      mockRequest.mockResolvedValueOnce({
        id: 'ord_123',
        status: 'FAILED',
        otaOrderId: 'OTA_999',
      });

      const result = await fetchToolkitOrderDetails('ord_123');
      expect(mockRequest).toHaveBeenCalledWith(`${ORDER_ENDPOINTS.ORDERS}/ord_123`);
      expect(result.id).toBe('ord_123');
    });

    it('throws error when id is empty', async () => {
      await expect(fetchToolkitOrderDetails('')).rejects.toThrow('订单 ID 不能为空');
    });
  });

  describe('order action methods', () => {
    it('updateToolkitOrder merges draft into ToolkitOrder and posts to /toolkit/orders/import', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        code: 200,
        data: { pmsOrderId: 'PMS_999' },
      });

      const baseOrder: ToolkitOrder = {
        id: 'ord_1',
        unitId: 'HOTEL_01',
        unitName: '隐居江南',
        otaChannel: 'MEITUAN',
        otaOrderId: 'MT_1001',
        contact: { name: '旧名字', mobile: '13800000000' },
        booking: {
          arrival: '2026-10-01',
          departure: '2026-10-02',
          roomType: '旧房型',
          roomTypeId: 'OLD_RT',
          rateCode: 'OLD_RATE',
          paytype: '预付全额',
          nights: 1,
          quantity: 1,
          totalPrice: 100,
          pricing: [{ date: '2026-10-01', price: 100 }],
        },
        status: 'FAILED',
        allowedActions: ['EDIT', 'IMPORT', 'DELETE'],
      };

      const draft = {
        otaOrderId: 'MT_1001',
        contact: { name: '张三', mobile: '13800001111' },
        booking: {
          roomType: '大床房',
          roomTypeId: 'RT_01',
          rateCode: 'OTA',
          paytype: '预付全额',
          arrival: '2026-10-01',
          departure: '2026-10-02',
          quantity: 1,
          pricing: [{ date: '2026-10-01', price: 200 }],
        },
        remark: '加急处理',
      };

      await updateToolkitOrder(baseOrder, draft);
      expect(mockRequest).toHaveBeenCalledWith(
        `${ORDER_ENDPOINTS.ORDERS}/ord_1`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            ...baseOrder,
            otaOrderId: 'MT_1001',
            contact: { name: '张三', mobile: '13800001111' },
            booking: {
              ...baseOrder.booking,
              roomType: '大床房',
              roomTypeId: 'RT_01',
              rateCode: 'OTA',
              paytype: '预付全额',
              arrival: '2026-10-01',
              departure: '2026-10-02',
              nights: 1,
              quantity: 1,
              pricing: [{ date: '2026-10-01', price: 200 }],
              totalPrice: 200,
            },
            remark: '加急处理',
          }),
        })
      );
    });

    it('updateToolkitOrder fetches details first if given an id string before sending PUT', async () => {
      mockRequest.mockResolvedValueOnce({
        id: 'ord_1',
        unitId: 'HOTEL_01',
        unitName: '隐居江南',
        otaChannel: 'MEITUAN',
        otaOrderId: 'MT_1001',
        contact: { name: '张三', mobile: '13800001111' },
        status: 'FAILED',
        booking: {
          roomType: '标准间',
          rateCode: 'RACK',
          paytype: '预付全额',
        },
      });
      mockRequest.mockResolvedValueOnce({
        success: true,
        code: 200,
      });

      const draft = {
        otaOrderId: 'MT_1001',
        contact: { name: '李四', mobile: '13900002222' },
        booking: {
          roomType: '大床房',
          roomTypeId: 'RT_01',
          rateCode: 'OTA',
          paytype: '预付全额',
          arrival: '2026-10-01',
          departure: '2026-10-02',
          quantity: 1,
          pricing: [{ date: '2026-10-01', price: 250 }],
        },
      };

      await updateToolkitOrder('ord_1', draft);
      expect(mockRequest).toHaveBeenCalledWith('/toolkit/orders/ord_1');
      expect(mockRequest).toHaveBeenCalledWith(
        '/toolkit/orders/ord_1',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('retryToolkitOrderImport calls POST /toolkit/orders/:id/import with record id', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        code: 200,
        data: { pmsOrderId: 'PMS_888' },
      });

      const orderToImport: ToolkitOrder = {
        id: 'ord_1',
        unitId: 'HOTEL_01',
        unitName: '隐居江南',
        otaChannel: 'MEITUAN',
        otaOrderId: 'MT_1001',
        contact: { name: '张三', mobile: '13800001111' },
        booking: {
          arrival: '2026-10-01',
          departure: '2026-10-02',
          roomType: '大床房',
          roomTypeId: 'RT_01',
          rateCode: 'OTA',
          paytype: '预付全额',
          nights: 1,
          quantity: 1,
          totalPrice: 200,
          pricing: [{ date: '2026-10-01', price: 200 }],
        },
        status: 'FAILED',
        allowedActions: ['EDIT', 'IMPORT', 'DELETE'],
      };

      const result = await retryToolkitOrderImport(orderToImport);
      expect(mockRequest).toHaveBeenCalledWith(
        '/toolkit/orders/ord_1/import',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: 'ord_1' }),
        })
      );
      expect(result.pmsOrderId).toBe('PMS_888');
    });

    it('retryToolkitOrderImport fetches details when given id string before importing', async () => {
      // First call for details
      mockRequest.mockResolvedValueOnce({
        id: 'ord_2',
        unitId: 'HOTEL_02',
        otaChannel: 'CTRIP',
        otaOrderId: 'CT_2002',
        guestName: '李四',
        guestMobile: '13900002222',
        roomType: '双床房',
        rateCode: 'RACK',
        arrival: '2026-10-03',
        departure: '2026-10-04',
        status: 'FAILED',
      });
      // Second call for import
      mockRequest.mockResolvedValueOnce({
        success: true,
        code: 200,
        data: { confirmationNo: 'CONF_999' },
      });

      const result = await retryToolkitOrderImport('ord_2');
      expect(mockRequest).toHaveBeenCalledWith('/toolkit/orders/ord_2');
      expect(mockRequest).toHaveBeenCalledWith(
        '/toolkit/orders/ord_2/import',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: 'ord_2' }),
        })
      );
      expect(result.confirmationNo).toBe('CONF_999');
    });

    it('deleteToolkitOrder sends DELETE request', async () => {
      mockRequest.mockResolvedValueOnce(undefined);
      await deleteToolkitOrder('ord_1');
      expect(mockRequest).toHaveBeenCalledWith(
        `${ORDER_ENDPOINTS.ORDERS}/ord_1`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('cancelToolkitOrder sends PUT cancel request', async () => {
      mockRequest.mockResolvedValueOnce(undefined);
      await cancelToolkitOrder('ord_1');
      expect(mockRequest).toHaveBeenCalledWith(
        `${ORDER_ENDPOINTS.ORDERS}/ord_1/cancel`,
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('fetchPropertyProductOptions', () => {
    it('fetches room types, rate codes, and reservation types concurrently via product APIs', async () => {
      mockRequest
        .mockResolvedValueOnce({
          code: 0,
          data: [{ roomType: 'R1', roomTypeName: '大床房' }],
        })
        .mockResolvedValueOnce({
          code: 0,
          data: [{ rateCode: 'BAR', rateName: '标准门市价' }],
        })
        .mockResolvedValueOnce({
          code: 0,
          data: [{ code: 'P1', name: '预付' }],
        });

      const options = await fetchPropertyProductOptions('unit_100');
      expect(mockRequest).toHaveBeenCalledTimes(3);

      expect(options.roomTypes).toHaveLength(1);
      expect(options.roomTypes[0].code).toBe('R1');
      expect(options.rateCodes).toHaveLength(1);
      expect(options.rateCodes[0].rateCode).toBe('BAR');
      expect(options.reservationTypes).toHaveLength(1);
      expect(options.reservationTypes[0].code).toBe('P1');
    });

    it('throws error when unitId is empty', async () => {
      await expect(fetchPropertyProductOptions('')).rejects.toThrow('酒店单位 unitId 不能为空');
    });

    it('throws error when any sub-request fails (Fail-Fast)', async () => {
      mockRequest
        .mockResolvedValueOnce({
          code: 0,
          data: [{ roomType: 'R1', roomTypeName: '大床房' }],
        })
        .mockRejectedValueOnce(new Error('RatePlans service unavailable'))
        .mockResolvedValueOnce({
          code: 0,
          data: [{ code: 'P1', name: '预付' }],
        });

      await expect(fetchPropertyProductOptions('unit_100')).rejects.toThrow('RatePlans service unavailable');
    });
  });

  describe('unwrapPlatformEnvelope and real payload handling', () => {
    it('correctly unwraps nested { code: 200, data: ... } structure', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 200,
        data: {
          records: [{ id: '99', otaOrderId: 'OT-99', status: 'FAILED' }],
          total: 1,
          current: 1,
          size: 20,
        },
      });

      const res = await fetchToolkitOrders({ page: 1 });
      expect(res.total).toBe(1);
      expect(res.records).toHaveLength(1);
      expect(res.records[0].otaOrderId).toBe('OT-99');
    });

    it('correctly unwraps nested { code: "0000", data: ... } enterprise structure', async () => {
      mockRequest.mockResolvedValueOnce({
        code: '0000',
        data: {
          records: [{ id: '100', otaOrderId: 'OT-100', status: 'SUCCESS' }],
          total: 1,
        },
      });

      const res = await fetchToolkitOrders({ page: 1 });
      expect(res.total).toBe(1);
      expect(res.records[0].otaOrderId).toBe('OT-100');
    });

    it('throws when platform returns business error envelope (code !== 200 and code !== 0)', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 500,
        msg: '文旅中台服务处理超时',
      });

      await expect(fetchToolkitOrders({ page: 1 })).rejects.toThrow(
        '平台接口返回业务错误: 文旅中台服务处理超时'
      );
    });
  });
});
