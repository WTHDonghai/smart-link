import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HOTEL_ENDPOINTS,
  STRUCTURE_ENDPOINTS,
  normalizeRemoteHotelMapping,
  fetchRemoteHotelMappings,
  saveHotelMappingsBatch,
  deleteRemoteHotelMappings,
  fetchPlatformProperties,
} from '../../src/services/hotelApi';
import { saveTokensToStorage, clearTokensFromStorage } from '../../src/services/platformAuth';
import type { PlatformAuthTokens } from '../../src/types';

describe('hotelApi - 门店/酒店映射平台接入服务', () => {
  const mockTokens: PlatformAuthTokens = {
    accessToken: 'test-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600 * 1000,
    tokenType: 'bearer',
    platformBaseUrl: 'https://pms.example.com',
    tenantId: 'TENANT-001',
    authenticatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    clearTokensFromStorage();
    saveTokensToStorage(mockTokens);
    vi.restoreAllMocks();
  });

  describe('HOTEL_ENDPOINTS 常量定义', () => {
    it('定义了规范的门店映射微服务路由', () => {
      expect(HOTEL_ENDPOINTS.HOTEL_MAPPINGS).toBe('/toolkit/hotel-mappings');
      expect(HOTEL_ENDPOINTS.HOTEL_MAPPINGS_BATCH).toBe('/toolkit/hotel-mappings/batch');
    });
  });

  describe('normalizeRemoteHotelMapping 纯函数规范化', () => {
    it('规范化已绑定中台单位的完整门店记录', () => {
      const raw = {
        mappingId: 'map-mt-001',
        otaChannelCode: 'meituan',
        extUnitCode: 'MT-10023',
        otaHotelName: '全季酒店杭州西湖店',
        unitId: 'PMS-HZ-001',
        unitCode: 'HZ-001',
        unitName: '华住全季-杭州西湖总店',
        unitType: 'Property',
        city: '杭州',
        starRating: '高档型',
        partnerId: 'PARTNER-99',
      };

      const normalized = normalizeRemoteHotelMapping(raw);

      expect(normalized.id).toBe('map-mt-001');
      expect(normalized.mappingId).toBe('map-mt-001');
      expect(normalized.otaChannelId).toBe('meituan');
      expect(normalized.otaChannelCode).toBe('MEITUAN');
      expect(normalized.otaHotelId).toBe('MT-10023');
      expect(normalized.extUnitCode).toBe('MT-10023');
      expect(normalized.otaHotelName).toBe('全季酒店杭州西湖店');
      expect(normalized.pmsHotelId).toBe('PMS-HZ-001');
      expect(normalized.pmsHotelName).toBe('华住全季-杭州西湖总店');
      expect(normalized.unitType).toBe('Property');
      expect(normalized.city).toBe('杭州');
      expect(normalized.starRating).toBe('高档型');
      expect(normalized.partnerId).toBe('PARTNER-99');
      expect(normalized.status).toBe('mapped');
      expect(normalized.source).toBe('remote-platform');
    });

    it('规范化未绑定中台单位的待匹配门店', () => {
      const raw = {
        id: 'map-raw-02',
        otaChannelCode: 'douyin',
        poiId: 'DY-SY-888',
        name: '三亚海棠湾度假酒店',
      };

      const normalized = normalizeRemoteHotelMapping(raw);

      expect(normalized.otaChannelCode).toBe('DOUYIN');
      expect(normalized.otaHotelId).toBe('DY-SY-888');
      expect(normalized.extUnitCode).toBe('DY-SY-888');
      expect(normalized.otaHotelName).toBe('三亚海棠湾度假酒店');
      expect(normalized.pmsHotelId).toBe('');
      expect(normalized.status).toBe('pending');
      expect(normalized.unitType).toBe('Property');
    });

    it('正确支持各种别名字段降级解析 (otaHotelCode, poiName, shopName 等)', () => {
      const raw = {
        otaHotelCode: 'SHOP-999',
        shopName: '自贡恐龙方特客栈',
      };

      const normalized = normalizeRemoteHotelMapping(raw, 'meituan');
      expect(normalized.otaChannelCode).toBe('MEITUAN');
      expect(normalized.otaChannelId).toBe('meituan');
      expect(normalized.otaHotelId).toBe('SHOP-999');
      expect(normalized.otaHotelName).toBe('自贡恐龙方特客栈');
    });

    it('正确规范化 MEITUAN_BIZ 渠道代码并映射 otaChannelId 为 meituanbiz', () => {
      const raw = {
        otaChannelCode: 'MEITUAN_BIZ',
        extUnitCode: 'MT-BIZ-001',
        otaHotelName: '美团商旅企业自营酒店',
      };

      const normalized = normalizeRemoteHotelMapping(raw);
      expect(normalized.otaChannelCode).toBe('MEITUAN_BIZ');
      expect(normalized.otaChannelId).toBe('meituanbiz');
    });

    it('当服务端字段为 channelCode 时亦能正确识别渠道与门店', () => {
      const raw = {
        channelCode: 'MEITUAN',
        hotelId: 'MT-RAW-88',
        hotelName: '西软美团测试酒店',
      };

      const normalized = normalizeRemoteHotelMapping(raw);
      expect(normalized.otaChannelCode).toBe('MEITUAN');
      expect(normalized.otaChannelId).toBe('meituan');
      expect(normalized.otaHotelId).toBe('MT-RAW-88');
      expect(normalized.otaHotelName).toBe('西软美团测试酒店');
    });
  });

  describe('fetchRemoteHotelMappings (GET /toolkit/hotel-mappings)', () => {
    it('未指定渠道时调用无参 GET 接口并清洗返回数据', async () => {
      let requestedUrl = '';
      let authHeader = '';

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        requestedUrl = url;
        authHeader = new Headers(init.headers).get('App-Auth') || '';
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            data: [
              {
                id: '101',
                otaChannelCode: 'MEITUAN',
                extUnitCode: 'MT-001',
                otaHotelName: '自贡禅驿度假酒店',
                unitId: 'PMS-01',
                unitName: '自贡禅驿',
              },
            ],
          }),
        };
      });

      const result = await fetchRemoteHotelMappings();

      expect(requestedUrl).toBe('https://pms.example.com/toolkit/hotel-mappings');
      expect(authHeader).toBe('bearer test-token');
      expect(result.length).toBe(1);
      expect(result[0].otaHotelName).toBe('自贡禅驿度假酒店');
      expect(result[0].status).toBe('mapped');
    });

    it('指定渠道代码时拼装 Query 参数 (otaChannelCode)', async () => {
      let requestedUrl = '';

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            data: {
              records: [
                {
                  id: '102',
                  otaChannelCode: 'MEITUAN',
                  extUnitCode: 'MT-002',
                  otaHotelName: '杭州湖滨全季',
                },
              ],
            },
          }),
        };
      });

      const result = await fetchRemoteHotelMappings({ otaChannelCode: 'meituan' });

      expect(requestedUrl).toBe('https://pms.example.com/toolkit/hotel-mappings?otaChannelCode=MEITUAN');
      expect(result.length).toBe(1);
      expect(result[0].otaHotelId).toBe('MT-002');
      expect(result[0].status).toBe('pending');
    });

    it('服务端返回业务错误时 Fail-Fast 阻断抛错', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 500,
            success: false,
            msg: '中台酒店微服务不可用',
          }),
        };
      });

      await expect(fetchRemoteHotelMappings()).rejects.toThrow('平台接口返回业务错误: 中台酒店微服务不可用');
    });
  });

  describe('saveHotelMappingsBatch (POST /toolkit/hotel-mappings/batch)', () => {
    it('参数校验 Fail-Fast：空列表抛错', async () => {
      await expect(saveHotelMappingsBatch([])).rejects.toThrow('没有可保存的门店/酒店映射数据');
    });

    it('参数校验 Fail-Fast：缺少 otaChannelCode 抛错', async () => {
      await expect(
        saveHotelMappingsBatch([
          {
            otaChannelCode: '',
            extUnitCode: 'MT-001',
            otaHotelName: '测试酒店',
          },
        ])
      ).rejects.toThrow('门店映射必须包含渠道代码 otaChannelCode');
    });

    it('参数校验 Fail-Fast：缺少 extUnitCode 抛错', async () => {
      await expect(
        saveHotelMappingsBatch([
          {
            otaChannelCode: 'MEITUAN',
            extUnitCode: '',
            otaHotelName: '测试酒店',
          },
        ])
      ).rejects.toThrow('缺少 OTA 门店编码 extUnitCode');
    });

    it('参数校验 Fail-Fast：缺少 otaHotelName 抛错', async () => {
      await expect(
        saveHotelMappingsBatch([
          {
            otaChannelCode: 'MEITUAN',
            extUnitCode: 'MT-001',
            otaHotelName: '',
          },
        ])
      ).rejects.toThrow('缺少 OTA 门店名称 otaHotelName');
    });

    it('正确发起 POST 请求并发送规范 Payload 结构', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      let requestedBody = '';

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        requestedUrl = url;
        requestedMethod = init.method || 'GET';
        requestedBody = String(init.body || '');
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: 'success',
          }),
        };
      });

      const result = await saveHotelMappingsBatch([
        {
          otaChannelCode: 'meituan',
          extUnitCode: 'MT-9901',
          otaHotelName: '北京国贸大酒店',
          unitId: 'PMS-BJ-012',
          unitType: 'Property',
        },
      ]);

      expect(requestedUrl).toBe('https://pms.example.com/toolkit/hotel-mappings/batch');
      expect(requestedMethod).toBe('POST');
      expect(result).toEqual({ success: true, count: 1 });

      const parsedBody = JSON.parse(requestedBody);
      expect(parsedBody).toEqual([
        {
          otaChannelCode: 'MEITUAN',
          extUnitCode: 'MT-9901',
          otaHotelName: '北京国贸大酒店',
          unitId: 'PMS-BJ-012',
          unitType: 'Property',
        },
      ]);
    });
  });

  describe('deleteRemoteHotelMappings (DELETE /toolkit/hotel-mappings)', () => {
    it('参数校验 Fail-Fast：缺少 ID 抛错', async () => {
      await expect(deleteRemoteHotelMappings([])).rejects.toThrow('缺少要删除的酒店/门店映射记录 ID');
      await expect(deleteRemoteHotelMappings(['  '])).rejects.toThrow('缺少要删除的酒店/门店映射记录 ID');
    });

    it('正确发起 DELETE 请求并传入映射 ID 数组 Payload', async () => {
      let requestedUrl = '';
      let requestedMethod = '';
      let requestedBody = '';

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        requestedUrl = url;
        requestedMethod = init.method || 'GET';
        requestedBody = String(init.body || '');
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: 'success',
          }),
        };
      });

      const result = await deleteRemoteHotelMappings(['map-101', 'map-102']);

      expect(requestedUrl).toBe('https://pms.example.com/toolkit/hotel-mappings');
      expect(requestedMethod).toBe('DELETE');
      expect(result).toEqual({ success: true, deletedCount: 2 });
      expect(JSON.parse(requestedBody)).toEqual(['map-101', 'map-102']);
    });
  });

  describe('STRUCTURE_ENDPOINTS & fetchPlatformProperties', () => {
    it('定义了规范的组织单位与酒店微服务路由', () => {
      expect(STRUCTURE_ENDPOINTS.PROPERTIES).toBe('/configuration/structure-management/properties');
      expect(STRUCTURE_ENDPOINTS.UNITS_ME).toBe('/configuration/unit-structure/units/me/list');
    });

    it('成功从主路由拉取并规范化组织单位/酒店列表', async () => {
      let requestedUrl = '';

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            data: {
              records: [
                { id: 'PMS-001', name: '全季酒店杭州西湖店', code: 'QJ-HZ' },
                { unitId: 'PMS-002', unitName: '三亚亚特兰蒂斯度假酒店', unitCode: 'ATL-SY' },
              ],
            },
          }),
        };
      });

      const result = await fetchPlatformProperties();

      expect(requestedUrl).toBe(
        'https://pms.example.com/configuration/structure-management/properties?showAll=true'
      );
      expect(result.length).toBe(2);
      expect(result[0]).toEqual({
        id: 'PMS-001',
        name: '全季酒店杭州西湖店',
        code: 'QJ-HZ',
        type: 'Property',
      });
      expect(result[1]).toEqual({
        id: 'PMS-002',
        name: '三亚亚特兰蒂斯度假酒店',
        code: 'ATL-SY',
        type: 'Property',
      });
    });

    it('主路由不可用时自动尝试备用路由 /configuration/unit-structure/units/me/list', async () => {
      let requestedUrls: string[] = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        requestedUrls.push(url);
        if (url.includes('/structure-management/properties')) {
          return {
            ok: false,
            status: 404,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ code: 404, msg: 'Not Found' }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            data: [
              { id: 'UNIT-99', name: '自贡禅驿度假酒店', code: 'CY-ZG' },
            ],
          }),
        };
      });

      const result = await fetchPlatformProperties();

      expect(requestedUrls.length).toBe(2);
      expect(requestedUrls[0]).toContain('/structure-management/properties');
      expect(requestedUrls[1]).toContain('/unit-structure/units/me/list');
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('自贡禅驿度假酒店');
    });
  });
});
