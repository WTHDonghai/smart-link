import type { DutyUnhandledOrderSummary } from './dutyContracts';

/**
 * 美团值守核心业务错误代码
 */
export enum MeituanDutyErrorCode {
  // 页面与环境状态
  TARGET_PAGE_NOT_READY = 'TARGET_PAGE_NOT_READY',         // 未处于美团订单中心页面
  RISK_VERIFICATION_REQUIRED = 'RISK_VERIFICATION_REQUIRED', // 命中安全验证/滑块/Yoda风控

  // 列表采集链路
  LIST_TRIGGER_UNAVAILABLE = 'LIST_TRIGGER_UNAVAILABLE',     // 列表刷新按钮/Tab不可用
  LIST_RESPONSE_TIMEOUT = 'LIST_RESPONSE_TIMEOUT',           // 列表网络响应超时
  LIST_HTTP_ERROR = 'LIST_HTTP_ERROR',                       // 列表网络请求返回非200
  LIST_BUSINESS_FAILED = 'LIST_BUSINESS_FAILED',             // 列表接口业务状态码失败

  // 详情抓取链路
  ORDER_CARD_NOT_FOUND = 'ORDER_CARD_NOT_FOUND',             // 列表中未找到目标订单卡片
  ORDER_DETAIL_TIMEOUT = 'ORDER_DETAIL_TIMEOUT',             // 详情网络响应超时
  ORDER_DETAIL_HTTP_ERROR = 'ORDER_DETAIL_HTTP_ERROR',       // 详情网络请求返回非200
  ORDER_DETAIL_FIELD_MISSING = 'ORDER_DETAIL_FIELD_MISSING', // 详情关键业务字段缺失
  GUEST_NAME_DECRYPT_FAILED = 'GUEST_NAME_DECRYPT_FAILED',   // 客人姓名解密失败

  // 确认号回填链路
  CONFIRM_INPUT_NOT_FOUND = 'CONFIRM_INPUT_NOT_FOUND',       // 未找到确认号输入框
  CONFIRM_INPUT_ALREADY_FILLED = 'CONFIRM_INPUT_ALREADY_FILLED', // 输入框已存在不同确认号
  CONFIRM_VALUE_MISMATCH = 'CONFIRM_VALUE_MISMATCH',         // 确认号填入后读回比对不一致
  CONFIRM_SUBMIT_NOT_FOUND = 'CONFIRM_SUBMIT_NOT_FOUND',     // 未找到确认提交按钮
  CONFIRM_RESPONSE_TIMEOUT = 'CONFIRM_RESPONSE_TIMEOUT',     // 确认接口网络响应超时
  CONFIRM_RESULT_UNVERIFIED = 'CONFIRM_RESULT_UNVERIFIED',   // 确认接口返回失败或未通过校验
}

/**
 * 结构化执行异常，支持精准透传错误码与重试属性
 */
export class DutyExecutionError extends Error {
  public readonly errorCode: string;
  public readonly retryable?: boolean;

  constructor(message: string, errorCode: string, retryable?: boolean) {
    super(message.includes(errorCode) ? message : `[${errorCode}] ${message}`);
    this.name = 'DutyExecutionError';
    this.errorCode = errorCode;
    this.retryable = retryable;
    Object.setPrototypeOf(this, DutyExecutionError.prototype);
  }
}

/**
 * 列表采集结构化结果
 */
export interface MeituanOrderCollectionResult {
  otaChannelCode: 'MEITUAN';
  collectionStatus: 'VERIFIED_EMPTY' | 'FOUND';
  recordCount: number;
  orders: DutyUnhandledOrderSummary[];
}
