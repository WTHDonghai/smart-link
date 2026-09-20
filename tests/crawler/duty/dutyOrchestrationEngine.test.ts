import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DutyOrchestrationEngine,
  buildTaskResultPayload,
} from '../../../src/crawler/duty/dutyOrchestrationEngine';
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

  public async inspectOrderDetail(otaOrderId: string): Promise<Record<string, unknown>> {
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

    it('should format appendDutyLog timestamp as standard YYYY-MM-DD HH:mm:ss.SSS in local timezone', () => {
      const entry = engine.appendDutyLog({
        level: 'INFO',
        message: '测试时间戳格式对齐',
      });
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
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
      expect(secondRes.error).toBeUndefined();
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
        businessType: 'OTA_MIGRATION',
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
        businessType: 'OTA_MIGRATION',
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
        businessType: 'OTA_MIGRATION',
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

      // 必须包含 claim 阶段日志
      const claimLog = taskLogs.find((l) => l.taskActionStage === 'claim');
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

      // 必须包含 execute 阶段日志
      const execLog = taskLogs.find((l) => l.taskActionStage === 'execute');
      expect(execLog).toBeDefined();
      expect(execLog?.msgType).toBe('OTA_IMPORT_ORDER');

      // 必须包含 result 阶段日志
      const resultLog = taskLogs.find((l) => l.taskActionStage === 'result' && l.event === 'DUTY_TASK_EXECUTE_SUCCESS');
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
        details: [
          {
            confirmNo: '',
            businessId: 'MT-BIZ-101',
            status: 'SUCCESS',
            ackData: Buffer.from(JSON.stringify({ result: { pmsOrderId: 'PMS-9988' } }), 'utf-8').toString('base64'),
          },
        ],
      });
      expect(resultLog?.apiResponse).toEqual({ pmsOrderId: 'PMS-9988' });
    });

    it('当 submitDutyTaskResult 提交失败时，应记录 DUTY_TASK_RESULT_SUBMIT_FAILED (level: ERROR) 错误日志', async () => {
      const task: DutyClaimedTask = {
        id: 'task-fail-submit-1',
        businessId: 'MT-FAIL-01',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-fail-1',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(task)
        .mockResolvedValue(null);

      mockRunner.executeResult = {
        status: 'SUCCEEDED',
        result: { imported: true },
      };

      vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockRejectedValueOnce(
        new Error('平台接口返回业务错误: TASK_PAYLOAD_INVALID')
      );

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 60));

      const logs = engine.getRecentDutyLogs();
      const failLog = logs.find((l) => l.event === 'DUTY_TASK_RESULT_SUBMIT_FAILED');
      expect(failLog).toBeDefined();
      expect(failLog?.level).toBe('ERROR');
      expect(failLog?.taskId).toBe('task-fail-submit-1');
      expect(failLog?.message).toContain('TASK_PAYLOAD_INVALID');

      const loopErrorLog = logs.find((l) => l.event === 'DUTY_TASK_CLAIM_LOOP_ERROR');
      expect(loopErrorLog).toBeDefined();
      expect(loopErrorLog?.level).toBe('ERROR');
      expect(loopErrorLog?.message).toContain('TASK_PAYLOAD_INVALID');
    });

    it('当任务 businessType 不为 OTA_MIGRATION 时，阻断执行并向中台提交 TASK_PAYLOAD_INVALID 且 retryable=false', async () => {
      const task: DutyClaimedTask = {
        id: 'task-invalid-biz-type',
        businessId: 'ORD-BIZ-TYPE-01',
        businessType: 'UNSUPPORTED_BUSINESS',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-biz-1',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(task)
        .mockResolvedValue(null);

      const submitSpy = vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockRunner.executedTasks).toHaveLength(0);
      expect(submitSpy).toHaveBeenCalledWith(
        'task-invalid-biz-type',
        expect.objectContaining({
          status: 'FAIL',
          retryable: false,
          errorMessage: expect.stringContaining('OTA_MIGRATION'),
          details: [
            expect.objectContaining({
              status: 'FAIL',
              ackData: Buffer.from(JSON.stringify({ errorCode: 'TASK_PAYLOAD_INVALID' }), 'utf-8').toString('base64'),
            }),
          ],
        })
      );
    });

    it('当任务缺失 businessId 时，阻断执行并向中台提交 TASK_PAYLOAD_INVALID 且 retryable=false', async () => {
      const task: DutyClaimedTask = {
        id: 'task-missing-biz-id',
        businessId: '   ',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-biz-2',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(task)
        .mockResolvedValue(null);

      const submitSpy = vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockRunner.executedTasks).toHaveLength(0);
      expect(submitSpy).toHaveBeenCalledWith(
        'task-missing-biz-id',
        expect.objectContaining({
          status: 'FAIL',
          retryable: false,
          errorMessage: expect.stringContaining('businessId'),
          details: [
            expect.objectContaining({
              status: 'FAIL',
              ackData: Buffer.from(JSON.stringify({ errorCode: 'TASK_PAYLOAD_INVALID' }), 'utf-8').toString('base64'),
            }),
          ],
        })
      );
    });

    it('当中台下发 OTA_CANCEL_ORDER 任务时，阻断执行并向中台提交 TASK_TYPE_UNSUPPORTED 且 retryable=false', async () => {
      const task: DutyClaimedTask = {
        id: 'task-cancel-unsupported',
        businessId: 'ORD-CANCEL-001',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_CANCEL_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-cancel-1',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(task)
        .mockResolvedValue(null);

      const submitSpy = vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockRunner.executedTasks).toHaveLength(0);
      expect(submitSpy).toHaveBeenCalledWith(
        'task-cancel-unsupported',
        expect.objectContaining({
          status: 'FAIL',
          retryable: false,
          errorMessage: expect.stringContaining('OTA_CANCEL_ORDER'),
          details: [
            expect.objectContaining({
              status: 'FAIL',
              ackData: Buffer.from(JSON.stringify({ errorCode: 'TASK_TYPE_UNSUPPORTED' }), 'utf-8').toString('base64'),
            }),
          ],
        })
      );
    });

    it('当任务 data 载荷非合法 Base64 JSON 对象时，阻断执行并向中台提交 TASK_PAYLOAD_INVALID 且 retryable=false', async () => {
      const task: DutyClaimedTask = {
        id: 'task-bad-data',
        businessId: 'ORD-BAD-DATA',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-bad-1',
        data: Buffer.from('["not_an_object"]').toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(task)
        .mockResolvedValue(null);

      const submitSpy = vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockRunner.executedTasks).toHaveLength(0);
      expect(submitSpy).toHaveBeenCalledWith(
        'task-bad-data',
        expect.objectContaining({
          status: 'FAIL',
          retryable: false,
          errorMessage: expect.stringContaining('JSON'),
          details: [
            expect.objectContaining({
              status: 'FAIL',
              ackData: Buffer.from(JSON.stringify({ errorCode: 'TASK_PAYLOAD_INVALID' }), 'utf-8').toString('base64'),
            }),
          ],
        })
      );
    });

    it('当任务消息类型不支持时，阻断执行并向中台提交 TASK_TYPE_UNSUPPORTED 且 retryable=false', async () => {
      const task: DutyClaimedTask = {
        id: 'task-unknown-msg-type',
        businessId: 'ORD-UNKNOWN-MSG',
        businessType: 'OTA_MIGRATION',
        msgType: 'UNKNOWN_MSG_TYPE' as unknown as DutyClaimedTask['msgType'],
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-unknown-msg',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(task)
        .mockResolvedValue(null);

      const submitSpy = vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockRunner.executedTasks).toHaveLength(0);
      expect(submitSpy).toHaveBeenCalledWith(
        'task-unknown-msg-type',
        expect.objectContaining({
          status: 'FAIL',
          retryable: false,
          errorMessage: expect.stringContaining('UNKNOWN_MSG_TYPE'),
          details: [
            expect.objectContaining({
              status: 'FAIL',
              ackData: Buffer.from(JSON.stringify({ errorCode: 'TASK_TYPE_UNSUPPORTED' }), 'utf-8').toString('base64'),
            }),
          ],
        })
      );
    });

    it('当执行遇到风控拦截 (RISK_VERIFICATION_REQUIRED) 时，向中台提交 retryable=false 并记录 DUTY_TASK_RISK_CONTROL_INTERCEPTED 日志', async () => {
      const task: DutyClaimedTask = {
        id: 'task-risk-interception',
        businessId: 'ORD-RISK-999',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-tok-risk',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'MOCK_OTA' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(task)
        .mockResolvedValue(null);

      mockRunner.executeTask = vi.fn().mockResolvedValue({
        status: 'FAILED',
        errorCode: 'RISK_VERIFICATION_REQUIRED',
        errorMessage: '美团后台提示安全验证或操作频繁，需要人工在浏览器中完成验证',
      });

      const submitSpy = vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(mockRunner.executeTask).toHaveBeenCalledTimes(1);
      expect(submitSpy).toHaveBeenCalledWith(
        'task-risk-interception',
        expect.objectContaining({
          status: 'FAIL',
          retryable: false,
          errorMessage: expect.stringContaining('安全验证'),
        })
      );

      const logs = engine.getRecentDutyLogs();
      const riskLog = logs.find((l) => l.event === 'DUTY_TASK_RISK_CONTROL_INTERCEPTED');
      expect(riskLog).toBeDefined();
      expect(riskLog?.level).toBe('WARN');
      expect(riskLog?.message).toContain('风控拦截熔断');
    });

    it('当目标渠道未注册或未在运行状态时，提交 TASK_ROUTE_UNAVAILABLE，导入任务 retryable=true，采集任务 retryable=false', async () => {
      // 1. 针对未注册/未运行渠道的导入任务：retryable 应为 true
      const importTask: DutyClaimedTask = {
        id: 'task-unavail-import',
        businessId: 'ORD-UNAVAIL-01',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-unavail-1',
        data: Buffer.from(JSON.stringify({ channel: 'CTRIP' })).toString('base64'),
      };

      // 2. 针对未运行渠道的采集任务：retryable 应为 false
      const collectTask: DutyClaimedTask = {
        id: 'task-unavail-collect',
        businessId: 'COLL-UNAVAIL-02',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-unit-test-1',
        leaseToken: 'lease-unavail-2',
        data: Buffer.from(JSON.stringify({ otaChannelCode: 'CTRIP' })).toString('base64'),
      };

      vi.spyOn(dutyRuntimeApi, 'claimDutyTask')
        .mockResolvedValueOnce(importTask)
        .mockResolvedValueOnce(collectTask)
        .mockResolvedValue(null);

      const submitSpy = vi.spyOn(dutyRuntimeApi, 'submitDutyTaskResult').mockResolvedValue(undefined);

      await engine.startDuty('MOCK_OTA');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 导入任务校验：retryable = true
      expect(submitSpy).toHaveBeenCalledWith(
        'task-unavail-import',
        expect.objectContaining({
          status: 'FAIL',
          retryable: true,
          errorMessage: expect.stringContaining('CTRIP'),
          details: [
            expect.objectContaining({
              status: 'FAIL',
              ackData: Buffer.from(JSON.stringify({ errorCode: 'TASK_ROUTE_UNAVAILABLE' }), 'utf-8').toString('base64'),
            }),
          ],
        })
      );

      // 采集任务校验：retryable = false
      expect(submitSpy).toHaveBeenCalledWith(
        'task-unavail-collect',
        expect.objectContaining({
          status: 'FAIL',
          retryable: false,
          errorMessage: expect.stringContaining('CTRIP'),
          details: [
            expect.objectContaining({
              status: 'FAIL',
              ackData: Buffer.from(JSON.stringify({ errorCode: 'TASK_ROUTE_UNAVAILABLE' }), 'utf-8').toString('base64'),
            }),
          ],
        })
      );
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
      expect(stopResult.error).toBeUndefined();

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

  describe('buildTaskResultPayload 契约标准化与 DTO 序列化', () => {
    const baseTask: DutyClaimedTask = {
      id: 'task-wire-001',
      businessId: 'MT-ORDER-8888',
      businessType: 'OTA_MIGRATION',
      msgType: 'OTA_IMPORT_ORDER',
      stationId: 'st-from-task',
      leaseToken: 'lease-999',
      data: 'e30=',
      msgId: 'msg-wire-777',
      unitId: 'unit-hotel-123',
      unitType: 'HOTEL',
      direction: 'INBOUND',
      createdTime: '2026-09-18T00:00:00.000Z',
      delaySendTime: 0,
    };

    it('成功执行时，ackData 必须解码为包含 { result: ... } 结构，并透传 msgId 与 task.stationId', () => {
      const payload = buildTaskResultPayload(baseTask, 'st-fallback', {
        status: 'SUCCESS',
        confirmationNo: 'CONFIRM-12345',
        result: { imported: true, pmsOrderId: 'PMS-111' },
      });

      expect(payload.station).toBe('st-from-task');
      expect(payload.leaseToken).toBe('lease-999');
      expect(payload.businessType).toBe('OTA_MIGRATION');
      expect(payload.businessId).toBe('MT-ORDER-8888');
      expect(payload.scope).toBe('INTERFACE');
      expect(payload.status).toBe('SUCCESS');
      expect(payload.msgId).toBe('msg-wire-777');
      expect(payload.unitId).toBe('unit-hotel-123');
      expect(payload.unitType).toBe('HOTEL');
      expect(payload.direction).toBe('INBOUND');
      expect(payload.createdTime).toBe('2026-09-18T00:00:00.000Z');
      expect(payload.delaySendTime).toBe(0);
      expect(payload.errorMessage).toBeUndefined();

      expect(payload.details).toHaveLength(1);
      const detail = payload.details[0];
      expect(detail.businessId).toBe('MT-ORDER-8888');
      expect(detail.confirmNo).toBe('CONFIRM-12345');
      expect(detail.status).toBe('SUCCESS');

      // 关键断言：ackData 解码后必须包含外层 result 包装对象，严格契合文旅中台 DTO 反序列化规范
      const decodedAck = JSON.parse(Buffer.from(detail.ackData || '', 'base64').toString('utf-8'));
      expect(decodedAck).toEqual({
        result: {
          imported: true,
          pmsOrderId: 'PMS-111',
        },
      });
    });

    it('失败执行时，ackData 必须解码为仅包含 { errorCode } 结构，顶层带 errorMessage 与 retryable', () => {
      const payload = buildTaskResultPayload(baseTask, 'st-fallback', {
        status: 'FAIL',
        errorCode: 'ROOM_FULL',
        errorMessage: '满房拒绝',
        retryable: true,
      });

      expect(payload.status).toBe('FAIL');
      expect(payload.errorMessage).toBe('满房拒绝');
      expect(payload.retryable).toBe(true);
      expect(payload.details).toHaveLength(1);

      const detail = payload.details[0];
      expect(detail.status).toBe('FAIL');
      expect(detail.confirmNo).toBe('');

      // 关键契约断言：ackData 失败时仅包裹 errorCode，errorMessage 位于顶层 DTO
      const decodedAck = JSON.parse(Buffer.from(detail.ackData || '', 'base64').toString('utf-8'));
      expect(decodedAck).toEqual({
        errorCode: 'ROOM_FULL',
      });
    });

    it('当任务缺少可选字段或为空串时，顶层 payload 严格按条件序列化，杜绝多余空字段与 undefined 污染', () => {
      const minimalTask: DutyClaimedTask = {
        id: 'task-minimal-002',
        businessId: 'MT-ORDER-MINIMAL',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: '',
        leaseToken: 'lease-min-002',
        data: 'e30=',
        unitId: '', // 空字符串
        unitType: '   ', // 空白
      };

      const payload = buildTaskResultPayload(minimalTask, 'st-fallback-identity', {
        status: 'SUCCESS',
        result: { recordCount: 0, orders: [] },
      });

      expect(payload.station).toBe('st-fallback-identity'); // 任务 stationId 为空，正确回退 fallbackStationId
      expect(payload.msgId).toBeUndefined();
      expect(payload.unitId).toBeUndefined(); // 空字符串未被输出
      expect(payload.unitType).toBeUndefined(); // 空白未被输出
      expect(payload.direction).toBeUndefined();
      expect(payload.createdTime).toBeUndefined();
      expect(payload.delaySendTime).toBeUndefined();

      const decodedAck = JSON.parse(Buffer.from(payload.details[0].ackData || '', 'base64').toString('utf-8'));
      expect(decodedAck.result).toEqual({ recordCount: 0, orders: [] });
    });
  });
});
