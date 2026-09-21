import type {
  ChannelDutyInfo,
  DutyCoordinatorStatus,
  StationIdentity,
  SystemLogEntry,
  PlatformAuthTokens,
} from '../types';
import { loadTokensFromStorage } from './platformAuth';
import type { DutyBridgeApi } from '../types';

function getDutyApi(): DutyBridgeApi {
  const host = window.host;
  if (!host?.duty) {
    throw new Error('值守调度仅支持桌面端');
  }

  return host.duty;
}

export async function syncDutyTokens(tokens: PlatformAuthTokens): Promise<void> {
  const result = await getDutyApi().syncTokens(tokens);
  if (!result.success) {
    throw new Error(result.error || '同步平台凭证失败');
  }
}

export async function clearDutyTokens(): Promise<void> {
  const result = await getDutyApi().clearTokens();
  if (!result.success) {
    throw new Error(result.error || '清除平台凭证失败');
  }
}

export async function startDutyByChannel(
  channelCode: string
): Promise<void> {
  const code = channelCode.trim().toUpperCase();
  if (!code) {
    throw new Error('值守渠道编码 channelCode 不能为空');
  }

  const currentTokens = loadTokensFromStorage();
  if (currentTokens?.accessToken) {
    await syncDutyTokens(currentTokens);
  }

  const result = await getDutyApi().startDuty(code);
  if (!result.success) {
    throw new Error(result.error || `启动「${code}」渠道值守失败`);
  }
}

export async function stopDutyByChannel(
  channelCode: string
): Promise<void> {
  const code = channelCode.trim().toUpperCase();
  if (!code) {
    throw new Error('值守渠道编码 channelCode 不能为空');
  }

  const result = await getDutyApi().stopDuty(code);
  if (!result.success) {
    throw new Error(result.error || `停止「${code}」渠道值守失败`);
  }
}

export async function stopAllDuty(): Promise<void> {
  const result = await getDutyApi().stopAllDuty();
  if (!result.success) {
    throw new Error(result.error || '停止全部值守任务失败');
  }
}

export async function setConfirmImportEnabled(enabled: boolean): Promise<void> {
  const result = await getDutyApi().setConfirmImportEnabled(enabled);
  if (!result.success) {
    throw new Error(result.error || '切换确认号回填开关失败');
  }
}

export async function queryDutyStatus(since?: number): Promise<{
  channels: Record<string, ChannelDutyInfo>;
  coordinatorStatus: DutyCoordinatorStatus;
  station?: StationIdentity | null;
  logs?: SystemLogEntry[];
  confirmImportEnabled?: boolean;
}> {
  return getDutyApi().getStatus(since);
}

export function subscribeDutyLogs(callback: (entry: SystemLogEntry) => void): () => void {
  return getDutyApi().onLog(callback);
}

export function takePendingMainLogs(): Promise<SystemLogEntry[]> {
  return getDutyApi().takePendingLogs();
}
