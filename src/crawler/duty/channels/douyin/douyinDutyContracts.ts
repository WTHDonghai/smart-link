import type { DutyUnhandledOrderSummary } from '../../dutyContracts';

export { DutyExecutionError } from '../../dutyContracts';

/**
 * 抖音值守核心业务错误代码
 */
export enum DouyinDutyErrorCode {
  // 页面与环境状态
  TARGET_PAGE_NOT_READY = 'TARGET_PAGE_NOT_READY',         // 未处于抖音订单工作台页面
  RISK_VERIFICATION_REQUIRED = 'RISK_VERIFICATION_REQUIRED', // 命中安全验证/滑块/人机风控

  // 列表采集链路
  LIST_TRIGGER_UNAVAILABLE = 'LIST_TRIGGER_UNAVAILABLE',     // 列表刷新按钮/Tab不可用
  LIST_RESPONSE_TIMEOUT = 'LIST_RESPONSE_TIMEOUT',           // 列表网络响应超时
  LIST_HTTP_ERROR = 'LIST_HTTP_ERROR',                       // 列表网络请求返回非200
  LIST_BUSINESS_FAILED = 'LIST_BUSINESS_FAILED',             // 列表接口业务状态码失败

  // 详情抓取链路
  ORDER_CARD_NOT_FOUND = 'ORDER_CARD_NOT_FOUND',             // 列表中未找到目标订单
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
  ORDER_STATUS_NOT_MATCHED = 'ORDER_STATUS_NOT_MATCHED',     // 订单状态不匹配或未处于可操作状态
  ACCEPT_ORDER_FAILED = 'ACCEPT_ORDER_FAILED',               // 接单确认操作失败
}

/**
 * 抖音来客工作台权威页面选择器与文案契约 (对齐 smart-link-auto-queue-split)
 */
export const DOUYIN_PAGE_SELECTORS = {
  observationBusinessTabSelector: '.byted-tab-bar-item',
  observationBusinessTabActiveClass: 'byted-tab-bar-item-active',
  newOrderTabText: '新订/变更',
  cancelOrderTabText: '取消/退款',
  orderCardSelector: '.hotel-book-list-order-card[data-form-insight-meta]',
  detailSelector: '#detailSection',
  detailOrderIdSelector: '.trade_copy.trade_copy_horizontal',
  pendingAcceptanceStatusText: '待接单',
  cancelledStatusTexts: ['已取消', '已退款'] as const,
  acceptOrderButtonText: '接单',
  acceptOrderPromptText: '确认接单吗？',
  acceptOrderScopeSelector: '.byted-popover-confirm-container',
  acceptOrderSubmitSelector: '.byted-confirm-ok',
  confirmationTriggerSelector: '.byted-popper-trigger.byted-confirm',
  confirmationTriggerText: '填写确认号',
  confirmationScopeSelector: '.byted-popover-confirm-container',
  confirmationInputSelector: 'input.byted-input[placeholder*="确认号"], input.byted-input, input[placeholder*="确认号"]',
  confirmationSubmitSelector: '.byted-confirm-ok',
  confirmationDismissSelector: '.byted-confirm-cancel',
  confirmationStateSelector: '.max-w-\\[200px\\]:has(+ .byted-popper-trigger.byted-confirm)',
  cancellationAcknowledgeButtonText: '我知道了',
} as const;

/**
 * 抖音订单列表采集结构化结果
 */
export interface DouyinOrderCollectionResult {
  otaChannelCode: 'DOUYIN';
  collectionStatus: 'VERIFIED_EMPTY' | 'FOUND';
  recordCount: number;
  orders: DutyUnhandledOrderSummary[];
}

