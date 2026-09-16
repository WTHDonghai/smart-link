/**
 * 模板与协议通用管道过滤器 (Pure Filters)
 * 严格纯函数，杜绝 any，100% 独立单测覆盖
 */

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

/**
 * 格式化时间戳或日期字符串
 * 支持格式: YYYY-MM-DD, YYYY-MM-DD HH:mm:ss, MM月DD日 等
 */
export function formatDate(
  input: number | string | null | undefined,
  format = 'YYYY-MM-DD'
): string {
  if (!input) return '';

  let date: Date;
  if (typeof input === 'number') {
    // 自动兼容 10 位秒级时间戳 (如抖音入离时间 1788537600) 与 13 位毫秒级时间戳 (如美团 1789401600000)
    const ms = input < 10000000000 ? input * 1000 : input;
    date = new Date(ms);
  } else {
    const trimmed = input.trim();
    // 纯数字且长度为 10 位，判定为秒级时间戳
    if (/^\d{10}$/.test(trimmed)) {
      date = new Date(Number(trimmed) * 1000);
    } else {
      // 兼容类似 "2026-09-15 00:00:00" 的标准格式或 ISO 串
      const cleaned = trimmed.replace(/-/g, '/');
      date = new Date(cleaned);
      if (isNaN(date.getTime())) {
        date = new Date(trimmed);
      }
    }
  }

  if (isNaN(date.getTime())) {
    throw new Error(`[Filter Error] 无法解析有效日期: ${String(input)}`);
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace(/YYYY/g, year)
    .replace(/MM/g, month)
    .replace(/DD/g, day)
    .replace(/HH/g, hours)
    .replace(/mm/g, minutes)
    .replace(/ss/g, seconds);
}

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
