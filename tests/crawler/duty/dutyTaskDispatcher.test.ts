import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchDutyTask } from '../../../src/crawler/duty/dutyTaskDispatcher';
import type {
  ChannelDutyRunner,
  ExtractedOrderDetail,
} from '../../../src/crawler/duty/dutyContracts';
import type { DutyClaimedTask, SystemLogEntry } from '../../../src/types';
import * as dutyRuntimeApi from '../../../src/services/dutyRuntimeApi';
import * as channelApi from '../../../src/services/channelApi';

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

    it('should map to RISK_VERIFICATION_REQUIRED when runner.inspectOrderDetail detects risk/captcha', async () => {
      runner.inspectOrderDetail = vi.fn().mockRejectedValue(
        new Error('美团后台提示安全验证或操作频繁，需要人工在浏览器中完成验证 (RISK_VERIFICATION_REQUIRED)')
      );

      const taskPayload = { otaOrderId: 'OTA-RISK-1' };
      const task: DutyClaimedTask = {
        id: 'task-imp-risk-err',
        businessId: 'OTA-RISK-1',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('RISK_VERIFICATION_REQUIRED');
      expect(result.errorMessage).toContain('RISK_VERIFICATION_REQUIRED');
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

    it('should emit DUTY_TASK_ORDER_IMPORT_SUBMIT log with order-import-submit stage and orderNo on success', async () => {
      vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockResolvedValue({
        success: true,
        pmsOrderId: 'PMS-LOG-100',
      });

      const logsEmitted: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
      const onLog = (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => {
        logsEmitted.push(entry);
      };

      const taskPayload = { otaOrderId: 'OTA-IMPORT-LOG-1', unitId: 'HOTEL-U1' };
      const task: DutyClaimedTask = {
        id: 'task-imp-log-ok',
        businessId: 'OTA-IMPORT-LOG-1',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner, onLog);
      expect(result.status).toBe('SUCCEEDED');

      const submitLog = logsEmitted.find((l) => l.event === 'DUTY_TASK_ORDER_IMPORT_SUBMIT');
      expect(submitLog).toBeDefined();
      expect(submitLog?.taskActionStage).toBe('order-import-submit');
      expect(submitLog?.orderNo).toBe('OTA-IMPORT-LOG-1');
      expect(submitLog?.apiUrl).toBe('/toolkit/orders/import');
      expect(submitLog?.level).toBe('INFO');
    });

    it('should emit DUTY_TASK_ORDER_IMPORT_SUBMIT_FAILED log with order-import-submit stage on failure', async () => {
      vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockRejectedValue(new Error('PMS入单接口异常: 500'));

      const logsEmitted: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
      const onLog = (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => {
        logsEmitted.push(entry);
      };

      const taskPayload = { otaOrderId: 'OTA-IMPORT-LOG-FAIL', unitId: 'HOTEL-U1' };
      const task: DutyClaimedTask = {
        id: 'task-imp-log-fail',
        businessId: 'OTA-IMPORT-LOG-FAIL',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner, onLog);
      expect(result.status).toBe('FAILED');

      const failLog = logsEmitted.find((l) => l.event === 'DUTY_TASK_ORDER_IMPORT_SUBMIT_FAILED');
      expect(failLog).toBeDefined();
      expect(failLog?.taskActionStage).toBe('order-import-submit');
      expect(failLog?.orderNo).toBe('OTA-IMPORT-LOG-FAIL');
      expect(failLog?.level).toBe('ERROR');
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

    it('should return RISK_VERIFICATION_REQUIRED when runner.confirmImport encounters risk verification', async () => {
      runner.confirmImport = vi.fn().mockRejectedValue(new Error('页面提示安全验证，请拖动滑块'));

      const taskPayload = { confirmNo: 'CFM-RISK' };
      const task: DutyClaimedTask = {
        id: 'task-cfm-risk',
        businessId: 'ORD-RISK',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('RISK_VERIFICATION_REQUIRED');
      expect(result.errorMessage).toContain('安全验证');
    });

    it('should fail fast with CONFIRM_NO_MISSING when confirmNo is empty', async () => {
      const task: DutyClaimedTask = {
        id: 'task-cfm-no-confirm-no',
        businessId: 'ORD-CFM-999',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify({ confirmNo: '   ' })).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('CONFIRM_NO_MISSING');
      expect(result.errorMessage).toContain('缺失有效的确认号');
    });

    it('should fail fast with ORDER_ID_MISSING when orderId is empty in OTA_CONFIRM_IMPORT', async () => {
      const task: DutyClaimedTask = {
        id: 'task-cfm-no-order',
        businessId: '',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify({ confirmNo: 'CFM-123' })).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('ORDER_ID_MISSING');
      expect(result.errorMessage).toContain('缺失有效的订单号');
    });

    it('should fail fast with METHOD_NOT_IMPLEMENTED when runner lacks confirmImport', async () => {
      const bareRunner = {
        channelCode: 'BARE_OTA',
        isRunning: () => true,
        start: async () => {},
        stop: async () => {},
        collectOrders: async () => ({ orders: [] }),
        inspectOrderDetail: async () => ({} as unknown as ExtractedOrderDetail),
      } as unknown as ChannelDutyRunner;

      const task: DutyClaimedTask = {
        id: 'task-cfm-no-method',
        businessId: 'ORD-CFM-001',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify({ confirmNo: 'CFM-123' })).toString('base64'),
      };

      const result = await dispatchDutyTask(task, bareRunner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('METHOD_NOT_IMPLEMENTED');
      expect(result.errorMessage).toContain('未实现 confirmImport 方法');
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

    it('should fail fast with ORDER_ID_MISSING when orderId is empty in OTA_CONFIRM_CANCEL', async () => {
      const task: DutyClaimedTask = {
        id: 'task-cnc-no-order',
        businessId: '',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_CANCEL',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: '',
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('ORDER_ID_MISSING');
      expect(result.errorMessage).toContain('缺失有效的订单号');
    });

    it('should fail fast with METHOD_NOT_IMPLEMENTED when runner lacks confirmCancel', async () => {
      const bareRunner = {
        channelCode: 'BARE_OTA',
        isRunning: () => true,
        start: async () => {},
        stop: async () => {},
        collectOrders: async () => ({ orders: [] }),
        inspectOrderDetail: async () => ({} as unknown as ExtractedOrderDetail),
      } as unknown as ChannelDutyRunner;

      const task: DutyClaimedTask = {
        id: 'task-cnc-no-method',
        businessId: 'ORD-CNC-001',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_CANCEL',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: '',
      };

      const result = await dispatchDutyTask(task, bareRunner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('METHOD_NOT_IMPLEMENTED');
      expect(result.errorMessage).toContain('未实现 confirmCancel 方法');
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

    it('should return RISK_VERIFICATION_REQUIRED when runner.confirmCancel encounters risk verification', async () => {
      runner.confirmCancel = vi.fn().mockRejectedValue(new Error('检测到操作频繁，已被风控拦截 (yoda verification)'));

      const task: DutyClaimedTask = {
        id: 'task-cnc-risk',
        businessId: 'ORD-CNC-RISK',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_CANCEL',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: '',
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('RISK_VERIFICATION_REQUIRED');
      expect(result.errorMessage).toContain('风控拦截');
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

  describe('Remark template resolution & dynamic rendering in OTA_IMPORT_ORDER', () => {
    const sampleDetail: ExtractedOrderDetail = {
      otaOrderId: 'MT-987654321',
      otaChannel: 'MEITUAN',
      guestName: '李小龙',
      guestMobile: '13800138000',
      roomTypeName: '豪华海景房',
      arrival: '2026-09-25',
      departure: '2026-09-27',
      nights: 2,
      quantity: 1,
      totalPrice: 880,
      raw: {
        remark: '客人要求尽量安排高楼层安静房间',
        data: {
          orderId: 'MT-987654321',
          roomName: '豪华海景房',
          floorPrice: 88000,
          checkInDateString: '2026-09-25 00:00:00',
          checkOutDateString: '2026-09-27 00:00:00',
          invoiceTagModel: {
            invoiceParty: 3,
            invoiceMoney: 88000,
          },
        },
      },
    };

    it('should inject rendered remark into importPayload when remote template exists', async () => {
      vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockResolvedValue({
        success: true,
        pmsOrderId: 'PMS-RENDERED-888',
      });
      vi.spyOn(channelApi, 'fetchChannelRemarkTemplate').mockResolvedValue({
        otaChannelCode: 'MEITUAN',
        remarkTemplate: '【自动入单】外部单号:{{OTA订单号}}，住客:{{入住人}}，间夜:{{间夜数}}',
      });

      runner.detailResult = sampleDetail;

      const taskPayload = { otaOrderId: 'MT-987654321', extUnitCode: 'HOTEL-TEST' };
      const task: DutyClaimedTask = {
        id: 'task-imp-rendered',
        businessId: 'MT-987654321',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('SUCCEEDED');

      expect(dutyRuntimeApi.importToolkitOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orders: [
            expect.objectContaining({
              remark: '【自动入单】外部单号:MT-987654321，住客:李小龙，间夜:2间夜',
            }),
          ],
        })
      );
    });

    it('should fallback to order raw remark when remote template is empty or null', async () => {
      vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockResolvedValue({
        success: true,
        pmsOrderId: 'PMS-FALLBACK-100',
      });
      vi.spyOn(channelApi, 'fetchChannelRemarkTemplate').mockResolvedValue({
        otaChannelCode: 'MEITUAN',
        remarkTemplate: null,
      });

      runner.detailResult = sampleDetail;

      const taskPayload = { otaOrderId: 'MT-987654321', extUnitCode: 'HOTEL-TEST' };
      const task: DutyClaimedTask = {
        id: 'task-imp-fallback',
        businessId: 'MT-987654321',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('SUCCEEDED');

      expect(dutyRuntimeApi.importToolkitOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orders: [
            expect.objectContaining({
              remark: '客人要求尽量安排高楼层安静房间',
            }),
          ],
        })
      );
    });

    it('should fallback to order raw remark when remote template API fails', async () => {
      vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockResolvedValue({
        success: true,
        pmsOrderId: 'PMS-FALLBACK-200',
      });
      vi.spyOn(channelApi, 'fetchChannelRemarkTemplate').mockRejectedValue(new Error('Network error'));

      runner.detailResult = sampleDetail;

      const taskPayload = { otaOrderId: 'MT-987654321', extUnitCode: 'HOTEL-TEST' };
      const task: DutyClaimedTask = {
        id: 'task-imp-net-fallback',
        businessId: 'MT-987654321',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('SUCCEEDED');

      expect(dutyRuntimeApi.importToolkitOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orders: [
            expect.objectContaining({
              remark: '客人要求尽量安排高楼层安静房间',
            }),
          ],
        })
      );
    });

    it('should propagate custom errorCode and retryable: false from runner error in OTA_IMPORT_ORDER', async () => {
      const customErr = new Error('列表中未找到美团订单卡片');
      Object.assign(customErr, { errorCode: 'ORDER_CARD_NOT_FOUND', retryable: false });
      runner.inspectOrderDetail = vi.fn().mockRejectedValue(customErr);

      const task: DutyClaimedTask = {
        id: 'task-imp-custom-err',
        businessId: 'MT-404',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify({ otaOrderId: 'MT-404' })).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('ORDER_CARD_NOT_FOUND');
      expect(result.retryable).toBe(false);
      expect(result.errorMessage).toContain('列表中未找到美团订单卡片');
    });

    it('should propagate custom errorCode and retryable: false in OTA_CONFIRM_IMPORT', async () => {
      const customErr = new Error('输入框已存在不同确认号');
      Object.assign(customErr, { errorCode: 'CONFIRM_INPUT_ALREADY_FILLED', retryable: false });
      runner.confirmImport = vi.fn().mockRejectedValue(customErr);

      const task: DutyClaimedTask = {
        id: 'task-conf-conflict',
        businessId: 'MT-888',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify({ confirmNo: 'NEW-CONF-123', otaOrderId: 'MT-888' })).toString('base64'),
      };

      const result = await dispatchDutyTask(task, runner);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('CONFIRM_INPUT_ALREADY_FILLED');
      expect(result.retryable).toBe(false);
    });
  });
});
