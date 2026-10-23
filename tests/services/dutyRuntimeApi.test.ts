import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  unwrapDutyEnvelope,
  registerStation,
  reportDutyActualState,
  claimDutyTask,
  createDutyTasks,
  submitDutyTaskResult,
  importToolkitOrder,
  DUTY_ENDPOINTS,
} from '../../src/services/dutyRuntimeApi';
import * as platformApi from '../../src/services/platformApi';
import { SYSTEM_TIMING } from '../../src/config/timing';
import type { DutyTaskResultPayload } from '../../src/types';

// 仅 Mock 网络边界 requestPlatformApi；isTransientPlatformError / PlatformApiError 等待测依赖均运行真实源码
vi.mock('../../src/services/platformApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/platformApi')>();
  return { ...actual, requestPlatformApi: vi.fn() };
});

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
          silentSuccess: true,
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
      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.TASK_CLAIMS,
        expect.objectContaining({
          method: 'POST',
          silentSuccess: true,
        })
      );
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
      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.TASK_CLAIMS,
        expect.objectContaining({
          method: 'POST',
          silentSuccess: true,
        })
      );
    });
  });

  describe('createDutyTasks', () => {
    it('调用 POST /toolkit/toolbox/tasks 批量创建下游任务，并自动转换 businessType 与 Base64 data', async () => {
      mockRequest.mockResolvedValueOnce({ code: '0000', success: true });

      await createDutyTasks({
        stationId: 'st-1',
        appId: 'smart-link',
        items: [
          {
            msgType: 'OTA_IMPORT_ORDER',
            businessId: 'MT-10001',
            unitId: 'unit-88',
            data: { channel: 'meituan', extUnitCode: 'unit-88' },
          },
          {
            msgType: 'OTA_CANCEL_ORDER',
            businessId: 'MT-10002',
            unitId: 'unit-88', // 应该被过滤掉，不发送 unitId
            data: { channel: 'meituan', reason: '客户退单' },
          },
        ],
      });

      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.TASKS,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            stationId: 'st-1',
            appId: 'smart-link',
            items: [
              {
                unitId: 'unit-88',
                msgType: 'OTA_IMPORT_ORDER',
                businessType: 'OTA_MIGRATION',
                businessId: 'MT-10001',
                data: Buffer.from(JSON.stringify({ channel: 'meituan', extUnitCode: 'unit-88' }), 'utf-8').toString('base64'),
              },
              {
                msgType: 'OTA_CANCEL_ORDER',
                businessType: 'OTA_MIGRATION',
                businessId: 'MT-10002',
                data: Buffer.from(JSON.stringify({ channel: 'meituan', reason: '客户退单' }), 'utf-8').toString('base64'),
              },
            ],
          }),
        })
      );
    });
  });

  describe('submitDutyTaskResult', () => {
    const resultPayload: DutyTaskResultPayload = {
      station: 'st-1',
      leaseToken: 'lease-999',
      businessType: 'OTA_MIGRATION',
      businessId: 'MT-10001',
      scope: 'INTERFACE',
      status: 'SUCCESS',
      details: [
        {
          confirmNo: 'CONF-888',
          businessId: 'MT-10001',
          status: 'SUCCESS',
          ackData: Buffer.from(JSON.stringify({ pmsOrderId: 'PMS-888' }), 'utf-8').toString('base64'),
        },
      ],
    };

    /** 构造 undici 本地超时中止的真实异常形态（name 为 AbortError） */
    const createAbortError = (): Error => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      return err;
    };

    it('调用 PUT /toolkit/toolbox/tasks/:id/result 提交标准线缆格式执行结果，并透传长超时', async () => {
      mockRequest.mockResolvedValueOnce({ code: '0000', success: true });

      await submitDutyTaskResult('task-101', resultPayload);

      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.TASK_RESULT('task-101'),
        expect.objectContaining({
          method: 'PUT',
          timeoutMs: SYSTEM_TIMING.TASK_RESULT_TIMEOUT,
          body: JSON.stringify(resultPayload),
        })
      );
    });

    it('瞬时网络错误（AbortError）自动重试，后续尝试成功后正常返回', async () => {
      vi.useFakeTimers();
      mockRequest
        .mockRejectedValueOnce(createAbortError())
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({ code: '0000', success: true });

      try {
        const promise = submitDutyTaskResult('task-retry-1', resultPayload);
        await vi.advanceTimersByTimeAsync(SYSTEM_TIMING.TASK_RESULT_RETRY_BACKOFF);
        await vi.advanceTimersByTimeAsync(SYSTEM_TIMING.TASK_RESULT_RETRY_BACKOFF);
        await promise;
      } finally {
        vi.useRealTimers();
      }

      expect(mockRequest).toHaveBeenCalledTimes(3);
      expect(mockRequest).toHaveBeenLastCalledWith(
        DUTY_ENDPOINTS.TASK_RESULT('task-retry-1'),
        expect.objectContaining({
          method: 'PUT',
          timeoutMs: SYSTEM_TIMING.TASK_RESULT_TIMEOUT,
        })
      );
    });

    it('瞬时网络错误连续失败达到最大尝试次数后，抛出最后一次真实异常', async () => {
      vi.useFakeTimers();
      mockRequest.mockRejectedValue(new platformApi.PlatformApiTimeoutError(30_000, 'PUT', 'https://pms.example.com/toolkit/toolbox/tasks/task-retry-2/result'));

      try {
        const promise = submitDutyTaskResult('task-retry-2', resultPayload);
        promise.catch(() => undefined); // 预注册 rejection 处理，避免 unhandled rejection 干扰定时器推进
        await vi.advanceTimersByTimeAsync(SYSTEM_TIMING.TASK_RESULT_RETRY_BACKOFF);
        await vi.advanceTimersByTimeAsync(SYSTEM_TIMING.TASK_RESULT_RETRY_BACKOFF);
        await expect(promise).rejects.toBeInstanceOf(platformApi.PlatformApiTimeoutError);
      } finally {
        vi.useRealTimers();
      }

      expect(mockRequest).toHaveBeenCalledTimes(SYSTEM_TIMING.TASK_RESULT_MAX_ATTEMPTS);
    });

    it('非瞬时业务错误（HTTP 400）不重试，一次即阻断抛出原异常', async () => {
      mockRequest.mockRejectedValueOnce(
        new platformApi.PlatformApiError(400, '平台接口调用失败 (400): leaseToken 已过期', {
          url: 'https://pms.example.com/toolkit/toolbox/tasks/task-400/result',
        })
      );

      await expect(submitDutyTaskResult('task-400', resultPayload)).rejects.toThrow(
        '平台接口调用失败 (400): leaseToken 已过期'
      );

      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('importToolkitOrder', () => {
    it('调用 POST /toolkit/orders/import 提交符合线缆标准的订单', async () => {
      mockRequest.mockResolvedValueOnce({
        code: '0000',
        success: true,
        data: { orders: [{ pmsOrderId: 'PMS-999', confirmationNo: 'CONF-123' }] },
      });

      const res = await importToolkitOrder({
        extUnitCode: 'HOTEL-1',
        orders: [
          {
            otaOrderId: 'MT-1',
            otaChannel: 'MEITUAN',
            contact: { name: '张三', mobile: '13800000000' },
            booking: {
              roomType: '大床房',
              rateCode: 'OTA',
              arrival: '2026-09-20',
              departure: '2026-09-21',
              roomTypeId: 'ROOM-1',
              nights: 1,
              quantity: 1,
              totalPrice: 200,
              paytype: '预付',
              pricing: [{ date: '2026-09-20', price: 200 }],
            },
            remark: '',
          },
        ],
      });
      expect(res).toEqual({ success: true, pmsOrderId: 'PMS-999', confirmationNo: 'CONF-123' });
      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.ORDER_IMPORT,
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

});
