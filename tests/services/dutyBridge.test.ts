import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDutyTokens,
  takePendingMainLogs,
  queryDutyStatus,
  setConfirmImportEnabled,
  startDutyByChannel,
  stopAllDuty,
  stopDutyByChannel,
  subscribeDutyLogs,
  syncDutyTokens,
} from '../../src/services/dutyBridge';
import type { PlatformAuthTokens } from '../../src/types';

const hostWindow = window as unknown as { host?: { duty?: unknown } };

const tokens: PlatformAuthTokens = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 60_000,
  tokenType: 'bearer',
  platformBaseUrl: 'https://api.example.com',
  tenantId: 'TENANT',
  authenticatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function installDutyApi() {
  const duty = {
    startDuty: vi.fn().mockResolvedValue({ success: true }),
    stopDuty: vi.fn().mockResolvedValue({ success: true }),
    stopAllDuty: vi.fn().mockResolvedValue({ success: true }),
    getStatus: vi.fn().mockResolvedValue({ channels: {}, coordinatorStatus: 'IDLE', station: null, logs: [], confirmImportEnabled: true }),
    setConfirmImportEnabled: vi.fn().mockResolvedValue({ success: true }),
    syncTokens: vi.fn().mockResolvedValue({ success: true }),
    clearTokens: vi.fn().mockResolvedValue({ success: true }),
    takePendingLogs: vi.fn().mockResolvedValue([]),
    onLog: vi.fn().mockReturnValue(() => undefined),
  };
  hostWindow.host = { duty };
  return duty;
}

afterEach(() => {
  delete hostWindow.host;
  vi.restoreAllMocks();
});

describe('dutyBridge', () => {
  it('requires the desktop duty API', async () => {
    delete hostWindow.host;
    await expect(startDutyByChannel('MEITUAN')).rejects.toThrow('值守调度仅支持桌面端');
    expect(() => subscribeDutyLogs(() => undefined)).toThrow('值守调度仅支持桌面端');
  });

  it('starts duty through IPC when no renderer token is present', async () => {
    const duty = installDutyApi();

    await startDutyByChannel('meituan');

    expect(duty.startDuty).toHaveBeenCalledWith('MEITUAN');
  });

  it('routes all lifecycle calls through IPC', async () => {
    const duty = installDutyApi();

    await stopDutyByChannel('meituan');
    await stopAllDuty();
    await setConfirmImportEnabled(false);
    await queryDutyStatus(123);
    await syncDutyTokens(tokens);
    await clearDutyTokens();
    await takePendingMainLogs();

    expect(duty.stopDuty).toHaveBeenCalledWith('MEITUAN');
    expect(duty.stopAllDuty).toHaveBeenCalledTimes(1);
    expect(duty.setConfirmImportEnabled).toHaveBeenCalledWith(false);
    expect(duty.getStatus).toHaveBeenCalledWith(123);
    expect(duty.syncTokens).toHaveBeenCalledWith(tokens);
    expect(duty.clearTokens).toHaveBeenCalledTimes(1);
    expect(duty.takePendingLogs).toHaveBeenCalledTimes(1);
  });

  it('throws error when setConfirmImportEnabled fails', async () => {
    const duty = installDutyApi();
    duty.setConfirmImportEnabled.mockResolvedValueOnce({ success: false, error: 'IPC通信异常' });

    await expect(setConfirmImportEnabled(true)).rejects.toThrow('IPC通信异常');
  });
});
