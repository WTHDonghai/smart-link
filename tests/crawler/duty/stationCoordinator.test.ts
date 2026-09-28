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

  it('should start and stop heartbeat timer', async () => {
    await coordinator.ensureIdentity();
    expect(coordinator.isHeartbeatActive()).toBe(false);

    coordinator.startHeartbeat(() => ['MEITUAN']);
    expect(coordinator.isHeartbeatActive()).toBe(true);

    // Starting again is idempotent
    coordinator.startHeartbeat(() => ['MEITUAN']);
    expect(coordinator.isHeartbeatActive()).toBe(true);

    coordinator.stopHeartbeat();
    expect(coordinator.isHeartbeatActive()).toBe(false);
  });
});
