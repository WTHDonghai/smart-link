export type ErrorDomain = 'AUTH' | 'ORDER' | 'CRAWLER' | 'MAPPING' | 'NET' | 'SYS';

export type AppErrorCode =
  // 认证授权域 (AUTH_*)
  | 'AUTH_NET_TIMEOUT'
  | 'AUTH_NET_UNAVAILABLE'
  | 'AUTH_CRED_INVALID'
  | 'AUTH_DEVICE_EXPIRED'
  | 'AUTH_USER_CANCELLED'
  // 订单流转域 (ORDER_*)
  | 'ORDER_MAP_HOTEL_NOT_FOUND'
  | 'ORDER_MAP_ROOM_NOT_FOUND'
  | 'ORDER_VALID_PRICE_MISMATCH'
  | 'ORDER_PMS_PUSH_FAILED'
  // 自动化会话域 (CRAWLER_*)
  | 'CRAWLER_SESS_EXPIRED'
  | 'CRAWLER_CAPTCHA_BLOCKED'
  // 系统与通用网络域 (NET_* / SYS_*)
  | 'NET_OFFLINE'
  | 'NET_REQUEST_TIMEOUT'
  | 'NET_NOT_FOUND'
  | 'NET_BAD_REQUEST'
  | 'NET_FORBIDDEN'
  | 'NET_SERVER_ERROR'
  | 'SYS_CONFIG_MISSING'
  | 'SYS_UNKNOWN_ERROR';

export interface AppErrorDefinition {
  code: AppErrorCode;
  domain: ErrorDomain;
  userTitle: string;
  userMessage: string;
  suggestion: string;
  retryable: boolean;
}

export interface AppError extends AppErrorDefinition {
  rawMessage: string;
  statusCode?: number;
  timestamp: string;
}
