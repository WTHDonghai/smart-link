import type { DouyinOriginalError, DouyinResponseRiskContext, DouyinResponseRiskEvidence } from '@/src/types/douyinRisk';

export const DOUYIN_RISK_TEXT_PATTERN = /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|验证一下|拖动滑块|请完成验证|secsdk|captcha/i;

export function redactDouyinDiagnosticUrl(url: string): string {
  return url.replace(/\?[^#]*/g, '?redacted').replace(/#.*/, '#redacted').slice(0, 500);
}

/** 诊断原文只脱敏凭据与 URL 参数，不折叠换行、不裁剪错误内容和堆栈。 */
export function redactDouyinDiagnosticText(text: string): string {
  return text
    .replace(/((?:authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|lease[_-]?token|token|password|secret)(\\*")\s*:\s*\2)[\s\S]*?\2/gi,
      (_match: string, prefix: string, quote: string) => `${prefix}[REDACTED]${quote}`)
    .replace(/(\b(?:authorization|cookie|set-cookie)\s*:\s*)(?!["'])(Bearer\s+)?[^\r\n]+/gi, '$1$2[REDACTED]')
    .replace(/https?:\/\/[^\s<>"'\\]+/g, (url) => url.replace(/\?[^#]*/g, '?redacted').replace(/#.*/, '#redacted'))
    .replace(/((?:["']?)(?:authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|lease[_-]?token|token|password|secret)(?:["']?)\s*[:=]\s*)(["'])(.*?)\2/gi,
      (_match: string, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`)
    .replace(/\b(Bearer\s+)[^\s"'\\,;]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:access[_-]?token|refresh[_-]?token|lease[_-]?token|token|password|secret)\s*=\s*)[^\s&;"']+/gi, '$1[REDACTED]');
}

export function serializeDouyinOriginalError(error: unknown, seen = new Set<object>()): DouyinOriginalError {
  if (error === null || typeof error !== 'object') {
    return { message: redactDouyinDiagnosticText(String(error)) };
  }
  if (seen.has(error)) return { message: '[循环异常引用]', circular: true };
  seen.add(error);
  const node = error as Record<string, unknown>;
  return {
    ...(typeof node.name === 'string' ? { name: node.name } : {}),
    message: redactDouyinDiagnosticText(typeof node.message === 'string' ? node.message : String(error)),
    ...(typeof node.stack === 'string' ? { stack: redactDouyinDiagnosticText(node.stack) } : {}),
    ...(typeof node.errorCode === 'string' ? { errorCode: node.errorCode } : {}),
    ...(typeof node.code === 'string' || typeof node.code === 'number' ? { code: node.code } : {}),
    ...(node.cause !== undefined ? { cause: serializeDouyinOriginalError(node.cause, seen) } : {}),
  };
}

/** 仅用于简短的命中摘要；完整报文单独存入日志 apiResponse。 */
export function douyinRiskSnippet(text: string, matchIndex: number): string {
  return text.slice(Math.max(0, matchIndex - 40), matchIndex + 120)
    .replace(/https?:\/\/[^\s<>"']+/g, (url) => redactDouyinDiagnosticUrl(url))
    .replace(/\d{6,}/g, '[数字已隐藏]')
    .slice(0, 160);
}

/** 诊断辅助解码：失败只代表无法提供 JSON 字段路径，不用默认数据推进业务。 */
function diagnosticJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function findField(value: unknown, path: string): DouyinResponseRiskEvidence['match'] | null {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!DOUYIN_RISK_TEXT_PATTERN.test(normalized)) return null;
    const nested = diagnosticJson(value);
    if (nested !== undefined && nested !== value) {
      const field = findField(nested, `${path}(JSON)`);
      if (field) return field;
    }
    const match = DOUYIN_RISK_TEXT_PATTERN.exec(normalized)!;
    return { source: 'response-body', fieldPath: path, matched: match[0], snippet: douyinRiskSnippet(normalized, match.index) };
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const field = findField(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`);
      if (field) return field;
    }
  }
  return null;
}

/** 仅提供证据，不自行决定正常业务响应是否应当被拦截。 */
export function findDouyinResponseRisk(
  text: string,
  context: DouyinResponseRiskContext,
  field: 'body' | 'status_msg' = 'body'
): DouyinResponseRiskEvidence | null {
  const payload = diagnosticJson(text);
  // 列表业务错误原本只由 status_msg 参与异常归类，不扩大为扫描全部订单字段。
  const target = field === 'status_msg' && payload && typeof payload === 'object'
    ? String((payload as Record<string, unknown>).status_msg || '')
    : field === 'body' ? text : '';
  const normalized = target.replace(/\s+/g, ' ').trim();
  const rawMatch = DOUYIN_RISK_TEXT_PATTERN.exec(normalized);
  if (!rawMatch) return null;
  const code = payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>).status_code
    : undefined;
  return {
    origin: 'api-response',
    ...context,
    apiUrl: redactDouyinDiagnosticUrl(context.apiUrl),
    ...(typeof code === 'string' || typeof code === 'number' ? { businessCode: code } : {}),
    match: field === 'status_msg'
      ? { source: 'response-body', fieldPath: '$.status_msg', matched: rawMatch[0], snippet: douyinRiskSnippet(normalized, rawMatch.index) }
      : findField(payload, '$') ?? {
          source: 'response-body', fieldPath: '$raw', matched: rawMatch[0], snippet: douyinRiskSnippet(normalized, rawMatch.index),
        },
  };
}
