import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchDutyTask } from '../../../src/crawler/duty/dutyTaskDispatcher';
import type {
  ChannelDutyRunner,
  ExtractedOrderDetail,
} from '../../../src/crawler/duty/dutyContracts';
import type { DutyClaimedTask } from '../../../src/types';
import * as dutyRuntimeApi from '../../../src/services/dutyRuntimeApi';

class MockDutyRunner implements ChannelDutyRunner {
  public channelCode = 'TEST_OTA';
  public running = true;
  public unhandledOrdersResult = [
    { orderId: 'ORD-1', hotelId: 'H1', hotelName: '酒店1', cancelOrder: false },
  ];
  public detailResult: ExtractedOrderDetail = {
    otaOrderId: 'ORD-1',
    otaChannel: 'TEST_OTA',
    guestName: '测试客人',
    roomTypeName: '海景套房',
    arrival: '2026-09-20',
    departure: '2026-09-22',
    nights: 2,
    quantity: 1,
    totalPrice: 500,
  };

  public collectCalls = 0;
  public inspectCalls: string[] = [];
  public closeCalls = 0;
  public confirmImportCalls: Array<{ confirmNo: string; otaOrderId: string }> = [];
  public confirmCancelCalls: string[] = [];

  public isRunning(): boolean {
    return this.running;
  }
  public async start(): Promise<void> {
    this.running = true;
  }
  public async stop(): Promise<void> {
    this.running = false;
  }
  public async collectUnhandledOrders() {
    this.collectCalls++;
    return this.unhandledOrdersResult;
  }
  public async inspectOrderDetail(otaOrderId: string): Promise<ExtractedOrderDetail> {
    this.inspectCalls.push(otaOrderId);
    return this.detailResult;
  }
  public async closeOrderDetail(): Promise<void> {
    this.closeCalls++;
  }
  public async confirmImport(confirmNo: string, otaOrderId: string): Promise<void> {
    this.confirmImportCalls.push({ confirmNo, otaOrderId });
  }
  public async confirmCancel(otaOrderId: string): Promise<void> {
    this.confirmCancelCalls.push(otaOrderId);
  }
}

