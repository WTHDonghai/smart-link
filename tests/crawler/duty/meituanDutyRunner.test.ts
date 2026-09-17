import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractMeituanOrdersFromPayload,
  extractMeituanOrderDetailFromPayload,
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

  describe('extractMeituanOrderDetailFromPayload', () => {
    it('should return null for non-object payloads or mismatched order IDs', () => {
      expect(extractMeituanOrderDetailFromPayload(null)).toBeNull();
      expect(extractMeituanOrderDetailFromPayload('invalid')).toBeNull();
      expect(extractMeituanOrderDetailFromPayload({ data: { orderId: 'MT-1' } }, 'MT-2')).toBeNull();
    });

    it('should extract structured order details from detail response payload', () => {
      const payload = {
        code: 0,
        data: {
          orderId: 'MT-DETAIL-888',
          poiId: 'poi-999',
          poiName: '美团度假酒店',
          roomTypeName: '海景大床房',
          ratePlanName: '连住特惠',
          checkInDateString: '2026-10-01',
          checkOutDateString: '2026-10-03',
          nights: 2,
          roomCount: 1,
          totalFee: 88000,
          contacts: [{ name: '赵六', phone: '13500135000' }],
        },
      };

      const detail = extractMeituanOrderDetailFromPayload(payload, 'MT-DETAIL-888');
      expect(detail).not.toBeNull();
      expect(detail?.otaOrderId).toBe('MT-DETAIL-888');
      expect(detail?.otaChannel).toBe('MEITUAN');
      expect(detail?.guestName).toBe('赵六');
      expect(detail?.guestMobile).toBe('13500135000');
      expect(detail?.roomTypeName).toBe('海景大床房');
      expect(detail?.ratePlanName).toBe('连住特惠');
      expect(detail?.arrival).toBe('2026-10-01');
      expect(detail?.departure).toBe('2026-10-03');
      expect(detail?.nights).toBe(2);
      expect(detail?.totalPrice).toBe(880);
      expect(detail?.unitId).toBe('poi-999');
      expect(detail?.unitName).toBe('美团度假酒店');
    });
  });

  describe('MeituanDutyRunner lifecycle and page operations', () => {
    let runner: MeituanDutyRunner;

    beforeEach(() => {
      runner = new MeituanDutyRunner();
    });

    it('should initialize with correct default state and dynamic targetUrl', () => {
      expect(runner.channelCode).toBe('MEITUAN');
      expect(runner.isRunning()).toBe(false);
      expect(runner.targetUrl).toBe('https://eb.meituan.com/ebooking/orders#/unhandled');
    });

    it('should dynamically reflect VITE_OTA_MEITUAN_ORDER_URL environment variable', () => {
      const original = process.env.VITE_OTA_MEITUAN_ORDER_URL;
      try {
        process.env.VITE_OTA_MEITUAN_ORDER_URL =
          'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled';
        const mockRunner = new MeituanDutyRunner();
        expect(mockRunner.targetUrl).toBe(
          'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
        );
      } finally {
        if (original === undefined) {
          delete process.env.VITE_OTA_MEITUAN_ORDER_URL;
        } else {
          process.env.VITE_OTA_MEITUAN_ORDER_URL = original;
        }
      }
    });

    it('should respect explicitly provided targetUrl in constructor', () => {
      const customRunner = new MeituanDutyRunner('http://127.0.0.1:9999/custom/orders');
      expect(customRunner.targetUrl).toBe('http://127.0.0.1:9999/custom/orders');
    });

    it('collectUnhandledOrders should throw when runner is not running', async () => {
      await expect(runner.collectUnhandledOrders()).rejects.toThrow('未运行');
    });

    it('collectUnhandledOrders should refresh order list and return order summaries from single-shot response', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(false),
            }),
          }),
          reload: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                data: {
                  list: [
                    {
                      orderId: 'MT-ORD-101',
                      poiId: 'poi-101',
                      poiName: '美团精品酒店',
                      orderDisplayLabel: '新订待处理',
                      cancelOrder: false,
                    },
                  ],
                },
              })
            ),
          }),
          evaluate: vi.fn().mockResolvedValue([]),
        },
      };

      const summaries = await runner.collectUnhandledOrders();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual({
        orderId: 'MT-ORD-101',
        hotelId: 'poi-101',
        hotelName: '美团精品酒店',
        cancelOrder: false,
        orderDisplayLabel: '新订待处理',
      });
    });

    it('collectUnhandledOrders should parse DOM rows directly when no network response is captured', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(false),
            }),
          }),
          reload: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockRejectedValue(new Error('timeout')),
          evaluate: vi.fn().mockResolvedValue([
            {
              orderId: 'MT-DOM-888',
              hotelName: 'DOM解析酒店',
              cancelOrder: false,
              orderDisplayLabel: '待处理',
            },
          ]),
        },
      };

      const summaries = await runner.collectUnhandledOrders();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].orderId).toBe('MT-DOM-888');
      expect(summaries[0].hotelName).toBe('DOM解析酒店');
    });

    it('inspectOrderDetail should throw when runner is not running', async () => {
      await expect(runner.inspectOrderDetail('MT-123')).rejects.toThrow('未运行');
    });

    it('inspectOrderDetail should fail fast when critical fields (guestName, roomTypeName, arrival, departure) are missing', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(false),
              locator: () => ({
                first: () => ({
                  isVisible: vi.fn().mockResolvedValue(false),
                }),
              }),
            }),
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn().mockResolvedValue({
            // 缺少 guestName, roomTypeName 等
            guestName: '',
            roomTypeName: '',
            arrival: '',
            departure: '',
          }),
        },
      };

      await expect(runner.inspectOrderDetail('MT-EMPTY-FIELDS')).rejects.toThrow(
        '未获取到关键字段 (guestName(入住人), roomTypeName(房型), arrival(入住日期), departure(离店日期))'
      );
    });

    it('inspectOrderDetail should extract valid fields from page DOM and return ExtractedOrderDetail', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(true),
              fill: vi.fn().mockResolvedValue(undefined),
              locator: () => ({
                first: () => ({
                  isVisible: vi.fn().mockResolvedValue(true),
                }),
              }),
            }),
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn().mockResolvedValue({
            guestName: '李小龙',
            guestMobile: '13888889999',
            roomTypeName: '豪华江景房',
            ratePlanName: '含早特惠',
            arrival: '2026-09-20',
            departure: '2026-09-22',
            totalPrice: 660,
            quantity: 1,
            hotelName: '江景国际大饭店',
          }),
        },
      };

      const detail = await runner.inspectOrderDetail('MT-DOM-001');
      expect(detail.otaOrderId).toBe('MT-DOM-001');
      expect(detail.otaChannel).toBe('MEITUAN');
      expect(detail.guestName).toBe('李小龙');
      expect(detail.guestMobile).toBe('13888889999');
      expect(detail.roomTypeName).toBe('豪华江景房');
      expect(detail.ratePlanName).toBe('含早特惠');
      expect(detail.arrival).toBe('2026-09-20');
      expect(detail.departure).toBe('2026-09-22');
      expect(detail.nights).toBe(2);
      expect(detail.totalPrice).toBe(660);
      expect(detail.unitName).toBe('江景国际大饭店');
    });

    it('inspectOrderDetail should prioritize and merge intercepted network detail when available', async () => {
      (runner as unknown as { running: boolean }).running = true;

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(false),
              locator: () => ({
                first: () => ({
                  isVisible: vi.fn().mockResolvedValue(false),
                }),
              }),
            }),
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                data: {
                  orderId: 'MT-NET-002',
                  guestName: '周星驰',
                  guestMobile: '13911112222',
                  roomTypeName: '至尊套房',
                  ratePlanName: '商务协议价',
                  checkInDateString: '2026-10-01',
                  checkOutDateString: '2026-10-04',
                  nights: 3,
                  quantity: 1,
                  totalFee: 150000,
                  poiId: 'poi-net-002',
                  poiName: '至尊商务酒店',
                },
              })
            ),
          }),
          evaluate: vi.fn().mockResolvedValue(null),
        },
      };

      const detail = await runner.inspectOrderDetail('MT-NET-002');
      expect(detail.otaOrderId).toBe('MT-NET-002');
      expect(detail.guestName).toBe('周星驰');
      expect(detail.roomTypeName).toBe('至尊套房');
      expect(detail.nights).toBe(3);
      expect(detail.totalPrice).toBe(1500);
      expect(detail.unitId).toBe('poi-net-002');
    });

    it('confirmImport and confirmCancel should operate page locators safely', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const fillSpy = vi.fn().mockResolvedValue(undefined);
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            first: () => ({
              isVisible: vi.fn().mockResolvedValue(true),
              fill: fillSpy,
              locator: () => ({
                first: () => ({
                  isVisible: vi.fn().mockResolvedValue(false),
                }),
              }),
            }),
          }),
        },
      };

      await expect(runner.confirmImport('CFM-12345', 'MT-ORD-99')).resolves.toBeUndefined();
      await expect(runner.confirmCancel('MT-ORD-99')).resolves.toBeUndefined();
    });
  });

  describe('MeituanDutyRunner executeTask delegation via dispatchDutyTask', () => {
    let runner: MeituanDutyRunner;

    beforeEach(() => {
      runner = new MeituanDutyRunner();
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

    it('should execute OTA_COLLECT_ORDER and return unhandled order summaries', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const collectSpy = vi.spyOn(runner, 'collectUnhandledOrders').mockResolvedValue([
        {
          orderId: 'MT-CAP-001',
          hotelId: 'poi-1',
          hotelName: '美团精选酒店',
          orderDisplayLabel: '新订',
          cancelOrder: false,
        },
      ]);

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
      expect(collectSpy).toHaveBeenCalledTimes(1);
    });

    it('should execute OTA_IMPORT_ORDER by inspecting order details and importing to middle platform', async () => {
      (runner as unknown as { running: boolean }).running = true;

      const inspectSpy = vi.spyOn(runner, 'inspectOrderDetail').mockResolvedValue({
        otaOrderId: 'MT-998877',
        otaChannel: 'MEITUAN',
        unitId: 'hotel-007',
        unitName: '美团旗舰店',
        guestName: '孙悟空',
        guestMobile: '13900001111',
        roomTypeName: '水帘洞豪华大套房',
        ratePlanName: '含早特惠',
        arrival: '2026-09-25',
        departure: '2026-09-27',
        nights: 2,
        quantity: 1,
        totalPrice: 998,
      });

      const closeSpy = vi.spyOn(runner, 'closeOrderDetail').mockResolvedValue(undefined);

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
      expect(inspectSpy).toHaveBeenCalledWith('MT-998877');
      expect(closeSpy).toHaveBeenCalledTimes(1);

      // 验证调用中台 importToolkitOrder 时传入的是页面实际提取的真实字段，绝对没有虚构默认值
      expect(importSpy).toHaveBeenCalledTimes(1);
      expect(importSpy).toHaveBeenCalledWith({
        extUnitCode: 'hotel-007',
        orders: [
          {
            otaOrderId: 'MT-998877',
            otaChannel: 'MEITUAN',
            contact: {
              name: '孙悟空',
              mobile: '13900001111',
            },
            booking: {
              roomType: '水帘洞豪华大套房',
              originRoomType: '水帘洞豪华大套房',
              rateCode: '含早特惠',
              arrival: '2026-09-25',
              departure: '2026-09-27',
              roomTypeId: 'ROOM_DEFAULT',
              nights: 2,
              quantity: 1,
              totalPrice: 998,
              paytype: '预付',
              pricing: [
                {
                  date: '2026-09-25',
                  price: 499,
                },
                {
                  date: '2026-09-26',
                  price: 499,
                },
              ],
            },
            remark: '',
          },
        ],
      });
    });

    it('should fail fast with ORDER_DETAIL_FETCH_FAILED when inspectOrderDetail throws', async () => {
      (runner as unknown as { running: boolean }).running = true;

      vi.spyOn(runner, 'inspectOrderDetail').mockRejectedValue(
        new Error('美团订单「MT-ERR-01」详情提取失败：页面及接口均未获取到关键字段')
      );

      const task: DutyClaimedTask = {
        id: 'task-import-inspect-fail',
        businessId: 'MT-ERR-01',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify({ otaOrderId: 'MT-ERR-01' })).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('FAILED');
      expect(execResult.errorCode).toBe('ORDER_DETAIL_FETCH_FAILED');
      expect(execResult.errorMessage).toContain('详情提取失败');
    });

    it('should return IMPORT_FAILED when importToolkitOrder fails', async () => {
      (runner as unknown as { running: boolean }).running = true;

      vi.spyOn(runner, 'inspectOrderDetail').mockResolvedValue({
        otaOrderId: 'MT-CONFLICT',
        otaChannel: 'MEITUAN',
        guestName: '猪八戒',
        roomTypeName: '高老庄标准间',
        arrival: '2026-10-01',
        departure: '2026-10-02',
        nights: 1,
        quantity: 1,
        totalPrice: 200,
      });

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

    it('should execute OTA_CONFIRM_IMPORT and call runner.confirmImport', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const confirmSpy = vi.spyOn(runner, 'confirmImport').mockResolvedValue(undefined);

      const taskPayload = { confirmNo: 'CFM-9988', otaOrderId: 'MT-IMPORT-OK' };
      const task: DutyClaimedTask = {
        id: 'task-cfm-01',
        businessId: 'MT-IMPORT-OK',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('SUCCEEDED');
      expect(execResult.result?.confirmed).toBe(true);
      expect(execResult.result?.confirmNo).toBe('CFM-9988');
      expect(confirmSpy).toHaveBeenCalledWith('CFM-9988', 'MT-IMPORT-OK');
    });

    it('should execute OTA_CONFIRM_CANCEL and acknowledge cancellation', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const cancelSpy = vi.spyOn(runner, 'confirmCancel').mockResolvedValue(undefined);

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
      expect(cancelSpy).toHaveBeenCalledWith('MT-CANCEL-REQ');
    });

    it('should fail fast on unsupported task message type', async () => {
      (runner as unknown as { running: boolean }).running = true;

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
