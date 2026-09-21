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
  unitId?: string;
  pmsHotelName: string;
  pmsHotelId: string;
  unitCode?: string;
  unitName?: string;
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

export interface RoomTypeOption {
  id?: string;
  code: string;
  name: string;
  displayLabel: string;
}

export interface RatePlanOption {
  id?: string;
  rateCode: string;
  rateName: string;
  displayLabel: string;
}

export interface ReservationTypeOption {
  id?: string;
  code: string;
  label: string;
  displayLabel: string;
}

export interface ProductMapping {
  id?: string;
  mappingId?: string;
  channelCode: string;
  extUnitCode: string;
  unitId: string;
  unitType: string;
  otaChannelId?: string;
  otaChannelCode?: string;
  hotelId?: string;
  hotelName?: string;
  // OTA 字段
  otaRoomTypeId: string;
  otaRoomTypeName: string;
  otaBasicRoomId?: string;
  otaBasicRoomName?: string;
  otaRateCodeId?: string;
  otaPayType?: string;
  // 视图兼容字段
  otaProductName?: string;
  otaProductCode?: string;
  otaPhysicalRoomName?: string;
  otaPhysicalRoomCode?: string;
  // 内部映射字段 (允许为空字符串)
  roomType: string;
  rateCode: string;
  payType: string;
  internalRoomType?: string;
  bookingType?: string;
  // 状态与来源
  status: 'completed' | 'pending' | 'active' | 'inactive';
  source?: 'remote-platform' | 'ota-collection' | 'merged';
  otaProductPresent?: boolean;
  priceRule?: 'direct' | 'markup_fixed' | 'markup_percent';
  markupValue?: number;
  autoSyncInventory?: boolean;
}

export interface SaveProductMappingPayloadItem {
  id?: string;
  channelCode: string;
  extUnitCode: string;
  unitId: string | number;
  unitType: string;
  otaRoomTypeId: string;
  otaRoomTypeName: string;
  otaBasicRoomId?: string;
  otaBasicRoomName?: string;
  otaRateCodeId?: string;
  otaPayType: string;
  roomType: string;
  rateCode: string;
  payType: string;
  otaProductPresent?: boolean;
  status?: string;
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
  | 'DUTY_TASK'
  | 'SYSTEM'
  | 'API';

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
  | 'CRAWLER_LOG'
  // 任务驱动值守 (Duty Task)
  | 'DUTY_STATION_REGISTER'
  | 'DUTY_ACTUAL_STATE_REPORT'
  | 'DUTY_TASK_CLAIM'
  | 'DUTY_TASK_EXECUTE_START'
  | 'DUTY_TASK_ORDER_IMPORT_SUBMIT'
  | 'DUTY_TASK_ORDER_IMPORT_SUBMIT_FAILED'
  | 'DUTY_TASK_EXECUTE_SUCCESS'
  | 'DUTY_TASK_EXECUTE_FAILED'
  | 'DUTY_TASK_CREATE_DOWNSTREAM'
  | 'DUTY_TASK_RESULT_SUBMIT'
  // 接口请求与网络调用
  | 'API_REQUEST_SUCCESS'
  | 'API_REQUEST_FAILED'
  | 'API_REQUEST_ERROR'
  // 系统内核与异常
  | 'SYS_UNHANDLED_ERROR'
  | 'SYS_UNHANDLED_REJECTION'
  | 'SYS_STORAGE_PURGE'
  | 'SYS_NETWORK_ONLINE'
  | 'SYS_NETWORK_OFFLINE';

export type TaskActionStage =
  | 'claim'
  | 'execute'
  | 'result'
  | 'report'
  | 'order-import-submit'
  | 'downstream-create';

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

  // 任务上下文专有元字段 (Task Metadata)
  taskId?: string;
  msgType?: DutyTaskMessageType | string;
  taskActionStage?: TaskActionStage | string;
  taskStatus?: 'SUCCEEDED' | 'FAILED' | 'PROCESSING' | 'PENDING';
  taskResult?: unknown;

  // 接口请求专有元字段 (API Request & Response Metadata)
  apiUrl?: string;
  apiMethod?: string;
  apiParams?: unknown;   // 请求入参 (URL query / request body)
  apiResponse?: unknown; // 接口返回 (response body / error payload)
  httpStatus?: number;   // HTTP 状态码
}