describe('dutyTaskDispatcher (Top-Level Multi-Channel Task Orchestration)', () => {
  let runner: MockDutyRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new MockDutyRunner();
  });

  it('should reject task when runner is not running', async () => {
    runner.running = false;
    const task: DutyClaimedTask = {
      id: 'task-1',
      businessId: 'biz-1',
      businessType: 'ORDER',
      msgType: 'OTA_COLLECT_ORDER',
      stationId: 'st-1',
      leaseToken: 'lt-1',
      data: '',
    };

    const result = await dispatchDutyTask(task, runner);
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('RUNNER_NOT_RUNNING');
    expect(result.errorMessage).toContain('未运行');
  });

  describe('OTA_COLLECT_ORDER', () => {
    it('should route to runner.collectUnhandledOrders and return summary list', async () => {
      const task: DutyClaimedTask = {
        id: 'task-coll-1',
        businessId: 'biz-coll',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: '',
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('SUCCEEDED');
      expect(runner.collectCalls).toBe(1);
      expect(result.result?.otaChannelCode).toBe('TEST_OTA');
      expect(result.result?.recordCount).toBe(1);
      expect(result.result?.orders).toEqual(runner.unhandledOrdersResult);
    });

    it('should return COLLECT_FAILED when runner.collectUnhandledOrders throws', async () => {
      runner.collectUnhandledOrders = vi.fn().mockRejectedValue(new Error('页面刷新超时'));
      const task: DutyClaimedTask = {
        id: 'task-coll-err',
        businessId: 'biz-coll',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: '',
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('COLLECT_FAILED');
      expect(result.errorMessage).toContain('页面刷新超时');
    });
  });

  describe('OTA_IMPORT_ORDER', () => {
    it('should fail fast when task payload lacks otaOrderId and businessId', async () => {
      const task: DutyClaimedTask = {
        id: 'task-imp-missing',
        businessId: '',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify({})).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('MISSING_ORDER_ID');
    });

    it('should route to runner.inspectOrderDetail, call importToolkitOrder with real fields, and close detail modal', async () => {
      const importSpy = vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockResolvedValue({
        success: true,
        pmsOrderId: 'PMS-SUCCESS-100',
      });

      const taskPayload = { otaOrderId: 'OTA-IMPORT-99', unitId: 'HOTEL-U1' };
      const task: DutyClaimedTask = {
        id: 'task-imp-ok',
        businessId: 'OTA-IMPORT-99',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('SUCCEEDED');
      expect(result.result?.pmsOrderId).toBe('PMS-SUCCESS-100');
      expect(runner.inspectCalls).toEqual(['OTA-IMPORT-99']);
      expect(runner.closeCalls).toBe(1);

      // 验证传入中台 importToolkitOrder 的参数绝对来自 inspectOrderDetail，未夹带假数据
      expect(importSpy).toHaveBeenCalledTimes(1);
      expect(importSpy).toHaveBeenCalledWith({
        extUnitCode: 'HOTEL-U1',
        orders: [
          {
            otaOrderId: 'ORD-1',
            otaChannel: 'TEST_OTA',
            contact: {
              name: '测试客人',
              mobile: '',
            },
            booking: {
              roomType: '海景套房',
              originRoomType: '海景套房',
              rateCode: 'OTA',
              arrival: '2026-09-20',
              departure: '2026-09-22',
              roomTypeId: 'ROOM_DEFAULT',
              nights: 2,
              quantity: 1,
              totalPrice: 500,
              paytype: '预付',
              pricing: [
                {
                  date: '2026-09-20',
                  price: 250,
                },
                {
                  date: '2026-09-21',
                  price: 250,
                },
              ],
            },
            remark: '',
          },
        ],
      });
    });

    it('should fail fast with ORDER_DETAIL_FETCH_FAILED when runner.inspectOrderDetail throws', async () => {
      runner.inspectOrderDetail = vi.fn().mockRejectedValue(new Error('未在页面找到订单元素'));

      const taskPayload = { otaOrderId: 'OTA-ERR-1' };
      const task: DutyClaimedTask = {
        id: 'task-imp-fetch-err',
        businessId: 'OTA-ERR-1',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('ORDER_DETAIL_FETCH_FAILED');
      expect(result.errorMessage).toContain('未在页面找到订单元素');
    });

    it('should fail fast with ORDER_DETAIL_INVALID when required fields are missing', async () => {
      runner.detailResult = {
        otaOrderId: 'ORD-INVALID',
        otaChannel: 'TEST_OTA',
        guestName: '', // 缺失姓名
        roomTypeName: '海景套房',
        arrival: '2026-09-20',
        departure: '2026-09-22',
        nights: 2,
        quantity: 1,
        totalPrice: 500,
      };

      const taskPayload = { otaOrderId: 'ORD-INVALID' };
      const task: DutyClaimedTask = {
        id: 'task-imp-invalid',
        businessId: 'ORD-INVALID',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('ORDER_DETAIL_INVALID');
      expect(result.errorMessage).toContain('缺少必须的业务字段');
    });

    it('should return IMPORT_FAILED when importToolkitOrder throws error', async () => {
      vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockRejectedValue(new Error('网络连接超时'));

      const taskPayload = { otaOrderId: 'ORD-TIMEOUT' };
      const task: DutyClaimedTask = {
        id: 'task-imp-net-err',
        businessId: 'ORD-TIMEOUT',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('IMPORT_FAILED');
      expect(result.errorMessage).toContain('网络连接超时');
    });
  });

  describe('OTA_CONFIRM_IMPORT', () => {
    it('should route to runner.confirmImport and return confirmed result', async () => {
      const taskPayload = { confirmNo: 'CFM-7788', otaOrderId: 'ORD-CFM' };
      const task: DutyClaimedTask = {
        id: 'task-cfm-1',
        businessId: 'ORD-CFM',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('SUCCEEDED');
      expect(result.result?.confirmed).toBe(true);
      expect(result.result?.confirmNo).toBe('CFM-7788');
      expect(runner.confirmImportCalls).toEqual([{ confirmNo: 'CFM-7788', otaOrderId: 'ORD-CFM' }]);
    });

    it('should return CONFIRM_IMPORT_FAILED when runner.confirmImport throws', async () => {
      runner.confirmImport = vi.fn().mockRejectedValue(new Error('回填确认号按钮不可见'));

      const taskPayload = { confirmNo: 'CFM-ERR' };
      const task: DutyClaimedTask = {
        id: 'task-cfm-err',
        businessId: 'ORD-ERR',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('CONFIRM_IMPORT_FAILED');
      expect(result.errorMessage).toContain('回填确认号按钮不可见');
    });
  });

  describe('OTA_CONFIRM_CANCEL', () => {
    it('should route to runner.confirmCancel and return acknowledged result', async () => {
      const taskPayload = { otaOrderId: 'ORD-CANCEL-1' };
      const task: DutyClaimedTask = {
        id: 'task-cnc-1',
        businessId: 'ORD-CANCEL-1',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_CANCEL',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('SUCCEEDED');
      expect(result.result?.acknowledged).toBe(true);
      expect(runner.confirmCancelCalls).toEqual(['ORD-CANCEL-1']);
    });

    it('should return CONFIRM_CANCEL_FAILED when runner.confirmCancel throws', async () => {
      runner.confirmCancel = vi.fn().mockRejectedValue(new Error('确认取消异常'));

      const task: DutyClaimedTask = {
        id: 'task-cnc-err',
        businessId: 'ORD-CNC-ERR',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_CANCEL',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: '',
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('CONFIRM_CANCEL_FAILED');
    });
  });

  describe('Unsupported message type', () => {
    it('should fail fast on unknown task message type', async () => {
      const task: DutyClaimedTask = {
        id: 'task-unsupported',
        businessId: 'biz-1',
        businessType: 'ORDER',
        msgType: 'UNKNOWN_MSG_TYPE' as unknown as DutyClaimedTask['msgType'],
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: '',
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('UNSUPPORTED_TASK_TYPE');
      expect(result.errorMessage).toContain('不支持的任务消息类型');
    });
  });
});
