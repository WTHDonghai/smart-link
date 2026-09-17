import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractMeituanOrdersFromPayload,
  MeituanDutyRunner,
} from '../../../src/crawler/duty/meituanDutyRunner';
import * as dutyRuntimeApi from '../../../src/services/dutyRuntimeApi';
import type { DutyClaimedTask } from '../../../src/types';

describe('meituanDutyRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractMeituanOrdersFromPayload', () => {
    it('should return empty array for null, undefined, or empty payload', () => {
      expect(extractMeituanOrdersFromPayload(null)).toEqual([]);
      expect(extractMeituanOrdersFromPayload(undefined)).toEqual([]);
      expect(extractMeituanOrdersFromPayload({})).toEqual([]);
      expect(extractMeituanOrdersFromPayload({ data: {} })).toEqual([]);
    });

    it('should extract orders from Meituan data.list payload with cent-to-yuan conversion and contact parsing', () => {
      const mockPayload = {
        code: 0,
        data: {
          list: [
            {
              orderId: 'MT-8899001',
              poiId: 'poi-1001',
              poiName: '美团大酒店(外滩店)',
              orderDisplayLabel: '待处理新订',
              aptCreatTimeString: '2026-09-17 14:00:00',
              roomName: '高级商务双床房',
              ratePlanName: '含双早标准价',
              checkInDateString: '2026-09-18',
              checkOutDateString: '2026-09-20',
              nights: 2,
              roomCount: 1,
              totalFee: 59800, // 59800 分 = 598 元
              contacts: [
                { name: '张三', phone: '13800138000' },
                { name: '李四', mobile: '13900139000' },
              ],
              cancelOrder: false,
            },
          ],
        },
      };

      const result = extractMeituanOrdersFromPayload(mockPayload);
      expect(result).toHaveLength(1);

      const order = result[0];
      expect(order.orderId).toBe('MT-8899001');
      expect(order.hotelId).toBe('poi-1001');
      expect(order.hotelName).toBe('美团大酒店(外滩店)');
      expect(order.orderDisplayLabel).toBe('待处理新订');
      expect(order.roomName).toBe('高级商务双床房');
      expect(order.ratePlanName).toBe('含双早标准价');
      expect(order.checkInDate).toBe('2026-09-18');
      expect(order.checkOutDate).toBe('2026-09-20');
      expect(order.nights).toBe(2);
      expect(order.quantity).toBe(1);
      expect(order.totalAmount).toBe(598);
      expect(order.contacts).toEqual([
        { name: '张三', phone: '13800138000' },
        { name: '李四', phone: '13900139000' },
      ]);
      expect(order.cancelOrder).toBe(false);
    });

    it('should derive night count from dates when nights field is omitted', () => {
      const mockPayload = {
        data: {
          orders: [
            {
              orderId: 'MT-776655',
              checkInDate: '2026-10-01',
              checkOutDate: '2026-10-04',
              price: 360,
              guestName: '王五',
              guestMobile: '13700000000',
            },
          ],
        },
      };

      const result = extractMeituanOrdersFromPayload(mockPayload);
      expect(result).toHaveLength(1);
      expect(result[0].nights).toBe(3);
      expect(result[0].totalAmount).toBe(360);
      expect(result[0].contacts).toEqual([{ name: '王五', phone: '13700000000' }]);
    });

    it('should detect cancel order when cancelOrder is true or status is CANCEL', () => {
      const mockPayload = [
        {
          orderId: 'MT-CANCEL-1',
          cancelOrder: true,
          totalPrice: 200,
        },
        {
          orderId: 'MT-CANCEL-2',
          status: 'CANCEL',
          totalPrice: 300,
        },
      ];

      const result = extractMeituanOrdersFromPayload(mockPayload);
      expect(result).toHaveLength(2);
      expect(result[0].cancelOrder).toBe(true);
      expect(result[1].cancelOrder).toBe(true);
    });
  });

  describe('MeituanDutyRunner lifecycle and task execution', () => {
    let runner: MeituanDutyRunner;

    beforeEach(() => {
      runner = new MeituanDutyRunner();
    });

    it('should initialize with correct default state', () => {
      expect(runner.channelCode).toBe('MEITUAN');
      expect(runner.isRunning()).toBe(false);
      expect(runner.getCapturedOrders()).toEqual([]);
    });

    it('should reject task execution when runner is not running', async () => {
      const task: DutyClaimedTask = {
        id: 'task-001',
        businessId: 'biz-001',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: '',
      };

      const result = await runner.executeTask(task);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('RUNNER_NOT_RUNNING');
      expect(result.errorMessage).toContain('未运行');
    });

    it('should execute OTA_COLLECT_ORDER and return captured orders when running', async () => {
      // 模拟已运行与已有拦截订单
      (runner as unknown as { running: boolean }).running = true;
      const mockOrder = {
        orderId: 'MT-CAP-001',
        hotelId: 'poi-1',
        orderDisplayLabel: '新订',
        roomName: '大床房',
        ratePlanName: '标准价',
        checkInDate: '2026-09-17',
        checkOutDate: '2026-09-18',
        nights: 1,
        quantity: 1,
        totalAmount: 199,
        contacts: [{ name: '测试客人', phone: '13888888888' }],
        cancelOrder: false,
        raw: {},
      };
      (runner as unknown as { capturedOrders: Map<string, unknown> }).capturedOrders.set('MT-CAP-001', mockOrder);
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(false),
            }),
          }),
          reload: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn().mockResolvedValue(undefined),
        },
      };

      const task: DutyClaimedTask = {
        id: 'task-collect-01',
        businessId: 'MT-COLLECT',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: '',
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('SUCCEEDED');
      expect(execResult.result?.otaChannelCode).toBe('MEITUAN');
      expect(execResult.result?.recordCount).toBe(1);
      expect((execResult.result?.orders as unknown[])).toHaveLength(1);
    });

    it('should execute OTA_IMPORT_ORDER and invoke importToolkitOrder', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: { evaluate: vi.fn().mockResolvedValue(undefined) },
      };

      const importSpy = vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockResolvedValue({
        success: true,
        pmsOrderId: 'PMS-ORDER-888',
      });

      const taskPayload = {
        otaOrderId: 'MT-998877',
        unitId: 'hotel-007',
      };
      const task: DutyClaimedTask = {
        id: 'task-import-01',
        businessId: 'MT-998877',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('SUCCEEDED');
      expect(execResult.result?.pmsOrderId).toBe('PMS-ORDER-888');
      expect(execResult.result?.otaOrderId).toBe('MT-998877');
      expect(importSpy).toHaveBeenCalledTimes(1);
      expect(importSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orders: expect.arrayContaining([
            expect.objectContaining({
              otaOrderId: 'MT-998877',
              otaChannel: 'MEITUAN',
              unitId: 'hotel-007',
            }),
          ]),
        })
      );
    });

    it('should return FAILED when OTA_IMPORT_ORDER fails', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: { evaluate: vi.fn().mockResolvedValue(undefined) },
      };

      vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockRejectedValue(new Error('PMS 房态冲突'));

      const task: DutyClaimedTask = {
        id: 'task-import-err',
        businessId: 'MT-CONFLICT',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify({ otaOrderId: 'MT-CONFLICT' })).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('FAILED');
      expect(execResult.errorCode).toBe('IMPORT_FAILED');
      expect(execResult.errorMessage).toContain('PMS 房态冲突');
    });

    it('should execute OTA_CONFIRM_CANCEL and acknowledge cancellation', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          evaluate: vi.fn().mockResolvedValue(undefined),
          locator: () => ({
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(false),
            }),
          }),
        },
      };

      const task: DutyClaimedTask = {
        id: 'task-cancel-01',
        businessId: 'MT-CANCEL-REQ',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_CANCEL',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: '',
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('SUCCEEDED');
      expect(execResult.result?.acknowledged).toBe(true);
    });

    it('should fail fast on unsupported task message type', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: { evaluate: vi.fn().mockResolvedValue(undefined) },
      };

      const task: DutyClaimedTask = {
        id: 'task-unknown',
        businessId: 'biz-none',
        businessType: 'ORDER',
        msgType: 'UNKNOWN_MSG_TYPE' as unknown as DutyClaimedTask['msgType'],
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: '',
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('FAILED');
      expect(execResult.errorCode).toBe('UNSUPPORTED_TASK_TYPE');
    });
  });
});
