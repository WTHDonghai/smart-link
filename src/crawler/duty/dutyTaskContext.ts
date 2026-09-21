import type { DutyClaimedTask } from '../../types';

/**
 * 统一解析后的值守任务上下文数据模型
 */
export interface ParsedDutyTaskContext {
  task: DutyClaimedTask;
  payload: Record<string, unknown>;
  channelCode: string;
  orderNo?: string;
  businessId: string;
}

/**
 * 风控特征识别正则
 * 统一收敛美团及各渠道后台的安全验证、登录验证、滑块验证码、人机识别、频繁访问与 yoda/captcha 拦截
 */
export const RISK_CONTROL_PATTERN =
  /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|yoda|captcha|RISK_VERIFICATION_REQUIRED/i;

/**
 * 统一风控特征异常识别纯函数
 * 严禁 any，支持 Error 实例、字符串及包含错误码/错误信息的对象校验
 */
export function isRiskControlError(err: unknown): boolean {
  if (err === null || err === undefined) {
    return false;
  }
  if (typeof err === 'string') {
    return RISK_CONTROL_PATTERN.test(err);
  }
  if (err instanceof Error) {
    if (RISK_CONTROL_PATTERN.test(err.message)) return true;
    if (RISK_CONTROL_PATTERN.test(err.name)) return true;
  }
  if (typeof err === 'object') {
    const candidate = err as Record<string, unknown>;
    if (typeof candidate.message === 'string' && RISK_CONTROL_PATTERN.test(candidate.message)) {
      return true;
    }
    if (typeof candidate.errorMessage === 'string' && RISK_CONTROL_PATTERN.test(candidate.errorMessage)) {
      return true;
    }
    if (typeof candidate.errorCode === 'string' && RISK_CONTROL_PATTERN.test(candidate.errorCode)) {
      return true;
    }
    if (typeof candidate.code === 'string' && RISK_CONTROL_PATTERN.test(candidate.code)) {
      return true;
    }
    if (typeof candidate.details === 'string' && RISK_CONTROL_PATTERN.test(candidate.details)) {
      return true;
    }
  }
  return false;
}

/**
 * 从任务载荷提取目标渠道代号（大写纯字符串，默认收敛为 MEITUAN）
 */
export function extractTaskChannelCode(task: DutyClaimedTask, payload: Record<string, unknown>): string {
  const sanitize = (val: unknown): string | undefined => {
    if (val === null || val === undefined) return undefined;
    const str = String(val).trim().toUpperCase();
    return str.length > 0 ? str : undefined;
  };

  if (task.msgType === 'OTA_COLLECT_ORDER') {
    const otaChan = sanitize(payload.otaChannelCode);
    if (otaChan) return otaChan;
  } else if (task.msgType === 'OTA_CONFIRM_IMPORT' || task.msgType === 'OTA_CONFIRM_CANCEL') {
    const chan = sanitize(payload.channelCode);
    if (chan) return chan;
  } else if (task.msgType === 'OTA_IMPORT_ORDER') {
    const chan = sanitize(payload.channel);
    if (chan) return chan;
    const otaChan = sanitize(payload.otaChannelCode);
    if (otaChan) return otaChan;
    if (
      Array.isArray(payload.orders) &&
      payload.orders[0] &&
      typeof payload.orders[0] === 'object' &&
      'otaChannel' in (payload.orders[0] as Record<string, unknown>)
    ) {
      const orderChan = sanitize((payload.orders[0] as Record<string, unknown>).otaChannel);
      if (orderChan) return orderChan;
    }
  }

  // 通用备选字段提取（防止 msgType 与载荷字段存在跨版本兼容冗余）
  const chanCode = sanitize(payload.channelCode);
  if (chanCode) return chanCode;
  const otaChanCode = sanitize(payload.otaChannelCode);
  if (otaChanCode) return otaChanCode;
  const chan = sanitize(payload.channel);
  if (chan) return chan;

  return 'MEITUAN';
}

function sanitizeOrderNo(val: unknown): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') {
    const s = val.trim();
    return s.length > 0 ? s : undefined;
  }
  if (typeof val === 'number' && !isNaN(val)) {
    const s = String(val).trim();
    return s.length > 0 ? s : undefined;
  }
  return undefined;
}

/**
 * 从任务载荷与任务元数据中提取关联的订单号
 * 优先级：orders[0].otaOrderId -> orders[0].orderId -> orders[0].orderNo -> payload.otaOrderId -> payload.orderId -> payload.orderNo -> (非采集任务的 businessId)
 * 具备对字符串与纯数字类型单号的强鲁棒兼容性
 */
export function extractTaskOrderNo(task: DutyClaimedTask, payload: Record<string, unknown>): string | undefined {
  const firstOrder =
    Array.isArray(payload.orders) && payload.orders[0] && typeof payload.orders[0] === 'object'
      ? (payload.orders[0] as Record<string, unknown>)
      : undefined;

  const orderNo =
    (firstOrder ? sanitizeOrderNo(firstOrder.otaOrderId) : undefined) ||
    (firstOrder ? sanitizeOrderNo(firstOrder.orderId) : undefined) ||
    (firstOrder ? sanitizeOrderNo(firstOrder.orderNo) : undefined) ||
    sanitizeOrderNo(payload.otaOrderId) ||
    sanitizeOrderNo(payload.orderId) ||
    sanitizeOrderNo(payload.orderNo) ||
    (task.msgType !== 'OTA_COLLECT_ORDER' && task.businessId ? sanitizeOrderNo(task.businessId) : undefined);

  return orderNo;
}

/**
 * 统一解析与校验中台下发的 DutyClaimedTask 载荷与上下文元数据
 * 纯函数，严格遵循 Fail-Fast 原则：若 data 存在但解码或 JSON 解析失败、或者非对象结构，立即抛出明确异常。
 */
export function parseDutyTaskContext(task: DutyClaimedTask): ParsedDutyTaskContext {
  let payload: Record<string, unknown> = {};

  if (task.data && task.data.trim()) {
    const rawDecoded = Buffer.from(task.data, 'base64').toString('utf-8');
    const decodedObj = JSON.parse(rawDecoded) as unknown;
    if (!decodedObj || typeof decodedObj !== 'object' || Array.isArray(decodedObj)) {
      throw new Error('任务 data 解码后必须为非数组的 JSON 对象');
    }
    payload = decodedObj as Record<string, unknown>;
  }

  const channelCode = extractTaskChannelCode(task, payload);
  const orderNo = extractTaskOrderNo(task, payload);
  const businessId = String(task.businessId || '').trim();

  return {
    task,
    payload,
    channelCode,
    orderNo,
    businessId,
  };
}
