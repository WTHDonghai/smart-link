import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DutyOrchestrationEngine } from '../../../src/crawler/duty/dutyOrchestrationEngine';
import type {
  ChannelDutyRunner,
  DutyTaskExecutionResult,
  DutyUnhandledOrderSummary,
  ExtractedOrderDetail,
} from '../../../src/crawler/duty/dutyContracts';
import type { DutyClaimedTask } from '../../../src/types';
import * as stationIdentityModule from '../../../src/crawler/duty/stationIdentity';
import * as dutyRuntimeApi from '../../../src/services/dutyRuntimeApi';

class MockChannelRunner implements ChannelDutyRunner {
  public channelCode: string;
  public running = false;
  public startCalls = 0;
  public stopCalls = 0;
  public executedTasks: DutyClaimedTask[] = [];
  public executeResult: DutyTaskExecutionResult = { status: 'SUCCEEDED', result: { test: true } };

  constructor(channelCode = 'TEST_CHANNEL') {
    this.channelCode = channelCode;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public async start(): Promise<void> {
    this.running = true;
    this.startCalls++;
  }

  public async stop(): Promise<void> {
    this.running = false;
    this.stopCalls++;
  }

  public async collectUnhandledOrders(): Promise<DutyUnhandledOrderSummary[]> {
    return [];
  }

  public async inspectOrderDetail(otaOrderId: string): Promise<ExtractedOrderDetail> {
    return {
      otaOrderId,
      otaChannel: this.channelCode,
      guestName: '测试客人',
      roomTypeName: '标准间',
      arrival: '2026-09-20',
      departure: '2026-09-21',
      nights: 1,
      quantity: 1,
      totalPrice: 200,
    };
  }

  public async executeTask(task: DutyClaimedTask): Promise<DutyTaskExecutionResult> {
    this.executedTasks.push(task);
    return this.executeResult;
  }
}

describe('dutyOrchestrationEngine', () => {
  let engine: DutyOrchestrationEngine;
  let mockRunner: MockChannelRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new DutyOrchestrationEngine();
    mockRunner = new MockChannelRunner('MOCK_OTA');
    engine.registerRunner(mockRunner);

    vi.spyOn(stationIdentityModule, 'getOrRegisterStationIdentity').mockResolvedValue({
      stationId: 'st-unit-test-1',
      appId: 'smart-link',
      macAddress: 'aa:bb:cc:dd:ee:ff',
      ip: '127.0.0.1',
      hostname: 'test-runner',
    });

    vi.spyOn(dutyRuntimeApi, 'reportDutyActualState').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    try {
      if (mockRunner.isRunning()) {
        await engine.stopDuty('MOCK_OTA');
      }
    } catch {
      // ignore teardown
    }
  });

  describe('Runner Registration & Status Inquiry', () => {
    it('should register runner and initialize its state to STOPPED', () => {
      const statusMap = engine.getChannelDutyStatus();
      expect(statusMap['MOCK_OTA']).toBeDefined();
      expect(statusMap['MOCK_OTA'].status).toBe('STOPPED');
      expect(statusMap['MOCK_OTA'].channelCode).toBe('MOCK_OTA');
    });

    it('should return STOPPED coordinator status initially', () => {
      expect(engine.getCoordinatorStatus()).toBe('STOPPED');
    });

    it('should fail fast when starting an unregistered channel', async () => {
      await expect(engine.startDuty('UNKNOWN_CHANNEL')).rejects.toThrow('暂不支持渠道「UNKNOWN_CHANNEL」自动化值守');
    });

    it('should fail fast when stopping an unregistered channel', async () => {
      await expect(engine.stopDuty('UNKNOWN_CHANNEL')).rejects.toThrow('未知渠道「UNKNOWN_CHANNEL」');
    });
  });

