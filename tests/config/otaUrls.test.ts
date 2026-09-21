import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getOtaChannelUrl,
  getMeituanCatalogUrl,
  getOtaOrderUrl,
  getMeituanOrderUrl,
  getOtaProductUrl,
  getMeituanProductUrl,
} from '../../src/config/otaUrls';
import { APP_ENV_KEYS } from '../../src/types/env';
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

  describe('getOtaChannelUrl', () => {
    it('throws explicit error when environment variable is not set (Fail-Fast)', () => {
      delete process.env[APP_ENV_KEYS.otaCatalogMeituan];
      expect(() => getOtaChannelUrl('MEITUAN')).toThrow('未配置渠道「MEITUAN」的目标访问地址');
    });

    it('throws explicit error for unsupported channel code', () => {
      expect(() => getOtaChannelUrl('UNKNOWN_CHANNEL')).toThrow('不支持的 OTA 渠道编码');
    });

    it('returns custom mock URL when environment variable is configured', () => {
      process.env[APP_ENV_KEYS.otaCatalogMeituan] =
        'http://127.0.0.1:18080/ebooking/merchant/product/batch-price';
      process.env[APP_ENV_KEYS.otaCatalogDouyin] =
        'http://127.0.0.1:18180/p/liteapp/fulfillment-workbench/hotel-book/list?status=waiting';

      expect(getOtaChannelUrl('MEITUAN')).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
      expect(getOtaChannelUrl('DOUYIN')).toBe('http://127.0.0.1:18180/p/liteapp/fulfillment-workbench/hotel-book/list?status=waiting');
    });

    it('normalizes case and hyphens/underscores for channel codes', () => {
      process.env[APP_ENV_KEYS.otaCatalogMeituan] = 'http://127.0.0.1:18080/mock-meituan';
      process.env[APP_ENV_KEYS.otaCatalogMeituanBiz] = 'http://127.0.0.1:18080/mock-biz';

      expect(getOtaChannelUrl('meituan')).toBe('http://127.0.0.1:18080/mock-meituan');
      expect(getOtaChannelUrl('MEITUAN_BIZ')).toBe('http://127.0.0.1:18080/mock-biz');
      expect(getOtaChannelUrl('MEITUAN-BIZ')).toBe('http://127.0.0.1:18080/mock-biz');
      expect(getOtaChannelUrl('meituanbiz')).toBe('http://127.0.0.1:18080/mock-biz');
    });

    it('supports MEITUAN_BIZ falling back to MEITUAN URL if biz specific is empty', () => {
      process.env[APP_ENV_KEYS.otaCatalogMeituan] =
        'http://127.0.0.1:18080/ebooking/merchant/product/batch-price';
      delete process.env[APP_ENV_KEYS.otaCatalogMeituanBiz];

      expect(getOtaChannelUrl('MEITUAN_BIZ')).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
      expect(getOtaChannelUrl('meituanbiz')).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
    });
  });

  describe('getMeituanCatalogUrl & resolveMeituanTargetUrl integration', () => {
    it('seamlessly redirects resolveMeituanTargetUrl to the configured Meituan catalog URL', () => {
      process.env[APP_ENV_KEYS.otaCatalogMeituan] =
        'http://127.0.0.1:18080/ebooking/merchant/product/batch-price';

      expect(getMeituanCatalogUrl()).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
      expect(resolveMeituanTargetUrl()).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
    });

    it('normalizes mock base root URL without pathname to batch-price endpoint', () => {
      process.env[APP_ENV_KEYS.otaCatalogMeituan] = 'http://127.0.0.1:18080';

      expect(resolveMeituanTargetUrl()).toBe('http://127.0.0.1:18080/ebooking/merchant/product/batch-price');
    });
  });

  describe('getOtaOrderUrl & getMeituanOrderUrl', () => {
    it('throws explicit error when environment variable is not set (Fail-Fast)', () => {
      delete process.env[APP_ENV_KEYS.otaOrderMeituan];
      delete process.env[APP_ENV_KEYS.otaOrderDouyin];

      expect(() => getMeituanOrderUrl()).toThrow('未配置渠道「MEITUAN」的订单值守地址');
      expect(() => getOtaOrderUrl('MEITUAN')).toThrow('未配置渠道「MEITUAN」的订单值守地址');
      expect(() => getOtaOrderUrl('DOUYIN')).toThrow('未配置渠道「DOUYIN」的订单值守地址');
    });

    it('throws explicit error for unsupported order channel code', () => {
      expect(() => getOtaOrderUrl('UNKNOWN_CHANNEL')).toThrow('不支持的订单值守 OTA 渠道编码');
    });

    it('returns mock order URL when the Meituan order URL is configured', () => {
      process.env[APP_ENV_KEYS.otaOrderMeituan] =
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled';

      expect(getMeituanOrderUrl()).toBe(
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
      );
      expect(getOtaOrderUrl('MEITUAN')).toBe(
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
      );
    });

    it('supports MEITUAN_BIZ falling back to MEITUAN_ORDER_URL', () => {
      process.env[APP_ENV_KEYS.otaOrderMeituan] =
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled';

      expect(getOtaOrderUrl('MEITUAN_BIZ')).toBe(
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
      );
      expect(getOtaOrderUrl('meituanbiz')).toBe(
        'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
      );
    });
  });

  describe('getOtaProductUrl & getMeituanProductUrl', () => {
    it('returns custom product URL when SMARTLINK_OTA_MEITUAN_PRODUCT_URL is configured', () => {
      process.env[APP_ENV_KEYS.otaProductMeituan] = 'https://custom.meituan.com/hotel/products';
      expect(getMeituanProductUrl()).toBe('https://custom.meituan.com/hotel/products');
      expect(getOtaProductUrl('MEITUAN')).toBe('https://custom.meituan.com/hotel/products');
    });

    it('falls back to getOtaChannelUrl when product specific env is not set', () => {
      delete process.env[APP_ENV_KEYS.otaProductMeituan];
      process.env[APP_ENV_KEYS.otaCatalogMeituan] = 'https://catalog.meituan.com/merchant';

      expect(getMeituanProductUrl()).toBe('https://catalog.meituan.com/merchant');
      expect(getOtaProductUrl('MEITUAN')).toBe('https://catalog.meituan.com/merchant');
    });

    it('throws Fail-Fast error when neither product nor catalog URL is configured', () => {
      delete process.env[APP_ENV_KEYS.otaProductMeituan];
      delete process.env[APP_ENV_KEYS.otaCatalogMeituan];

      expect(() => getMeituanProductUrl()).toThrow('未配置渠道「MEITUAN」的目标访问地址');
    });

    it('throws explicit error when channelCode is empty', () => {
      expect(() => getOtaProductUrl('')).toThrow('渠道编码 channelCode 不能为空');
    });
  });
});
