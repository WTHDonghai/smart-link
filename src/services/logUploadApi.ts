import { requestPlatformApi } from './platformApi';
import { logger } from './logger';
import { LOG_UPLOAD_MODULE } from '../utils/logUploadPath';

/**
 * 日志文件上传服务：预签名 URL 直传对象存储
 *
 * 1. GET /file/upload/sign?module={module}&path={objectKey} 获取预签名上传地址
 * 2. 携带签名 query 直接 PUT 文件体
 *
 * 预签名字段契约（string 型字段全部做强类型收敛，缺失即抛错）：
 *   - url：预签名上传地址（含签名 query）
 *   - method：可选，默认 PUT
 *   - headers：可选，直传时须携带的请求头（如 Content-Type）
 */

export interface PresignedUploadDescriptor {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 解包 R 结构 { code, success, data, msg }，失败即抛错（Fail-Fast，不静默兜底） */
function unwrapPlatformEnvelope(response: unknown, action: string): unknown {
  const envelope = asRecord(response);
  if (!envelope) {
    throw new Error(`日志上传${action}响应格式异常：非对象结构`);
  }
  if (envelope.success === false) {
    throw new Error(`日志上传${action}失败：${text(envelope.msg) || '未知业务错误'}`);
  }
  if (typeof envelope.code === 'number' && envelope.code !== 200 && envelope.code !== 0) {
    throw new Error(`日志上传${action}失败：code=${envelope.code} ${text(envelope.msg)}`);
  }
  return envelope.data;
}

/** 从 data 中解析预签名描述符；url 缺失即抛错 */
export function parsePresignedUploadDescriptor(data: unknown): PresignedUploadDescriptor {
  const source = asRecord(data);
  if (!source) {
    throw new Error('日志上传预签名响应缺少 data 对象');
  }

  // 兼容 url 字段的多种命名（url / uploadUrl / presignedUrl / host）
  const url = text(source.url) || text(source.uploadUrl) || text(source.presignedUrl) || text(source.host);
  if (!url) {
    throw new Error('日志上传预签名响应缺少 url 字段，无法直传');
  }

  const method = text(source.method).toUpperCase() || 'PUT';

  const headers: Record<string, string> = {};
  const rawHeaders = asRecord(source.headers);
  if (rawHeaders) {
    for (const [key, value] of Object.entries(rawHeaders)) {
      const headerValue = text(value);
      if (headerValue) {
        headers[key] = headerValue;
      }
    }
  }

  return { url, method, headers };
}

/** 调平台文件服务获取对象键的预签名上传地址 */
/** 文件服务所属微服务路由前缀（网关路径：/configuration/file/upload/sign） */
export const FILE_UPLOAD_SERVICE_PREFIX = 'configuration';

export async function fetchLogUploadPresign(objectKey: string): Promise<PresignedUploadDescriptor> {
  const normalizedKey = objectKey.replace(/^\/+/, '');
  if (!normalizedKey) {
    throw new Error('日志上传预签名请求缺少对象键（objectKey 为空）');
  }

  const query = `module=${encodeURIComponent(LOG_UPLOAD_MODULE)}&path=${encodeURIComponent(normalizedKey)}`;
  const response = await requestPlatformApi<unknown>(`/${FILE_UPLOAD_SERVICE_PREFIX}/file/upload/sign?${query}`);

  return parsePresignedUploadDescriptor(unwrapPlatformEnvelope(response, '预签名'));
}

/** 携带预签名直传文本内容（日志文件为纯文本，body 以 string 经主进程桥发送） */
export async function uploadTextViaPresign(
  descriptor: PresignedUploadDescriptor,
  content: string
): Promise<void> {
  const headers: Record<string, string> = { ...descriptor.headers };
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
  if (!hasContentType) {
    headers['Content-Type'] = 'text/plain;charset=utf-8';
  }

  let response: { ok: boolean; status: number; bodyText: string };
  if (typeof window !== 'undefined' && window.host?.platform?.request) {
    const resp = await window.host.platform.request({
      url: descriptor.url,
      method: descriptor.method,
      headers,
      body: content,
      timeoutMs: 60000,
    });
    response = { ok: resp.ok, status: resp.status, bodyText: resp.body };
  } else {
    // 单元测试 / 独立环境回退标准 fetch（与 requestPlatformApi 同一约定）
    const fetchResponse = await fetch(descriptor.url, {
      method: descriptor.method,
      headers,
      body: content,
    });
    response = {
      ok: fetchResponse.ok,
      status: fetchResponse.status,
      bodyText: typeof fetchResponse.text === 'function' ? await fetchResponse.text() : '',
    };
  }

  if (!response.ok) {
    throw new Error(`日志文件直传失败 (HTTP ${response.status})${response.bodyText ? `: ${response.bodyText.slice(0, 200)}` : ''}`);
  }
}

export interface LogUploadResult {
  objectKey: string;
  fileName: string;
  byteSize: number;
  entryCount: number;
}

/**
 * 上传日志文本到指定对象键（组签名 + 直传 + 结构化遥测）
 */
export async function uploadLogContent(input: {
  objectKey: string;
  fileName: string;
  content: string;
  entryCount: number;
}): Promise<LogUploadResult> {
  const startTime = Date.now();
  try {
    const descriptor = await fetchLogUploadPresign(input.objectKey);
    await uploadTextViaPresign(descriptor, input.content);

    const durationMs = Date.now() - startTime;
    const byteSize = new TextEncoder().encode(input.content).length;
    logger.track('LOG_UPLOAD_SUCCESS', {
      level: 'SUCCESS',
      module: 'SYSTEM',
      message: `[日志上传] ${input.fileName} (${byteSize} 字节, ${input.entryCount} 条) - ${durationMs}ms`,
      details: `对象键: ${input.objectKey}`,
      durationMs,
      meta: {
        objectKey: input.objectKey,
        byteSize,
        entryCount: input.entryCount,
      },
    });

    return { objectKey: input.objectKey, fileName: input.fileName, byteSize, entryCount: input.entryCount };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    logger.track('LOG_UPLOAD_FAILED', {
      level: 'ERROR',
      module: 'SYSTEM',
      message: `[日志上传失败] ${input.fileName}: ${message}`,
      details: `对象键: ${input.objectKey}`,
      durationMs,
      apiUrl: `/${FILE_UPLOAD_SERVICE_PREFIX}/file/upload/sign`,
      apiMethod: 'GET',
      apiParams: { module: LOG_UPLOAD_MODULE, path: input.objectKey },
      apiResponse: { error: message },
      meta: {
        objectKey: input.objectKey,
        entryCount: input.entryCount,
      },
    });
    throw error;
  }
}
