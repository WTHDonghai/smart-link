import type {
  ChannelDutyInfo,
  DutyCoordinatorStatus,
  StationIdentity,
  SystemLogEntry,
  PlatformAuthTokens,
} from '../types';
import { loadTokensFromStorage } from './platformAuth';
import { logger } from './logger';
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

/**
 * 推送商旅分流开关至主进程（用户是否配置 MEITUANBIZ 渠道映射决定）：
 * 关闭时 MEITUAN 值守不做商旅分流过滤，开启时双侧互斥分流
 */
export async function setMeituanBizSplitEnabled(enabled: boolean): Promise<void> {
  const result = await getDutyApi().setMeituanBizSplitEnabled(enabled);
  if (!result.success) {
    throw new Error(result.error || '切换商旅分流开关失败');
  }
}

/**
 * 映射数据变更时向主进程同步商旅分流开关（渐进增强性 best-effort IPC 通知）。
 * 若宿主不支持（非 Electron 环境或旧版 Preload），静默跳过属于预期行为，
 * 不阻断映射拉取/保存主流程——启动值守时的强制同步 (setMeituanBizSplitEnabled)
 * 仍是权威路径，本函数仅缩短映射变更后的开关滞后窗口。
 * 本函数不适用 AGENTS.md §5 Fail-Fast 准则，属渐进增强型设计（对齐 updateTemplateCache 先例）。
 */
export function syncMeituanBizSplitBestEffort(enabled: boolean): void {
  const host = window.host;
  if (typeof host?.duty?.setMeituanBizSplitEnabled !== 'function') {
    return;
  }
  void host.duty
    .setMeituanBizSplitEnabled(enabled)
    .then((result) => {
      if (!result.success) {
        logger.warn(`[商旅分流] 映射变更同步开关失败: ${result.error || '未知错误'}`);
      }
    })
    .catch((err: unknown) => {
      logger.warn(
        `[商旅分流] 映射变更同步开关异常: ${err instanceof Error ? err.message : String(err)}`
      );
    });
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

