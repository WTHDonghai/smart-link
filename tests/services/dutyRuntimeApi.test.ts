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
import type { DutyTaskResultPayload } from '../../src/types';

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
    it('调用 PUT /toolkit/toolbox/tasks/:id/result 提交标准线缆格式执行结果', async () => {
      mockRequest.mockResolvedValueOnce({ code: '0000', success: true });

      const payload: DutyTaskResultPayload = {
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

      await submitDutyTaskResult('task-101', payload);

      expect(mockRequest).toHaveBeenCalledWith(
        DUTY_ENDPOINTS.TASK_RESULT('task-101'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      );
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
