/**
 * 集中式 OTA 渠道 URL 配置管理 (Single Source of Truth)
 * 统一管理各渠道商户中心与门店采集地址，消除业务源码中的硬编码 URL
 */

import { getAppEnv } from './env';
import { APP_ENV_KEYS, type AppEnvKey } from '../types/env';

export const OTA_CATALOG_ENV_KEY_MAP: Record<string, AppEnvKey> = {
  MEITUAN: APP_ENV_KEYS.otaCatalogMeituan,
  MEITUAN_BIZ: APP_ENV_KEYS.otaCatalogMeituanBiz,
  DOUYIN: APP_ENV_KEYS.otaCatalogDouyin,
  CTRIP: APP_ENV_KEYS.otaCatalogCtrip,
  TONGCHENG: APP_ENV_KEYS.otaCatalogTongcheng,
  FLIGGY: APP_ENV_KEYS.otaCatalogFliggy,
  QUNAR: APP_ENV_KEYS.otaCatalogQunar,
  RED: APP_ENV_KEYS.otaCatalogRed,
};

export const OTA_ORDER_ENV_KEY_MAP: Record<string, AppEnvKey> = {
  MEITUAN: APP_ENV_KEYS.otaOrderMeituan,
  MEITUAN_BIZ: APP_ENV_KEYS.otaOrderMeituan,
  DOUYIN: APP_ENV_KEYS.otaOrderDouyin,
  CTRIP: APP_ENV_KEYS.otaOrderCtrip,
  TONGCHENG: APP_ENV_KEYS.otaOrderTongcheng,
  FLIGGY: APP_ENV_KEYS.otaOrderFliggy,
  QUNAR: APP_ENV_KEYS.otaOrderQunar,
};

export const OTA_PRODUCT_ENV_KEY_MAP: Record<string, AppEnvKey> = {
  MEITUAN: APP_ENV_KEYS.otaProductMeituan,
  MEITUAN_BIZ: APP_ENV_KEYS.otaProductMeituan,
};

interface OtaUrlErrorContext {
  subject: string;
  unsupportedMessagePrefix: string;
  sharedMeituanKey: AppEnvKey;
}

type OtaUrlType = 'catalog' | 'order';

const OTA_URL_ERROR_CONTEXT: Record<OtaUrlType, OtaUrlErrorContext> = {
  catalog: {
    subject: '目标访问地址',
    unsupportedMessagePrefix: '不支持的 OTA',
    sharedMeituanKey: APP_ENV_KEYS.otaCatalogMeituan,
  },
  order: {
    subject: '订单值守地址',
    unsupportedMessagePrefix: '不支持的订单值守 OTA',
    sharedMeituanKey: APP_ENV_KEYS.otaOrderMeituan,
  },
};

function getOtaEnvKeyMap(urlType: OtaUrlType): Record<string, AppEnvKey> {
  return urlType === 'catalog' ? OTA_CATALOG_ENV_KEY_MAP : OTA_ORDER_ENV_KEY_MAP;
}

function resolveOtaUrl(channelCode: string, urlType: OtaUrlType): string {
  const code = channelCode.trim();
  if (!code) {
    throw new Error('渠道编码 channelCode 不能为空');
  }

  const normalizedCode = normalizeOtaChannelCode(code);
  const envKey = getOtaEnvKeyMap(urlType)[normalizedCode];
  const errorContext = OTA_URL_ERROR_CONTEXT[urlType];

  if (!envKey) {
    throw new Error(`${errorContext.unsupportedMessagePrefix} 渠道编码: ${channelCode}`);
  }

  const value = getAppEnv(envKey);
  if (value) return value;

  if (normalizedCode === 'MEITUAN_BIZ') {
    const meituanValue = getAppEnv(errorContext.sharedMeituanKey);
    if (meituanValue) return meituanValue;

    throw new Error(
      `未配置美团商旅或美团的${errorContext.subject}，请在环境变量中配置 ${envKey} 或 ${errorContext.sharedMeituanKey}`
    );
  }

  throw new Error(`未配置渠道「${channelCode}」的${errorContext.subject}，请在环境变量中配置 ${envKey}`);
}

/**
 * 规范化渠道编码
 */
export function normalizeOtaChannelCode(channelCode: string): string {
  const cleanCode = (channelCode || '').trim().toUpperCase();
  const stripped = cleanCode.replace(/[-_]/g, '');

  if (stripped === 'MEITUANBIZ' || stripped === 'MEITUANBUSINESS' || stripped === 'MTBIZ') {
    return 'MEITUAN_BIZ';
  }
  if (stripped === 'MEITUAN' || stripped === 'MEITUANHOTEL' || stripped === 'MT') {
    return 'MEITUAN';
  }
  if (stripped === 'DOUYIN' || stripped === 'DOUYINLIFE' || stripped === 'DY') {
    return 'DOUYIN';
  }
  if (stripped === 'CTRIP' || stripped === 'XIECHENG') {
    return 'CTRIP';
  }
  if (stripped === 'FLIGGY' || stripped === 'FEIZHU') {
    return 'FLIGGY';
  }
  if (stripped === 'TONGCHENG') {
    return 'TONGCHENG';
  }
  if (stripped === 'QUNAR') {
    return 'QUNAR';
  }
  if (stripped === 'RED' || stripped === 'XIAOHONGSHU') {
    return 'RED';
  }
  return cleanCode;
}

/**
 * 根据渠道编码规范化获取该渠道配置的目标 URL (门店改价/目录中心)
 * 遵循 Fail-Fast 原则：绝不使用隐式 fallback 兜底默认值，未配置时立即显式抛出异常
 * 支持大写或规范化编码 (如 MEITUAN, MEITUAN_BIZ, MEITUANBIZ, DOUYIN 等)
 */
export function getOtaChannelUrl(channelCode: string): string {
  return resolveOtaUrl(channelCode, 'catalog');
}

/**
 * 快捷获取美团改价/门店采集标准目标 URL
 */
export function getMeituanCatalogUrl(): string {
  return getOtaChannelUrl('MEITUAN');
}

/**
 * 根据渠道编码规范化获取该渠道值守/待处理订单目标 URL (Single Source of Truth)
 * 遵循 Fail-Fast 原则：绝不使用隐式 fallback 兜底默认值，未配置时立即显式抛出异常
 */
export function getOtaOrderUrl(channelCode: string): string {
  return resolveOtaUrl(channelCode, 'order');
}

/**
 * 快捷获取美团待处理订单值守目标 URL
 */
export function getMeituanOrderUrl(): string {
  return getOtaOrderUrl('MEITUAN');
}

/**
 * 根据渠道编码获取该渠道产品采集目标 URL (Single Source of Truth)
 * 优先读取渠道产品专用环境变量；若未配置，默认回退至该渠道的标准目录中心页面 (getOtaChannelUrl)
 */
export function getOtaProductUrl(channelCode: string): string {
  const code = (channelCode || '').trim();
  if (!code) {
    throw new Error('渠道编码 channelCode 不能为空');
  }

  const normalizedCode = normalizeOtaChannelCode(code);
  const envKey = OTA_PRODUCT_ENV_KEY_MAP[normalizedCode];
  if (envKey) {
    const customProductUrl = getAppEnv(envKey);
    if (customProductUrl?.trim()) {
      return customProductUrl.trim();
    }
  }

  return getOtaChannelUrl(normalizedCode);
}

/**
 * 快捷获取美团产品采集标准目标 URL
 */
export function getMeituanProductUrl(): string {
  return getOtaProductUrl('MEITUAN');
}
