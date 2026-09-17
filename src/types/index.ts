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

export interface ChannelMeta {
  name: string;
  short: string;
  bgColor: string;
  textColor: string;
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

export interface PlatformProperty {
  id: string;
  name: string;
  code?: string;
  type?: string;
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

/**
 * 文旅中台订单处理状态
 */
export type ToolkitOrderStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCEL' | 'IMPORTING';

/**
 * 订单允许执行的人工操作类型
 */
export type ToolkitOrderAction = 'EDIT' | 'IMPORT' | 'DELETE' | 'CANCEL';

/**
 * 每日价格明细项
 */
export interface NightlyPricing {
  date: string;
  price: number;
}

/**
 * 文旅中台标准订单实体契约
 */
export interface ToolkitOrder {
  id: string;
  unitId: string;
  unitName: string;
  otaChannel: string;
  otaOrderId: string;
  contact: {
    name: string;
    mobile: string;
  };
  booking: {
    arrival: string;
    departure: string;
    roomType: string;
    roomTypeId?: string;
    rateCode: string;
    paytype: string;
    nights: number;
    quantity: number;
    totalPrice: number;
    pricing: NightlyPricing[];
  };
  status: ToolkitOrderStatus;
  errorMessage?: string;
  pmsOrderId?: string;
  remark?: string;
  updatedAt?: string;
  allowedActions: ToolkitOrderAction[];
}

/**
 * 文旅中台订单 4 项核心统计指标
 */
export interface ToolkitOrderStatistics {
  today: number;
  pending: number;
  success: number;
  failed: number;
}

/**
 * 文旅订单查询参数
 */
export interface ToolkitOrderFilters {
  page: number;
  pageSize: number;
  status: string;
  query: string;
  arrivalStart: string;
  arrivalEnd: string;
}

/**
 * 订单分页查询响应
 */
export interface ToolkitOrderPageResult {
  records: ToolkitOrder[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * 酒店内部产品选项目录 (用于订单编辑绑定)
 */
export interface InternalProductOptions {
  roomTypes: Array<{ code: string; name: string }>;
  rateCodes: Array<{ rateCode: string; name: string }>;
  reservationTypes: Array<{ code: string; name: string }>;
}

/**
 * 订单编辑草稿载荷
 */
export interface ToolkitOrderDraft {
  otaOrderId: string;
  contact: {
    name: string;
    mobile: string;
  };
  booking: {
    roomType: string;
    roomTypeId: string;
    rateCode: string;
    paytype: string;
    arrival: string;
    departure: string;
    quantity: number;
    pricing: NightlyPricing[];
  };
  remark?: string;
}

/**
 * 渠道自动化值守单渠道运行状态
 */
export type ChannelDutyStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'DEGRADED';

/**
 * 全局任务协调器运行状态
 */
export type DutyCoordinatorStatus =
  | 'STOPPED'
  | 'IDLE'
  | 'CLAIMING'
  | 'EXECUTING'
  | 'REPORTING'
  | 'CLAIM_BACKOFF'
  | 'DEGRADED';

/**
 * 单渠道值守状态实体
 */
export interface ChannelDutyInfo {
  channelCode: string;
  status: ChannelDutyStatus;
  lastStartedAt?: number;
  error?: string;
}

/**
 * 实际状态上报载荷 (POST /toolkit/toolbox/actual-state/report)
 */
export interface ActualStateReportPayload {
  stationId: string;
  apps: Array<{
    appId: string;
    actualVersion: string;
    status: 'RUNNING' | 'STOP';
    lastStartedAt: number;
    reportedAt: number;
    otaCollectionTargets: Array<{ otaChannelCode: string }>;
  }>;
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


