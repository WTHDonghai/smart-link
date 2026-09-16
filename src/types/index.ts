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
  storeCrawlUrl?: string;
}

export interface HotelMapping {
  id: string;
  mappingId?: string;
  otaChannelId: string;
  otaChannelCode?: string;
  otaHotelName: string;
  otaHotelId: string;
  extUnitCode?: string;
  pmsHotelName: string;
  pmsHotelId: string;
  unitCode?: string;
  unitType?: string;
  city?: string;
  starRating?: string;
  status: 'mapped' | 'pending' | 'error';
  lastScraped?: string;
  roomCount?: number;
  partnerId?: string;
  source?: string;
  failureReason?: string;
}

export interface SaveHotelMappingPayloadItem {
  otaChannelCode: string;
  extUnitCode: string;
  otaHotelName: string;
  unitId?: string | number;
  unitType?: string;
}

export interface RemoteHotelMappingRecord {
  id?: string | number;
  mappingId?: string | number;
  otaHotelMappingId?: string | number;
  otaChannelCode: string;
  extUnitCode?: string;
  otaHotelCode?: string;
  otaHotelName: string;
  unitId?: string | number;
  unitCode?: string;
  unitName?: string;
  unitType?: string;
  status?: string;
  partnerId?: string;
  city?: string;
  starRating?: string;
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

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: 'PLAYWRIGHT' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  channelId?: string;
  message: string;
  details?: string;
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


