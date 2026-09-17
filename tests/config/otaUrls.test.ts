import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getEnvVar,
  getOtaChannelUrl,
  getMeituanCatalogUrl,
  getOtaOrderUrl,
  getMeituanOrderUrl,
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
    it('throws explicit error when environment variable is not set (Fail-Fast)', () => {
      delete process.env.VITE_OTA_MEITUAN_URL;
      expect(() => getOtaChannelUrl('MEITUAN')).toThrow('未配置渠道「MEITUAN」的目标访问地址');
    });

    it('throws explicit error for unsupported channel code', () => {
      expect(() => getOtaChannelUrl('UNKNOWN_CHANNEL')).toThrow('不支持的 OTA 渠道编码');
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

  describe('getOtaOrderUrl & getMeituanOrderUrl', () => {
    it('throws explicit error when environment variable is not set (Fail-Fast)', () => {
      delete process.env.VITE_OTA_MEITUAN_ORDER_URL;
      delete process.env.VITE_OTA_DOUYIN_ORDER_URL;

      expect(() => getMeituanOrderUrl()).toThrow('未配置渠道「MEITUAN」的订单值守地址');
      expect(() => getOtaOrderUrl('MEITUAN')).toThrow('未配置渠道「MEITUAN」的订单值守地址');
      expect(() => getOtaOrderUrl('DOUYIN')).toThrow('未配置渠道「DOUYIN」的订单值守地址');
    });

    it('throws explicit error for unsupported order channel code', () => {
      expect(() => getOtaOrderUrl('UNKNOWN_CHANNEL')).toThrow('不支持的订单值守 OTA 渠道编码');
    });

    it('returns mock order URL when VITE_OTA_MEITUAN_ORDER_URL is configured', () => {
      process.env.VITE_OTA_MEITUAN_ORDER_URL =
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled';

      expect(getMeituanOrderUrl()).toBe(
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
      );
      expect(getOtaOrderUrl('MEITUAN')).toBe(
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
      );
    });

    it('supports MEITUAN_BIZ falling back to MEITUAN_ORDER_URL', () => {
      process.env.VITE_OTA_MEITUAN_ORDER_URL =
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled';

      expect(getOtaOrderUrl('MEITUAN_BIZ')).toBe(
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
      );
      expect(getOtaOrderUrl('meituanbiz')).toBe(
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
      );
    });
  });
});

