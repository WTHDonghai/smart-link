import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  unwrapDutyEnvelope,
  registerStation,
  reportDutyActualState,
  claimDutyTask,
  createDutyTasks,
  submitDutyTaskResult,
  importToolkitOrder,
  syncDutyTokensHttp,
  clearDutyTokensHttp,
  DUTY_ENDPOINTS,
} from '../../src/services/dutyRuntimeApi';
import * as platformApi from '../../src/services/platformApi';
import type { PlatformAuthTokens } from '../../src/types';

vi.mock('../../src/services/platformApi', () => ({
  requestPlatformApi: vi.fn(),
  TOOLKIT_MODULE: 'toolkit',
}));

describe('dutyRuntimeApi 平台任务与工位服务', () => {
  const mockRequest = vi.mocked(platformApi.requestPlatformApi);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('unwrapDutyEnvelope', () => {
    it('业务成功时正确解包 data 属性', () => {
      const res = { code: '0000', success: true, data: { stationId: 'st-001' } };
      expect(unwrapDutyEnvelope<{ stationId: string }>(res)).toEqual({ stationId: 'st-001' });
    });

    it('无 data 字段但成功时返回原信封', () => {
      const res = { code: 200, success: true, message: 'OK' };
      expect(unwrapDutyEnvelope(res)).toEqual(res);
    });

    it('success 为 false 时阻断抛出异常', () => {
      const res = { code: '500', success: false, message: '服务器繁忙' };
      expect(() => unwrapDutyEnvelope(res)).toThrow('平台接口返回业务错误: 服务器繁忙');
    });

    it('code 非 0/200/0000 时阻断抛出异常', () => {
      const res = { code: 'B001', msg: '缺少参数' };
      expect(() => unwrapDutyEnvelope(res)).toThrow('平台接口返回业务错误: 缺少参数');
    });
  });

  describe('registerStation', () => {
    it('调用 POST /toolkit/toolbox/station/register 并返回工位信息', async () => {
      mockRequest.mockResolvedValueOnce({
        code: '0000',
        success: true,
        data: { stationId: 'station-999', appId: 'smart-link', stationName: '前台工位' },
      });

      const res = await registerStation({
        macAddress: '00:11:22:33:44:55',
        hostname: 'mac-mini',
        ip: '192.168.1.100',
        appId: 'smart-link',
      });

      expect(res).toEqual(
        expect.objectContaining({
          stationId: 'station-999',
          appId: 'smart-link',
          stationName: '前台工位',
          hostname: 'mac-mini',
          ip: '192.168.1.100',
          macAddress: '00:11:22:33:44:55',
        })
      );
      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.STATION_REGISTER,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('Fail-Fast: 当中台未返回有效 stationId 时阻断抛出异常', async () => {
      mockRequest.mockResolvedValueOnce({
        code: '0000',
        success: true,
        data: { stationId: '', appId: 'smart-link' },
      });

      await expect(
        registerStation({
          macAddress: '00:11:22:33:44:55',
          hostname: 'mac-mini',
          ip: '192.168.1.100',
          appId: 'smart-link',
        })
      ).rejects.toThrow('平台工位注册失败：中台未返回有效的 stationId');
    });

    it('Fail-Fast: 当中台返回的 appId 与期望不一致时阻断抛出异常', async () => {
      mockRequest.mockResolvedValueOnce({
        code: '0000',
        success: true,
        data: { stationId: 'station-123', appId: 'mismatch-app' },
      });

      await expect(
        registerStation({
          macAddress: '00:11:22:33:44:55',
          hostname: 'mac-mini',
          ip: '192.168.1.100',
          appId: 'smart-link',
        })
      ).rejects.toThrow('平台工位注册异常：appId 不匹配');
    });
  });

  describe('reportDutyActualState', () => {
    it('调用 POST /toolkit/toolbox/actual-state/report 上报活跃值守', async () => {
      mockRequest.mockResolvedValueOnce({ code: '0000', success: true });

      await reportDutyActualState({
        stationId: 'st-1',
        apps: [
          {
            appId: 'smart-link',
            actualVersion: '1.0.0',
            status: 'RUNNING',
            lastStartedAt: 1789400000000,
            reportedAt: 1789400000000,
            otaCollectionTargets: [{ otaChannelCode: 'MEITUAN' }],
          },
        ],
      });

      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.ACTUAL_STATE_REPORT,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('claimDutyTask', () => {
    it('当 pollingStatus 为 PROCESSING 且 task 为空时返回 null', async () => {
      mockRequest.mockResolvedValueOnce({
        code: '0000',
        success: true,
        data: { pollingStatus: 'PROCESSING', task: null },
      });

      const task = await claimDutyTask({ stationId: 'st-1', appId: 'smart-link' });
      expect(task).toBeNull();
    });

    it('当领取到任务时返回任务对象', async () => {
      const mockTask = {
        id: 'task-101',
        businessId: 'MT-10001',
        businessType: 'OTA_MIGRATION',
        msgType: 'OTA_COLLECT_ORDER' as const,
        stationId: 'st-1',
        leaseToken: 'lease-abc',
        data: 'eyJvdGFDaGFubmVsQ29kZSI6Ik1FSVRVQU4ifQ==',
      };
      mockRequest.mockResolvedValueOnce({
        code: '0000',
        success: true,
        data: { pollingStatus: 'SUCCEEDED', task: mockTask },
      });

      const task = await claimDutyTask({ stationId: 'st-1', appId: 'smart-link' });
      expect(task).toEqual(mockTask);
    });
  });

  describe('createDutyTasks', () => {
    it('调用 POST /toolkit/toolbox/tasks 批量创建下游任务', async () => {
      mockRequest.mockResolvedValueOnce({ code: '0000', success: true });

      await createDutyTasks({
        stationId: 'st-1',
        appId: 'smart-link',
        items: [
          {
            msgType: 'OTA_IMPORT_ORDER',
            businessId: 'MT-10001',
            unitId: 'unit-88',
            data: { channel: 'meituan' },
          },
        ],
      });

      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.TASKS,
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('submitDutyTaskResult', () => {
    it('调用 PUT /toolkit/toolbox/tasks/:id/result 提交执行结果', async () => {
      mockRequest.mockResolvedValueOnce({ code: '0000', success: true });

      await submitDutyTaskResult('task-101', {
        taskId: 'task-101',
        status: 'SUCCEEDED',
        result: { pmsOrderId: 'PMS-888' },
      });

      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.TASK_RESULT('task-101'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('importToolkitOrder', () => {
    it('调用 POST /toolkit/orders/import 直接提交订单', async () => {
      mockRequest.mockResolvedValueOnce({
        code: '0000',
        success: true,
        data: { pmsOrderId: 'PMS-999' },
      });

      const res = await importToolkitOrder({ orders: [{ otaOrderId: 'MT-1' }] });
      expect(res).toEqual({ success: true, pmsOrderId: 'PMS-999' });
      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.ORDER_IMPORT,
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('syncDutyTokensHttp & clearDutyTokensHttp', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('POST /api/duty/tokens 同步平台 Token', async () => {
      const mockFetch = vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const tokens: PlatformAuthTokens = {
        accessToken: 'token-1',
        refreshToken: 'ref-1',
        expiresAt: 12345,
        tokenType: 'bearer',
        platformBaseUrl: 'https://api.test.com',
        tenantId: 'TENANT_HTTP',
        authenticatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const res = await syncDutyTokensHttp(tokens);

      expect(res.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.LOCAL_DUTY_TOKENS,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(tokens),
        })
      );
    });

    it('DELETE /api/duty/tokens 清除平台 Token', async () => {
      const mockFetch = vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const res = await clearDutyTokensHttp();

      expect(res.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.LOCAL_DUTY_TOKENS,
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('同步失败时抛出明确异常', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(
        syncDutyTokensHttp({
          accessToken: 'a',
          refreshToken: 'b',
          expiresAt: 1,
          tokenType: 'bearer',
          platformBaseUrl: 'https://api.test.com',
          tenantId: 'TENANT_HTTP',
          authenticatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      ).rejects.toThrow('同步 Token 失败 (500)');
    });
  });
});
