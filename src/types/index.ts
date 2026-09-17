import type { ChannelProtocolSchema } from './template';

export type NavTab = 
  | 'channel-mapping' 
  | 'hotel-sync' 
  | 'product-mapping' 
  | 'order-guardian' 
  | 'system-logs';

export interface CulturalTourismChannel {
  id: string;
  channelId: string;
  channelCode: string;
  channelName: string;
  status: string;
  otaChannelCode?: string;
}

export interface OTAChannelMappingRecord {
  id: string;
  mappingId: string;
  otaChannelCode: string;
  otaChannelName: string;
  channelId: string;
  channelCode: string;
  channelName: string;
  status: string;
}

export interface SaveChannelMappingPayloadItem {
  otaChannelCode: string;
  otaChannelName?: string;
  channelCode: string;
  channelId: string;
  status?: string;
}

export interface OTAChannel {
  id: string;
  name: string;
  code: string;
  short: string;
  bgColor: string;
  textColor: string;
  targetSystem: string;
  targetSystemOptions?: { val: string; label: string }[];
  remarkTemplate: string;
  status: 'active' | 'warning' | 'paused';
  crawlerStatus: 'online' | 'refreshing' | 'offline';
  todayOrders: number;
  lastSyncTime: string;
  channelId?: string;
  channelCode?: string;
  channelName?: string;
  mappingId?: string;
  isMapped?: boolean;
  protocolSchema?: ChannelProtocolSchema;
}

export interface HotelMapping {
  id: string;
  otaChannelId: string;
  otaHotelName: string;
  otaHotelId: string;
  pmsHotelName: string;
  pmsHotelId: string;
  city: string;
  starRating: string;
  status: 'mapped' | 'pending' | 'error';
  lastScraped: string;
  roomCount: number;
}

export interface ProductMapping {
  id: string;
  hotelId: string;
  hotelName: string;
  otaChannelId: string;
  otaProductName: string;
  otaProductCode: string;
  otaPhysicalRoomName: string;
  otaPhysicalRoomCode: string;
  internalRoomType: string;
  rateCode: string;
  bookingType: string;
  status: 'completed' | 'pending' | 'active' | 'inactive';
  priceRule?: 'direct' | 'markup_fixed' | 'markup_percent';
  markupValue?: number;
  autoSyncInventory?: boolean;
}

export type OrderStatus = 'transferred' | 'processing' | 'confirmed' | 'failed' | 'manual_review' | 'pending' | 'success' | 'cancelled' | 'importing';

export interface GuardianOrder {
  id: string;
  otaOrderNo: string;
  pmsOrderNo: string;
  channelId: string;
  channelName: string;
  hotelName: string;
  roomTypeName: string;
  ratePlanCode?: string;
  guestName: string;
  guestPhone: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  rooms: number;
  otaPrice: number;
  pmsCostPrice: number;
  profit: number;
  status: OrderStatus;
  failureReason?: string;
  bookingType?: string;
  travelRoomType?: string;
  dailyPrices?: { date: string; price: number }[];
  remark: string;
  scrapedAt: string;
  transferredAt: string;
  crawlerDurationMs: number;
}

export type LogLevel = 'PLAYWRIGHT' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export type LogModule =
  | 'AUTH'
  | 'ORDER'
  | 'HOTEL'
  | 'PRODUCT'
  | 'CHANNEL'
  | 'PLAYWRIGHT'
  | 'SYSTEM';

export type LogEventType =
  // 平台认证
  | 'AUTH_LOGIN_START'
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_TOKEN_REFRESH'
  | 'AUTH_LOGOUT'
  // 订单守护与分发
  | 'ORDER_POLL_START'
  | 'ORDER_POLL_SUCCESS'
  | 'ORDER_TRANSFER_PMS_SUCCESS'
  | 'ORDER_TRANSFER_PMS_FAILED'
  | 'ORDER_BATCH_RETRY'
  | 'ORDER_MANUAL_UPDATE'
  // 渠道映射
  | 'CHANNEL_MAPPING_SAVE'
  | 'CHANNEL_PROTOCOL_UPDATE'
  | 'CHANNEL_TEMPLATE_UPDATE'
  | 'CHANNEL_RESET_DEFAULT'
  // 房型与价格同步
  | 'HOTEL_SYNC_START'
  | 'HOTEL_SYNC_SUCCESS'
  | 'HOTEL_SYNC_FAILED'
  | 'PRODUCT_MAPPING_MATCH'
  | 'PRODUCT_PRICE_PUSH'
  // Playwright 自动化引擎
  | 'PLAYWRIGHT_WORKER_START'
  | 'PLAYWRIGHT_PAGE_NAVIGATE'
  | 'PLAYWRIGHT_CAPTCHA_DETECTED'
  | 'PLAYWRIGHT_CAPTCHA_SOLVED'
  | 'PLAYWRIGHT_HEARTBEAT'
  // 系统内核与异常
  | 'SYS_UNHANDLED_ERROR'
  | 'SYS_UNHANDLED_REJECTION'
  | 'SYS_STORAGE_PURGE'
  | 'SYS_NETWORK_ONLINE'
  | 'SYS_NETWORK_OFFLINE';

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  createdAt: number;
  level: LogLevel;
  module?: LogModule;
  event?: LogEventType | string;
  channelId?: string;
  orderNo?: string;
  durationMs?: number;
  message: string;
  details?: string;
  meta?: Record<string, unknown>;
}

export interface LogFilterParams {
  level?: 'ALL' | LogLevel;
  module?: 'ALL' | LogModule;
  event?: string;
  channelId?: string;
  orderNo?: string;
  timeRange?: 'ALL' | '1D' | '3D' | '7D';
  onlyErrors?: boolean;
  search?: string;
}

export interface GuardianStats {
  todayImported: number;
  pendingConfirm: number;
  imported: number;
  failed: number;
  todayTotal?: number;
  todaySuccess?: number;
  todayFailed?: number;
  pendingManual?: number;
  avgTransferSeconds?: number;
}

export interface PlatformAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  platformBaseUrl: string;
  tenantId: string;
  authenticatedAt: string;
  updatedAt: string;
}

export interface PlatformTokenState {
  fresh: boolean;
  usable: boolean;
  expiresAt: number;
  expiresInMs: number;
  refreshAt: number;
  refreshInMs: number;
}

export interface PlatformDeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  expiresAt: number;
}

export type PlatformAuthStatus =
  | 'unconfigured'
  | 'login-required'
  | 'authorizing'
  | 'authorized';

export type {
  ErrorDomain,
  AppErrorCode,
  AppErrorDefinition,
  AppError,
} from './error';

export type {
  ProtocolFieldCategory,
  ProtocolFieldTransform,
  ProtocolFieldMapping,
  ChannelProtocolSchema,
  CleanOrderContext,
  ProtocolDriftWarning,
} from './template';


