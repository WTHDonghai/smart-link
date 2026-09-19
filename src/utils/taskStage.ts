import type { SystemLogEntry, TaskActionStage } from '../types';

export type NormalizedTaskStage = TaskActionStage;

export interface TaskStageItem {
  key: 'ALL' | NormalizedTaskStage;
  label: string;
}

export const TASK_STAGES: TaskStageItem[] = [
  { key: 'ALL', label: '全部' },
  { key: 'claim', label: '认领 claim' },
  { key: 'order-import-submit', label: '入单提交 order-import-submit' },
  { key: 'result', label: '结果 result' },
  { key: 'execute', label: '执行 execute' },
  { key: 'downstream-create', label: '下游派发 downstream-create' },
  { key: 'report', label: '上报 report' },
];

/**
 * 智能解析日志条目所归属的 Task 链路操作阶段
 * 具备对历史报文、API 接口调用日志及事件枚举的自愈推导能力
 */
export function resolveTaskActionStage(
  log: Partial<SystemLogEntry> & { taskActionStage?: TaskActionStage | string }
): NormalizedTaskStage | '' {
  // 1. 优先使用已明确声明的 taskActionStage 字段
  if (log.taskActionStage && typeof log.taskActionStage === 'string') {
    const raw = log.taskActionStage.toLowerCase().replace(/_/g, '-').trim();
    if (raw === 'claim' || raw.includes('claim')) return 'claim';
    if (
      raw === 'order-import-submit' ||
      raw.includes('order-import') ||
      raw.includes('import-submit') ||
      raw === 'import'
    ) {
      return 'order-import-submit';
    }
    if (raw === 'result' || raw.includes('result')) return 'result';
    if (raw === 'execute' || raw.includes('execute')) return 'execute';
    if (raw === 'downstream-create' || raw.includes('downstream')) return 'downstream-create';
    if (raw === 'report' || raw.includes('report')) return 'report';
  }

  const event = (log.event || '').toLowerCase();
  const url = (log.apiUrl || '').toLowerCase();
  const msg = (log.message || '').toLowerCase();
  const details = (log.details || '').toLowerCase();
  const fullText = `${msg} ${details}`;

  // 2. 任务结果 / 回执 (result) - 优先级高于普通执行和下游派发
  if (
    event.includes('result') ||
    event === 'duty_task_execute_success' ||
    event === 'duty_task_execute_failed' ||
    event === 'duty_task_result' ||
    url.includes('/result') ||
    fullText.includes('[任务结果') ||
    fullText.includes('[回执') ||
    fullText.includes('回执提交') ||
    fullText.includes('任务执行结果') ||
    fullText.includes('提交任务回执') ||
    fullText.includes('回执结果') ||
    fullText.includes('上报任务结果')
  ) {
    return 'result';
  }

  // 3. 入单提交 (order-import-submit)
  if (
    event.includes('order_import_submit') ||
    event.includes('order_import') ||
    event.includes('order_transfer_pms') ||
    url.includes('/orders/import') ||
    (url.includes('/orders') && url.includes('/import')) ||
    fullText.includes('order-import-submit') ||
    fullText.includes('入单提交') ||
    fullText.includes('提交中台入单') ||
    fullText.includes('提交中台导入') ||
    fullText.includes('中台入单') ||
    fullText.includes('订单导入') ||
    fullText.includes('单单重新导入') ||
    fullText.includes('重新导入') ||
    fullText.includes('手动导入') ||
    fullText.includes('导入订单') ||
    fullText.includes('转入pms') ||
    fullText.includes('转入中台') ||
    fullText.includes('提交入单')
  ) {
    return 'order-import-submit';
  }

  // 4. 任务认领 (claim)
  if (
    event === 'duty_task_claim' ||
    event.includes('task_claim') ||
    event.includes('duty_claim') ||
    event.includes('claim') ||
    url.includes('/toolbox/task-claims') ||
    url.includes('task-claims') ||
    fullText.includes('[任务认领') ||
    fullText.includes('[claim') ||
    fullText.includes('任务认领') ||
    fullText.includes('认领任务') ||
    fullText.includes('认领') ||
    fullText.includes('claim')
  ) {
    return 'claim';
  }

  // 5. 下游派发 (downstream-create)
  if (
    event.includes('downstream') ||
    event === 'duty_task_create_downstream' ||
    (url.includes('/toolbox/tasks') && !url.includes('/result')) ||
    fullText.includes('downstream-create') ||
    fullText.includes('下游派发') ||
    fullText.includes('创建下游') ||
    fullText.includes('派发任务')
  ) {
    return 'downstream-create';
  }

  // 6. 任务执行 (execute)
  if (
    event.includes('execute') ||
    event === 'duty_task_execute_start' ||
    event === 'duty_log' ||
    event === 'playwright_worker_start' ||
    fullText.includes('[任务执行') ||
    fullText.includes('正在执行') ||
    fullText.includes('开始执行') ||
    fullText.includes('执行任务') ||
    fullText.includes('执行器已启动') ||
    fullText.includes('值守启动')
  ) {
    return 'execute';
  }

  // 7. 状态与心跳上报 (report)
  if (
    event.includes('actual_state_report') ||
    event.includes('heartbeat') ||
    url.includes('/actual-state') ||
    fullText.includes('状态上报') ||
    fullText.includes('值守心跳') ||
    fullText.includes('工位注册与状态上报') ||
    fullText.includes('心跳上报') ||
    fullText.includes('协同心跳')
  ) {
    return 'report';
  }

  return '';
}
