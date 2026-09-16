import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import channelReducer, {
  updateChannelFieldMapping,
  toggleChannelField,
  resetChannelProtocol,
  updateRemarkTemplate,
  saveRemarkTemplateAsync,
  fetchRemarkTemplateAsync,
  updateChannelProtocolSchema,
  getSavedProtocolSchema,
  saveProtocolSchemaToStorage,
  removeProtocolSchemaFromStorage,
  getSavedRemarkTemplate,
  saveRemarkTemplateToStorage,
  removeRemarkTemplateFromStorage,
  ALL_CHANNELS_CATALOG,
  SCHEMA_STORAGE_PREFIX,
  TEMPLATE_STORAGE_PREFIX,
  createInitialChannels,
} from '../../../src/store/slices/channelSlice';
import { createAppStore } from '../../../src/store';
import { DEFAULT_MEITUAN_PROTOCOL_SCHEMA } from '../../../src/services/protocols/meituanProtocol';
import { ChannelProtocolSchema, PlatformAuthTokens } from '../../../src/types';
import { saveTokensToStorage } from '../../../src/services/platformAuth';

describe('channelSlice (Protocol Schema & Template Reducer Purity & Listener Persistence)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('1. Pure Reducer Behavior (Zero Side-Effects, Zero External Mutations)', () => {
    it('initializes Meituan channel with default protocol schema and template', () => {
      const state = channelReducer(undefined, { type: '@@INIT' });
      const meituan = state.channels.find((c) => c.id === 'meituan');
      expect(meituan).toBeDefined();
      expect(meituan?.protocolSchema).toBeDefined();
      expect(meituan?.protocolSchema?.channelCode).toBe('MEITUAN');
      expect(meituan?.protocolSchema?.fields.length).toBeGreaterThan(10);
      expect(meituan?.remarkTemplate).toContain('【美团搬单】');
    });

    it('ALL_CHANNELS_CATALOG is frozen and strictly read-only', () => {
      expect(Object.isFrozen(ALL_CHANNELS_CATALOG)).toBe(true);
      // 验证各个子项也是冻结对象
      for (const item of ALL_CHANNELS_CATALOG) {
        expect(Object.isFrozen(item)).toBe(true);
      }
    });

    it('updateChannelFieldMapping updates state purely without touching localStorage or mutating ALL_CHANNELS_CATALOG', () => {
      const state = channelReducer(undefined, { type: '@@INIT' });
      const originalCatalogTemplate = ALL_CHANNELS_CATALOG.find((c) => c.id === 'meituan')?.remarkTemplate;

      const nextState = channelReducer(
        state,
        updateChannelFieldMapping({
          channelId: 'meituan',
          fieldKey: 'floorPrice',
          updates: {
            path: 'data.pricing.newFloorPrice',
            label: '最新底价',
          },
          updatedAt: '2026-09-16 12:00:00',
        })
      );

      const meituan = nextState.channels.find((c) => c.id === 'meituan');
      const field = meituan?.protocolSchema?.fields.find((f) => f.key === 'floorPrice');
      expect(field?.path).toBe('data.pricing.newFloorPrice');
      expect(field?.label).toBe('最新底价');
      expect(meituan?.protocolSchema?.updatedAt).toBe('2026-09-16 12:00:00');

      // 纯函数严密断言：纯 Reducer 调用绝不直接产生 localStorage I/O
      expect(localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}meituan`)).toBeNull();

      // 纯函数严密断言：外部只读常量 ALL_CHANNELS_CATALOG 绝不被就地突变
      expect(ALL_CHANNELS_CATALOG.find((c) => c.id === 'meituan')?.remarkTemplate).toBe(originalCatalogTemplate);
    });

    it('toggleChannelField updates field enabled status purely in-memory', () => {
      const state = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(
        state,
        toggleChannelField({
          channelId: 'meituan',
          fieldKey: 'partnerIncome',
          enabled: false,
          updatedAt: '2026-09-16 13:00:00',
        })
      );

      const meituan = nextState.channels.find((c) => c.id === 'meituan');
      const field = meituan?.protocolSchema?.fields.find((f) => f.key === 'partnerIncome');
      expect(field?.enabled).toBe(false);
      expect(meituan?.protocolSchema?.updatedAt).toBe('2026-09-16 13:00:00');

      // 纯函数无 localStorage 副作用
      expect(localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}meituan`)).toBeNull();
    });

    it('updateRemarkTemplate updates template purely in-memory without side-effects', () => {
      const state = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(
        state,
        updateRemarkTemplate({
          channelId: 'meituan',
          template: '【纯函数测试模板】单号:{OTA订单号}',
        })
      );

      const meituan = nextState.channels.find((c) => c.id === 'meituan');
      expect(meituan?.remarkTemplate).toBe('【纯函数测试模板】单号:{OTA订单号}');

      // 纯函数无 localStorage 副作用
      expect(localStorage.getItem(`${TEMPLATE_STORAGE_PREFIX}meituan`)).toBeNull();
    });

    it('resetChannelProtocol restores defaults in-memory purely', () => {
      const state = channelReducer(undefined, { type: '@@INIT' });
      const modifiedState = channelReducer(
        state,
        updateRemarkTemplate({
          channelId: 'meituan',
          template: '自定义临时模板',
        })
      );

      const resetState = channelReducer(
        modifiedState,
        resetChannelProtocol({ channelId: 'meituan' })
      );

      const meituan = resetState.channels.find((c) => c.id === 'meituan');
      expect(meituan?.remarkTemplate).toContain('【美团搬单】');
      expect(meituan?.protocolSchema?.fields.length).toBe(
        DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields.length
      );
    });

    it('updateChannelProtocolSchema updates schema purely in-memory', () => {
      const state = channelReducer(undefined, { type: '@@INIT' });
      const customSchema: ChannelProtocolSchema = {
        channelId: 'meituan',
        channelCode: 'MEITUAN_CUSTOM',
        version: '3.0.0',
        updatedAt: '2026-09-16 14:00:00',
        fields: [],
      };

      const nextState = channelReducer(
        state,
        updateChannelProtocolSchema({
          channelId: 'meituan',
          schema: customSchema,
        })
      );

      const meituan = nextState.channels.find((c) => c.id === 'meituan');
      expect(meituan?.protocolSchema?.channelCode).toBe('MEITUAN_CUSTOM');
      expect(meituan?.protocolSchema?.version).toBe('3.0.0');
      expect(localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}meituan`)).toBeNull();
    });
  });

  describe('2. Redux Store & Listener Middleware Persistence Integration', () => {
    it('dispatches updateChannelFieldMapping to store and persists to localStorage via listener', () => {
      const store = createAppStore();

      store.dispatch(
        updateChannelFieldMapping({
          channelId: 'meituan',
          fieldKey: 'floorPrice',
          updates: {
            path: 'data.pricing.newFloorPrice',
            label: '最新底价',
          },
          updatedAt: '2026-09-16 15:00:00',
        })
      );

      // 验证 Redux 状态已更新
      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      const field = meituan?.protocolSchema?.fields.find((f) => f.key === 'floorPrice');
      expect(field?.path).toBe('data.pricing.newFloorPrice');
      expect(field?.label).toBe('最新底价');

      // 验证 Listener 中间件安全同步到 localStorage
      const saved = localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}meituan`);
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved as string) as ChannelProtocolSchema;
      const persistedField = parsed.fields.find((f) => f.key === 'floorPrice');
      expect(persistedField?.path).toBe('data.pricing.newFloorPrice');
      expect(persistedField?.label).toBe('最新底价');
    });

    it('dispatches toggleChannelField to store and syncs pruned schema to localStorage', () => {
      const store = createAppStore();

      store.dispatch(
        toggleChannelField({
          channelId: 'meituan',
          fieldKey: 'partnerIncome',
          enabled: false,
          updatedAt: '2026-09-16 15:10:00',
        })
      );

      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      const field = meituan?.protocolSchema?.fields.find((f) => f.key === 'partnerIncome');
      expect(field?.enabled).toBe(false);

      const saved = localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}meituan`);
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved as string) as ChannelProtocolSchema;
      const persistedField = parsed.fields.find((f) => f.key === 'partnerIncome');
      expect(persistedField?.enabled).toBe(false);
    });

    it('dispatches updateRemarkTemplate to store and persists template to localStorage', () => {
      const store = createAppStore();

      store.dispatch(
        updateRemarkTemplate({
          channelId: 'meituan',
          template: '【美团中间件持久化模板】单号:{OTA订单号}',
        })
      );

      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      expect(meituan?.remarkTemplate).toBe('【美团中间件持久化模板】单号:{OTA订单号}');

      const saved = localStorage.getItem(`${TEMPLATE_STORAGE_PREFIX}meituan`);
      expect(saved).toBe('【美团中间件持久化模板】单号:{OTA订单号}');
    });

    it('dispatches saveRemarkTemplateAsync and successfully updates template in Redux and localStorage', async () => {
      const store = createAppStore();
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
      saveTokensToStorage(mockTokens);

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: '模板已保存成功',
            data: { otaChannelCode: 'MEITUAN', remarkTemplate: '【美团API保存】客人:{入住人}' },
          }),
        } as unknown as Response;
      });

      const result = await store.dispatch(
        saveRemarkTemplateAsync({
          channelId: 'meituan',
          otaChannelCode: 'MEITUAN',
          template: '【美团API保存】客人:{入住人}',
        })
      );

      expect(saveRemarkTemplateAsync.fulfilled.match(result)).toBe(true);

      // 验证 Redux 状态
      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      expect(meituan?.remarkTemplate).toBe('【美团API保存】客人:{入住人}');
      expect(store.getState().channel.isSavingTemplate).toBe(false);

      // 验证 Listener 中间件安全写入 localStorage
      const saved = localStorage.getItem(`${TEMPLATE_STORAGE_PREFIX}meituan`);
      expect(saved).toBe('【美团API保存】客人:{入住人}');
    });

    it('handles saveRemarkTemplateAsync.rejected when remote API fails', async () => {
      const store = createAppStore();
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
      saveTokensToStorage(mockTokens);

      const originalTemplate = store.getState().channel.channels.find((c) => c.id === 'meituan')?.remarkTemplate;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 500,
            success: false,
            msg: '远端服务异常: 模板保存受限',
          }),
        } as unknown as Response;
      });

      const result = await store.dispatch(
        saveRemarkTemplateAsync({
          channelId: 'meituan',
          otaChannelCode: 'MEITUAN',
          template: '【错误测试模板】',
        })
      );

      expect(saveRemarkTemplateAsync.rejected.match(result)).toBe(true);
      expect(store.getState().channel.isSavingTemplate).toBe(false);
      expect(store.getState().channel.error).toContain('远端服务异常: 模板保存受限');

      // 验证原始模板未被破坏
      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      expect(meituan?.remarkTemplate).toBe(originalTemplate);
    });

    it('dispatches fetchRemarkTemplateAsync and updates template in Redux and localStorage when remote template exists', async () => {
      const store = createAppStore();
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
      saveTokensToStorage(mockTokens);

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 0,
            msg: 'success',
            data: {
              otaChannelCode: 'MEITUAN',
              remarkTemplate: '【美团云端拉取】外部单号:{OTA订单号}',
            },
          }),
        } as unknown as Response;
      });

      const result = await store.dispatch(
        fetchRemarkTemplateAsync({
          channelId: 'meituan',
          otaChannelCode: 'MEITUAN',
        })
      );

      expect(fetchRemarkTemplateAsync.fulfilled.match(result)).toBe(true);

      // 验证 Redux 状态
      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      expect(meituan?.remarkTemplate).toBe('【美团云端拉取】外部单号:{OTA订单号}');
      expect(store.getState().channel.isLoadingTemplate).toBe(false);

      // 验证 Listener 中间件同步写入 localStorage
      const saved = localStorage.getItem(`${TEMPLATE_STORAGE_PREFIX}meituan`);
      expect(saved).toBe('【美团云端拉取】外部单号:{OTA订单号}');
    });

    it('dispatches fetchRemarkTemplateAsync and handles 404 (null template) by keeping default template', async () => {
      const store = createAppStore();
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
      saveTokensToStorage(mockTokens);

      const defaultTemplate = store.getState().channel.channels.find((c) => c.id === 'meituan')?.remarkTemplate;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            code: 404,
            msg: 'No static resource channel-remark-templates/MEITUAN.',
          }),
        } as unknown as Response;
      });

      const result = await store.dispatch(
        fetchRemarkTemplateAsync({
          channelId: 'meituan',
          otaChannelCode: 'MEITUAN',
        })
      );

      expect(fetchRemarkTemplateAsync.fulfilled.match(result)).toBe(true);
      if (fetchRemarkTemplateAsync.fulfilled.match(result)) {
        expect(result.payload.remarkTemplate).toBeNull();
      }

      // 验证保持原默认模板不被覆盖为 null
      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      expect(meituan?.remarkTemplate).toBe(defaultTemplate);
      expect(store.getState().channel.isLoadingTemplate).toBe(false);
    });

    it('auto-initializes protocolSchema when updating a channel that initially lacked protocolSchema', () => {
      const store = createAppStore();

      // Ctrip initially has protocolSchema === undefined
      const initialCtrip = store.getState().channel.channels.find((c) => c.id === 'ctrip');
      // If ctrip is not yet in initial channels, add it or test with meituanbiz
      const targetChannelId = initialCtrip ? 'ctrip' : 'meituanbiz';

      store.dispatch(
        updateChannelFieldMapping({
          channelId: targetChannelId,
          fieldKey: 'floorPrice',
          updates: {
            path: 'data.pricing.customFloorPrice',
            label: '商旅结算底价',
          },
          updatedAt: '2026-09-16 16:00:00',
        })
      );

      const updatedChannel = store.getState().channel.channels.find((c) => c.id === targetChannelId);
      expect(updatedChannel?.protocolSchema).toBeDefined();
      expect(updatedChannel?.protocolSchema?.fields.find((f) => f.key === 'floorPrice')?.path).toBe(
        'data.pricing.customFloorPrice'
      );

      // Verify listener persisted the auto-initialized and updated schema to localStorage
      const saved = localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}${targetChannelId}`);
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved as string) as ChannelProtocolSchema;
      expect(parsed.fields.find((f) => f.key === 'floorPrice')?.path).toBe('data.pricing.customFloorPrice');
    });

    it('persists entire updated schema via updateChannelProtocolSchema when clicking finish management', () => {
      const store = createAppStore();
      const customSchema: ChannelProtocolSchema = {
        channelId: 'meituan',
        channelCode: 'MEITUAN',
        version: '2026.09.custom',
        updatedAt: '2026-09-16 16:30:00',
        fields: [
          {
            key: 'customKey',
            label: '自定义字段',
            path: 'data.customField',
            category: 'basic',
            transform: 'string',
            sampleValue: 'test',
            description: '测试字段',
            enabled: true,
          },
        ],
      };

      store.dispatch(
        updateChannelProtocolSchema({
          channelId: 'meituan',
          schema: customSchema,
        })
      );

      // 验证 Redux store 中的状态更新
      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      expect(meituan?.protocolSchema?.version).toBe('2026.09.custom');
      expect(meituan?.protocolSchema?.fields.length).toBe(1);
      expect(meituan?.protocolSchema?.fields[0].key).toBe('customKey');

      // 验证 listener 中间件已将该 schema 成功写入 localStorage
      const saved = getSavedProtocolSchema('meituan');
      expect(saved).not.toBeNull();
      expect(saved?.version).toBe('2026.09.custom');
      expect(saved?.fields[0].key).toBe('customKey');
    });

    it('dispatches resetChannelProtocol to store and cleans up localStorage cache', () => {
      const store = createAppStore();

      // 先通过 dispatch 写入自定义模板与 Schema
      store.dispatch(
        updateRemarkTemplate({
          channelId: 'meituan',
          template: '待重置的自定义模板',
        })
      );
      expect(localStorage.getItem(`${TEMPLATE_STORAGE_PREFIX}meituan`)).toBe('待重置的自定义模板');

      store.dispatch(
        updateChannelFieldMapping({
          channelId: 'meituan',
          fieldKey: 'floorPrice',
          updates: { path: 'custom.path' },
        })
      );
      expect(localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}meituan`)).not.toBeNull();

      // 执行重置
      store.dispatch(resetChannelProtocol({ channelId: 'meituan' }));

      // 验证 state 已恢复
      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      expect(meituan?.remarkTemplate).toContain('【美团搬单】');

      // 验证 Listener 中间件已安全清理 localStorage
      expect(localStorage.getItem(`${TEMPLATE_STORAGE_PREFIX}meituan`)).toBeNull();
      expect(localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}meituan`)).toBeNull();
    });

    it('dispatches updateChannelProtocolSchema to store and syncs full schema', () => {
      const store = createAppStore();
      const customSchema: ChannelProtocolSchema = {
        channelId: 'douyin',
        channelCode: 'DOUYIN_V3',
        version: '3.0.0',
        updatedAt: '2026-09-16 16:00:00',
        fields: [],
      };

      store.dispatch(
        updateChannelProtocolSchema({
          channelId: 'douyin',
          schema: customSchema,
        })
      );

      const douyin = store.getState().channel.channels.find((c) => c.id === 'douyin');
      expect(douyin?.protocolSchema?.channelCode).toBe('DOUYIN_V3');

      const saved = localStorage.getItem(`${SCHEMA_STORAGE_PREFIX}douyin`);
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved as string) as ChannelProtocolSchema;
      expect(parsed.channelCode).toBe('DOUYIN_V3');
    });

    it('ensures protocol schema modifications survive modal reopen and page refresh', () => {
      const store = createAppStore();

      // 1. 用户打开美团“管理协议字段”，调整了结算底价路径并点击“完成管理”
      const meituan = store.getState().channel.channels.find((c) => c.id === 'meituan');
      expect(meituan?.protocolSchema).toBeDefined();

      const modifiedFields = meituan!.protocolSchema!.fields.map((f) =>
        f.key === 'floorPrice'
          ? { ...f, path: 'data.myCustomFloorPrice', label: '自定义底价字段' }
          : f
      );
      const updatedSchema: ChannelProtocolSchema = {
        ...meituan!.protocolSchema!,
        fields: modifiedFields,
        updatedAt: '2026-09-16 17:00:00',
      };

      store.dispatch(updateChannelProtocolSchema({ channelId: 'meituan', schema: updatedSchema }));

      // 2. 模拟用户关闭弹窗后“再次打开”：从 Redux 当前状态读取
      const reopenedChannel = store.getState().channel.channels.find((c) => c.id === 'meituan');
      const reopenedField = reopenedChannel?.protocolSchema?.fields.find((f) => f.key === 'floorPrice');
      expect(reopenedField?.path).toBe('data.myCustomFloorPrice');
      expect(reopenedField?.label).toBe('自定义底价字段');

      // 3. 模拟用户刷新页面 (F5/Reload)：Redux store 重新从 createInitialChannels 初始化
      const freshChannels = createInitialChannels();
      const reloadedMeituan = freshChannels.find((c) => c.id === 'meituan');
      const reloadedField = reloadedMeituan?.protocolSchema?.fields.find((f) => f.key === 'floorPrice');

      expect(reloadedMeituan?.protocolSchema).toBeDefined();
      expect(reloadedField?.path).toBe('data.myCustomFloorPrice');
      expect(reloadedField?.label).toBe('自定义底价字段');
    });
  });


  describe('localStorage Helper Functions & Fail-Safe Protection', () => {
    it('correctly reads, writes, and removes protocol schemas from storage', () => {
      const mockSchema: ChannelProtocolSchema = {
        channelId: 'test_chan',
        channelCode: 'TEST',
        version: '1.0.0',
        updatedAt: '2026-09-16 10:00:00',
        fields: [],
      };

      saveProtocolSchemaToStorage('test_chan', mockSchema);
      const retrieved = getSavedProtocolSchema('test_chan');
      expect(retrieved).toEqual(mockSchema);

      removeProtocolSchemaFromStorage('test_chan');
      expect(getSavedProtocolSchema('test_chan')).toBeNull();
    });

    it('correctly reads, writes, and removes remark templates from storage', () => {
      saveRemarkTemplateToStorage('test_chan', '模板内容:{订单号}');
      expect(getSavedRemarkTemplate('test_chan')).toBe('模板内容:{订单号}');

      removeRemarkTemplateFromStorage('test_chan');
      expect(getSavedRemarkTemplate('test_chan')).toBeNull();
    });

    it('safely handles corrupted JSON in storage without throwing', () => {
      localStorage.setItem(`${SCHEMA_STORAGE_PREFIX}corrupted`, '{ invalid json');
      expect(getSavedProtocolSchema('corrupted')).toBeNull();

      localStorage.setItem(`${SCHEMA_STORAGE_PREFIX}not_schema`, JSON.stringify({ notFields: 123 }));
      expect(getSavedProtocolSchema('not_schema')).toBeNull();
    });

    it('safely handles localStorage throwing exceptions', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('QuotaExceeded or SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceeded or SecurityError');
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('QuotaExceeded or SecurityError');
      });

      // 不应抛出任何异常
      expect(() => getSavedProtocolSchema('any')).not.toThrow();
      expect(getSavedProtocolSchema('any')).toBeNull();

      expect(() => getSavedRemarkTemplate('any')).not.toThrow();
      expect(getSavedRemarkTemplate('any')).toBeNull();

      expect(() =>
        saveProtocolSchemaToStorage('any', {
          channelId: 'any',
          channelCode: 'ANY',
          version: '1.0.0',
          updatedAt: '',
          fields: [],
        })
      ).not.toThrow();

      expect(() => saveRemarkTemplateToStorage('any', 'template')).not.toThrow();
      expect(() => removeProtocolSchemaFromStorage('any')).not.toThrow();
      expect(() => removeRemarkTemplateFromStorage('any')).not.toThrow();
    });
  });
});
