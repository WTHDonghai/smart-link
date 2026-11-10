/**
 * Agent 值守消息推送客户端（仅主进程消费，P3 异常诊断工作流调用）。
 *
 * 依据 docs/architecture/llm-agent-integration-design.md 第 8 节与最省事接入决策（2026-11-02）：
 * - 渠道为企业微信 / 钉钉 / 飞书群机器人 webhook，凭据经环境变量由运维手工配置；
 * - 群机器人只返回「服务端受理」结果：无幂等键、无送达回执，本客户端如实区分
 *   accepted（机器人服务受理成功）/ failed（明确的拒绝）/ unknown（传输未获响应，结果未知）；
 * - 通知文案使用确定性模板构造（不经过模型），字段缺失时立即报错，不做静默截断或兜底拼接。
 */

import { createHmac } from 'node:crypto';
import type { AgentNotificationConfig } from '../config/agentNotificationConfig';
import { isRecord } from '@/src/utils/typeGuards';

/** 三家群机器人的文本消息长度上限均为 2048 字节；预留安全余量并禁止悄悄截断 */
export const MAX_NOTIFICATION_TEXT_LENGTH = 2000;

export type NotificationSendStatus = 'accepted' | 'failed' | 'unknown';

export interface NotificationSendResult {
  status: NotificationSendStatus;
  /** accepted: 受理回执摘要；failed/unknown: 具体原因 */
  detail: string;
}

export interface IncidentNotificationInput {
  hotelName: string;
  channelName: string;
  /** 已脱敏的订单号 */
  orderNo: string;
  /** 已观察事实与处置结论，每行一条（必须已脱敏） */
  summaryLines: string[];
  /** 人工需要执行的下一步 */
  manualAction: string;
  /** 本机可查询的处理记录编号（如 AG-20261015-xxxx） */
  traceRef: string;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`值守通知内容缺少必须字段: ${fieldName}`);
  }
  return trimmed;
}

/**
 * 构造确定性的值守异常通知文案（设计 8.1 示例形态）。
 * 所有字段必填且已脱敏；内容超长时显式报错，禁止悄悄截断影响判断。
 */
export function buildIncidentNotificationText(input: IncidentNotificationInput): string {
  const hotelName = requireNonEmpty(input.hotelName, 'hotelName');
  const channelName = requireNonEmpty(input.channelName, 'channelName');
  const orderNo = requireNonEmpty(input.orderNo, 'orderNo');
  const manualAction = requireNonEmpty(input.manualAction, 'manualAction');
  const traceRef = requireNonEmpty(input.traceRef, 'traceRef');

  if (!Array.isArray(input.summaryLines) || input.summaryLines.length === 0) {
    throw new Error('值守通知内容缺少必须字段: summaryLines（至少一条已观察事实）');
  }
  const summaryLines = input.summaryLines.map((line, index) => {
    const trimmed = requireNonEmpty(line, `summaryLines[${index}]`);
    return trimmed;
  });

  const lines = [
    '【SmartLink 值守提醒】',
    `${hotelName} 的${channelName}订单 ${orderNo} 暂未完成搬单。`,
    ...summaryLines,
    `请人工处理：${manualAction}`,
    `处理记录：${traceRef}`,
  ];
  const text = lines.join('\n');

  if (text.length > MAX_NOTIFICATION_TEXT_LENGTH) {
    throw new Error(
      `值守通知内容超出 ${MAX_NOTIFICATION_TEXT_LENGTH} 字上限（当前 ${text.length} 字），请精简事实描述，禁止悄悄截断`
    );
  }
  return text;
}

/** 钉钉加签：HMAC-SHA256(`${timestamp}\n${secret}`) 后 base64，由调用方统一 urlencode */
export function signDingtalkPayload(timestamp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
}

interface WebhookTarget {
  url: string;
  body: string;
}

function buildWebhookTarget(
  config: AgentNotificationConfig,
  text: string,
  now: () => number
): WebhookTarget {
  switch (config.webhookType) {
    case 'wecom':
      return {
        url: config.webhookUrl,
        body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
      };
    case 'dingtalk': {
      let url = config.webhookUrl;
      if (config.dingtalkSecret) {
        const timestamp = now();
        const sign = encodeURIComponent(signDingtalkPayload(timestamp, config.dingtalkSecret));
        url += `&timestamp=${timestamp}&sign=${sign}`;
      }
      return {
        url,
        body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
      };
    }
    case 'feishu':
      return {
        url: config.webhookUrl,
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      };
  }
}

/** 解析机器人受理回执：企业微信/钉钉用 errcode，飞书用 code（兼容旧版 StatusCode） */
function interpretWebhookResponse(webhookType: AgentNotificationConfig['webhookType'], payload: unknown): NotificationSendResult {
  if (!isRecord(payload)) {
    return { status: 'failed', detail: '机器人响应不是合法 JSON 对象' };
  }

  if (webhookType === 'feishu') {
    if (payload.code === 0 || payload.StatusCode === 0) {
      return { status: 'accepted', detail: '飞书机器人已受理' };
    }
    return {
      status: 'failed',
      detail: `飞书机器人拒绝: ${String(payload.msg ?? payload.StatusMessage ?? '未知原因')}`,
    };
  }

  const providerLabel = webhookType === 'wecom' ? '企业微信' : '钉钉';
  if (payload.errcode === 0) {
    return { status: 'accepted', detail: `${providerLabel}机器人已受理` };
  }
  return {
    status: 'failed',
    detail: `${providerLabel}机器人拒绝: errcode=${String(payload.errcode)} ${String(payload.errmsg ?? '')}`.trim(),
  };
}

export interface SendNotificationOptions {
  /** 可注入时钟，供钉钉加签确定性测试 */
  now?: () => number;
}

/**
 * 发送一条值守通知文本到群机器人。
 * 传输层失败与超时一律返回 unknown（请求可能已到达服务器，结果未知），由调用方决定是否重发；
 * 仅在机器人服务明确拒绝时返回 failed。
 */
export async function sendAgentNotificationText(
  config: AgentNotificationConfig,
  text: string,
  options?: SendNotificationOptions
): Promise<NotificationSendResult> {
  if (!text.trim()) {
    throw new Error('通知内容不能为空');
  }
  if (text.length > MAX_NOTIFICATION_TEXT_LENGTH) {
    throw new Error(`通知内容超出 ${MAX_NOTIFICATION_TEXT_LENGTH} 字上限（当前 ${text.length} 字），禁止悄悄截断`);
  }

  const target = buildWebhookTarget(config, text, options?.now ?? Date.now);

  let response: Response;
  try {
    response = await fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: target.body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { status: 'unknown', detail: `通知请求未获响应（可能超时或网络中断），结果未知: ${reason}` };
  }

  if (!response.ok) {
    return { status: 'failed', detail: `机器人服务返回 HTTP ${response.status} ${response.statusText}`.trim() };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'failed', detail: '机器人响应不是合法 JSON' };
  }

  return interpretWebhookResponse(config.webhookType, payload);
}
