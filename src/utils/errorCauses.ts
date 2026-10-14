/**
 * 异常 cause 链诊断展平工具 (Error Cause Chain Descriptor)
 *
 * Node undici 抛出的 `TypeError: fetch failed` 会把连接层的真实失败原因
 * (ECONNREFUSED / ENOTFOUND / ETIMEDOUT / ECONNRESET / TLS 证书错误等)
 * 存放在 error.cause 中，而默认的 message 与 stack 均不包含该信息。
 * 本工具将 cause 链展平为可直接写入日志的可检索后缀，例如：
 * `fetch failed [cause] [ECONNRESET] socket hang up`
 */

/** 日志后缀最大长度，防止超长 cause 链污染日志行 */
const MAX_CAUSE_CHAIN_LENGTH = 800;

/** Node 系统异常携带的扩展字段 (errno 异常码 / AggregateError 聚合明细) */
interface ErrorCauseNode extends Error {
  code?: unknown;
  errors?: unknown;
}

/** 格式化非异常类型的 cause 节点；JSON.stringify 对循环引用会抛错，此处为日志格式化兜底，绝不允许因日志而中断业务 */
function describeNonErrorCause(node: unknown): string {
  if (typeof node === 'string') return node;
  try {
    return JSON.stringify(node) ?? String(node);
  } catch {
    return String(node);
  }
}

function describeCauseNode(node: unknown): string {
  if (!(node instanceof Error)) return describeNonErrorCause(node);

  const { code, errors } = node as ErrorCauseNode;
  const segments: string[] = [];
  if (typeof code === 'string' && code) segments.push(`[${code}]`);
  segments.push(`${node.name !== 'Error' ? `${node.name}: ` : ''}${node.message}`.trim());

  if (Array.isArray(errors) && errors.length > 0) {
    segments.push(`(errors: ${errors.map((sub) => describeCauseNode(sub)).join('; ')})`);
  }
  return segments.join(' ');
}

/**
 * 将异常的 cause 链展平为日志后缀。
 * 无 cause 链时返回空字符串；有则返回以空格开头的 ` [cause] ...` 后缀，
 * 可直接拼接在 message/stack 尾部；多级链路以 ` <- ` 连接，
 * 深度上限 maxDepth 同时天然截断环状引用。
 */
export function describeErrorCauses(error: unknown, maxDepth: number = 3): string {
  const levels: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (!(current instanceof Error)) break;
    const next: unknown = current.cause;
    if (next === undefined || next === null) break;
    levels.push(describeCauseNode(next));
    current = next;
  }
  if (levels.length === 0) return '';

  let result = ` [cause] ${levels.join(' <- ')}`;
  if (result.length > MAX_CAUSE_CHAIN_LENGTH) {
    result = `${result.slice(0, MAX_CAUSE_CHAIN_LENGTH - 1)}…`;
  }
  return result;
}

/**
 * 统一「错误消息 + cause 链」日志文案：Error 输出 message + cause 后缀，非 Error 输出 String()。
 */
export function describeErrorMessage(error: unknown): string {
  return error instanceof Error ? `${error.message}${describeErrorCauses(error)}` : String(error);
}
