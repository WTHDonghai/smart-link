import { describe, it, expect } from 'vitest';
import { resolveTaskActionStage, TASK_STAGES } from '../../src/utils/taskStage';
import type { SystemLogEntry } from '../../src/types';

describe('resolveTaskActionStage 任务操作阶段推导与解析纯函数', () => {
  it('优先使用显式声明的 taskActionStage 字段并做标准化转换', () => {
    expect(resolveTaskActionStage({ taskActionStage: 'CLAIM' })).toBe('claim');
    expect(resolveTaskActionStage({ taskActionStage: 'claim' })).toBe('claim');
    expect(resolveTaskActionStage({ taskActionStage: 'ORDER_IMPORT_SUBMIT' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ taskActionStage: 'order-import-submit' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ taskActionStage: 'RESULT' })).toBe('result');
    expect(resolveTaskActionStage({ taskActionStage: 'result' })).toBe('result');
    expect(resolveTaskActionStage({ taskActionStage: 'EXECUTE' })).toBe('execute');
    expect(resolveTaskActionStage({ taskActionStage: 'execute' })).toBe('execute');
    expect(resolveTaskActionStage({ taskActionStage: 'DOWNSTREAM_CREATE' })).toBe('downstream-create');
    expect(resolveTaskActionStage({ taskActionStage: 'downstream-create' })).toBe('downstream-create');
    expect(resolveTaskActionStage({ taskActionStage: 'REPORT' })).toBe('report');
    expect(resolveTaskActionStage({ taskActionStage: 'report' })).toBe('report');
  });

  it('从 apiUrl 智能推导任务操作阶段（覆盖中台接口请求日志，包含资源嵌套路径）', () => {
    expect(resolveTaskActionStage({ apiUrl: '/toolkit/toolbox/task-claims' })).toBe('claim');
    expect(resolveTaskActionStage({ apiUrl: '/toolkit/orders/import' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ apiUrl: '/toolkit/orders/MT-998811/import' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ apiUrl: '/toolkit/toolbox/tasks/task-9981/result' })).toBe('result');
    expect(resolveTaskActionStage({ apiUrl: '/toolkit/toolbox/tasks' })).toBe('downstream-create');
    expect(resolveTaskActionStage({ apiUrl: '/toolkit/toolbox/actual-state' })).toBe('report');
  });

  it('从 event 枚举智能推导任务操作阶段', () => {
    expect(resolveTaskActionStage({ event: 'DUTY_TASK_CLAIM' })).toBe('claim');
    expect(resolveTaskActionStage({ event: 'DUTY_TASK_ORDER_IMPORT_SUBMIT' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ event: 'DUTY_TASK_ORDER_IMPORT_SUBMIT_FAILED' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ event: 'DUTY_TASK_EXECUTE_SUCCESS' })).toBe('result');
    expect(resolveTaskActionStage({ event: 'DUTY_TASK_EXECUTE_FAILED' })).toBe('result');
    expect(resolveTaskActionStage({ event: 'DUTY_TASK_EXECUTE_START' })).toBe('execute');
    expect(resolveTaskActionStage({ event: 'DUTY_TASK_CREATE_DOWNSTREAM' })).toBe('downstream-create');
    expect(resolveTaskActionStage({ event: 'DUTY_ACTUAL_STATE_REPORT' })).toBe('report');
    expect(resolveTaskActionStage({ event: 'ORDER_TRANSFER_PMS_SUCCESS' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ event: 'ORDER_TRANSFER_PMS_FAILED' })).toBe('order-import-submit');
  });

  it('从 message 消息文案智能推导任务操作阶段（覆盖多渠道高频真实日志）', () => {
    expect(resolveTaskActionStage({ message: '[OrderGuardian] 用户手动导入订单 1116956085050906669' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ message: '订单 100234 重新导入' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ message: '[任务认领 claim] 任务类型: OTA_IMPORT_ORDER' })).toBe('claim');
    expect(resolveTaskActionStage({ message: '[任务认领 CLAIM] 任务类型: OTA_IMPORT_ORDER' })).toBe('claim');
    expect(resolveTaskActionStage({ message: '[美团值守] 认领中台任务: 1 个' })).toBe('claim');
    expect(resolveTaskActionStage({ message: '成功认领任务 task-001' })).toBe('claim');
    expect(resolveTaskActionStage({ message: '[入单提交 order-import-submit] 订单 MT-8888 成功提交中台入单' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ message: '订单 100234 提交中台导入' })).toBe('order-import-submit');
    expect(resolveTaskActionStage({ message: '[任务结果 result] 任务 OTA_IMPORT_ORDER 执行成功' })).toBe('result');
    expect(resolveTaskActionStage({ message: '[任务结果 RESULT] 任务 OTA_IMPORT_ORDER 执行成功' })).toBe('result');
    expect(resolveTaskActionStage({ message: '提交任务回执 (ID: task-88)' })).toBe('result');
    expect(resolveTaskActionStage({ message: '[任务执行 execute] 正在执行 OTA_IMPORT_ORDER' })).toBe('execute');
    expect(resolveTaskActionStage({ message: '[任务执行 EXECUTE] 正在执行 OTA_IMPORT_ORDER' })).toBe('execute');
    expect(resolveTaskActionStage({ message: '[值守启动] 渠道「MEITUAN」值守执行器已启动运行' })).toBe('execute');
    expect(resolveTaskActionStage({ message: '[下游派发] 发现 1 个订单，已批量创建下游中台处理任务' })).toBe('downstream-create');
    expect(resolveTaskActionStage({ message: '[中台协同] 渠道「MEITUAN」状态上报完成' })).toBe('report');
    expect(resolveTaskActionStage({ message: '[中台协同] 渠道「MEITUAN」工位注册与状态上报完成' })).toBe('report');
  });

  it('从 details 补充上下文智能推导任务操作阶段', () => {
    expect(
      resolveTaskActionStage({
        message: '接口调用成功',
        details: '订单 MT-99 提交中台导入完成',
      })
    ).toBe('order-import-submit');
    expect(
      resolveTaskActionStage({
        message: '调用中台服务',
        details: '工位注册与状态上报成功',
      })
    ).toBe('report');
  });

  it('无法匹配的常规日志返回空字符串', () => {
    const regularLog: Partial<SystemLogEntry> = {
      level: 'INFO',
      module: 'AUTH',
      message: '用户登录成功',
    };
    expect(resolveTaskActionStage(regularLog)).toBe('');
  });

  it('TASK_STAGES 常量包含全部预期的阶段定义', () => {
    const keys = TASK_STAGES.map((s) => s.key);
    expect(keys).toContain('ALL');
    expect(keys).toContain('claim');
    expect(keys).toContain('order-import-submit');
    expect(keys).toContain('result');
    expect(keys).toContain('execute');
    expect(keys).toContain('downstream-create');
    expect(keys).toContain('report');
  });
});
