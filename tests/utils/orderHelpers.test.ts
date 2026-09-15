import { describe, it, expect } from 'vitest';
import { isOrderSuccess, formatSyncTime } from '../../src/utils/orderHelpers';
import { OrderStatus } from '../../src/types';

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
});
