import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchCulturalTourismChannels,
  fetchChannelMappings,
  saveChannelMappingsBatch,
  saveChannelRemarkTemplate,
  fetchChannelRemarkTemplate,
  extractDataItems,
  normalizeCulturalTourismChannel,
  normalizeOTAChannelMappingRecord,
  validateAndBuildChannelMappingPayload,
  CHANNEL_ENDPOINTS,
  TOOLKIT_MODULE,
} from '../../src/services/channelApi';
import { saveTokensToStorage, clearTokensFromStorage } from '../../src/services/platformAuth';
import { PlatformAuthTokens, SaveChannelMappingPayloadItem } from '../../src/types';

describe('channelApi - 文旅渠道与 OTA 渠道映射服务层', () => {
  const mockTokens: PlatformAuthTokens = {
    accessToken: 'test-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600 * 1000,
    tokenType: 'bearer',
    platformBaseUrl: 'https://pms.example.com',
    tenantId: 'XR-01',
    authenticatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    clearTokensFromStorage();
    saveTokensToStorage(mockTokens);
    vi.restoreAllMocks();
  });

  describe('extractDataItems & Normalizers', () => {
    it('TOOLKIT_MODULE 常量与 CHANNEL_ENDPOINTS 配置正确', () => {
      expect(TOOLKIT_MODULE).toBe('toolkit');
      expect(CHANNEL_ENDPOINTS.CHANNEL_REMARK_TEMPLATES).toBe('/toolkit/channel-remark-templates');
      expect(CHANNEL_ENDPOINTS.OTA_CHANNEL_MAPPINGS).toBe('/toolkit/channel-mappings');
      expect(CHANNEL_ENDPOINTS.OTA_CHANNEL_MAPPINGS_BATCH).toBe('/toolkit/channel-mappings/batch');
    });

    it('extractDataItems 支持直接数组、{ data: [...] } 与 { data: { records: [...] } }', () => {
      expect(extractDataItems(null)).toEqual([]);
      expect(extractDataItems([ { id: 1 } ])).toEqual([ { id: 1 } ]);
      expect(extractDataItems({ data: [ { id: 2 } ] })).toEqual([ { id: 2 } ]);
      expect(extractDataItems({ data: { records: [ { id: 3 } ] } })).toEqual([ { id: 3 } ]);
      expect(extractDataItems({ data: { items: [ { id: 4 } ] } })).toEqual([ { id: 4 } ]);
      expect(extractDataItems({ data: { otaChannelCode: 'MT', channelCode: 'MT' } })).toEqual([
        { otaChannelCode: 'MT', channelCode: 'MT' },
      ]);
    });

    it('normalizeCulturalTourismChannel 规范化文旅渠道并滤除缺失关键字段的数据', () => {
      const valid = normalizeCulturalTourismChannel({
        channelId: '101',
        channelCode: 'CTRIP_DIR',
        channelName: '携程直连商户',
        status: 'A',
      });
      expect(valid).toEqual({
        id: '101',
        channelId: '101',
        channelCode: 'CTRIP_DIR',
        channelName: '携程直连商户',
        status: 'A',
        otaChannelCode: undefined,
      });

      // 缺失 channelCode 或 channelId 返回 null
      expect(normalizeCulturalTourismChannel({ channelId: '101' })).toBeNull();
      expect(normalizeCulturalTourismChannel({ channelCode: 'CTRIP_DIR' })).toBeNull();
    });

    it('normalizeOTAChannelMappingRecord 规范化 OTA 渠道映射记录', () => {
      const valid = normalizeOTAChannelMappingRecord({
        mappingId: 'map-01',
        otaChannelCode: 'meituan',
        channelCode: 'MT_PMS',
        channelId: '202',
        channelName: '美团对接通道',
      });

      expect(valid).toEqual({
        id: 'map-01',
        mappingId: 'map-01',
        otaChannelCode: 'MEITUAN',
        otaChannelName: 'MEITUAN',
        channelId: '202',
        channelCode: 'MT_PMS',
        channelName: '美团对接通道',
        status: 'A',
      });

      expect(normalizeOTAChannelMappingRecord({})).toBeNull();
    });

    it('extractDataItems 遇到业务错误信封时 Fail-Fast 阻断抛错，杜绝静默吞噬', () => {
      expect(() =>
        extractDataItems({ code: 500, msg: '租户服务已到期', success: false })
      ).toThrow('平台接口返回业务错误: 租户服务已到期');

      expect(() =>
        extractDataItems({ success: false, message: '系统内部异常' })
      ).toThrow('平台接口返回业务错误: 系统内部异常');

      expect(() =>
        extractDataItems({ data: { code: 403, msg: '无权操作' } })
      ).toThrow('平台接口返回业务错误: 无权操作');
    });

    it('extractDataItems 支持字符串状态码校验并 Fail-Fast 抛错（杜绝 code: "500" 等逃逸）', () => {
      expect(() =>
        extractDataItems({ code: '500', msg: '租户服务已到期', success: false })
      ).toThrow('平台接口返回业务错误: 租户服务已到期');

      expect(() =>
        extractDataItems({ data: { code: '403', msg: '无权操作' } })
      ).toThrow('平台接口返回业务错误: 无权操作');

      // 正常的 code 字符串 "0" 与 "200" 不应抛错
      expect(extractDataItems({ code: '0', data: [{ id: 100 }] })).toEqual([{ id: 100 }]);
      expect(extractDataItems({ code: '200', data: [{ id: 200 }] })).toEqual([{ id: 200 }]);
    });

    it('normalizeOTAChannelMappingRecord 支持解析 raw.rateChannelId 作为 channelIdRaw', () => {
      const record = normalizeOTAChannelMappingRecord({
        mappingId: 'map-rate-01',
        otaChannelCode: 'douyin',
        channelCode: 'DY_PMS',
        rateChannelId: '999',
        channelName: '抖音直连',
      });

      expect(record).not.toBeNull();
      expect(record?.channelId).toBe('999');
      expect(record?.channelCode).toBe('DY_PMS');
      expect(record?.otaChannelCode).toBe('DOUYIN');
    });

    it('normalizeOTAChannelMappingRecord 严格校验 channelId 必填性且不将 mapping 的 id 误作为 channelId', () => {
      expect(
        normalizeOTAChannelMappingRecord({
          mappingId: 'map-01',
          otaChannelCode: 'meituan',
          channelCode: 'MT_PMS',
          channelId: '',
        })
      ).toBeNull();

      expect(
        normalizeOTAChannelMappingRecord({
          id: 'map-01',
          otaChannelCode: 'meituan',
          channelCode: 'MT_PMS',
        })
      ).toBeNull();
    });
  });

  describe('fetchCulturalTourismChannels', () => {
    it('调用 GET /rate-management/channels?showAll=true 并正确归一化与去重', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            data: [
              { channelId: '1', channelCode: 'MT', channelName: '美团直连', status: 'A' },
              { channelId: '2', channelCode: 'CTRP', channelName: '携程直签', status: 'A' },
              { channelId: '3', channelCode: 'MT', channelName: '美团重复', status: 'A' }, // 重复 code
              { channelId: '4', channelCode: 'INACTIVE', channelName: '已停用', status: 'I' }, // 已停用
            ],
          }),
        } as unknown as Response;
      });

      const channels = await fetchCulturalTourismChannels();

      expect(capturedUrl).toBe(`https://pms.example.com${CHANNEL_ENDPOINTS.RATE_MANAGEMENT_CHANNELS}?showAll=true`);
      expect(channels.length).toBe(2);
      expect(channels[0].channelCode).toBe('MT');
      expect(channels[0].channelName).toBe('美团直连');
      expect(channels[1].channelCode).toBe('CTRP');
    });
  });

  describe('fetchChannelMappings', () => {
    it('调用 GET /toolkit/channel-mappings 并支持按 otaChannelCode 过滤查询', async () => {
      let capturedUrl = '';
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            data: [
              {
                id: 'm-1',
                otaChannelCode: 'MEITUAN',
                otaChannelName: '美团',
                channelId: '1',
                channelCode: 'MT',
                channelName: '美团直连',
                status: 'A',
              },
            ],
          }),
        } as unknown as Response;
      });

      const mappings = await fetchChannelMappings('MEITUAN');

      expect(capturedUrl).toBe(`https://pms.example.com${CHANNEL_ENDPOINTS.OTA_CHANNEL_MAPPINGS}?otaChannelCode=MEITUAN`);
      expect(mappings.length).toBe(1);
      expect(mappings[0].otaChannelCode).toBe('MEITUAN');
      expect(mappings[0].channelCode).toBe('MT');
      expect(mappings[0].channelId).toBe('1');
    });

    it('fetchChannelMappings 自动过滤 status === "I" 的停用作废映射记录', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            data: [
              {
                id: 'm-active',
                otaChannelCode: 'CTRIP',
                channelCode: 'CTRIP_DIR',
                channelId: '101',
                status: 'A',
              },
              {
                id: 'm-inactive',
                otaChannelCode: 'CTRIP',
                channelCode: 'CTRIP_OLD',
                channelId: '999',
                status: 'I',
              },
            ],
          }),
        } as unknown as Response;
      });

      const mappings = await fetchChannelMappings('CTRIP');
      expect(mappings.length).toBe(1);
      expect(mappings[0].id).toBe('m-active');
      expect(mappings[0].channelCode).toBe('CTRIP_DIR');
      expect(mappings[0].status).toBe('A');
    });
  });

  describe('saveChannelMappingsBatch & validateAndBuildChannelMappingPayload', () => {
    it('当必填字段缺失时 Fail-Fast 抛错，绝不隐式降级', async () => {
      expect(() =>
        validateAndBuildChannelMappingPayload({
          otaChannelCode: '',
          channelCode: 'MT',
          channelId: '1',
        })
      ).toThrow('渠道映射缺少必填字段: otaChannelCode');

      expect(() =>
        validateAndBuildChannelMappingPayload({
          otaChannelCode: 'MEITUAN',
          channelCode: '',
          channelId: '1',
        })
      ).toThrow('渠道映射缺少必填字段: channelCode');

      expect(() =>
        validateAndBuildChannelMappingPayload({
          otaChannelCode: 'MEITUAN',
          channelCode: 'MT',
          channelId: '',
        })
      ).toThrow('渠道映射缺少必填字段: channelId');

      await expect(saveChannelMappingsBatch([])).rejects.toThrow('没有可保存的渠道映射。');
    });

    it('正确发起 PUT /toolkit/channel-mappings/batch 请求并提交批量映射', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedBody = '';

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedMethod = init?.method || '';
        capturedBody = String(init?.body || '');
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: '渠道映射保存成功',
          }),
        } as unknown as Response;
      });

      const payload: SaveChannelMappingPayloadItem[] = [
        {
          otaChannelCode: 'MEITUAN',
          otaChannelName: '美团',
          channelCode: 'MT',
          channelId: '101',
          status: 'A',
        },
        {
          otaChannelCode: 'DOUYIN',
          otaChannelName: '抖音',
          channelCode: 'DY',
          channelId: '102',
        },
      ];

      const res = await saveChannelMappingsBatch(payload);

      expect(capturedUrl).toBe(`https://pms.example.com${CHANNEL_ENDPOINTS.OTA_CHANNEL_MAPPINGS_BATCH}`);
      expect(capturedMethod).toBe('PUT');
      const sentPayload = JSON.parse(capturedBody);
      expect(sentPayload).toEqual([
        {
          otaChannelCode: 'MEITUAN',
          otaChannelName: '美团',
          channelCode: 'MT',
          channelId: '101',
          status: 'A',
        },
        {
          otaChannelCode: 'DOUYIN',
          otaChannelName: '抖音',
          channelCode: 'DY',
          channelId: '102',
          status: 'A',
        },
      ]);
      expect(res.ok).toBe(true);
      expect(res.message).toBe('渠道映射保存成功');
    });

    it('正确解析并提取服务端 response.data 中返回的已生成映射记录与真实 mappingId', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: '保存成功',
            data: [
              {
                mappingId: 'server-gen-map-999',
                otaChannelCode: 'MEITUAN',
                otaChannelName: '美团外卖民宿',
                channelCode: 'MT_PMS',
                channelId: '202',
                channelName: '美团直连通道',
                status: 'A',
              },
            ],
          }),
        } as unknown as Response;
      });

      const payload: SaveChannelMappingPayloadItem[] = [
        {
          otaChannelCode: 'MEITUAN',
          channelCode: 'MT_PMS',
          channelId: '202',
        },
      ];

      const res = await saveChannelMappingsBatch(payload);
      expect(res.ok).toBe(true);
      expect(res.records.length).toBe(1);
      expect(res.records[0].mappingId).toBe('server-gen-map-999');
      expect(res.records[0].id).toBe('server-gen-map-999');
      expect(res.records[0].otaChannelCode).toBe('MEITUAN');
      expect(res.records[0].channelCode).toBe('MT_PMS');
      expect(res.records[0].channelId).toBe('202');
    });


    it('当后端返回业务失败（code 非 0 或 success 为 false）时抛出异常，绝不伪造成功', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 500,
            success: false,
            msg: '目标文旅渠道不存在或已被停用',
          }),
        } as unknown as Response;
      });

      await expect(
        saveChannelMappingsBatch([
          {
            otaChannelCode: 'MEITUAN',
            channelCode: 'INVALID_CODE',
            channelId: '999',
          },
        ])
      ).rejects.toThrow('保存渠道映射失败: 目标文旅渠道不存在或已被停用');
    });

    it('当后端返回字符串业务失败状态码（如 code: "500"）时 Fail-Fast 抛错，杜绝字符串 code 逃逸', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: '500',
            success: false,
            msg: '文旅平台底层服务异常',
          }),
        } as unknown as Response;
      });

      await expect(
        saveChannelMappingsBatch([
          {
            otaChannelCode: 'MEITUAN',
            channelCode: 'MT_PMS',
            channelId: '101',
          },
        ])
      ).rejects.toThrow('保存渠道映射失败: 文旅平台底层服务异常');
    });
  });

  describe('saveChannelRemarkTemplate (PUT /toolkit/channel-remark-templates/{otaChannelCode})', () => {
    it('成功调用保存渠道备注模板接口并返回结构化结果', async () => {
      let interceptedUrl = '';
      let interceptedMethod = '';
      let interceptedBody = '';
      let interceptedAuth = '';

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        interceptedUrl = url;
        interceptedMethod = init?.method || '';
        interceptedBody = init?.body as string;
        interceptedAuth = (init?.headers as Headers)?.get('App-Auth') || '';

        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: '模板保存成功',
            data: { otaChannelCode: 'MEITUAN', remarkTemplate: '【美团】单号:{OTA订单号}' },
          }),
        } as unknown as Response;
      });

      const res = await saveChannelRemarkTemplate('meituan', {
        remarkTemplate: '【美团】单号:{OTA订单号}',
      });

      expect(res.ok).toBe(true);
      expect(res.otaChannelCode).toBe('meituan');
      expect(res.remarkTemplate).toBe('【美团】单号:{OTA订单号}');
      expect(res.message).toBe('模板保存成功');

      // 验证真实请求参数，确认包含文旅后台 toolkit 业务模块前缀
      expect(interceptedUrl).toBe('https://pms.example.com/toolkit/channel-remark-templates/MEITUAN');
      expect(interceptedMethod).toBe('PUT');
      expect(interceptedAuth).toBe('bearer test-token');
      expect(JSON.parse(interceptedBody)).toEqual({
        remarkTemplate: '【美团】单号:{OTA订单号}',
      });
    });

    it('当缺少 otaChannelCode 时 Fail-Fast 阻断，不发起网络调用', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      await expect(
        saveChannelRemarkTemplate('', { remarkTemplate: 'test' })
      ).rejects.toThrow('保存渠道备注模板缺少必填参数: otaChannelCode');

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('当缺少 remarkTemplate 字段时 Fail-Fast 阻断', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      await expect(
        saveChannelRemarkTemplate('MEITUAN', null as unknown as { remarkTemplate: string })
      ).rejects.toThrow('保存渠道备注模板缺少必填字段: remarkTemplate');

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('当后端返回业务失败信封（code: 500, success: false）时抛出异常', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 500,
            success: false,
            msg: '渠道不存在或已被禁用',
          }),
        } as unknown as Response;
      });

      await expect(
        saveChannelRemarkTemplate('UNKNOWN_CHANNEL', {
          remarkTemplate: 'test',
        })
      ).rejects.toThrow('保存渠道备注模板失败: 渠道不存在或已被禁用');
    });
  });

  describe('fetchChannelRemarkTemplate (GET /toolkit/channel-remark-templates/{otaChannelCode})', () => {
    it('成功调用获取渠道备注模板接口并返回有效模板', async () => {
      let interceptedUrl = '';
      let interceptedMethod = '';
      let interceptedAuth = '';

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        interceptedUrl = url;
        interceptedMethod = init?.method || '';
        interceptedAuth = (init?.headers as Headers)?.get('App-Auth') || '';

        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: 'success',
            data: {
              otaChannelCode: 'MEITUAN',
              remarkTemplate: '【美团后台模板】外部单号:{OTA订单号}，客人:{入住人}',
            },
          }),
        } as unknown as Response;
      });

      const res = await fetchChannelRemarkTemplate('meituan');

      expect(res.otaChannelCode).toBe('meituan');
      expect(res.remarkTemplate).toBe('【美团后台模板】外部单号:{OTA订单号}，客人:{入住人}');
      expect(interceptedUrl).toBe('https://pms.example.com/toolkit/channel-remark-templates/MEITUAN');
      expect(interceptedMethod).toBe('GET');
      expect(interceptedAuth).toBe('bearer test-token');
    });

    it('当服务端返回 404 NOT_FOUND 时，优雅解析为 remarkTemplate: null 供展示默认模板', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 404,
            msg: 'No static resource channel-remark-templates/UNKNOWN.',
          }),
        } as unknown as Response;
      });

      const res = await fetchChannelRemarkTemplate('UNKNOWN');

      expect(res.otaChannelCode).toBe('UNKNOWN');
      expect(res.remarkTemplate).toBeNull();
    });

    it('当服务端返回 200 但 data 为 null 或空串时，返回 remarkTemplate: null', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: 'success',
            data: {
              otaChannelCode: 'DOUYIN',
              remarkTemplate: '   ',
            },
          }),
        } as unknown as Response;
      });

      const res = await fetchChannelRemarkTemplate('douyin');

      expect(res.otaChannelCode).toBe('douyin');
      expect(res.remarkTemplate).toBeNull();
    });

    it('当缺少 otaChannelCode 时 Fail-Fast 阻断，不发起网络调用', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy;

      await expect(fetchChannelRemarkTemplate('')).rejects.toThrow(
        '查询渠道备注模板缺少必填参数: otaChannelCode'
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('当遇到 500 等不可恢复的后端错误时 Fail-Fast 抛出异常', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 500,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 500,
            msg: '内部数据库异常',
          }),
        } as unknown as Response;
      });

      await expect(fetchChannelRemarkTemplate('MEITUAN')).rejects.toThrow(
        '平台接口调用失败 (500)'
      );
    });

    it('当服务端返回 HTTP 200 但业务信封标记失败（success: false）时 Fail-Fast 抛出异常', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 500,
            success: false,
            msg: '远端服务异常: 数据库连接丢失',
          }),
        } as unknown as Response;
      });

      await expect(fetchChannelRemarkTemplate('MEITUAN')).rejects.toThrow(
        '获取渠道备注模板失败: 远端服务异常: 数据库连接丢失'
      );
    });
  });
});
