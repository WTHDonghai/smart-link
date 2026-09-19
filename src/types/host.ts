import type { AppEnvSnapshot } from './env';
import type {
  ChannelDutyInfo,
  DutyCoordinatorStatus,
  PlatformAuthTokens,
  StationIdentity,
  SystemLogEntry,
} from './index';
import type { AppUpdateBridgeApi } from './update';
import type { HotelCrawlRequest, HotelCrawlResult, ProfileSyncResult } from '../crawler/types';

export interface CrawlerBridgeApi {
  collectHotels(request: HotelCrawlRequest): Promise<HotelCrawlResult>;
  syncProfile(channelCode?: string): Promise<ProfileSyncResult>;
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
  }>;
  syncTokens(tokens: PlatformAuthTokens): Promise<{ success: boolean; error?: string }>;
  clearTokens(): Promise<{ success: boolean; error?: string }>;
  takePendingLogs(): Promise<SystemLogEntry[]>;
  onLog(callback: (entry: SystemLogEntry) => void): () => void;
}

export interface HostBridgeApi {
  crawler: CrawlerBridgeApi;
  duty: DutyBridgeApi;
  update: AppUpdateBridgeApi;
  env: AppEnvSnapshot;
}

declare global {
  interface Window {
    host?: HostBridgeApi;
  }
}
