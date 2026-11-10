import type { AppEnvSnapshot } from './env';
import type {
  AgentCapabilities,
  AgentLogPersistedAck,
  ProductMappingProgressEvent,
  ProductMappingSnapshot,
} from './agent';
import type {
  ChannelDutyInfo,
  DutyCoordinatorStatus,
  PlatformAuthTokens,
  StationIdentity,
  SystemLogEntry,
} from './index';
import type { AppUpdateBridgeApi } from './update';
import type {
  HotelCrawlRequest,
  HotelCrawlResult,
  ProfileSyncResult,
  ProductCrawlRequest,
  ProductCrawlResult,
} from '../crawler/types';

export interface CrawlerBridgeApi {
  collectHotels(request: HotelCrawlRequest): Promise<HotelCrawlResult>;
  collectProducts(request: ProductCrawlRequest): Promise<ProductCrawlResult>;
  syncProfile(channelCode?: string): Promise<ProfileSyncResult>;
  /** 取消指定渠道进行中的采集作业（关闭其浏览器会话，在途操作立即失败收敛） */
  cancelChannelJob(channelCode: string): Promise<{ cancelled: boolean; reason?: string }>;
}

export interface DutyBridgeApi {
  startDuty(channelCode: string): Promise<{ success: boolean; error?: string }>;
  stopDuty(channelCode: string): Promise<{ success: boolean; error?: string }>;
  stopAllDuty(): Promise<{ success: boolean; error?: string }>;
  teardownApp?(): Promise<{ success: boolean; error?: string }>;
  getStatus(since?: number): Promise<{
    channels: Record<string, ChannelDutyInfo>;
    coordinatorStatus: DutyCoordinatorStatus;
    station?: StationIdentity | null;
    logs?: SystemLogEntry[];
    confirmImportEnabled?: boolean;
  }>;
  setConfirmImportEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }>;
  setMeituanBizSplitEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }>;
  syncTokens(tokens: PlatformAuthTokens): Promise<{ success: boolean; error?: string }>;
  clearTokens(): Promise<{ success: boolean; error?: string }>;
  updateTemplateCache(payload: {
    channelCode: string;
    template?: string | null;
  }): Promise<{ success: boolean; error?: string }>;
}

export interface LogBridgeApi {
  takePendingLogs(): Promise<SystemLogEntry[]>;
  onLog(callback: (entry: SystemLogEntry) => void): () => void;
}

export interface AgentBridgeApi {
  /**
   * 渲染进程向主进程回传 Agent 关键追踪事件的 IndexedDB 提交确认。
   * 仅受信任主窗口可确认；主进程收到 committed 前不得放行后续受限动作。
   */
  confirmLogPersisted(ack: AgentLogPersistedAck): Promise<{ accepted: boolean; error?: string }>;

  /** 查询 Agent 能力开关（仅布尔，不携带任何模型配置与密钥） */
  getCapabilities(): Promise<AgentCapabilities>;

  /**
   * 启动一次产品自动映射 run（快照由渲染层采集后构建，主进程结构校验 + 业务校验后执行）。
   * 返回 runId；进度与最终结果经 onProductMappingProgress 推送。
   */
  startProductMapping(snapshot: ProductMappingSnapshot): Promise<{
    accepted: boolean;
    runId?: string;
    error?: string;
  }>;

  /** 取消进行中的映射 run；已完成批次结果保留并回传 */
  cancelProductMappingRun(runId: string): Promise<{ accepted: boolean; error?: string }>;

  /** 订阅映射进度事件（含终态 result）；返回取消订阅函数 */
  onProductMappingProgress(callback: (event: ProductMappingProgressEvent) => void): () => void;
}

export interface PlatformBridgeRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface PlatformBridgeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface PlatformBridgeApi {
  request(options: PlatformBridgeRequestOptions): Promise<PlatformBridgeResponse>;
}

export interface ClipboardBridgeApi {
  writeText(text: string): Promise<boolean>;
  readText(): Promise<string>;
}

export interface HostBridgeApi {
  crawler: CrawlerBridgeApi;
  duty: DutyBridgeApi;
  log?: LogBridgeApi;
  agent: AgentBridgeApi;
  update: AppUpdateBridgeApi;
  env: AppEnvSnapshot;
  platform?: PlatformBridgeApi;
  clipboard?: ClipboardBridgeApi;
}

declare global {
  interface Window {
    host?: HostBridgeApi;
  }
}
