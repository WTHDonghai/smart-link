import { requestPlatformApi, TOOLKIT_MODULE } from './platformApi';
import { logger } from './logger';
import type {
  ActualStateReportPayload,
  StationRegistration,
  StationIdentity,
  DutyTaskClaimRequest,
  DutyClaimedTask,
  DutyTaskResultPayload,
  DutyTaskCreationBatch,
  ImportPayload,
} from '../types';

export const DUTY_ENDPOINTS = {
  STATION_REGISTER: `/${TOOLKIT_MODULE}/toolbox/station/register`,
  ACTUAL_STATE_REPORT: `/${TOOLKIT_MODULE}/toolbox/actual-state/report`,
  TASK_CLAIMS: `/${TOOLKIT_MODULE}/toolbox/task-claims`,
  TASKS: `/${TOOLKIT_MODULE}/toolbox/tasks`,
  TASK_RESULT: (id: string) => `/${TOOLKIT_MODULE}/toolbox/tasks/${encodeURIComponent(id)}/result`,
  ORDER_IMPORT: `/${TOOLKIT_MODULE}/orders/import`,
} as const;

/**
 * 校验并解包中台 Toolbox 信封结构
 */
export function unwrapDutyEnvelope<T>(res: unknown): T {
  if (!res || typeof res !== 'object') {
    return res as T;
  }
  const envelope = res as Record<string, unknown>;
  const hasSuccessFalse = envelope.success === false;
  const hasBadCode =
    envelope.code !== undefined &&
    envelope.code !== null &&
    envelope.code !== 0 &&
    envelope.code !== '0' &&
    envelope.code !== '0000' &&
    envelope.code !== '200' &&
    envelope.code !== 200;

  if (hasSuccessFalse || hasBadCode) {
    const errorMsg =
      (typeof envelope.msg === 'string' && envelope.msg) ||
      (typeof envelope.message === 'string' && envelope.message) ||
      (typeof envelope.error === 'string' && envelope.error) ||
      `业务状态异常 (code: ${envelope.code})`;
    logger.error(`[平台接口] 业务信封异常: ${errorMsg}`, {
      module: 'API',
      details: JSON.stringify(envelope),
      meta: { envelope },
    });
    throw new Error(`平台接口返回业务错误: ${errorMsg}`);
  }

  if ('data' in envelope && envelope.data !== undefined && envelope.data !== null) {
    return envelope.data as T;
  }
  return envelope as T;
}

/**
 * 工位实例注册与识别 (POST /toolkit/toolbox/station/register)
 */
export async function registerStation(payload: StationRegistration): Promise<StationIdentity> {
  const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.STATION_REGISTER, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = unwrapDutyEnvelope<Record<string, unknown>>(res);
  const stationId = String(data.stationId || '').trim();
  if (!stationId) {
    throw new Error('平台工位注册失败：中台未返回有效的 stationId');
  }
  const appId = String(data.appId || payload.appId).trim();
  if (payload.appId && appId !== payload.appId) {
    throw new Error(`平台工位注册异常：appId 不匹配 (期望: ${payload.appId}, 实际: ${appId})`);
  }
  return {
    stationId,
    appId,
    stationName: typeof data.stationName === 'string' ? data.stationName : undefined,
    hostname: payload.hostname,
    ip: payload.ip,
    macAddress: payload.macAddress,
    osName: payload.osName,
    agentVersion: payload.agentVersion,
    registeredAt: Date.now(),
  };
}

/**
 * 上报订单值守实际状态至文旅中台 (POST /toolkit/toolbox/actual-state/report)
 */
export async function reportDutyActualState(payload: ActualStateReportPayload): Promise<void> {
  const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.ACTUAL_STATE_REPORT, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  unwrapDutyEnvelope(res);
}

/**
 * 全局 Long Polling 认领一条中台任务 (POST /toolkit/toolbox/task-claims)
 * 线缆约束：direction 固定为 'INBOUND'
 */
export async function claimDutyTask(
  payload: DutyTaskClaimRequest,
  timeoutMs = 75000
): Promise<DutyClaimedTask | null> {
  const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.TASK_CLAIMS, {
    method: 'POST',
    timeoutMs,
    body: JSON.stringify({
      stationId: payload.stationId,
      appId: payload.appId,
      direction: 'INBOUND',
    }),
  });
  const unwrapped = unwrapDutyEnvelope<Record<string, unknown>>(res);
  if (!unwrapped) return null;
  const task = unwrapped.task as DutyClaimedTask | undefined | null;
  if (!task) return null;
  return task;
}