  describe('startDuty & stopDuty lifecycle', () => {
    it('should start duty runner, transition state to RUNNING and report actual state', async () => {
      const reportSpy = vi.spyOn(dutyRuntimeApi, 'reportDutyActualState');

      const startRes = await engine.startDuty('MOCK_OTA');
      expect(startRes.success).toBe(true);
      expect(mockRunner.running).toBe(true);
      expect(mockRunner.startCalls).toBe(1);

      const status = engine.getChannelDutyStatus();
      expect(status['MOCK_OTA'].status).toBe('RUNNING');
      expect(status['MOCK_OTA'].lastStartedAt).toBeDefined();

      expect(reportSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          stationId: 'st-unit-test-1',
          apps: expect.arrayContaining([
            expect.objectContaining({
              appId: 'smart-link',
              status: 'RUNNING',
              otaCollectionTargets: [{ otaChannelCode: 'MOCK_OTA' }],
            }),
          ]),
        })
      );
    });

    it('should be idempotent when starting an already running duty runner', async () => {
      await engine.startDuty('MOCK_OTA');
      const secondRes = await engine.startDuty('MOCK_OTA');

      expect(secondRes.success).toBe(true);
      expect(secondRes.message).toContain('已在运行中');
      expect(mockRunner.startCalls).toBe(1);
    });

