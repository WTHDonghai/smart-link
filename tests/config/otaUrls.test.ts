import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getEnvVar,
  getOtaChannelUrl,
  getMeituanCatalogUrl,
  DEFAULT_FALLBACK_URLS,
} from '../../src/config/otaUrls';
import { resolveMeituanTargetUrl } from '../../src/crawler/collectors/meituan/meituanStoreMapper';

describe('otaUrls config & single source of truth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 恢复环境变量副本
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getEnvVar', () => {
    it('retrieves variable from process.env', () => {
      process.env.VITE_TEST_SAMPLE_KEY = 'https://custom-test.domain.com';
      expect(getEnvVar('VITE_TEST_SAMPLE_KEY')).toBe('https://custom-test.domain.com');
    });

    it('returns default fallback when environment variable is not defined', () => {
      delete process.env.VITE_NON_EXISTENT_KEY;
      expect(getEnvVar('VITE_NON_EXISTENT_KEY', 'default-val')).toBe('default-val');
    });
  });

  describe('getOtaChannelUrl', () => {
    it('returns default fallback URL when environment variable is not set', () => {
      delete process.env.VITE_OTA_MEITUAN_URL;
      delete process.env.VITE_OTA_DOUYIN_URL;

      expect(getOtaChannelUrl('MEITUAN')).toBe(DEFAULT_FALLBACK_URLS.MEITUAN);
      expect(getOtaChannelUrl('DOUYIN')).toBe(DEFAULT_FALLBACK_URLS.DOUYIN);
    });

    it('returns custom mock URL when environment variable is configured', () => {
      process.env.VITE_OTA_MEITUAN_URL = 'http://127.0.0.1:18080/ebooking/merchant/product/batch-price';
      process.env.VITE_OTA_DOUYIN_URL = 'http://127.0.0.1:18180/p/liteapp/fulfillment-workbench/hotel-book/list?status=waiting';

      expect(getOtaChannelUrl('MEITUAN')).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
      expect(getOtaChannelUrl('DOUYIN')).toBe('http://127.0.0.1:18180/p/liteapp/fulfillment-workbench/hotel-book/list?status=waiting');
    });

    it('normalizes case and hyphens/underscores for channel codes', () => {
      process.env.VITE_OTA_MEITUAN_URL = 'http://127.0.0.1:18080/mock-meituan';
      process.env.VITE_OTA_MEITUAN_BIZ_URL = 'http://127.0.0.1:18080/mock-biz';

      expect(getOtaChannelUrl('meituan')).toBe('http://127.0.0.1:18080/mock-meituan');
      expect(getOtaChannelUrl('MEITUAN_BIZ')).toBe('http://127.0.0.1:18080/mock-biz');
      expect(getOtaChannelUrl('MEITUAN-BIZ')).toBe('http://127.0.0.1:18080/mock-biz');
      expect(getOtaChannelUrl('meituanbiz')).toBe('http://127.0.0.1:18080/mock-biz');
    });

    it('supports MEITUAN_BIZ falling back to MEITUAN URL if biz specific is empty', () => {
      process.env.VITE_OTA_MEITUAN_URL = 'http://127.0.0.1:18080/ebooking/merchant/product/batch-price';
      delete process.env.VITE_OTA_MEITUAN_BIZ_URL;

      expect(getOtaChannelUrl('MEITUAN_BIZ')).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
      expect(getOtaChannelUrl('meituanbiz')).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
    });
  });

  describe('getMeituanCatalogUrl & resolveMeituanTargetUrl integration', () => {
    it('seamlessly redirects resolveMeituanTargetUrl to mock server when VITE_OTA_MEITUAN_URL is set', () => {
      process.env.VITE_OTA_MEITUAN_URL = 'http://127.0.0.1:18080/ebooking/merchant/product/batch-price';

      expect(getMeituanCatalogUrl()).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
      expect(resolveMeituanTargetUrl()).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
    });

    it('normalizes mock base root URL without pathname to batch-price endpoint', () => {
      process.env.VITE_OTA_MEITUAN_URL = 'http://127.0.0.1:18080';

      expect(resolveMeituanTargetUrl()).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
    });
  });
});
