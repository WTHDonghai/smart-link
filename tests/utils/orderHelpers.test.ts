import { describe, it, expect } from 'vitest';
import {
  isOrderSuccess,
  formatSyncTime,
  getAllowedOrderActions,
  getOrderActionDisabledReason,
  formatCurrency,
  calculateNightsAndPricing,
  getOrderStatusMeta,
  buildImportPayloadFromOrder,
} from '../../src/utils/orderHelpers';
import type { OrderStatus, ToolkitOrder } from '../../src/types';

describe('orderHelpers', () => {
  describe('isOrderSuccess', () => {
    it('returns true for successful and transferred order statuses', () => {
      const successStatuses: OrderStatus[] = ['success', 'confirmed', 'transferred'];
      for (const status of successStatuses) {
        expect(isOrderSuccess(status)).toBe(true);
      }
    });

    it('returns false for pending, failed, cancelled, and in-progress statuses', () => {
      const nonSuccessStatuses: OrderStatus[] = [
        'failed',
        'cancelled',
        'pending',
        'processing',
        'manual_review',
        'importing',
      ];
      for (const status of nonSuccessStatuses) {
        expect(isOrderSuccess(status)).toBe(false);
      }
    });
  });

  describe('formatSyncTime', () => {
    it('returns "-" when input is missing, empty, or whitespace only', () => {
      expect(formatSyncTime(undefined)).toBe('-');
      expect(formatSyncTime('')).toBe('-');
      expect(formatSyncTime('   ')).toBe('-');
    });

    it('formats ISO and standard date-time strings into "YYYY-MM-DD HH:mm"', () => {
      expect(formatSyncTime('2026-09-15 14:30:00')).toBe('2026-09-15 14:30');
      expect(formatSyncTime('2026-09-15T18:45:10.123Z')).toBe('2026-09-15 18:45');
      expect(formatSyncTime('2026-10-01 08:05')).toBe('2026-10-01 08:05');
    });

    it('does not prepend hardcoded fake dates when only time is provided', () => {
      const timeOnlyResult = formatSyncTime('19:30');
      expect(timeOnlyResult).toBe('19:30');
      expect(timeOnlyResult).not.toContain('2026-09-14');

      const timeWithSecondsResult = formatSyncTime('08:15:20');
      expect(timeWithSecondsResult).toBe('08:15');
      expect(timeWithSecondsResult).not.toContain('2026-09-14');
    });

    it('preserves relative descriptive strings without fabricating dates', () => {
      expect(formatSyncTime('刚刚 (直接导入)')).toBe('刚刚 (直接导入)');
      expect(formatSyncTime('刚刚 (手动重推)')).toBe('刚刚 (手动重推)');
      expect(formatSyncTime('5秒前')).toBe('5秒前');
    });
  });

  describe('getAllowedOrderActions', () => {
    it('allows EDIT, IMPORT, DELETE exclusively for FAILED status', () => {
      expect(getAllowedOrderActions('FAILED')).toEqual(['EDIT', 'IMPORT', 'DELETE']);
      expect(getAllowedOrderActions('failed')).toEqual(['EDIT', 'IMPORT', 'DELETE']);
    });

    it('allows CANCEL exclusively for SUCCESS status', () => {
      expect(getAllowedOrderActions('SUCCESS')).toEqual(['CANCEL']);
      expect(getAllowedOrderActions('success')).toEqual(['CANCEL']);
    });

    it('returns empty array for PENDING, IMPORTING, CANCEL or unknown statuses', () => {
      expect(getAllowedOrderActions('PENDING')).toEqual([]);
      expect(getAllowedOrderActions('IMPORTING')).toEqual([]);
      expect(getAllowedOrderActions('CANCEL')).toEqual([]);
      expect(getAllowedOrderActions('UNKNOWN')).toEqual([]);
      expect(getAllowedOrderActions('')).toEqual([]);
    });
  });

  describe('getOrderActionDisabledReason', () => {
    it('returns empty string when action is allowed', () => {
      expect(getOrderActionDisabledReason('EDIT', 'FAILED')).toBe('');
      expect(getOrderActionDisabledReason('IMPORT', 'FAILED')).toBe('');
      expect(getOrderActionDisabledReason('DELETE', 'FAILED')).toBe('');
      expect(getOrderActionDisabledReason('CANCEL', 'SUCCESS')).toBe('');
    });

    it('returns descriptive reason when action is disabled', () => {
      expect(getOrderActionDisabledReason('EDIT', 'SUCCESS')).toBe('仅失败订单允许编辑');
      expect(getOrderActionDisabledReason('IMPORT', 'PENDING')).toBe('仅失败订单允许重新导入');
      expect(getOrderActionDisabledReason('DELETE', 'IMPORTING')).toBe('仅失败订单允许删除');
      expect(getOrderActionDisabledReason('CANCEL', 'FAILED')).toBe('仅成功订单允许取消');
    });
  });

  describe('formatCurrency', () => {
    it('formats numeric amounts to CNY currency string', () => {
      expect(formatCurrency(120)).toBe('¥120.00');
      expect(formatCurrency(99.5)).toBe('¥99.50');
      expect(formatCurrency(0)).toBe('¥0.00');
    });

    it('handles empty or missing input gracefully', () => {
      expect(formatCurrency(undefined)).toBe('-');
      expect(formatCurrency(null)).toBe('-');
      expect(formatCurrency('')).toBe('-');
    });
  });

  describe('calculateNightsAndPricing', () => {
    it('calculates nights and returns nightly prices for consecutive dates', () => {
      const res = calculateNightsAndPricing('2026-10-01', '2026-10-03', [], 100);
      expect(res.nights).toBe(2);
      expect(res.pricing).toEqual([
        { date: '2026-10-01', price: 100 },
        { date: '2026-10-02', price: 100 },
      ]);
      expect(res.totalPrice).toBe(200);
    });

    it('preserves existing prices when dates match', () => {
      const existing = [
        { date: '2026-10-01', price: 150 },
        { date: '2026-10-02', price: 180 },
      ];
      const res = calculateNightsAndPricing('2026-10-01', '2026-10-04', existing, 100);
      expect(res.nights).toBe(3);
      expect(res.pricing).toEqual([
        { date: '2026-10-01', price: 150 },
        { date: '2026-10-02', price: 180 },
        { date: '2026-10-03', price: 100 },
      ]);
      expect(res.totalPrice).toBe(430);
    });

    it('returns empty result when dates are invalid or departure <= arrival', () => {
      expect(calculateNightsAndPricing('2026-10-03', '2026-10-01').nights).toBe(0);
      expect(calculateNightsAndPricing('invalid', '2026-10-01').nights).toBe(0);
      expect(calculateNightsAndPricing('2026-10-01', '2026-10-01').nights).toBe(0);
    });
  });

  describe('buildImportPayloadFromOrder', () => {
    it('converts ToolkitOrder into complete ImportPayload with pricing and room details', () => {
      const order: ToolkitOrder = {
        id: 'ord_99',
        unitId: 'HOTEL_U1',
        unitName: '隐居度假酒店',
        otaChannel: 'MEITUAN',
        otaOrderId: 'MT_888999',
        contact: { name: '赵六', mobile: '13700003333' },
        booking: {
          arrival: '2026-10-01',
          departure: '2026-10-03',
          roomType: '大床房',
          roomTypeId: 'RT_KING',
          rateCode: 'OTA_BAR',
          paytype: '预付在线',
          nights: 2,
          quantity: 2,
          totalPrice: 600,
          pricing: [
            { date: '2026-10-01', price: 150 },
            { date: '2026-10-02', price: 150 },
          ],
        },
        remark: '无烟房需求',
        status: 'FAILED' as const,
        allowedActions: ['EDIT', 'IMPORT', 'DELETE'],
      };

      const payload = buildImportPayloadFromOrder(order);
      expect(payload.extUnitCode).toBe('HOTEL_U1');
      expect(payload.orders).toHaveLength(1);
      const imported = payload.orders[0];
      expect(imported.otaOrderId).toBe('MT_888999');
      expect(imported.otaChannel).toBe('MEITUAN');
      expect(imported.contact).toEqual({ name: '赵六', mobile: '13700003333' });
      expect(imported.booking.roomType).toBe('大床房');
      expect(imported.booking.roomTypeId).toBe('RT_KING');
      expect(imported.booking.rateCode).toBe('OTA_BAR');
      expect(imported.booking.arrival).toBe('2026-10-01');
      expect(imported.booking.departure).toBe('2026-10-03');
      expect(imported.booking.nights).toBe(2);
      expect(imported.booking.quantity).toBe(2);
      expect(imported.booking.totalPrice).toBe(600);
      expect(imported.booking.pricing).toEqual([
        { date: '2026-10-01', price: 150 },
        { date: '2026-10-02', price: 150 },
      ]);
      expect(imported.remark).toBe('无烟房需求');
    });

    it('throws error when order is missing or otaOrderId is empty', () => {
      expect(() => buildImportPayloadFromOrder(null as unknown as ToolkitOrder)).toThrow('订单数据不能为空');
      expect(() => buildImportPayloadFromOrder({} as unknown as ToolkitOrder)).toThrow('订单编号不能为空');
    });

    it('throws error when rateCode is missing or empty', () => {
      const orderWithoutRateCode: ToolkitOrder = {
        id: 'ord_empty_rate',
        otaOrderId: 'MT_1001',
        booking: {
          arrival: '2026-10-01',
          departure: '2026-10-02',
          rateCode: '',
        },
      } as unknown as ToolkitOrder;

      expect(() => buildImportPayloadFromOrder(orderWithoutRateCode)).toThrow(
        '订单「MT_1001」缺少房价方案代码 (rateCode)，请编辑指定后再重新导入'
      );
    });

    it('calculates default nightly price by spreading totalPrice across nights when pricing is empty', () => {
      const orderWithoutPricing: ToolkitOrder = {
        id: 'ord_spread',
        otaOrderId: 'MT_SPREAD_1',
        unitId: 'HOTEL_U1',
        unitName: '隐居度假酒店',
        otaChannel: 'MEITUAN',
        contact: { name: '王五', mobile: '13900004444' },
        booking: {
          arrival: '2026-10-01',
          departure: '2026-10-03',
          roomType: '大床房',
          rateCode: 'OTA_BAR',
          paytype: '预付在线',
          nights: 2,
          quantity: 1,
          totalPrice: 500,
          pricing: [],
        },
        status: 'FAILED',
        allowedActions: ['EDIT', 'IMPORT'],
      };

      const payload = buildImportPayloadFromOrder(orderWithoutPricing);
      const importedBooking = payload.orders[0].booking;
      expect(importedBooking.nights).toBe(2);
      expect(importedBooking.totalPrice).toBe(500);
      expect(importedBooking.pricing).toEqual([
        { date: '2026-10-01', price: 250 },
        { date: '2026-10-02', price: 250 },
      ]);
    });
  });

  describe('getOrderStatusMeta', () => {
    it('returns correct label and tone for each status', () => {
      expect(getOrderStatusMeta('SUCCESS')).toEqual({ label: '成功', tone: 'success' });
      expect(getOrderStatusMeta('CONFIRMED')).toEqual({ label: '成功', tone: 'success' });
      expect(getOrderStatusMeta('FAILED')).toEqual({ label: '失败', tone: 'failed' });
      expect(getOrderStatusMeta('PENDING')).toEqual({ label: '待确认', tone: 'warning' });
      expect(getOrderStatusMeta('IMPORTING')).toEqual({ label: '导入中', tone: 'info' });
      expect(getOrderStatusMeta('PROCESSING')).toEqual({ label: '导入中', tone: 'info' });
      expect(getOrderStatusMeta('CANCEL')).toEqual({ label: '已取消', tone: 'neutral' });
      expect(getOrderStatusMeta('CANCELLED')).toEqual({ label: '已取消', tone: 'neutral' });
      expect(getOrderStatusMeta('UNKNOWN_STATUS' as unknown as OrderStatus)).toEqual({
        label: 'UNKNOWN_STATUS',
        tone: 'neutral',
      });
    });
  });
});
