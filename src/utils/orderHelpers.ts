import type { OrderStatus, ToolkitOrderAction, NightlyPricing } from '../types';

export const isOrderSuccess = (status: OrderStatus): boolean => {
  return status === 'success' || status === 'confirmed' || status === 'transferred';
};

export const formatSyncTime = (val?: string): string => {
  if (!val || !val.trim()) return '-';
  const clean = val.replace('T', ' ').trim();
  const fullMatch = clean.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
  if (fullMatch) {
    return `${fullMatch[1]} ${fullMatch[2]}`;
  }
  const timeMatch = clean.match(/^(\d{1,2}:\d{2})/);
  if (timeMatch) {
    return timeMatch[1];
  }
  return clean;
};

/**
 * 订单状态的人工操作策略字典 (严格契约)
 * - FAILED: 仅失败订单允许编辑、重新导入、删除
 * - SUCCESS: 仅成功订单允许取消
 * - 其余状态: 严格只读禁止操作
 */
const STATUS_ALLOWED_ACTIONS: Record<string, ToolkitOrderAction[]> = {
  FAILED: ['EDIT', 'IMPORT', 'DELETE'],
  SUCCESS: ['CANCEL'],
};

/**
 * 获取订单允许执行的人工操作列表
 */
export function getAllowedOrderActions(status: string): ToolkitOrderAction[] {
  const normalized = (status || '').trim().toUpperCase();
  return STATUS_ALLOWED_ACTIONS[normalized] || [];
}

/**
 * 获取操作被禁用的原因说明
 */
export function getOrderActionDisabledReason(action: ToolkitOrderAction, status: string): string {
  const normalized = (status || '').trim().toUpperCase();
  if (action === 'EDIT') {
    return normalized === 'FAILED' ? '' : '仅失败订单允许编辑';
  }
  if (action === 'IMPORT') {
    return normalized === 'FAILED' ? '' : '仅失败订单允许重新导入';
  }
  if (action === 'DELETE') {
    return normalized === 'FAILED' ? '' : '仅失败订单允许删除';
  }
  if (action === 'CANCEL') {
    return normalized === 'SUCCESS' ? '' : '仅成功订单允许取消';
  }
  return '当前状态不可操作';
}

/**
 * 人民币金额格式化工具 (千分位 + 两位小数)
 */
export function formatCurrency(amount: number | string | undefined | null): string {
  if (amount == null || amount === '') return '-';
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(num)) return String(amount);
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * 根据入住和离店日期拆解并对齐每日价格明细
 * 入住日 (包含) 至 离店日 (不包含)，每日一条
 */
export function calculateNightsAndPricing(
  arrivalDate: string,
  departureDate: string,
  existingPricing: NightlyPricing[] = [],
  defaultPrice = 0
): { nights: number; pricing: NightlyPricing[]; totalPrice: number } {
  const arrival = (arrivalDate || '').trim().slice(0, 10);
  const departure = (departureDate || '').trim().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) || !/^\d{4}-\d{2}-\d{2}$/.test(departure)) {
    return { nights: 0, pricing: [], totalPrice: 0 };
  }

  const startMs = Date.parse(`${arrival}T00:00:00Z`);
  const endMs = Date.parse(`${departure}T00:00:00Z`);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { nights: 0, pricing: [], totalPrice: 0 };
  }

  const existingMap = new Map<string, number>();
  for (const item of existingPricing) {
    if (item && item.date) {
      existingMap.set(item.date.slice(0, 10), Number(item.price) || 0);
    }
  }

  const pricing: NightlyPricing[] = [];
  let totalCents = 0;
  const ONE_DAY_MS = 86400000;

  for (let t = startMs; t < endMs; t += ONE_DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    const price = existingMap.has(d) ? (existingMap.get(d) as number) : defaultPrice;
    pricing.push({ date: d, price });
    totalCents += Math.round(price * 100);
  }

  return {
    nights: pricing.length,
    pricing,
    totalPrice: Math.round(totalCents) / 100,
  };
}

/**
 * 订单状态元数据映射
 */
export function getOrderStatusMeta(status: string): {
  label: string;
  tone: 'success' | 'failed' | 'warning' | 'info' | 'neutral';
} {
  const s = (status || '').trim().toUpperCase();
  switch (s) {
    case 'SUCCESS':
    case 'CONFIRMED':
    case 'TRANSFERRED':
      return { label: '成功', tone: 'success' };
    case 'FAILED':
      return { label: '失败', tone: 'failed' };
    case 'PENDING':
      return { label: '待确认', tone: 'warning' };
    case 'IMPORTING':
    case 'PROCESSING':
      return { label: '导入中', tone: 'info' };
    case 'CANCEL':
    case 'CANCELLED':
      return { label: '已取消', tone: 'neutral' };
    default:
      return { label: status || '未知', tone: 'neutral' };
  }
}
