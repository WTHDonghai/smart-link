import { type AppEnvKey, type AppEnvSnapshot } from '../types/env';

/**
 * 渲染进程使用 preload 契约注入；CLI 和主进程读取 process.env。
 */
export function getAppEnv(key: AppEnvKey): string {
  if (typeof window !== 'undefined') {
    const hostValue = window.host?.env?.[key];
    if (hostValue?.trim()) return hostValue;
  }

  const processValue = typeof process === 'undefined' ? undefined : process.env[key];
  if (processValue?.trim()) return processValue;

  return '';
}
