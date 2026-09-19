import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_ENV_KEYS } from '../../src/types/env';

describe('Meituan catalog config lazy evaluation', () => {
  const originalEnv = { ...process.env };
  const windowWithHost = window as unknown as { host?: unknown };
  const originalHost = windowWithHost.host;

  beforeEach(() => {
    delete process.env[APP_ENV_KEYS.otaCatalogMeituan];
    delete windowWithHost.host;
  });

  afterEach(() => {
    process.env = originalEnv;
    windowWithHost.host = originalHost;
  });

  it('imports the collector module without evaluating OTA URL configuration', async () => {
    const module = await import('../../src/crawler/collectors/meituan/meituanStoreMapper');

    expect(() => module.getDefaultMeituanCatalogUrl()).toThrow(
      '未配置渠道「MEITUAN」的目标访问地址'
    );
  });
});
