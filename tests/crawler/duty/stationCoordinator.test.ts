import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StationCoordinator } from '../../../src/crawler/duty/stationCoordinator';
import * as stationIdentityModule from '../../../src/crawler/duty/stationIdentity';
import * as dutyRuntimeApi from '../../../src/services/dutyRuntimeApi';
import type { SystemLogEntry } from '../../../src/types';

describe('StationCoordinator', () => {
  let coordinator: StationCoordinator;
  const mockIdentity = {
    stationId: 'st-unit-test-1',
    appId: 'smart-link',
    macAddress: 'aa:bb:cc:dd:ee:ff',
    ip: '127.0.0.1',
    hostname: 'test-runner',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    coordinator = new StationCoordinator();
    vi.spyOn(stationIdentityModule.stationIdentityManager, 'getCurrentIdentity').mockReturnValue(null);
    vi.spyOn(stationIdentityModule, 'getOrRegisterStationIdentity').mockResolvedValue(mockIdentity);
    vi.spyOn(dutyRuntimeApi, 'reportDutyActualState').mockResolvedValue(undefined);
  });

  afterEach(() => {
    coordinator.dispose();
  });

  it('should ensure and retrieve station identity', async () => {
    expect(coordinator.getIdentity()).toBeNull();
    const identity = await coordinator.ensureIdentity();
    expect(identity.stationId).toBe('st-unit-test-1');
    expect(coordinator.getIdentity()?.stationId).toBe('st-unit-test-1');
  });

  it('should report RUNNING actual state with active channel targets', async () => {
    await coordinator.ensureIdentity();
    const reportSpy = vi.spyOn(dutyRuntimeApi, 'reportDutyActualState');

    await coordinator.reportActualState(['MEITUAN', 'DOUYIN']);

    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stationId: 'st-unit-test-1',
        apps: [
          expect.objectContaining({
            appId: 'smart-link',
            status: 'RUNNING',
            otaCollectionTargets: [
              { otaChannelCode: 'MEITUAN' },
              { otaChannelCode: 'DOUYIN' },
            ],
          }),
        ],
      })
    );
  });

  it('should report STOP actual state when forceStop is true or channels empty', async () => {
    await coordinator.ensureIdentity();
    const reportSpy = vi.spyOn(dutyRuntimeApi, 'reportDutyActualState');

    await coordinator.reportActualState(['MEITUAN'], true);

    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stationId: 'st-unit-test-1',
        apps: [
          expect.objectContaining({
            appId: 'smart-link',
            status: 'STOP',
            otaCollectionTargets: [],
          }),
        ],
      })
    );
  });

  it('should log warning when reportActualState fails', async () => {
    await coordinator.ensureIdentity();
    vi.spyOn(dutyRuntimeApi, 'reportDutyActualState').mockRejectedValue(new Error('Network timeout'));

    const logs: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
    coordinator.setLogCallback((entry) => logs.push(entry));

    await coordinator.reportActualState(['MEITUAN']);

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('WARN');
    expect(logs[0].event).toBe('DUTY_ACTUAL_STATE_REPORT_FAILED');
    expect(logs[0].message).toContain('Network timeout');
  });

  it('should suppress repeated failure logs during consecutive heartbeat failures', async () => {
    await coordinator.ensureIdentity();
    vi.spyOn(dutyRuntimeApi, 'reportDutyActualState').mockRejectedValue(new Error('Connection refused'));

    const logs: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
    coordinator.setLogCallback((entry) => logs.push(entry));

    // 连续 5 次上报失败
    for (let i = 0; i < 5; i++) {
      await coordinator.reportActualState(['MEITUAN']);
    }

    // 严格断言：连续失败只产生一条告警日志，杜绝高频日志轰炸
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('WARN');
    expect(logs[0].event).toBe('DUTY_ACTUAL_STATE_REPORT_FAILED');
  });

  it('should emit DUTY_ACTUAL_STATE_REPORT_RECOVERED when report succeeds after previous failure', async () => {
    await coordinator.ensureIdentity();
    const reportSpy = vi.spyOn(dutyRuntimeApi, 'reportDutyActualState');
    reportSpy.mockRejectedValueOnce(new Error('Network timeout'));

    const logs: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
    coordinator.setLogCallback((entry) => logs.push(entry));

    // 第一次：失败
    await coordinator.reportActualState(['MEITUAN']);
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe('DUTY_ACTUAL_STATE_REPORT_FAILED');

    // 第二次：成功，触发边缘恢复日志
    reportSpy.mockResolvedValueOnce(undefined);
    await coordinator.reportActualState(['MEITUAN']);
    expect(logs).toHaveLength(2);
    expect(logs[1].event).toBe('DUTY_ACTUAL_STATE_REPORT_RECOVERED');
    expect(logs[1].level).toBe('INFO');
    expect(logs[1].message).toContain('网络恢复');

    // 第三次：持续成功，正常静默，不再重复打印恢复日志
    reportSpy.mockResolvedValueOnce(undefined);
    await coordinator.reportActualState(['MEITUAN']);
    expect(logs).toHaveLength(2);
  });

  it('should start and stop heartbeat timer and emit lifecycle logs when onLog provided', async () => {
    await coordinator.ensureIdentity();
    expect(coordinator.isHeartbeatActive()).toBe(false);

    const logs: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
    coordinator.setLogCallback((entry) => logs.push(entry));

    coordinator.startHeartbeat(() => ['MEITUAN']);
    expect(coordinator.isHeartbeatActive()).toBe(true);
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe('DUTY_HEARTBEAT_STARTED');

    // 重复 start 幂等，不重复发日志
    coordinator.startHeartbeat(() => ['MEITUAN']);
    expect(coordinator.isHeartbeatActive()).toBe(true);
    expect(logs).toHaveLength(1);

    coordinator.stopHeartbeat();
    expect(coordinator.isHeartbeatActive()).toBe(false);
    expect(logs).toHaveLength(2);
    expect(logs[1].event).toBe('DUTY_HEARTBEAT_STOPPED');
  });
});
