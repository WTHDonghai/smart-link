/**
 * 轻量模型客户端（仅主进程消费，设计 4.1/4.5：产品映射与异常分类首选直接结构化模型调用）。
 *
 * 协议：OpenAI 兼容 Chat Completions（openai / deepseek / qwen 等主流供应商与 OpenAI 兼容网关均支持）。
 * 约束：
 * - 供应商密钥仅存在于主进程环境变量，绝不写入日志、报错与返回值；
 * - 零自动重试（设计 12：SDK 自动重试设为 0，是否发起新尝试由业务工作流显式决定）；
 * - 超时与取消经 AbortSignal 传播，取消中的请求以 CANCELLED 错误码显式结束；
 * - usage 缺失时返回 null，不伪造 0。
 */

import { isRecord } from '@/src/utils/typeGuards';

export type ModelChatRole = 'system' | 'user';

export interface ModelChatMessage {
  role: ModelChatRole;
  content: string;
}

/** 模型服务端点（仅主进程持有；密钥严禁进入日志、报错与 Renderer） */
export interface AgentModelEndpoint {
  /** 模型服务 Base URL（含版本路径的完整前缀，如 https://api.deepseek.com/v1） */
  baseUrl: string;
  apiKey: string;
}

export interface ModelCallInput {
  model: string;
  messages: ModelChatMessage[];
  timeoutMs: number;
  /** 业务工作流传入的取消信号（如用户停止任务） */
  signal?: AbortSignal;
}

export interface ModelCallResult {
  /** 供应商返回的原始文本内容 */
  content: string;
  /** 对 content 执行 JSON.parse 的结果；解析失败时抛 PROTOCOL 错误，不返回 null 掩盖 */
  parsedJson: unknown;
  usage: { promptTokens: number | null; completionTokens: number | null };
  /** 供应商回显的实际模型名（未回显时为请求模型名） */
  model: string;
  durationMs: number;
}

export type AgentModelErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'HTTP_ERROR'
  | 'PROTOCOL'
  | 'NETWORK';

export class AgentModelClientError extends Error {
  readonly code: AgentModelErrorCode;
  /** HTTP_ERROR 时的状态码（其余错误码为 undefined） */
  readonly httpStatus?: number;

  constructor(code: AgentModelErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'AgentModelClientError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 合并业务取消信号与超时信号（Electron 33 内置 Node 20.18 支持 AbortSignal.any） */
function buildAbortSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([timeoutSignal, external]) : timeoutSignal;
}

function describeAbortError(error: unknown): AgentModelClientError {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    // 区分外部取消（业务 signal）与超时：外部 signal 已中止即为主动取消
    return new AgentModelClientError('TIMEOUT', `模型请求超时被中止: ${error.message}`);
  }
  return new AgentModelClientError(
    'NETWORK',
    `模型请求传输失败: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
  );
}

async function readHttpErrorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text.length > 0 ? ` ${text.slice(0, 200)}` : '';
  } catch {
    return '';
  }
}

/**
 * 执行一次 OpenAI 兼容 chat completions 调用并要求 JSON 输出。
 * baseUrl 约定为含版本路径的完整前缀（如 https://api.deepseek.com/v1）。
 */
export async function callChatCompletion(
  endpoint: AgentModelEndpoint,
  input: ModelCallInput
): Promise<ModelCallResult> {
  const url = `${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: 0,
        stream: false,
        response_format: { type: 'json_object' },
      }),
      signal: buildAbortSignal(input.timeoutMs, input.signal),
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw new AgentModelClientError('CANCELLED', '模型请求已被业务取消信号中止');
    }
    throw describeAbortError(error);
  }

  if (!response.ok) {
    const detail = await readHttpErrorBody(response);
    throw new AgentModelClientError(
      'HTTP_ERROR',
      `模型服务返回 HTTP ${response.status}${detail}`,
      response.status
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AgentModelClientError('PROTOCOL', '模型服务响应不是合法 JSON');
  }
  if (!isRecord(payload)) {
    throw new AgentModelClientError('PROTOCOL', '模型服务响应不是 JSON 对象');
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new AgentModelClientError('PROTOCOL', '模型服务响应缺少 choices');
  }
  const message = (choices[0] as Record<string, unknown>).message;
  if (!isRecord(message) || typeof message.content !== 'string' || !message.content.trim()) {
    throw new AgentModelClientError('PROTOCOL', '模型服务响应缺少 message.content 文本');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(message.content);
  } catch {
    throw new AgentModelClientError(
      'PROTOCOL',
      `模型输出不是合法 JSON: ${message.content.slice(0, 120)}`
    );
  }

  const usageRecord = isRecord(payload.usage) ? payload.usage : {};
  const respondedModel =
    typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : input.model;

  return {
    content: message.content,
    parsedJson,
    usage: {
      promptTokens: toNumberOrNull(usageRecord.prompt_tokens),
      completionTokens: toNumberOrNull(usageRecord.completion_tokens),
    },
    model: respondedModel,
    durationMs: Date.now() - startedAt,
  };
}
