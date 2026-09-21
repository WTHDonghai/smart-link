import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_ENV_KEYS } from '../../src/types/env';

describe('hotel collector registry lazy config', () => {
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

  it('registers collectors without evaluating Meituan target URL at import time', async () => {
    const { hotelCollectorRegistry } = await import('../../src/crawler/registry');

    expect(hotelCollectorRegistry.getSupportedChannelCodes()).toContain('MEITUAN');
    expect(() => hotelCollectorRegistry.get('MEITUAN')?.defaultTargetUrl).toThrow(
      '未配置渠道「MEITUAN」的目标访问地址'
    );
  });
});
