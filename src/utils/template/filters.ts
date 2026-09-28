import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

/**
 * 模板与协议通用管道过滤器 (Pure Filters)
 * 严格纯函数，杜绝 any，100% 独立单测覆盖
 */

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

/**
 * 分转换为元，保留两位小数
 * 例如: 26555 -> "265.55", 23900 -> "239.00", 0 -> "0.00"
 */
export function centsToYuan(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') {
    return '0.00';
  }
  const num = typeof cents === 'number' ? cents : Number(cents);
  if (isNaN(num)) {
    throw new Error(`[Filter Error] 无法将非数值金额转换为元: ${String(cents)}`);
  }
  return (num / 100).toFixed(2);
}

function parseToDayjs(input: unknown): dayjs.Dayjs | null {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    if (input <= 0 || !Number.isFinite(input)) return null;
    return input < 10000000000 ? dayjs.unix(input).tz('Asia/Shanghai') : dayjs(input).tz('Asia/Shanghai');
  }

  const str = String(input).trim();
  if (!str) return null;

  // 10~13 位纯数字时间戳
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    return num < 10000000000 ? dayjs.unix(num).tz('Asia/Shanghai') : dayjs(num).tz('Asia/Shanghai');
  }

  // 紧凑年月日 YYYYMMDD
  if (/^\d{8}$/.test(str)) {
    const parsed = dayjs.tz(str, 'YYYYMMDD', 'Asia/Shanghai');
    if (parsed.isValid()) return parsed;
  }

  // 短日期 MM-DD / MM/DD / MM.DD / MM月DD日
  const shortMatch = str.match(/^(\d{1,2})[-/.月](\d{1,2})(?:日)?$/);
  if (shortMatch) {
    const year = new Date().getFullYear();
    const m = shortMatch[1].padStart(2, '0');
    const d = shortMatch[2].padStart(2, '0');
    return dayjs.tz(`${year}-${m}-${d}`, 'YYYY-MM-DD', 'Asia/Shanghai');
  }

  // 常见中文或带符号日期：替换为标准短横线后由 dayjs 解析
  const cleaned = str.replace(/[年月]/g, '-').replace(/日/g, '').replace(/\//g, '-').replace(/\./g, '-');
  const parsed = dayjs.tz(cleaned, 'Asia/Shanghai');
  if (parsed.isValid()) return parsed;

  const fallback = dayjs(str);
  return fallback.isValid() ? fallback.tz('Asia/Shanghai') : null;
}

/**
 * 格式化时间戳或日期字符串（统一使用 Day.js 以中国标准时间 Asia/Shanghai 解析与格式化）
 * 支持格式: YYYY-MM-DD, YYYY-MM-DD HH:mm:ss, MM月DD日 等
 */
export function formatDate(
  input: number | string | null | undefined,
  format = 'YYYY-MM-DD'
): string {
  if (input == null || input === '') return '';
  const d = parseToDayjs(input);
  if (!d || !d.isValid()) {
    throw new Error(`[Filter Error] 无法解析有效日期: ${String(input)}`);
  }
  return d.format(format);
}

/**
 * 安全日期格式化函数（异常时不抛错阻断，安全回退为空字符串）
 * 供各渠道订单采集与解析层统一调用
 */
export function safeFormatDate(value: unknown, format = 'YYYY-MM-DD'): string {
  if (value == null || value === '') return '';
  try {
    return formatDate(value as string | number, format);
  } catch {
    return '';
  }
}

export const fmtDate = safeFormatDate;

/**
 * 空值保护过滤器
 */
export function defaultVal(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

/**
 * 手机号脱敏过滤 (保留前3后4，中间4位为*)
 * 如 13812345678 -> 138****5678
 */
export function maskPhone(phone: unknown): string {
  if (!phone) return '-';
  const str = String(phone).trim();
  if (str.length === 11) {
    return `${str.slice(0, 3)}****${str.slice(7)}`;
  }
  return str;
}

/**
 * 统一过滤器调用分发器
 */
export function applyFilter(value: unknown, filterName: string, arg?: string): unknown {
  switch (filterName.trim()) {
    case 'money':
    case 'centsToYuan':
      return centsToYuan(value as number | string);
    case 'date':
      return formatDate(value as number | string, arg || 'YYYY-MM-DD');
    case 'default':
      return defaultVal(value, arg || '');
    case 'phone':
    case 'maskPhone':
      return maskPhone(value);
    default:
      throw new Error(`[Filter Error] 不支持的过滤器: ${filterName}`);
  }
}
