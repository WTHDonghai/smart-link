/**
 * 自动匹配失败原因 → 一线操作员可读文案（AGENTS.md §3.4.5/§3.4.2）。
 *
 * 原始协议细节（HTTP 状态码、供应商响应体、环境变量名）不得直达界面；
 * 未清洗原文已由主进程 Agent 追踪事件留档（日志控制台可溯源），
 * 渲染层只展示业务语义。本目录内已知业务引导文案原样透传。
 */

/** 已确认面向操作员的引导文案前缀（由本仓库生成，无技术泄露），原样透传 */
const OPERATIONAL_PREFIXES: readonly RegExp[] = [
  /^请先选择/,
  /^PMS .*字典为空或加载失败/,
  /^映射总预算（时间）耗尽/,
];

/** 原始技术错误 → 业务文案 */
const RAW_ERROR_PATTERNS: ReadonlyArray<{ pattern: RegExp; copy: string }> = [
  { pattern: /模型配置缺失/, copy: '智能匹配服务尚未完成配置，请联系管理员处理后再使用' },
  { pattern: /模型服务返回 HTTP/, copy: '智能匹配服务暂时不可用，请稍后重试；若持续失败请联系管理员' },
  { pattern: /模型请求超时/, copy: '智能匹配服务响应超时，请检查网络后重试' },
  { pattern: /模型请求传输失败/, copy: '无法连接智能匹配服务，请检查网络后重试' },
  { pattern: /模型输出不是合法 JSON|模型服务响应/, copy: '智能匹配服务返回了异常结果，已停止本次匹配，请稍后重试' },
  { pattern: /映射快照报文不符合契约/, copy: '匹配数据校验未通过，请重新采集产品后再试' },
  { pattern: /终态追踪确认失败/, copy: '匹配结果记录确认失败，请查看处理记录后重新发起匹配' },
];

const GENERIC_COPY = '自动匹配失败，详情请查看处理记录';

/**
 * 将自动匹配失败原因转换为操作员可读文案。
 * 空原因返回空串（调用方自行给出兜底）；无法识别的原因一律收敛为通用文案，
 * 绝不透出未清洗的原始错误链。
 */
export function describeAutoMappingError(reason: string | null | undefined): string {
  if (!reason || !reason.trim()) return '';
  if (OPERATIONAL_PREFIXES.some((pattern) => pattern.test(reason))) return reason;
  const matched = RAW_ERROR_PATTERNS.find(({ pattern }) => pattern.test(reason));
  return matched ? matched.copy : GENERIC_COPY;
}