    it('should stop duty runner, transition state to STOPPED and report STOP state', async () => {
      await engine.startDuty('MOCK_OTA');

      const reportSpy = vi.spyOn(dutyRuntimeApi, 'reportDutyActualState');
      const stopRes = await engine.stopDuty('MOCK_OTA');

      expect(stopRes.success).toBe(true);
      expect(mockRunner.running).toBe(false);
      expect(mockRunner.stopCalls).toBe(1);

      const status = engine.getChannelDutyStatus();
      expect(status['MOCK_OTA'].status).toBe('STOPPED');
      expect(engine.getCoordinatorStatus()).toBe('STOPPED');

      expect(reportSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          stationId: 'st-unit-test-1',
          apps: expect.arrayContaining([
            expect.objectContaining({
              appId: 'smart-link',
              status: 'STOP',
              otaCollectionTargets: [],
            }),
          ]),
        })
      );
    });

    it('should transition to DEGRADED and rethrow if runner.start() throws error', async () => {
      const failingRunner = new MockChannelRunner('FAIL_OTA');
      failingRunner.start = vi.fn().mockRejectedValue(new Error('浏览器驱动启动失败'));
      engine.registerRunner(failingRunner);

      await expect(engine.startDuty('FAIL_OTA')).rejects.toThrow('浏览器驱动启动失败');

      const status = engine.getChannelDutyStatus();
      expect(status['FAIL_OTA'].status).toBe('DEGRADED');
      expect(status['FAIL_OTA'].error).toContain('浏览器驱动启动失败');
    });
  });

  describe('Task Claiming and Dispatch Loop', () => {
    it('should claim task, dispatch to registered runner and submit execution result', async () => {
      const mockTask: DutyClaimedTask = {
        id: 'task-test-claim-1',
        businessId: 'MT-CLAIM-1',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-1',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(mockTask)
        .mockResolvedValue(null);

      mockRunner.executeResult = {
        status: 'SUCCEEDED',
        result: { imported: true },
      };

      const submitSpy = vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockRunner.executedTasks).toHaveLength(1);
      expect(mockRunner.executedTasks[0].id).toBe('task-test-claim-1');

      expect(submitSpy).toHaveBeenCalledWith(
        'task-test-claim-1',
        expect.objectContaining({
          station: 'st-unit-test-1',
          leaseToken: 'lease-tok-1',
          businessType: 'OTA_MIGRATION',
          businessId: 'MT-CLAIM-1',
          scope: 'INTERFACE',
          status: 'SUCCESS',
          details: [
            expect.objectContaining({
              businessId: 'MT-CLAIM-1',
              status: 'SUCCESS',
            }),
          ],
        })
      );
    });

    it('should create downstream import/cancel tasks when OTA_COLLECT_ORDER finds orders', async () => {
      const collectTask: DutyClaimedTask = {
        id: 'task-collect-99',
        businessId: 'MT-COLL-99',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-99',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(collectTask)
        .mockResolvedValue(null);

      mockRunner.executeResult = {
        status: 'SUCCEEDED',
        result: {
          orders: [
            { orderId: 'ORD-101', hotelId: 'H-1', cancelOrder: false },
            { orderId: 'ORD-102', hotelId: 'H-1', cancelOrder: true },
          ],
        },
      };

      vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      const createTasksSpy = vi.spyOn(dutyRuntimeApi, 'createDutyTasks').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(createTasksSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          stationId: 'st-unit-test-1',
          appId: 'smart-link',
          items: [
            expect.objectContaining({
              msgType: 'OTA_IMPORT_ORDER',
              businessId: 'ORD-101',
              unitId: 'H-1',
            }),
            expect.objectContaining({
              msgType: 'OTA_CANCEL_ORDER',
              businessId: 'ORD-102',
            }),
          ],
        })
      );
    });

    it('should capture structured task logs with CLAIM, EXECUTE, and RESULT stages including msgType, taskId, and result status', async () => {
      const task: DutyClaimedTask = {
        id: 'task-log-test-1',
        businessId: 'MT-BIZ-101',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-log-1',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(task)
        .mockResolvedValue(null);

      mockRunner.executeResult = {
        status: 'SUCCEEDED',
        result: { pmsOrderId: 'PMS-9988' },
      };

      vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logs = engine.getRecentDutyLogs();
      const taskLogs = logs.filter((l) => l.taskId === 'task-log-test-1');

      // 必须包含 CLAIM 阶段日志
      const claimLog = taskLogs.find((l) => l.taskActionStage === 'CLAIM');
      expect(claimLog).toBeDefined();
      expect(claimLog?.msgType).toBe('OTA_IMPORT_ORDER');
      expect(claimLog?.module).toBe('DUTY_TASK');
      expect(claimLog?.apiUrl).toBe('/toolkit/toolbox/task-claims');
      expect(claimLog?.apiMethod).toBe('POST');
      expect(claimLog?.apiParams).toEqual({
        stationId: 'st-unit-test-1',
        appId: 'smart-link',
        direction: 'INBOUND',
      });
      expect(claimLog?.apiResponse).toEqual(task);

      // 必须包含 EXECUTE 阶段日志
      const execLog = taskLogs.find((l) => l.taskActionStage === 'EXECUTE');
      expect(execLog).toBeDefined();
      expect(execLog?.msgType).toBe('OTA_IMPORT_ORDER');

      // 必须包含 RESULT 阶段日志
      const resultLog = taskLogs.find((l) => l.taskActionStage === 'RESULT' && l.event === 'DUTY_TASK_EXECUTE_SUCCESS');
      expect(resultLog).toBeDefined();
      expect(resultLog?.msgType).toBe('OTA_IMPORT_ORDER');
      expect(resultLog?.taskStatus).toBe('SUCCEEDED');
      expect(resultLog?.taskResult).toEqual({ pmsOrderId: 'PMS-9988' });
      expect(resultLog?.apiUrl).toBe('/toolkit/toolbox/tasks/task-log-test-1/result');
      expect(resultLog?.apiMethod).toBe('PUT');
      expect(resultLog?.apiParams).toEqual({
        station: 'st-unit-test-1',
        leaseToken: 'lease-tok-log-1',
        businessType: 'OTA_MIGRATION',
        businessId: 'MT-BIZ-101',
        scope: 'INTERFACE',
        status: 'SUCCESS',
        msgType: 'OTA_IMPORT_ORDER',
        unitId: undefined,
        unitType: undefined,
        direction: undefined,
        createdTime: undefined,
        delaySendTime: undefined,
        details: [
          {
            confirmNo: '',
            businessId: 'MT-BIZ-101',
            status: 'SUCCESS',
            ackData: Buffer.from(JSON.stringify({ pmsOrderId: 'PMS-9988' }), 'utf-8').toString('base64'),
          },
        ],
      });
      expect(resultLog?.apiResponse).toEqual({ pmsOrderId: 'PMS-9988' });
    });
  });

  describe('stopAllDuty 一键全局停止与资源清退', () => {
    it('停止所有激活的渠道 Runner，注销心跳，阻断任务认领，并将中台工位状态置为 STOP', async () => {
      const runner2 = new MockChannelRunner('SECOND_OTA');
      engine.registerRunner(runner2);

      const reportSpy = vi.spyOn(dutyRuntimeApi, 'reportDutyActualState');

      // 启动两个渠道
      await engine.startDuty('MOCK_OTA');
      await engine.startDuty('SECOND_OTA');

      expect(mockRunner.running).toBe(true);
      expect(runner2.running).toBe(true);
      expect(engine.getChannelDutyStatus()['MOCK_OTA'].status).toBe('RUNNING');
      expect(engine.getChannelDutyStatus()['SECOND_OTA'].status).toBe('RUNNING');

      // 触发一键停止
      const stopResult = await engine.stopAllDuty();

      // 1. 断言停止响应
      expect(stopResult.success).toBe(true);
      expect(stopResult.message).toContain('已安全停止');

      // 2. 精准断言所有 runner 状态变为 false，调用了 stop()
      expect(mockRunner.running).toBe(false);
      expect(mockRunner.stopCalls).toBe(1);
      expect(runner2.running).toBe(false);
      expect(runner2.stopCalls).toBe(1);

      // 3. 精准断言所有渠道状态和协调器状态确切为 STOPPED
      const statusMap = engine.getChannelDutyStatus();
      expect(statusMap['MOCK_OTA'].status).toBe('STOPPED');
      expect(statusMap['SECOND_OTA'].status).toBe('STOPPED');
      expect(engine.getCoordinatorStatus()).toBe('STOPPED');

      // 4. 精准断言中台 reportActualState 上报 payload 确切包含 status: 'STOP' 与 otaCollectionTargets: []
      expect(reportSpy).toHaveBeenCalled();
      const lastCallPayload = reportSpy.mock.calls[reportSpy.mock.calls.length - 1][0];
      expect(lastCallPayload.stationId).toBe('st-unit-test-1');
      expect(lastCallPayload.apps).toHaveLength(1);
      expect(lastCallPayload.apps[0].status).toBe('STOP');
      expect(lastCallPayload.apps[0].otaCollectionTargets).toEqual([]);

      // 5. 断言心跳定时器已被注销：后续不再触发新的 reportActualState 上报
      const callsAfterStop = reportSpy.mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(reportSpy.mock.calls.length).toBe(callsAfterStop);

      // 6. 断言记录了全局停止日志
      const stopLogs = engine.getRecentDutyLogs().filter((l) => l.event === 'DUTY_STOP_ALL');
      expect(stopLogs.length).toBeGreaterThanOrEqual(1);
      expect(stopLogs[0].level).toBe('INFO');
      expect(stopLogs[0].message).toContain('全局值守已安全终止');
    });

    it('当个别 Runner stop 抛出异常时，依然确保其他 Runner 停止并置为 STOPPED', async () => {
      const failingRunner = new MockChannelRunner('FAILING_OTA');
      failingRunner.stop = vi.fn().mockRejectedValue(new Error('停止执行器超时'));
      engine.registerRunner(failingRunner);

      await engine.startDuty('MOCK_OTA');
      await engine.startDuty('FAILING_OTA');

      const stopResult = await engine.stopAllDuty();
      expect(stopResult.success).toBe(true);

      expect(mockRunner.running).toBe(false);
      expect(engine.getChannelDutyStatus()['MOCK_OTA'].status).toBe('STOPPED');
      expect(engine.getChannelDutyStatus()['FAILING_OTA'].status).toBe('STOPPED');
      expect(engine.getCoordinatorStatus()).toBe('STOPPED');
    });
  });
});
