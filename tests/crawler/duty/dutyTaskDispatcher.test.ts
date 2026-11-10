import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchDutyTask } from '../../../src/crawler/duty/dutyTaskDispatcher';
import type { ChannelDutyRunner } from '../../../src/crawler/duty/dutyContracts';
import type { DutyClaimedTask } from '../../../src/types';
import type { IChannelOrderProtocol, UnifiedOrderProtocol } from '../../../src/types/template';

/**
 * 调度器失败阶段与副作用状态标注（设计 7.1 incident.phase / sideEffectState）：
 * 真实执行 dispatchDutyTask 编排逻辑，仅注入外部 I/O
 * （页面动作 Runner、协议清洗依赖的渠道协议实体、中台入单接口、备注模板拉取）。
 */

vi.mock('../../../src/services/protocols', () => ({
  cleanChannelOrder: vi.fn(() => buildChannelOrder()),
}));

vi.mock('../../../src/crawler/duty/remarkTemplateManager', () => ({
  remarkTemplateManager: { getTemplate: vi.fn(async () => null) },
}));

import { importToolkitOrder } from '../../../src/services/dutyRuntimeApi';

vi.mock('../../../src/services/dutyRuntimeApi', () => ({
  importToolkitOrder: vi.fn(),
}));

function buildUnifiedOrder(): UnifiedOrderProtocol {
  return {
    otaOrderId: 'ORD-1001',
    otaChannel: 'MOCK_OTA',
    unitId: 'UNIT-1',
    contact: { name: '张三', mobile: '13800000000' },
    booking: {
      roomTypeName: '豪华大床房',
      roomTypeId: 'R-1',
      rateCode: 'ADV',
      arrival: '2026-11-10',
      departure: '2026-11-11',
      nights: 1,
      quantity: 1,
      totalPrice: 300,
      paytype: 'PREPAY',
      pricing: [],
    },
    remark: '',
  };
}

function buildChannelOrder(): IChannelOrderProtocol {
  return {
    channelCode: 'MOCK_OTA',
    getTemplateVariables: () => ({}) as never,
    toUnifiedOrder: (renderedRemark: string) => ({ ...buildUnifiedOrder(), remark: renderedRemark }),
  };
}

function buildTask(overrides?: { msgType?: DutyClaimedTask['msgType']; data?: Record<string, unknown> }): DutyClaimedTask {
  return {
    id: 'task-dispatch-1',
    businessId: 'ORD-1001',
    businessType: 'OTA_MIGRATION',
    msgType: overrides?.msgType ?? 'OTA_IMPORT_ORDER',
    stationId: 'st-1',
    leaseToken: 'lease-1',
    data: Buffer.from(JSON.stringify(overrides?.data ?? { otaChannelCode: 'MOCK_OTA' })).toString('base64'),
  };
}

function buildRunner(overrides?: Partial<ChannelDutyRunner>): ChannelDutyRunner {
  return {
    channelCode: 'MOCK_OTA',
    isRunning: () => true,
    start: async () => {},
    stop: async () => {},
    inspectOrderDetail: vi.fn(async () => ({ otaOrderId: 'ORD-1001' })),
    confirmImport: vi.fn(async () => {}),
    confirmCancel: vi.fn(async () => {}),
    ...overrides,
  } as ChannelDutyRunner;
}

beforeEach(() => {
  vi.mocked(importToolkitOrder).mockReset();
});

describe('dispatchDutyTask 失败阶段与副作用状态标注（设计 7.1）', () => {
  it('页面查看详情失败：failedPhase=inspect-order-detail，副作用未开始', async () => {
    const runner = buildRunner({
      inspectOrderDetail: vi.fn(async () => {
        throw new Error('定位订单卡片超时');
      }),
    });

    const result = await dispatchDutyTask(buildTask(), runner);

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('ORDER_DETAIL_FETCH_FAILED');
    expect(result.failedPhase).toBe('inspect-order-detail');
    expect(result.sideEffectState).toBe('not_started');
  });

  it('中台入单提交失败：failedPhase=submit-import，副作用状态如实取 unknown', async () => {
    vi.mocked(importToolkitOrder).mockRejectedValue(new Error('请求超时(30000ms)'));

    const result = await dispatchDutyTask(buildTask(), buildRunner());

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('IMPORT_FAILED');
    // 请求是否已送达中台无法断言：必须按结果未知处理，不得伪装 not_started
    expect(result.failedPhase).toBe('submit-import');
    expect(result.sideEffectState).toBe('unknown');
  });

  it('页面确认回填失败：failedPhase=confirm-import，副作用状态如实取 unknown', async () => {
    const runner = buildRunner({
      confirmImport: vi.fn(async () => {
        throw new Error('确认按钮点击后页面无响应');
      }),
    });
    const task = buildTask({
      msgType: 'OTA_CONFIRM_IMPORT',
      data: { channelCode: 'MOCK_OTA', confirmNo: 'CFM-1' },
    });

    const result = await dispatchDutyTask(task, runner);

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('CONFIRM_IMPORT_FAILED');
    expect(result.failedPhase).toBe('confirm-import');
    expect(result.sideEffectState).toBe('unknown');
  });

  it('载荷解析失败：failedPhase=payload-parse，副作用未开始', async () => {
    const task = buildTask({ data: { otaChannelCode: 'MOCK_OTA' } });
    const invalidTask = { ...task, businessId: '   ' };

    const result = await dispatchDutyTask(invalidTask, buildRunner());

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('MISSING_ORDER_ID');
    expect(result.failedPhase).toBe('payload-parse');
    expect(result.sideEffectState).toBe('not_started');
  });

  it('成功任务不携带失败阶段字段', async () => {
    vi.mocked(importToolkitOrder).mockResolvedValue({
      success: true,
      pmsOrderId: 'PMS-1',
      confirmationNo: 'CFM-9',
      batchId: 'B-1',
    });

    const result = await dispatchDutyTask(buildTask(), buildRunner());

    expect(result.status).toBe('SUCCEEDED');
    expect(result.failedPhase).toBeUndefined();
    expect(result.sideEffectState).toBeUndefined();
  });
});
