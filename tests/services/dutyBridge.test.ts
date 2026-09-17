import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startDutyByChannel,
  stopDutyByChannel,
  queryDutyStatus,
  syncDutyTokens,
  clearDutyTokens,
} from '../../src/services/dutyBridge';
import * as dutyRuntimeApi from '../../src/services/dutyRuntimeApi';
import type { PlatformAuthTokens } from '../../src/types';

vi.mock('../../src/services/dutyRuntimeApi', () => ({
  startChannelDutyHttp: vi.fn(),
  stopChannelDutyHttp: vi.fn(),
  fetchDutyStatusHttp: vi.fn(),
  syncDutyTokensHttp: vi.fn(),
  clearDutyTokensHttp: vi.fn(),
}));

describe('dutyBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { electron?: unknown }).electron;
  });

  describe('startDutyByChannel', () => {
    it('uses Electron IPC when available in desktop context', async () => {
      const mockStartDuty = vi.fn().mockResolvedValue({ success: true, message: 'IPC Started' });
      (window as unknown as { electron: { duty: { startDuty: typeof mockStartDuty } } }).electron = {
        duty: { startDuty: mockStartDuty },
      };

      const res = await startDutyByChannel('meituan');
      expect(mockStartDuty).toHaveBeenCalledWith('MEITUAN');
      expect(res.success).toBe(true);
      expect(res.message).toBe('IPC Started');
      expect(dutyRuntimeApi.startChannelDutyHttp).not.toHaveBeenCalled();
    });

    it('falls back to HTTP API in web context', async () => {
      vi.mocked(dutyRuntimeApi.startChannelDutyHttp).mockResolvedValueOnce({
        success: true,
        message: 'HTTP Started',
      });

      const res = await startDutyByChannel('DOUYIN');
      expect(dutyRuntimeApi.startChannelDutyHttp).toHaveBeenCalledWith('DOUYIN');
      expect(res.success).toBe(true);
      expect(res.message).toBe('HTTP Started');
    });

    it('throws error when channelCode is empty', async () => {
      await expect(startDutyByChannel('')).rejects.toThrow('值守渠道编码 channelCode 不能为空');
    });
  });

  describe('stopDutyByChannel', () => {
    it('uses Electron IPC when available in desktop context', async () => {
      const mockStopDuty = vi.fn().mockResolvedValue({ success: true, message: 'IPC Stopped' });
      (window as unknown as { electron: { duty: { stopDuty: typeof mockStopDuty } } }).electron = {
        duty: { stopDuty: mockStopDuty },
      };

      const res = await stopDutyByChannel('CTRIP');
      expect(mockStopDuty).toHaveBeenCalledWith('CTRIP');
      expect(res.success).toBe(true);
      expect(res.message).toBe('IPC Stopped');
    });

    it('falls back to HTTP API in web context', async () => {
      vi.mocked(dutyRuntimeApi.stopChannelDutyHttp).mockResolvedValueOnce({
        success: true,
        message: 'HTTP Stopped',
      });

      const res = await stopDutyByChannel('MEITUAN');
      expect(dutyRuntimeApi.stopChannelDutyHttp).toHaveBeenCalledWith('MEITUAN');
      expect(res.success).toBe(true);
    });
  });

  describe('queryDutyStatus', () => {
    it('queries IPC in desktop mode', async () => {
      const mockStatus = {
        channels: { MEITUAN: { channelCode: 'MEITUAN', status: 'RUNNING' as const } },
        coordinatorStatus: 'CLAIMING' as const,
        station: { stationId: 'station-desktop-001', appId: 'smart-link' },
      };
      (window as unknown as { electron: { duty: { getStatus: () => Promise<typeof mockStatus> } } }).electron = {
        duty: { getStatus: vi.fn().mockResolvedValue(mockStatus) },
      };

      const res = await queryDutyStatus();
      expect(res.coordinatorStatus).toBe('CLAIMING');
      expect(res.channels.MEITUAN.status).toBe('RUNNING');
      expect(res.station?.stationId).toBe('station-desktop-001');
    });

    it('queries HTTP in web mode', async () => {
      vi.mocked(dutyRuntimeApi.fetchDutyStatusHttp).mockResolvedValueOnce({
        channels: {},
        coordinatorStatus: 'STOPPED',
        station: { stationId: 'station-web-002', appId: 'smart-link' },
      });

      const res = await queryDutyStatus();
      expect(res.coordinatorStatus).toBe('STOPPED');
      expect(res.station?.stationId).toBe('station-web-002');
    });

    it('fails fast and throws when HTTP query fails', async () => {
      vi.mocked(dutyRuntimeApi.fetchDutyStatusHttp).mockRejectedValueOnce(
        new Error('Network offline')
      );

      await expect(queryDutyStatus()).rejects.toThrow('Network offline');
    });
  });

  describe('syncDutyTokens and clearDutyTokens', () => {
    const mockTokens: PlatformAuthTokens = {
      accessToken: 'token-abc',
      refreshToken: 'refresh-xyz',
      expiresAt: 999999999,
      tokenType: 'bearer',
      platformBaseUrl: 'https://api.test.com',
      tenantId: 'TENANT_BRIDGE',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('syncs tokens via Electron IPC when available', async () => {
      const mockSync = vi.fn().mockResolvedValue({ success: true });
      (window as unknown as { electron: { duty: { syncTokens: typeof mockSync } } }).electron = {
        duty: { syncTokens: mockSync },
      };

      const res = await syncDutyTokens(mockTokens);
      expect(mockSync).toHaveBeenCalledWith(mockTokens);
      expect(res.success).toBe(true);
      expect(dutyRuntimeApi.syncDutyTokensHttp).not.toHaveBeenCalled();
    });

    it('falls back to HTTP API for sync tokens in web context', async () => {
      vi.mocked(dutyRuntimeApi.syncDutyTokensHttp).mockResolvedValueOnce({ success: true });

      const res = await syncDutyTokens(mockTokens);
      expect(dutyRuntimeApi.syncDutyTokensHttp).toHaveBeenCalledWith(mockTokens);
      expect(res.success).toBe(true);
    });

    it('clears tokens via Electron IPC when available', async () => {
      const mockClear = vi.fn().mockResolvedValue({ success: true });
      (window as unknown as { electron: { duty: { clearTokens: typeof mockClear } } }).electron = {
        duty: { clearTokens: mockClear },
      };

      const res = await clearDutyTokens();
      expect(mockClear).toHaveBeenCalled();
      expect(res.success).toBe(true);
      expect(dutyRuntimeApi.clearDutyTokensHttp).not.toHaveBeenCalled();
    });

    it('falls back to HTTP API for clear tokens in web context', async () => {
      vi.mocked(dutyRuntimeApi.clearDutyTokensHttp).mockResolvedValueOnce({ success: true });

      const res = await clearDutyTokens();
      expect(dutyRuntimeApi.clearDutyTokensHttp).toHaveBeenCalled();
      expect(res.success).toBe(true);
    });
  });
});