/**
 * 批量提交下游订单任务 (POST /toolkit/toolbox/tasks)
 * 线缆约束：
 * - items[].businessType 固定为 'OTA_MIGRATION'
 * - items[].data 必须为 Base64 编码的 UTF-8 JSON 字符串
 * - OTA_CANCEL_ORDER 不发送 unitId
 */
export async function createDutyTasks(payload: DutyTaskCreationBatch): Promise<void> {
  const wirePayload = {
    stationId: payload.stationId,
    appId: payload.appId,
    items: payload.items.map((item) => {
      const dataStr =
        typeof item.data === 'string'
          ? item.data
          : Buffer.from(JSON.stringify(item.data ?? {}), 'utf-8').toString('base64');
      return {
        ...(item.msgType === 'OTA_IMPORT_ORDER' && item.unitId ? { unitId: item.unitId } : {}),
        msgType: item.msgType,
        businessType: item.businessType || 'OTA_MIGRATION',
        businessId: item.businessId,
        data: dataStr,
      };
    }),
  };

  const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.TASKS, {
    method: 'POST',
    body: JSON.stringify(wirePayload),
  });
  unwrapDutyEnvelope(res);
}

/**
 * 提交任务最终执行结果 (PUT /toolkit/toolbox/tasks/:id/result)
 * 线缆约束：由中台后端 DTO 规定，包含 scope: 'INTERFACE'、station、leaseToken、status ('SUCCESS' | 'FAIL') 及 details[]
 */
export async function submitDutyTaskResult(
  taskId: string,
  payload: DutyTaskResultPayload
): Promise<void> {
  const cleanTaskId = String(taskId || '').trim();
  if (!cleanTaskId) {
    throw new Error('提交任务回执失败：taskId 不能为空');
  }
  logger.track('DUTY_TASK_RESULT_SUBMIT', {
    module: 'DUTY_TASK',
    level: 'INFO',
    taskId: cleanTaskId,
    taskActionStage: 'result',
    message: `[任务回执] 正在向中台提交任务 ${cleanTaskId} 回执`,
    apiUrl: DUTY_ENDPOINTS.TASK_RESULT(cleanTaskId),
    apiMethod: 'PUT',
    apiParams: payload,
  });
  try {
    const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.TASK_RESULT(cleanTaskId), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    unwrapDutyEnvelope(res);
    logger.success(`[任务回执] 任务 ${cleanTaskId} 回执提交成功`, {
      module: 'DUTY_TASK',
      taskId: cleanTaskId,
      taskActionStage: 'result',
      apiUrl: DUTY_ENDPOINTS.TASK_RESULT(cleanTaskId),
      apiMethod: 'PUT',
    });
  } catch (err) {
    logger.error(`[任务回执] 任务 ${cleanTaskId} 回执提交失败: ${err instanceof Error ? err.message : String(err)}`, {
      module: 'DUTY_TASK',
      taskId: cleanTaskId,
      taskActionStage: 'result',
      apiUrl: DUTY_ENDPOINTS.TASK_RESULT(cleanTaskId),
      apiMethod: 'PUT',
      details: err instanceof Error ? err.stack : String(err),
    });
    throw err;
  }
}

/**
 * 直接提交订单导入文旅中台 (POST /toolkit/orders/import)
 * 线缆约束：入参遵循标准 ImportPayload 契约 (含 extUnitCode 与 orders[{ contact, booking, remark }])
 */
export async function importToolkitOrder(
  payload: ImportPayload
): Promise<{ success: boolean; pmsOrderId?: string; confirmationNo?: string; batchId?: string }> {
  const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.ORDER_IMPORT, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = unwrapDutyEnvelope<Record<string, unknown>>(res);
  const orders = Array.isArray(data?.orders)
    ? (data.orders as Array<Record<string, unknown>>)
    : Array.isArray(data?.items)
      ? (data.items as Array<Record<string, unknown>>)
      : [];
  const firstOrder = orders[0] || {};
  return {
    success: true,
    pmsOrderId:
      typeof firstOrder.pmsOrderId === 'string'
        ? firstOrder.pmsOrderId
        : typeof data?.pmsOrderId === 'string'
          ? data.pmsOrderId
          : undefined,
    confirmationNo:
      typeof firstOrder.confirmationNo === 'string'
        ? firstOrder.confirmationNo
        : typeof data?.confirmationNo === 'string'
          ? data.confirmationNo
          : undefined,
    batchId:
      typeof data?.importBatchId === 'string'
        ? data.importBatchId
        : typeof data?.batchId === 'string'
          ? data.batchId
          : undefined,
  };
}
