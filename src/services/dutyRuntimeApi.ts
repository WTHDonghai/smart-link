import { requestPlatformApi, TOOLKIT_MODULE } from './platformApi';
import type { ActualStateReportPayload, ChannelDutyInfo, DutyCoordinatorStatus } from '../types';

export const DUTY_ENDPOINTS = {
  ACTUAL_STATE_REPORT: `/${TOOLKIT_MODULE}/toolbox/actual-state/report`,
  LOCAL_DUTY_START: '/api/duty/start',
  LOCAL_DUTY_STOP: '/api/duty/stop',
  LOCAL_DUTY_STATUS: '/api/duty/status',
} as const;

/**
 * 上报订单值守实际状态至文旅中台 (POST /toolkit/toolbox/actual-state/report)
 */
export async function reportDutyActualState(payload: ActualStateReportPayload): Promise<void> {
  await requestPlatformApi<void>(DUTY_ENDPOINTS.ACTUAL_STATE_REPORT, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
export async function fetchDutyStatusHttp(): Promise<{
  channels: Record<string, ChannelDutyInfo>;
  coordinatorStatus: DutyCoordinatorStatus;
}> {
  const res = await fetch(DUTY_ENDPOINTS.LOCAL_DUTY_STATUS);
  if (!res.ok) {
    throw new Error(`获取值守状态失败 (${res.status})`);
  }
  return res.json() as Promise<{
    channels: Record<string, ChannelDutyInfo>;
    coordinatorStatus: DutyCoordinatorStatus;
  }>;
}
