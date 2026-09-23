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

/**
 * 跨进程更新/失效主进程值守备注模板内存缓存
 * 若宿主不支持（非 Electron 环境或测试桩环境）安全降级
 */
export async function updateDutyTemplateCache(payload: {
  channelCode: string;
  template?: string | null;
}): Promise<void> {
  const code = payload?.channelCode?.trim();
  if (!code) {
    throw new Error('渠道编码 channelCode 不能为空');
  }

  const host = window.host;
  // 【渐进增强性 best-effort IPC 通知】
  // 此调用用于在模板保存成功后，顺带通知主进程使内存缓存失效，以便下次接单时拿到最新模板。
  // 若宿主不支持此 API（如旧版 Preload 或非 Electron 测试环境），静默跳过属于预期行为，
  // 不影响核心接单流程（主进程仍可在缓存过期后自动从服务端拉取最新模板）。
  // 此函数不适用 AGENTS.md §5 Fail-Fast 准则，属于渐进增强型设计。
  if (!host?.duty?.updateTemplateCache) {
    return;
  }

  const result = await host.duty.updateTemplateCache({
    ...payload,
    channelCode: code.toUpperCase(),
  });
  if (!result.success) {
    throw new Error(result.error || '更新值守备注模板缓存失败');
  }
}

