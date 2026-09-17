import { requestPlatformApi, TOOLKIT_MODULE } from './platformApi';
import type {
  ActualStateReportPayload,
  ChannelDutyInfo,
  DutyCoordinatorStatus,
  StationRegistration,
  StationIdentity,
  DutyTaskClaimRequest,
  DutyClaimedTask,
  DutyTaskResultPayload,
  DutyTaskCreationBatch,
  SystemLogEntry,
} from '../types';

export const DUTY_ENDPOINTS = {
  STATION_REGISTER: `/${TOOLKIT_MODULE}/toolbox/station/register`,
  ACTUAL_STATE_REPORT: `/${TOOLKIT_MODULE}/toolbox/actual-state/report`,
  TASK_CLAIMS: `/${TOOLKIT_MODULE}/toolbox/task-claims`,
  TASKS: `/${TOOLKIT_MODULE}/toolbox/tasks`,
  TASK_RESULT: (id: string) => `/${TOOLKIT_MODULE}/toolbox/tasks/${encodeURIComponent(id)}/result`,
  ORDER_IMPORT: `/${TOOLKIT_MODULE}/orders/import`,
  LOCAL_DUTY_START: '/api/duty/start',
  LOCAL_DUTY_STOP: '/api/duty/stop',
  LOCAL_DUTY_STATUS: '/api/duty/status',
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
      direction: payload.direction || 'FORWARD',
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
 */
export async function createDutyTasks(payload: DutyTaskCreationBatch): Promise<void> {
  const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.TASKS, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  unwrapDutyEnvelope(res);
}

/**
 * 提交任务最终执行结果 (PUT /toolkit/toolbox/tasks/:id/result)
 */
export async function submitDutyTaskResult(
  taskId: string,
  payload: DutyTaskResultPayload
): Promise<void> {
  const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.TASK_RESULT(taskId), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  unwrapDutyEnvelope(res);
}

/**
 * 直接提交订单导入文旅中台 (POST /toolkit/orders/import)
 */
export async function importToolkitOrder(payload: unknown): Promise<{ success: boolean; pmsOrderId?: string }> {
  const res = await requestPlatformApi<unknown>(DUTY_ENDPOINTS.ORDER_IMPORT, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = unwrapDutyEnvelope<Record<string, unknown>>(res);
  return {
    success: true,
    pmsOrderId: typeof data?.pmsOrderId === 'string' ? data.pmsOrderId : undefined,
  };
}

/**
 * 本地开发服务器中间件：启动指定渠道的值守
 */
export async function startChannelDutyHttp(channelCode: string): Promise<{ success: boolean; message?: string }> {
  const code = (channelCode || '').trim().toUpperCase();
  const res = await fetch(DUTY_ENDPOINTS.LOCAL_DUTY_START, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelCode: code }),
  });
  if (!res.ok) {
    throw new Error(`启动值守失败 (${res.status})`);
  }
  return res.json() as Promise<{ success: boolean; message?: string }>;
}

/**
 * 本地开发服务器中间件：停止指定渠道的值守
 */
export async function stopChannelDutyHttp(channelCode: string): Promise<{ success: boolean; message?: string }> {
  const code = (channelCode || '').trim().toUpperCase();
  const res = await fetch(DUTY_ENDPOINTS.LOCAL_DUTY_STOP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelCode: code }),
  });
  if (!res.ok) {
    throw new Error(`停止值守失败 (${res.status})`);
  }
  return res.json() as Promise<{ success: boolean; message?: string }>;
}

/**
 * 本地开发服务器中间件：查询当前各渠道值守与协调器状态
 */
export async function fetchDutyStatusHttp(since?: number): Promise<{
  channels: Record<string, ChannelDutyInfo>;
  coordinatorStatus: DutyCoordinatorStatus;
  station?: StationIdentity | null;
  logs?: SystemLogEntry[];
}> {
  const url = since ? `${DUTY_ENDPOINTS.LOCAL_DUTY_STATUS}?since=${since}` : DUTY_ENDPOINTS.LOCAL_DUTY_STATUS;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`获取值守状态失败 (${res.status})`);
  }
  return res.json() as Promise<{
    channels: Record<string, ChannelDutyInfo>;
    coordinatorStatus: DutyCoordinatorStatus;
    station?: StationIdentity | null;
    logs?: SystemLogEntry[];
  }>;
}