export interface LogFilterParams {
  level?: 'ALL' | LogLevel;
  module?: 'ALL' | LogModule;
  event?: string;
  channelId?: string;
  orderNo?: string;
  taskId?: string;
  taskActionStage?: 'ALL' | string;
  date?: string;
  startDate?: string;
  endDate?: string;
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
  roomTypes: RoomTypeOption[];
  rateCodes: RatePlanOption[];
  reservationTypes: ReservationTypeOption[];
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
  manualVerificationRequired?: boolean;
  manualVerificationReason?: string;
}

/**
 * Desktop IPC acknowledgement. Operation failures use one stable error field.
 */
export interface DesktopOperationResult {
  success: boolean;
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
 * 机器指纹配置选项 (支持测试与自定义注入)
 */
export interface StationMachineProfileOptions {
  appId?: string;
  agentVersion?: string;
  customHostname?: string;
  customPlatform?: string;
  customRelease?: string;
  customArch?: string;
  customMac?: string;
  customIp?: string;
}

/**
 * 工位注册与识别身份
 */
export interface StationIdentity {
  stationId: string;
  appId: string;
  platformBaseUrl?: string;
  stationName?: string;
  macAddress?: string;
  ip?: string;
  hostname?: string;
  osName?: string;
  agentVersion?: string;
  registeredAt?: number | string;
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
  direction?: 'INBOUND' | 'FORWARD' | 'BACKWARD';
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
  msgId?: string;
  unitId?: string;
  unitType?: string;
  direction?: string;
  createdTime?: string;
  delaySendTime?: number;
}

/**
 * 任务执行状态枚举 (符合文旅中台线缆标准)
 */
export type DutyTaskWireStatus = 'SUCCESS' | 'FAIL';

/**
 * 任务执行结果明细
 */
export interface DutyTaskResultDetail {
  confirmNo?: string;
  businessId: string;
  status: DutyTaskWireStatus;
  ackData?: string; // Base64 encoded JSON
}

/**
 * 任务执行结果提交载荷 (PUT /toolkit/toolbox/tasks/:id/result)
 */
export interface DutyTaskResultPayload {
  station: string;
  leaseToken: string;
  businessType: string; // 固定 'OTA_MIGRATION'
  businessId: string;
  scope: 'INTERFACE';
  status: DutyTaskWireStatus;
  msgId?: string;
  msgType?: string;
  unitId?: string;
  unitType?: string;
  direction?: string;
  createdTime?: string;
  delaySendTime?: number;
  details: DutyTaskResultDetail[];
  errorMessage?: string;
  retryable?: boolean;
  retryDelayMillis?: number;
}

/**
 * 批量创建下游任务载荷 (POST /toolkit/toolbox/tasks)
 */
export interface DutyTaskCreationBatch {
  stationId: string;
  appId: string;
  items: Array<{
    msgType: 'OTA_IMPORT_ORDER' | 'OTA_CANCEL_ORDER';
    businessType?: string; // 固定 'OTA_MIGRATION'
    businessId: string;
    unitId?: string;
    data: string | unknown; // Base64 编码字符串或原始业务对象 (在 API 层转为 Base64)
  }>;
}

/**
 * 文旅中台订单导入联系人结构
 */
export interface ImportOrderContact {
  name: string;
  mobile: string;
}

/**
 * 文旅中台订单导入按日价格明细
 */
export interface ImportOrderPricing {
  date: string; // YYYY-MM-DD
  price: number; // 元
}

/**
 * 文旅中台订单导入预订结构
 */
export interface ImportOrderBooking {
  roomType: string;
  originRoomType?: string;
  rateCode: string;
  arrival: string; // YYYY-MM-DD
  departure: string; // YYYY-MM-DD
  roomTypeId: string;
  nights: number;
  quantity: number;
  totalPrice: number;
  paytype: string;
  pricing: ImportOrderPricing[];
}

/**
 * 文旅中台订单导入订单项
 */
export interface ImportOrder {
  otaOrderId: string;
  otaChannel: string;
  contact: ImportOrderContact;
  booking: ImportOrderBooking;
  remark: string;
}

/**
 * 提交订单导入文旅中台载荷 (POST /toolkit/orders/import)
 */
export interface ImportPayload {
  extUnitCode: string | null;
  orders: ImportOrder[];
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
  CrawlerBridgeApi,
  DutyBridgeApi,
  HostBridgeApi,
  PlatformBridgeRequestOptions,
  PlatformBridgeResponse,
  PlatformBridgeApi,
} from './host';

export type {
  ProtocolFieldCategory,
  ProtocolFieldTransform,
  ProtocolFieldMapping,
  ChannelProtocolSchema,
  CleanOrderContext,
  ProtocolDriftWarning,
  OrderProtocolPricing,
  UnifiedOrderProtocol,
  IChannelOrderProtocol,
} from './template';
