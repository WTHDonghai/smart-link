import { parse, test } from 'liqe';
import { resolveTaskActionStage } from './taskStage';
import type { SystemLogEntry, LogFilterParams } from '../types';

const FIELD_ALIASES: Record<string, string> = {
  stage: 'taskActionStage',
  action: 'taskActionStage',
  step: 'taskActionStage',
  taskactionstage: 'taskActionStage',
  level: 'level',
  lvl: 'level',
  module: 'module',
  mod: 'module',
  channel: 'channelId',
  channelid: 'channelId',
  task: 'taskId',
  taskid: 'taskId',
  type: 'msgType',
  msgtype: 'msgType',
  url: 'apiUrl',
  apiurl: 'apiUrl',
  status: 'httpStatus',
  httpstatus: 'httpStatus',
};

export function normalizeQueryString(rawQuery: string): string {
  if (!rawQuery || !rawQuery.trim()) return '';

  let query = rawQuery.trim();

  query = query.replace(/(^|\s|[:=])(\d{15,})(?=$|\s|[)\]])/g, '$1"$2"');
  query = query.replace(/(^|\s|[:=])([/]?[\w\-.]+[/][\w\-./]+)(?=$|\s|[)\]])/g, '$1"$2"');

  query = query.replace(
    /\b(order|orderno):("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s()]+)/gi,
    (_match, _field: string, rawValue: string) => {
      const value = rawValue.replace(/^(["'])(.*)\1$/, '$2');
      return `fullText:${encodeSubstringLiteral(value)}`;
    }
  );

  query = query.replace(/\b([a-zA-Z_]+)(:)/g, (match, field: string, colon: string) => {
    const lower = field.toLowerCase();
    const mapped = FIELD_ALIASES[lower];
    return mapped ? `${mapped}${colon}` : match;
  });

  return query;
}

export interface LogDateBounds {
  startMs: number | null;
  endMs: number | null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const PURE_DIGITS_RULE = /^\d+$/;
const SAFE_UNQUOTED_RULE = /^[A-Za-z0-9_.@#$-]+$/;

/**
 * 将子串匹配值编码为 liqe 字面量。
 *
 * liqe 中未加引号的普通字面量本身就是大小写不敏感的子串匹配，且不会像正则字面量那样在
 * AND/OR 组合时触发 "Ambiguous results" 解析歧义。因此除必须加引号的情况外一律使用裸字面量。
 *
 * 纯数字必须加引号：liqe 会将其解析为 Number，长单号会丢失精度而无法命中。
 * 含空格、引号、斜杠等字符的值退化为带引号字面量（此时为大小写敏感匹配），以保证语法始终合法。
 */
function encodeSubstringLiteral(value: string): string {
  if (PURE_DIGITS_RULE.test(value)) {
    return `"${value}"`;
  }
  if (SAFE_UNQUOTED_RULE.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizeStage(raw: string): string {
  return raw.toLowerCase().replace(/_/g, '-');
}

export function compileLogQuery(
  filters: LogFilterParams,
  bounds?: LogDateBounds
): string {
  const parts: string[] = [];

  if (bounds) {
    if (bounds.startMs !== null) parts.push(`createdAt:>=${bounds.startMs}`);
    if (bounds.endMs !== null) parts.push(`createdAt:<=${bounds.endMs}`);
  }

  if (filters.onlyErrors) {
    parts.push('(level:"ERROR" OR level:"WARN")');
  }

  if (filters.event && filters.event !== 'ALL') {
    parts.push(`event:"${filters.event}"`);
  }

  if (filters.taskId?.trim()) {
    parts.push(`taskId:${encodeSubstringLiteral(filters.taskId.trim())}`);
  }

  if (filters.module && filters.module !== 'ALL') {
    if (filters.module === 'API') {
      // 保留 API 模块的多维嗅探语义：显式 API 模块、携带 apiUrl 或 API_ 事件前缀
      parts.push('(module:"API" OR apiUrl:* OR event:API_)');
    } else {
      parts.push(`module:"${filters.module}"`);
    }
  }

  if (filters.channelId && filters.channelId !== 'ALL') {
    parts.push(`channelId:${encodeSubstringLiteral(filters.channelId)}`);
  }

  if (filters.orderNo?.trim()) {
    parts.push(`fullText:${encodeSubstringLiteral(filters.orderNo.trim())}`);
  }

  if (filters.taskActionStage && filters.taskActionStage !== 'ALL') {
    parts.push(`taskActionStage:${encodeSubstringLiteral(normalizeStage(filters.taskActionStage))}`);
  }

  if (filters.level && filters.level !== 'ALL') {
    parts.push(`level:"${filters.level}"`);
  }

  if (filters.search?.trim()) {
    const trimmed = filters.search.trim();
    if (isLogQuerySyntaxValid(trimmed)) {
      const normalized = normalizeQueryString(trimmed);
      if (normalized) parts.push(`(${normalized})`);
    } else {
      parts.push(`fullText:${encodeSubstringLiteral(trimmed)}`);
    }
  }

  return parts.join(' AND ');
}

interface PreparedLog {
  [key: string]: unknown;
}

const preparedCache = new WeakMap<SystemLogEntry, PreparedLog>();

function prepareLogForEvaluation(entry: SystemLogEntry): PreparedLog {
  const cached = preparedCache.get(entry);
  if (cached) return cached;

  const resolvedStage = resolveTaskActionStage(entry);
  const orderNo = entry.orderNo || '';
  const taskId = entry.taskId || '';
  const msgType = entry.msgType || '';
  const channelId = entry.channelId || '';
  const moduleName = entry.module || '';
  const apiUrl = entry.apiUrl || '';
  const level = (entry.level || '').toUpperCase();
  const message = entry.message || '';
  const details = entry.details || '';
  const paramsText = entry.apiParams !== undefined ? JSON.stringify(entry.apiParams) : '';
  const responseText = entry.apiResponse !== undefined ? JSON.stringify(entry.apiResponse) : '';
  const event = entry.event || '';

  const result: PreparedLog = {
    ...entry,
    level,
    module: moduleName,
    taskActionStage: resolvedStage || entry.taskActionStage || '',
    orderNo,
    taskId,
    msgType,
    channelId,
    apiUrl,
    apiParamsText: paramsText,
    apiResponseText: responseText,
    event,
    fullText: `${message} ${details} ${orderNo} ${taskId} ${msgType} ${channelId} ${apiUrl} ${event} ${paramsText} ${responseText}`,
  };

  preparedCache.set(entry, result);
  return result;
}

type LiqeAst = ReturnType<typeof parse>;
const astCache = new Map<string, LiqeAst | null>();

/**
 * 缓存已编译的 Liqe 语法树 (AST)，避免在循环过滤中重复解析相同查询
 */
export function getParsedAst(query: string): LiqeAst | null {
  if (!query || !query.trim()) return null;
  const cached = astCache.get(query);
  if (cached !== undefined) return cached;

  try {
    const ast = parse(query);
    if (astCache.size > 200) {
      astCache.clear();
    }
    astCache.set(query, ast);
    return ast;
  } catch {
    if (astCache.size > 200) {
      astCache.clear();
    }
    astCache.set(query, null);
    return null;
  }
}

/**
 * 评估已编译的标准 liqe 查询表达式，不再对表达式本身做用户输入规范化
 */
export function evaluateLogQuery(entry: SystemLogEntry, compiledQuery: string): boolean {
  if (!compiledQuery || !compiledQuery.trim()) return true;

  const targetObj = prepareLogForEvaluation(entry);
  const ast = getParsedAst(compiledQuery);

  if (ast) {
    try {
      return test(ast, targetObj);
    } catch {
      // 运行时匹配异常降级至字面兜底
    }
  }

  const fullText = String(targetObj.fullText || '');
  return new RegExp(escapeRegex(compiledQuery), 'i').test(fullText);
}

function hasEmptyExpression(ast: unknown): boolean {
  if (!ast || typeof ast !== 'object') return false;
  const node = ast as Record<string, unknown>;
  if (node.type === 'EmptyExpression') return true;
  if (node.expression && hasEmptyExpression(node.expression)) return true;
  if (node.left && hasEmptyExpression(node.left)) return true;
  if (node.right && hasEmptyExpression(node.right)) return true;
  return false;
}

/**
 * 校验用户自由输入的查询语句是否符合 liqe 语法
 */
export function isLogQuerySyntaxValid(rawSearch: string): boolean {
  if (!rawSearch || !rawSearch.trim()) return true;

  try {
    const ast = parse(normalizeQueryString(rawSearch));
    return !hasEmptyExpression(ast);
  } catch {
    return false;
  }
}
