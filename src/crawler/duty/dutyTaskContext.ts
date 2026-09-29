import type { DutyClaimedTask } from '../../types';
import { normalizeOtaChannelCode } from '../../config/otaUrls';

/**
 * 统一解析后的值守任务关联订单状态枚举
 * - ALL: 适用于美团等单 Tab 同屏展示所有订单的渠道
 * - NEW: 新订
 * - CANCEL: 取消
 */
export enum DutyOrderStatus {
  ALL = 'ALL',
  NEW = 'NEW',
  CANCEL = 'CANCEL',
}

/**
 * 统一解析后的值守任务上下文数据模型
 */
export interface ParsedDutyTaskContext {
  task: DutyClaimedTask;
  payload: Record<string, unknown>;
  channelCode?: string;
  orderId?: string;
  businessId: string;
  orderStatus: DutyOrderStatus;
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

function sanitizeChannelCode(val: unknown): string | undefined {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.length > 0) {
      return normalizeOtaChannelCode(trimmed);
    }
  }
  return undefined;
}

/**
 * 依据中台线缆契约与各任务消息类型的固定协议路径，精准提取渠道代号 (channelCode)
 * 遵循 Fail-Fast 原则：严格按对应 msgType 的固定契约路径解析，杜绝跨字段模糊猜测与无谓兜底。
 * 若契约规定的渠道字段缺失或为空，明确返回 undefined，交由上层阻断拒单。
 */
export function extractTaskChannelCode(
  task: DutyClaimedTask,
  payload: Record<string, unknown>
): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  switch (task.msgType) {
    case 'OTA_COLLECT_ORDER':
      // 采集任务线缆协议固定字段: otaChannelCode
      return sanitizeChannelCode(payload.otaChannelCode);

    case 'OTA_CONFIRM_IMPORT':
    case 'OTA_CONFIRM_CANCEL':
      // 确认接单/取消确认任务线缆协议固定字段: channelCode
      return sanitizeChannelCode(payload.channelCode);

    case 'OTA_IMPORT_ORDER': {
      // 订单导入任务线缆协议固定字段: payload.channel，或批量结构 orders[0].otaChannel，或中台派发的 otaChannelCode
      const directChannel = sanitizeChannelCode(payload.channel);
      if (directChannel) return directChannel;

      const otaChannel = sanitizeChannelCode(payload.otaChannelCode);
      if (otaChannel) return otaChannel;

      if (Array.isArray(payload.orders) && payload.orders[0] && typeof payload.orders[0] === 'object') {
        const fromFirstOrder = sanitizeChannelCode(
          (payload.orders[0] as Record<string, unknown>).otaChannel
        );
        if (fromFirstOrder) return fromFirstOrder;
      }

      return undefined;
    }

    default:
      return undefined;
  }
}

function sanitizeOrderId(val: unknown): string | undefined {
  if (typeof val === 'string' || (typeof val === 'number' && !Number.isNaN(val))) {
    return String(val).trim() || undefined;
  }
  return undefined;
}

/**
 * 依据中台线缆契约与业务事实，精准提取任务关联的渠道订单号 (orderId)
 *
 * 刚性准则：
 * 1. 采集巡检任务 (OTA_COLLECT_ORDER) 无单体关联订单号，严格返回 undefined。
 * 2. Fail-Fast 约束：一个任务只能处理一个订单的详情。若 payload.orders 存在且长度 > 1，立即抛出异常拒绝隐式截断。
 * 3. 订单类任务中，中台 businessId 即为权威的渠道订单号 (otaOrderId)。
 * 4. 兼容容错：若 businessId 缺失但 payload 中显式提供了 otaOrderId/orderId/orderNo，回退提取。
 */
