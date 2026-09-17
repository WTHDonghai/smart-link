import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startDutyByChannel,
  stopDutyByChannel,
  queryDutyStatus,
} from '../../src/services/dutyBridge';
import * as dutyRuntimeApi from '../../src/services/dutyRuntimeApi';

vi.mock('../../src/services/dutyRuntimeApi', () => ({
  startChannelDutyHttp: vi.fn(),
  stopChannelDutyHttp: vi.fn(),
  fetchDutyStatusHttp: vi.fn(),
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
      };
      (window as unknown as { electron: { duty: { getStatus: () => Promise<typeof mockStatus> } } }).electron = {
        duty: { getStatus: vi.fn().mockResolvedValue(mockStatus) },
      };

      const res = await queryDutyStatus();
      expect(res.coordinatorStatus).toBe('CLAIMING');
      expect(res.channels.MEITUAN.status).toBe('RUNNING');
    });

    it('queries HTTP in web mode', async () => {
      vi.mocked(dutyRuntimeApi.fetchDutyStatusHttp).mockResolvedValueOnce({
        channels: {},
        coordinatorStatus: 'STOPPED',
      });

      const res = await queryDutyStatus();
      expect(res.coordinatorStatus).toBe('STOPPED');
    });
  });
});
