import type {
  ChannelDutyInfo,
  DutyCoordinatorStatus,
  StationIdentity,
  SystemLogEntry,
} from '../types';
import {
  startChannelDutyHttp,
  stopChannelDutyHttp,
  fetchDutyStatusHttp,
} from './dutyRuntimeApi';

export interface ElectronDutyApi {
  startDuty(channelCode: string): Promise<{ success: boolean; message?: string }>;
  stopDuty(channelCode: string): Promise<{ success: boolean; message?: string }>;
  getStatus(since?: number): Promise<{
    channels: Record<string, ChannelDutyInfo>;
    coordinatorStatus: DutyCoordinatorStatus;
    station?: StationIdentity | null;
    logs?: SystemLogEntry[];
  }>;
}

interface WindowWithElectronDuty {
  electron?: {
    duty?: ElectronDutyApi;
  };
}

/**
 * 统一渠道值守通信网关 (Unified Duty Bridge)
 * 抹平 Electron 原生 IPC 与 Web/Vite HTTP 差异，上层业务统一通过大写 channelCode 调度
 */
export async function startDutyByChannel(
  channelCode: string
): Promise<{ success: boolean; message?: string }> {
  const code = (channelCode || '').trim().toUpperCase();
  if (!code) {
    throw new Error('值守渠道编码 channelCode 不能为空');
  }

  // 1. 若处于 Electron 桌面原生上下文，优先直走 IPC
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithElectronDuty;
    if (win.electron?.duty?.startDuty) {
      return win.electron.duty.startDuty(code);
    }
  }

  // 2. 默认走本地 HTTP 服务 / 中间件调度 (严格 Fail-Fast，绝不伪造成功)
  return await startChannelDutyHttp(code);
}

/**
 * 停止指定渠道值守
 */
export async function stopDutyByChannel(
  channelCode: string
): Promise<{ success: boolean; message?: string }> {
  const code = (channelCode || '').trim().toUpperCase();
  if (!code) {
    throw new Error('值守渠道编码 channelCode 不能为空');
  }

  // 1. 若处于 Electron 桌面原生上下文，优先直走 IPC
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithElectronDuty;
    if (win.electron?.duty?.stopDuty) {
      return win.electron.duty.stopDuty(code);
    }
  }

  // 2. 默认走本地 HTTP 服务 / 中间件调度 (严格 Fail-Fast，绝不伪造成功)
  return await stopChannelDutyHttp(code);
}

/**
 * 查询当前值守状态
 */
export async function queryDutyStatus(since?: number): Promise<{
  channels: Record<string, ChannelDutyInfo>;
  coordinatorStatus: DutyCoordinatorStatus;
  station?: StationIdentity | null;
  logs?: SystemLogEntry[];
}> {
  // 1. 若处于 Electron 桌面原生上下文，优先直走 IPC
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithElectronDuty;
    if (win.electron?.duty?.getStatus) {
      return win.electron.duty.getStatus(since);
    }
  }

  // 2. 默认走本地 HTTP 服务
  return await fetchDutyStatusHttp(since);
}