export function extractTaskOrderId(
  task: DutyClaimedTask,
  payload?: Record<string, unknown>
): string | undefined {
  if (task.msgType === 'OTA_COLLECT_ORDER') {
    // 采集巡检任务无单体关联订单号
    return undefined;
  }

  // Fail-Fast: 一个任务只能处理一个订单的详情，坚决杜绝静默吃掉后续订单
  if (payload && Array.isArray(payload.orders) && payload.orders.length > 1) {
    throw new Error(`单任务仅支持处理单笔订单，收到包含 ${payload.orders.length} 笔订单的非法载荷`);
  }

  // 1. 优先使用中台任务业务主键 businessId (即 OTA 渠道订单号)
  const fromBusinessId = sanitizeOrderId(task.businessId);
  if (fromBusinessId) {
    return fromBusinessId;
  }

  // 2. 兼容容错：当 businessId 缺失时，从载荷显式声明中回退提取
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.orders) && payload.orders[0] && typeof payload.orders[0] === 'object') {
      const firstOrder = payload.orders[0] as Record<string, unknown>;
      const idInBatch =
        sanitizeOrderId(firstOrder.otaOrderId) ||
        sanitizeOrderId(firstOrder.orderId) ||
        sanitizeOrderId(firstOrder.orderNo);
      if (idInBatch) return idInBatch;
    }

    return (
      sanitizeOrderId(payload.otaOrderId) ||
      sanitizeOrderId(payload.orderId) ||
      sanitizeOrderId(payload.orderNo)
    );
  }

  return undefined;
}

/**
 * 依据中台任务与已解码的 payload 精准判定订单状态
 * 直接复用外层已解析的 payload，零重复 Base64 解码与 JSON 解析
 * - CANCEL: 取消订单
 * - NEW: 新订订单
 * - ALL: 美团等同屏单 Tab 聚合所有订单的渠道
 */
export function resolveTaskOrderStatus(
  task: DutyClaimedTask,
  payload: Record<string, unknown> = {}
): DutyOrderStatus {
  // 1. targetMsgTypes 数组优先级最高
  if (Array.isArray(payload.targetMsgTypes)) {
    const types = payload.targetMsgTypes as string[];
    const hasCancel = types.includes('OTA_CANCEL_ORDER');
    const hasImport = types.includes('OTA_IMPORT_ORDER');
    if (hasCancel && !hasImport) return DutyOrderStatus.CANCEL;
    if (hasImport && !hasCancel) return DutyOrderStatus.NEW;
  }

  // 2. 显式字段标记
  if (payload.cancelOrder === true || payload.action === 'cancel') {
    return DutyOrderStatus.CANCEL;
  }

  if (Array.isArray(payload.orders) && payload.orders[0] && typeof payload.orders[0] === 'object') {
    const firstOrder = payload.orders[0] as Record<string, unknown>;
    if (firstOrder.cancelOrder === true || firstOrder.action === 'cancel') {
      return DutyOrderStatus.CANCEL;
    }
  }

  // 3. 业务标识 businessId
  const businessId = String(task.businessId || '').toUpperCase();
  if (businessId.includes('CANCEL') || businessId.includes('REFUND')) {
    return DutyOrderStatus.CANCEL;
  }
  if (businessId.includes('NEW') || businessId.includes('BOOK')) {
    return DutyOrderStatus.NEW;
  }

  // 4. 任务消息类型 msgType
  const msgType = String(task.msgType || '');
  if (msgType === 'OTA_CONFIRM_CANCEL' || msgType === 'OTA_CANCEL_ORDER') {
    return DutyOrderStatus.CANCEL;
  }
  if (msgType === 'OTA_CONFIRM_IMPORT' || msgType === 'OTA_IMPORT_ORDER') {
    return DutyOrderStatus.NEW;
  }

  // 5. 默认 ALL（美团等多个订单都在同一 Tab 中的渠道）
  return DutyOrderStatus.ALL;
}

/**
 * @deprecated 兼容历史调用，已统一为 resolveTaskOrderStatus
 */
export const extractTaskOrderStatus = resolveTaskOrderStatus;

/**
 * @deprecated 兼容历史调用，已统一为 extractTaskOrderId
 */
export const extractTaskOrderNo = extractTaskOrderId;

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
  const orderId = extractTaskOrderId(task, payload);
  const businessId = String(task.businessId || '').trim();
  const orderStatus = resolveTaskOrderStatus(task, payload);

  return {
    task,
    payload,
    channelCode,
    orderId,
    businessId,
    orderStatus,
  };
}
