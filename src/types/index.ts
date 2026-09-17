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
  unitId?: string;
  otaChannel?: string;
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

/**
 * 工位注册请求体 (POST /toolkit/toolbox/station/register)
 */
export interface StationRegistration {
  macAddress: string;
  hostname: string;
  ip: string;
  appId: string;
  osName?: string;
  agentVersion?: string;
}

/**
 * 工位注册成功回执
 */
export interface StationIdentity {
  stationId: string;
  appId: string;
  stationName?: string;
  macAddress?: string;
  ip?: string;
  hostname?: string;
  registeredAt?: number;
}

/**
 * 文旅中台任务消息类型
 */
export type DutyTaskMessageType =
  | 'OTA_COLLECT_ORDER'
  | 'OTA_IMPORT_ORDER'
  | 'OTA_CANCEL_ORDER'
  | 'OTA_CONFIRM_IMPORT'
  | 'OTA_CONFIRM_CANCEL';

/**
 * 任务领取长轮询请求体 (POST /toolkit/toolbox/task-claims)
 */
export interface DutyTaskClaimRequest {
  stationId: string;
  appId: string;
  direction?: 'FORWARD' | 'BACKWARD';
}

/**
 * 领取到的中台任务实体
 */
export interface DutyClaimedTask {
  id: string;
  businessId: string;
  businessType: string;
  msgType: DutyTaskMessageType;
  stationId: string;
  leaseToken: string;
  data: string; // Base64 encoded JSON
  createdTime?: string;
}

/**
 * 任务执行结果提交载荷 (PUT /toolkit/toolbox/tasks/:id/result)
 */
export interface DutyTaskResultPayload {
  taskId: string;
  status: 'SUCCEEDED' | 'FAILED';
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * 批量创建下游任务载荷 (POST /toolkit/toolbox/tasks)
 */
export interface DutyTaskCreationBatch {
  stationId: string;
  appId: string;
  items: Array<{
    msgType: 'OTA_IMPORT_ORDER' | 'OTA_CANCEL_ORDER';
    businessId: string;
    unitId?: string;
    data: unknown;
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


