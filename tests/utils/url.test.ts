import { describe, it, expect } from 'vitest';
import { formatBaseUrl, joinApiUrl } from '../../src/utils/url';

describe('url utils - Base URL 格式化与 API 安全拼接', () => {
  describe('formatBaseUrl', () => {
    it('去除 URL 首尾空白字符与末尾多余斜杠', () => {
      expect(formatBaseUrl('  https://pms.xiruan.com///  ')).toBe('https://pms.xiruan.com');
      expect(formatBaseUrl('http://192.168.1.100:8080/')).toBe('http://192.168.1.100:8080');
    });

    it('空字符串或空值安全返回空串', () => {
      expect(formatBaseUrl('')).toBe('');
    });
  });

  describe('joinApiUrl', () => {
    it('正确拼接 Base URL 与路径，无论是否带斜杠', () => {
      expect(joinApiUrl('https://pms.xiruan.com', '/api/v1/orders')).toBe(
        'https://pms.xiruan.com/api/v1/orders'
      );
      expect(joinApiUrl('https://pms.xiruan.com/', 'api/v1/orders')).toBe(
        'https://pms.xiruan.com/api/v1/orders'
      );
      expect(joinApiUrl('https://pms.xiruan.com///', '///api/v1/orders')).toBe(
        'https://pms.xiruan.com/api/v1/orders'
      );
    });

    it('完整保留 Base URL 中的子路径前缀 (避免 new URL 根路径回退缺陷)', () => {
      expect(joinApiUrl('https://gateway.com/hotel/v1', '/orders/import')).toBe(
        'https://gateway.com/hotel/v1/orders/import'
      );
      expect(joinApiUrl('https://gateway.com/hotel/v1/', 'orders/import')).toBe(
        'https://gateway.com/hotel/v1/orders/import'
      );
    });

    it('Base URL 为空时 Fail-Fast 抛出异常', () => {
      expect(() => joinApiUrl('', '/orders')).toThrow('无法拼接 API 请求地址：Base URL 为空');
    });
  });
});
