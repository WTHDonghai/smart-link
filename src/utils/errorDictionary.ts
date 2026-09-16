import { AppErrorCode, AppErrorDefinition } from '../types/error';

/**
 * 全局统一错误字典 (Master Error Dictionary)
 * 严格遵循 [DOMAIN]_[CATEGORY]_[REASON] 统一命名偏好
 */
export const ERROR_DICTIONARY: Record<AppErrorCode, AppErrorDefinition> = {
  // --- 认证授权域 (AUTH_*) ---
  AUTH_NET_TIMEOUT: {
    code: 'AUTH_NET_TIMEOUT',
    domain: 'AUTH',
    userTitle: '授权服务响应超时',
    userMessage: '文旅平台授权接口响应时间过长，未能及时完成鉴权确认。',
    suggestion: '请检查本地网络连接，或稍后点击重试。',
    retryable: true,
  },
  AUTH_NET_UNAVAILABLE: {
    code: 'AUTH_NET_UNAVAILABLE',
    domain: 'AUTH',
    userTitle: '授权服务暂时不可用',
    userMessage: '文旅平台服务正在维护或网关连接繁忙 (HTTP 502/503)。',
    suggestion: '请联系技术管理员确认平台服务状态后重试。',
    retryable: true,
  },
  AUTH_CRED_INVALID: {
    code: 'AUTH_CRED_INVALID',
    domain: 'AUTH',
    userTitle: '登录凭据已失效',
    userMessage: '系统与文旅平台的授权会话已过期，需要重新登录。',
    suggestion: '请点击“授权登录”按钮重新建立会话连接。',
    retryable: false,
  },
  AUTH_DEVICE_EXPIRED: {
    code: 'AUTH_DEVICE_EXPIRED',
    domain: 'AUTH',
    userTitle: '授权等待超时',
    userMessage: '未在有效时间内在浏览器中确认授权，本次授权码已失效。',
    suggestion: '请重新点击授权登录发起新流程。',
    retryable: true,
  },
  AUTH_USER_CANCELLED: {
    code: 'AUTH_USER_CANCELLED',
    domain: 'AUTH',
    userTitle: '授权已取消',
    userMessage: '已主动取消本次文旅平台授权流程。',
    suggestion: '如需使用平台订单与房态同步，请重新点击授权登录。',
    retryable: true,
  },

  // --- 订单流水线域 (ORDER_*) ---
  ORDER_MAP_HOTEL_NOT_FOUND: {
    code: 'ORDER_MAP_HOTEL_NOT_FOUND',
    domain: 'ORDER',
    userTitle: '酒店映射未建立',
    userMessage: '未能识别该渠道订单对应的西软 PMS 酒店标识。',
    suggestion: '请前往【酒店映射】面板建立对应关系后再进行重推。',
    retryable: false,
  },
  ORDER_MAP_ROOM_NOT_FOUND: {
    code: 'ORDER_MAP_ROOM_NOT_FOUND',
    domain: 'ORDER',
    userTitle: '预订房型未匹配',
    userMessage: '渠道推送的房型名称或价格码未配置 PMS 对应关系。',
    suggestion: '请前往【房型映射】面板补全该房型的映射配置后手动重推。',
    retryable: false,
  },
  ORDER_VALID_PRICE_MISMATCH: {
    code: 'ORDER_VALID_PRICE_MISMATCH',
    domain: 'ORDER',
    userTitle: '价格校验异常',
    userMessage: '订单金额与系统计算底价存在偏差或倒挂风险。',
    suggestion: '请核实渠道结算价格规则，或转入人工审核确认。',
    retryable: false,
  },
  ORDER_PMS_PUSH_FAILED: {
    code: 'ORDER_PMS_PUSH_FAILED',
    domain: 'ORDER',
    userTitle: 'PMS 直连入账失败',
    userMessage: '推送至 PMS 业务系统时被拒绝或网络传输中断。',
    suggestion: '请检查 PMS 服务状态，稍后可在列表中点击手动重推。',
    retryable: true,
  },

  // --- 自动化会话域 (CRAWLER_*) ---
  CRAWLER_SESS_EXPIRED: {
    code: 'CRAWLER_SESS_EXPIRED',
    domain: 'CRAWLER',
    userTitle: '渠道后台登录已失效',
    userMessage: '检测到对应 OTA 商家后台的登录 Cookie 或会话凭证已过期。',
    suggestion: '请在【渠道接入】页面重新扫码登录或接管会话。',
    retryable: false,
  },
  CRAWLER_CAPTCHA_BLOCKED: {
    code: 'CRAWLER_CAPTCHA_BLOCKED',
    domain: 'CRAWLER',
    userTitle: '触发人机安全拦截',
    userMessage: '渠道后台触发了滑块验证码或短信验证机制，自动化已暂停。',
    suggestion: '请通过桌面浏览器窗口手动完成人机验证后继续。',
    retryable: false,
  },

  // --- 系统与通用网络域 (NET_* / SYS_*) ---
  NET_OFFLINE: {
    code: 'NET_OFFLINE',
    domain: 'NET',
    userTitle: '网络连接断开',
    userMessage: '无法连接外部互联网，请检查本地网络配置。',
    suggestion: '请检查网线插头或无线网络连接状态。',
    retryable: true,
  },
  NET_REQUEST_TIMEOUT: {
    code: 'NET_REQUEST_TIMEOUT',
    domain: 'NET',
    userTitle: '网络请求超时',
    userMessage: '网络通信超时，目标服务未在预期时间内完成响应。',
    suggestion: '请检查本地网络状况并稍后重试。',
    retryable: true,
  },
  SYS_CONFIG_MISSING: {
    code: 'SYS_CONFIG_MISSING',
    domain: 'SYS',
    userTitle: '系统配置缺失',
    userMessage: '缺少必要的系统环境变量或基础网关参数。',
    suggestion: '请联系技术运维人员检查应用环境变量配置。',
    retryable: false,
  },
  SYS_UNKNOWN_ERROR: {
    code: 'SYS_UNKNOWN_ERROR',
    domain: 'SYS',
    userTitle: '发生未预期的异常',
    userMessage: '系统在执行当前操作时遇到未知错误。',
    suggestion: '请稍后重试；若持续发生，请展开复制排查日志并反馈给技术支持。',
    retryable: true,
  },
};
