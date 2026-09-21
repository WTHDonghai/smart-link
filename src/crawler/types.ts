export interface HotelCrawlRequest {
  channelCode: string; // 必须大写，如 'MEITUAN', 'MEITUAN_BIZ'
  targetUrl?: string; // 可选指定目标 URL，未传递时默认从统一配置/环境变量解析
  headless?: boolean;
  waitSeconds?: number; // 采集等待时长 (单位: 秒，推荐，便于精准防风控)
  timeoutSeconds?: number; // 整体操作超时 (单位: 秒)
  timeoutMs?: number;
  waitMs?: number;
}

export interface DiscoveredHotelCandidate {
  otaChannelId: string;
  otaChannelCode: string;
  otaHotelId: string; // 唯一门店 ID (如美团 poiId, 抖音 lifeAccountId)
  otaHotelName: string;
  city?: string;
  starRating?: string;
  partnerId?: string; // 供应商/主账号 ID (如美团 partnerId)
  roomCount?: number;
  source: string;
  raw?: Record<string, unknown>;
}

export interface HotelCrawlDiagnostics {
  targetUrl: string;
  source: string;
  scannedCount: number;
  discoveredCount: number;
  verifiedEmpty: boolean;
  durationMs: number;
  warnings: string[];
}

export interface HotelCrawlResult {
  success: boolean;
  channelCode: string;
  hotels: DiscoveredHotelCandidate[];
  diagnostics: HotelCrawlDiagnostics;
  error?: string;
}

export interface CollectorLogPayload {
  level: 'PLAYWRIGHT' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
  details?: string;
}

export interface CollectorOptions {
  channelCode: string;
  targetUrl: string;
  waitSeconds?: number;
  timeoutSeconds?: number;
  waitMs?: number;
  timeoutMs?: number;
  onLog?: (log: CollectorLogPayload) => void;
}

export interface ProfileSyncResult {
  success: boolean;
  sourceDir: string;
  sourceProfile: string;
  targetDir: string;
  message?: string;
  error?: string;
}

export interface ProductCrawlRequest {
  channelCode: string;
  pmsChannelCode?: string;
  extUnitCode: string;
  otaHotelName?: string;
  poiId?: string;
  partnerId?: string;
  targetUrl?: string;
  headless?: boolean;
  waitSeconds?: number; // 采集等待时长 (单位: 秒，推荐，确保接口调用完毕并规避风控)
  timeoutSeconds?: number; // 整体操作超时 (单位: 秒)
  timeoutMs?: number;
  waitMs?: number;
}

/**
 * 统一将秒/毫秒等待参数解析为毫秒 (默认 3 秒)
 */
export function resolveWaitMs(
  req?: { waitSeconds?: number; waitMs?: number },
  defaultSeconds = 3
): number {
  if (typeof req?.waitSeconds === 'number' && Number.isFinite(req.waitSeconds) && req.waitSeconds > 0) {
    return Math.round(req.waitSeconds * 1000);
  }
  if (typeof req?.waitMs === 'number' && Number.isFinite(req.waitMs) && req.waitMs > 0) {
    return req.waitMs;
  }
  return defaultSeconds * 1000;
}

/**
 * 统一将秒/毫秒等待参数解析为秒 (默认 3 秒)
 */
export function resolveWaitSeconds(
  req?: { waitSeconds?: number; waitMs?: number },
  defaultSeconds = 3
): number {
  if (typeof req?.waitSeconds === 'number' && Number.isFinite(req.waitSeconds) && req.waitSeconds > 0) {
    return req.waitSeconds;
  }
  if (typeof req?.waitMs === 'number' && Number.isFinite(req.waitMs) && req.waitMs > 0) {
    return req.waitMs >= 1000 ? Math.round(req.waitMs / 1000) : req.waitMs;
  }
  return defaultSeconds;
}

/**
 * 统一将整体超时参数解析为毫秒 (默认 30 秒)
 */
export function resolveTimeoutMs(
  req?: { timeoutSeconds?: number; timeoutMs?: number },
  defaultSeconds = 30
): number {
  if (typeof req?.timeoutSeconds === 'number' && Number.isFinite(req.timeoutSeconds) && req.timeoutSeconds > 0) {
    return Math.round(req.timeoutSeconds * 1000);
  }
  if (typeof req?.timeoutMs === 'number' && Number.isFinite(req.timeoutMs) && req.timeoutMs > 0) {
    return req.timeoutMs;
  }
  return defaultSeconds * 1000;
}


export interface DiscoveredProductCandidate {
  otaChannelCode: string;
  extUnitCode: string;
  otaRoomTypeId: string;
  otaRoomTypeName: string;
  otaBasicRoomId?: string;
  otaBasicRoomName?: string;
  otaRateCodeId?: string;
  otaPayType?: string;
  source: string;
  raw?: Record<string, unknown>;
}

export interface ProductCrawlResult {
  success: boolean;
  channelCode: string;
  extUnitCode: string;
  products: DiscoveredProductCandidate[];
  error?: string;
}

