import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DutyOrchestrationEngine } from '../../../src/crawler/duty/dutyOrchestrationEngine';
import type { ChannelDutyRunner, DutyTaskExecutionResult } from '../../../src/crawler/duty/dutyContracts';
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
          taskId: 'task-test-claim-1',
          status: 'SUCCEEDED',
          result: { imported: true },
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
              unitId: 'H-1',
            }),
          ],
        })
      );
    });
  });
});
