import { describe, it, expect, vi } from 'vitest';
import { createTaskLogger } from '../../../src/crawler/duty/dutyTaskLogger';
import type { DutyClaimedTask, SystemLogEntry } from '../../../src/types';

describe('dutyTaskLogger', () => {
  const mockTask: DutyClaimedTask = {
    id: 'task-log-test-99',
    stationId: 'st-unit-test-1',
    businessId: 'MT-LOG-BIZ-1',
    businessType: 'OTA_MIGRATION',
    msgType: 'OTA_IMPORT_ORDER',
    leaseToken: 'lease-log-99',
    data: '',
  };

  it('日志输出时应自动注入 module: DUTY_TASK, taskId, msgType, channelId, orderNo', () => {
    const emittedLogs: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
    const sink = (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => {
      emittedLogs.push(entry);
    };

    const taskLogger = createTaskLogger(
      mockTask,
      { channelCode: 'MEITUAN', orderNo: 'MT-ORD-001' },
      sink
    );

    taskLogger.log({
      level: 'INFO',
      event: 'DUTY_TASK_CLAIM',
      taskActionStage: 'claim',
      taskStatus: 'PROCESSING',
      message: '认领任务成功',
      details: '工位已认领',
      apiUrl: '/toolkit/toolbox/task-claims',
      apiMethod: 'POST',
      apiParams: { stationId: 'st-unit-test-1' },
      apiResponse: { ok: true },
      httpStatus: 200,
    });

    expect(emittedLogs).toHaveLength(1);
    const entry = emittedLogs[0];
    expect(entry.module).toBe('DUTY_TASK');
    expect(entry.taskId).toBe('task-log-test-99');
    expect(entry.msgType).toBe('OTA_IMPORT_ORDER');
    expect(entry.channelId).toBe('MEITUAN');
    expect(entry.orderNo).toBe('MT-ORD-001');
    expect(entry.level).toBe('INFO');
    expect(entry.event).toBe('DUTY_TASK_CLAIM');
    expect(entry.taskActionStage).toBe('claim');
    expect(entry.taskStatus).toBe('PROCESSING');
    expect(entry.message).toBe('认领任务成功');
    expect(entry.details).toBe('工位已认领');
    expect(entry.apiUrl).toBe('/toolkit/toolbox/task-claims');
    expect(entry.apiMethod).toBe('POST');
    expect(entry.apiParams).toEqual({ stationId: 'st-unit-test-1' });
    expect(entry.apiResponse).toEqual({ ok: true });
    expect(entry.httpStatus).toBe(200);
  });

  it('当单次日志调用显式指定 channelId 或 orderNo 时，应优先使用显式覆盖值', () => {
    const emittedLogs: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
    const sink = (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => {
      emittedLogs.push(entry);
    };

    const taskLogger = createTaskLogger(
      mockTask,
      { channelCode: 'MEITUAN', orderNo: 'MT-DEFAULT' },
      sink
    );

    taskLogger.log({
      level: 'WARN',
      channelId: 'CTRIP',
      orderNo: 'CTRIP-OVERRIDE-1',
      message: '跨渠道测试',
    });

    expect(emittedLogs[0].channelId).toBe('CTRIP');
    expect(emittedLogs[0].orderNo).toBe('CTRIP-OVERRIDE-1');
  });

  it('updateContext 与 context 属性赋值应能正确动态变更后续日志上下文', () => {
    const emittedLogs: Array<Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>> = [];
    const sink = (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => {
      emittedLogs.push(entry);
    };

    const taskLogger = createTaskLogger(
      mockTask,
      { channelCode: 'MEITUAN' },
      sink
    );

    // 初始没有 orderNo
    taskLogger.log({
      level: 'INFO',
      message: '无单号日志',
    });
    expect(emittedLogs[0].orderNo).toBeUndefined();

    // 更新 orderNo
    taskLogger.updateContext({ orderNo: 'MT-NEW-002' });
    taskLogger.log({
      level: 'INFO',
      message: '有单号日志',
    });
    expect(emittedLogs[1].orderNo).toBe('MT-NEW-002');

    // 通过 setter 修改整个 context
    taskLogger.context = { channelCode: 'DOUYIN', orderNo: 'DY-003' };
    taskLogger.log({
      level: 'INFO',
      message: '抖音单号日志',
    });
    expect(emittedLogs[2].channelId).toBe('DOUYIN');
    expect(emittedLogs[2].orderNo).toBe('DY-003');
  });

  it('taskLogger.task 属性应为只读并指向原始任务', () => {
    const sink = vi.fn();
    const taskLogger = createTaskLogger(
      mockTask,
      { channelCode: 'MEITUAN' },
      sink
    );
    expect(taskLogger.task).toBe(mockTask);
  });
});
