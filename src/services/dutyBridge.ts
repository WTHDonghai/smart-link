import type {
  ChannelDutyInfo,
  DutyCoordinatorStatus,
  StationIdentity,
  SystemLogEntry,
  PlatformAuthTokens,
} from '../types';
import {
  startChannelDutyHttp,
  stopChannelDutyHttp,
  fetchDutyStatusHttp,
  syncDutyTokensHttp,
  clearDutyTokensHttp,
} from './dutyRuntimeApi';
import { loadTokensFromStorage } from './platformAuth';

export interface ElectronDutyApi {
  startDuty(channelCode: string): Promise<{ success: boolean; message?: string }>;
  stopDuty(channelCode: string): Promise<{ success: boolean; message?: string }>;
  getStatus(since?: number): Promise<{
    channels: Record<string, ChannelDutyInfo>;
    coordinatorStatus: DutyCoordinatorStatus;
    station?: StationIdentity | null;
    logs?: SystemLogEntry[];
  }>;
  syncTokens?(tokens: PlatformAuthTokens): Promise<{ success: boolean; message?: string }>;
  clearTokens?(): Promise<{ success: boolean; message?: string }>;
}

interface WindowWithElectronDuty {
  electron?: {
    duty?: ElectronDutyApi;
  };
}

/**
 * 同步平台 Token 凭据至后台 Node/Electron 宿主环境
 */
export async function syncDutyTokens(
  tokens: PlatformAuthTokens
): Promise<{ success: boolean; message?: string }> {
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithElectronDuty;
    if (win.electron?.duty?.syncTokens) {
      return win.electron.duty.syncTokens(tokens);
    }
  }
  return await syncDutyTokensHttp(tokens);
}

/**
 * 清除后台 Node/Electron 宿主环境中的平台 Token 凭据
 */
export async function clearDutyTokens(): Promise<{ success: boolean; message?: string }> {
  if (typeof window !== 'undefined') {
    const win = window as unknown as WindowWithElectronDuty;
    if (win.electron?.duty?.clearTokens) {
      return win.electron.duty.clearTokens();
    }
  }
  return await clearDutyTokensHttp();
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

  // 先行动步：若当前前端持有有效 Token，先行自动向后台同步，避免 Node 环境因存储隔离缺失凭证
  const currentTokens = loadTokensFromStorage();
  if (currentTokens && currentTokens.accessToken) {
    try {
      await syncDutyTokens(currentTokens);
    } catch {
      // 容错继续，不阻断主流程
    }
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
