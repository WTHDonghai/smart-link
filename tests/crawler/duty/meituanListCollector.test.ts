import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Response } from 'playwright';
import {
  MeituanListCollector,
  waitForMeituanListResponse,
} from '@/src/crawler/duty/channels/meituan/meituanListCollector';
import {
  MeituanDutyErrorCode,
} from '@/src/crawler/duty/channels/meituan/meituanDutyContracts';

describe('meituanListCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('waitForMeituanListResponse', () => {
    it('should throw METHOD_NOT_SUPPORTED when waitForResponse is not supported', async () => {
      const mockPage = {} as Page;
      await expect(waitForMeituanListResponse(mockPage, '测试')).rejects.toThrow(
        expect.objectContaining({ errorCode: 'METHOD_NOT_SUPPORTED' })
      );
    });

    it('should throw LIST_HTTP_ERROR when server returns non-200', async () => {
      const mockResponse = {
        status: () => 502,
        url: () => 'https://eb.meituan.com/api/v2/task/list',
      } as unknown as Response;

      const mockPage = {
        waitForResponse: vi.fn().mockResolvedValue(mockResponse),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Page;

      await expect(waitForMeituanListResponse(mockPage, '待确认')).rejects.toThrow(
        expect.objectContaining({ errorCode: MeituanDutyErrorCode.LIST_HTTP_ERROR })
      );
    });

    it('should return valid response when server returns 200', async () => {
      const mockResponse = {
        status: () => 200,
        url: () => 'https://eb.meituan.com/api/v2/task/list',
      } as unknown as Response;

      const mockPage = {
        waitForResponse: vi.fn().mockResolvedValue(mockResponse),
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as Page;

      const result = await waitForMeituanListResponse(mockPage, '待确认');
      expect(result).toBe(mockResponse);
    });
  });

  describe('MeituanListCollector instance', () => {
    it('should throw LIST_BUSINESS_FAILED when list response is invalid JSON', async () => {
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;

      const mockResponse = {
        text: async () => 'invalid-json-text',
      } as unknown as Response;

      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockResolvedValue(mockResponse);

      await expect(collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn)).rejects.toThrow(
        expect.objectContaining({ errorCode: MeituanDutyErrorCode.LIST_BUSINESS_FAILED })
      );
    });

    it('should successfully parse unhandled orders from valid JSON response', async () => {
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;

      const mockPayload = {
        code: 0,
        data: {
          orders: [
            {
              orderId: 'MT-888',
              roomName: '豪华大床房',
              checkInDate: '2026-10-01',
              checkOutDate: '2026-10-03',
              totalAmount: 500,
              contactName: '张三',
            },
          ],
        },
      };

      const mockResponse = {
        text: async () => JSON.stringify(mockPayload),
      } as unknown as Response;

      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockResolvedValue(mockResponse);

      const orders = await collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn);
      expect(orders).toHaveLength(1);
      expect(orders[0].orderId).toBe('MT-888');
      expect(orders[0].orderDisplayLabel).toBe('新订');
    });

    it('should coalesce concurrent in-flight collectUnhandledOrders requests', async () => {
      const collector = new MeituanListCollector();
      const mockPage = {
        url: () => 'https://eb.meituan.com/dealorder',
      } as unknown as Page;

      const mockPayload = {
        code: 0,
        data: { orders: [] },
      };

      const mockResponse = {
        text: async () => JSON.stringify(mockPayload),
      } as unknown as Response;

      let callCount = 0;
      const runWithMutex = async <T>(fn: () => Promise<T>): Promise<T> => fn();
      const refreshFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return mockResponse;
      });

      const [res1, res2] = await Promise.all([
        collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn),
        collector.collectUnhandledOrders(mockPage, runWithMutex, refreshFn),
      ]);

      expect(callCount).toBe(1);
      expect(res1).toEqual(res2);
    });
  });
});
