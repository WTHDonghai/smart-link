import processEnvKeysJson from './processEnvKeys.json' with { type: 'json' };

export const APP_ENV_KEYS = {
  platformBaseUrl: 'SMARTLINK_PLATFORM_BASE_URL',
  otaCatalogMeituan: 'SMARTLINK_OTA_MEITUAN_URL',
  otaCatalogMeituanBiz: 'SMARTLINK_OTA_MEITUAN_BIZ_URL',
  otaCatalogDouyin: 'SMARTLINK_OTA_DOUYIN_URL',
  otaCatalogCtrip: 'SMARTLINK_OTA_CTRIP_URL',
  otaCatalogTongcheng: 'SMARTLINK_OTA_TONGCHENG_URL',
  otaCatalogFliggy: 'SMARTLINK_OTA_FLIGGY_URL',
  otaCatalogQunar: 'SMARTLINK_OTA_QUNAR_URL',
  otaCatalogRed: 'SMARTLINK_OTA_RED_URL',
  otaProductMeituan: 'SMARTLINK_OTA_MEITUAN_PRODUCT_URL',
  otaProductDouyin: 'SMARTLINK_OTA_DOUYIN_PRODUCT_URL',
  otaOrderMeituan: 'SMARTLINK_OTA_MEITUAN_ORDER_URL',
  otaOrderDouyin: 'SMARTLINK_OTA_DOUYIN_ORDER_URL',
  otaOrderCtrip: 'SMARTLINK_OTA_CTRIP_ORDER_URL',
  otaOrderTongcheng: 'SMARTLINK_OTA_TONGCHENG_ORDER_URL',
  otaOrderFliggy: 'SMARTLINK_OTA_FLIGGY_ORDER_URL',
  otaOrderQunar: 'SMARTLINK_OTA_QUNAR_ORDER_URL',
} as const;

export type AppEnvKey = (typeof APP_ENV_KEYS)[keyof typeof APP_ENV_KEYS];

export type AppEnvSnapshot = Partial<Record<AppEnvKey, string>>;

export const PROCESS_ENV_KEYS = processEnvKeysJson;

export type ProcessEnvKeyName = keyof typeof PROCESS_ENV_KEYS;

export function selectAppEnv(source: Record<string, string | undefined>): AppEnvSnapshot {
  const snapshot: AppEnvSnapshot = {};

  for (const key of Object.values(APP_ENV_KEYS)) {
    const value = source[key]?.trim();
    if (value) {
      snapshot[key] = value;
    }
  }

  return snapshot;
}
