import { OrderStatus } from '../types';

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

