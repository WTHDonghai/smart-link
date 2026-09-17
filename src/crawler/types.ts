export interface HotelCrawlRequest {
  channelId: string;
  channelCode?: string;
  headless?: boolean;
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
  channelId: string;
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
  channelId: string;
  channelCode: string;
  targetUrl: string;
  waitMs: number;
  timeoutMs: number;
  onLog?: (log: CollectorLogPayload) => void;
}
