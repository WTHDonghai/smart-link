import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type {
  OTAChannel,
  CulturalTourismChannel,
  OTAChannelMappingRecord,
  SaveChannelMappingPayloadItem,
  ProtocolFieldMapping,
  ChannelProtocolSchema,
} from '../../types';
import {
  fetchCulturalTourismChannels,
  fetchChannelMappings,
  saveChannelMappingsBatch,
  saveChannelRemarkTemplate,
  fetchChannelRemarkTemplate,
} from '../../services/channelApi';
import {
  DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
  DEFAULT_MEITUAN_REMARK_TEMPLATE,
} from '../../services/protocols/meituanProtocol';
import {
  DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
  DEFAULT_DOUYIN_REMARK_TEMPLATE,
} from '../../services/protocols/douyinProtocol';
import { getOtaChannelUrl } from '../../config/otaUrls';

export const SCHEMA_STORAGE_PREFIX = 'smartlink_schema_';
export const TEMPLATE_STORAGE_PREFIX = 'smartlink_template_';

/**
 * 安全获取 LocalStorage 实例（兼顾 window.localStorage 与全局 localStorage）
 */
function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 从本地存储读取自定义协议 Schema
 */
export function getSavedProtocolSchema(channelId: string): ChannelProtocolSchema | null {
  try {
    const storage = getLocalStorage();
    if (!storage) return null;
    const raw = storage.getItem(`${SCHEMA_STORAGE_PREFIX}${channelId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.fields)) {
      return parsed as ChannelProtocolSchema;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 将自定义协议 Schema 安全持久化至本地存储
 */
export function saveProtocolSchemaToStorage(channelId: string, schema: ChannelProtocolSchema): void {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.setItem(`${SCHEMA_STORAGE_PREFIX}${channelId}`, JSON.stringify(schema));
  } catch {
    // 捕获 storage 异常防崩
  }
}

/**
 * 从本地存储安全移除自定义协议 Schema 缓存
 */
export function removeProtocolSchemaFromStorage(channelId: string): void {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.removeItem(`${SCHEMA_STORAGE_PREFIX}${channelId}`);
  } catch {
    // 捕获 storage 异常防崩
  }
}

/**
 * 从本地存储读取自定义备注模板
 */
export function getSavedRemarkTemplate(channelId: string): string | null {
  try {
    const storage = getLocalStorage();
    if (!storage) return null;
    const item = storage.getItem(`${TEMPLATE_STORAGE_PREFIX}${channelId}`);
    return typeof item === 'string' ? item : null;
  } catch {
    return null;
  }
}

/**
 * 将自定义备注模板安全持久化至本地存储
 */
export function saveRemarkTemplateToStorage(channelId: string, template: string): void {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.setItem(`${TEMPLATE_STORAGE_PREFIX}${channelId}`, template);
  } catch {
    // 捕获 storage 异常防崩
  }
}

/**
 * 从本地存储安全移除自定义备注模板缓存
 */
export function removeRemarkTemplateFromStorage(channelId: string): void {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.removeItem(`${TEMPLATE_STORAGE_PREFIX}${channelId}`);
  } catch {
    // 捕获 storage 异常防崩
  }
}

export const BASE_CHANNELS_CATALOG: readonly Omit<OTAChannel, 'todayOrders' | 'lastSyncTime'>[] = [
  {
    id: 'meituan',
    name: '美团',
    code: 'MEITUAN',
    short: '美',
    bgColor: 'bg-[#fff1e0]',
    textColor: 'text-[#ff7d00]',
    targetSystem: 'meituan',
    targetSystemOptions: [
      { val: 'meituan', label: '美团 (MEITUAN)' },
      { val: 'meituan_sub_01', label: '美团自营分销 01 (MEITUAN_S1)' },
      { val: 'meituan_sub_02', label: '美团直签通道 02 (MEITUAN_DIR)' }
    ],
    remarkTemplate: DEFAULT_MEITUAN_REMARK_TEMPLATE,
    protocolSchema: DEFAULT_MEITUAN_PROTOCOL_SCHEMA,
    storeCrawlUrl: getOtaChannelUrl('MEITUAN'),
    status: 'active',
    crawlerStatus: 'online'
  },
  {
    id: 'meituanbiz',
    name: '美团商旅',
    code: 'MEITUAN_BIZ',
    short: '商',
    bgColor: 'bg-[#eef2ff]',
    textColor: 'text-[#004ac6]',
    targetSystem: 'meituanbiz',
    targetSystemOptions: [
      { val: 'meituanbiz', label: '美团商旅 (MEITUAN_BIZ)' },
      { val: 'meituanbiz_vip', label: '美团企业采购 VIP (MEITUAN_CORP)' }
    ],
    remarkTemplate: '【企业商旅协议】OTA单号:{OTA订单号} | 企业统一结算 | {入住人} | 请提供增值税专用发票',
    storeCrawlUrl: getOtaChannelUrl('MEITUAN_BIZ'),
    status: 'active',
    crawlerStatus: 'online'
  },
  {
    id: 'douyin',
    name: '抖音',
    code: 'DOUYIN',
    short: '抖',
    bgColor: 'bg-[#0f172a]',
    textColor: 'text-white',
    targetSystem: 'douyin',
    targetSystemOptions: [
      { val: 'douyin', label: '抖音 (DOUYIN)' },
      { val: 'douyin_life', label: '抖音本地生活服务 (DOUYIN_LOCAL)' }
    ],
    remarkTemplate: DEFAULT_DOUYIN_REMARK_TEMPLATE,
    protocolSchema: DEFAULT_DOUYIN_PROTOCOL_SCHEMA,
    storeCrawlUrl: getOtaChannelUrl('DOUYIN'),
    status: 'active',
    crawlerStatus: 'online'
  },
  {
    id: 'ctrip',
    name: '携程旅行',
    code: 'CTRIP',
    short: '携',
    bgColor: 'bg-[#2577e3]',
    textColor: 'text-white',
    targetSystem: 'ctrip_direct',
    targetSystemOptions: [
      { val: 'ctrip_direct', label: '携程直连商户 (CTRIP_DIR)' },
      { val: 'ctrip_corp', label: '携程商旅直通 (CTRIP_CORP)' },
      { val: 'ctrip_agent', label: '携程代理分销 (CTRIP_AGENT)' }
    ],
    remarkTemplate: '【携程直销】订单号:{OTA订单号}，房型:{房型名称}，入住人:{入住人}，底价:{底价}，请及时排房。',
    storeCrawlUrl: getOtaChannelUrl('CTRIP'),
    status: 'active',
    crawlerStatus: 'online'
  },
  {
    id: 'tongcheng',
    name: '同程旅行',
    code: 'TONGCHENG',
    short: '同',
    bgColor: 'bg-[#0fc26a]',
    textColor: 'text-white',
    targetSystem: 'tongcheng_main',
    targetSystemOptions: [
      { val: 'tongcheng_main', label: '同程艺龙直连 (TONGCHENG_MAIN)' },
      { val: 'tongcheng_b2b', label: '同程企业集采 (TC_B2B)' }
    ],
    remarkTemplate: '【同程订单】外部单号:{OTA订单号}，客人:{入住人}，间夜:{间夜数}，无早。',
    storeCrawlUrl: getOtaChannelUrl('TONGCHENG'),
    status: 'active',
    crawlerStatus: 'online'
  },
  {
    id: 'fliggy',
    name: '飞猪旅行',
    code: 'FLIGGY',
    short: '猪',
    bgColor: 'bg-[#ffc800]',
    textColor: 'text-[#805000]',
    targetSystem: 'fliggy_open',
    targetSystemOptions: [
      { val: 'fliggy_open', label: '飞猪开放平台直连 (FLIGGY_OPEN)' },
      { val: 'fliggy_alitrip', label: '阿里商旅分销 (ALITRIP_CORP)' }
    ],
    remarkTemplate: '【飞猪信用住】单号:{OTA订单号}，免押免查房，离店后自动结算。',
    storeCrawlUrl: getOtaChannelUrl('FLIGGY'),
    status: 'active',
    crawlerStatus: 'online'
  },
  {
    id: 'qunar',
    name: '去哪儿',
    code: 'QUNAR',
    short: '去',
    bgColor: 'bg-[#00afc7]',
    textColor: 'text-white',
    targetSystem: 'qunar_hotel',
    targetSystemOptions: [
      { val: 'qunar_hotel', label: '去哪儿酒店直连 (QUNAR_HOTEL)' },
      { val: 'qunar_b2b', label: '去哪儿同业分销 (QUNAR_B2B)' }
    ],
    remarkTemplate: '【去哪儿】单号:{OTA订单号}，预留至20:00，房型:{房型名称}。',
    storeCrawlUrl: getOtaChannelUrl('QUNAR'),
    status: 'active',
    crawlerStatus: 'online'
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    code: 'RED',
    short: '红',
    bgColor: 'bg-[#ff2442]',
    textColor: 'text-white',
    targetSystem: 'red_store',
    targetSystemOptions: [
      { val: 'red_store', label: '小红书自营店铺 (RED_STORE)' },
      { val: 'red_trips', label: '小红书文旅预订 (RED_TRIPS)' }
    ],
    remarkTemplate: '【小红书种草单】单号:{OTA订单号}，网红探店客户，送欢迎水果礼遇。',
    storeCrawlUrl: getOtaChannelUrl('RED'),
    status: 'active',
    crawlerStatus: 'online'
  }
];

export const ALL_CHANNELS_CATALOG: readonly Omit<OTAChannel, 'todayOrders' | 'lastSyncTime'>[] = Object.freeze(
  BASE_CHANNELS_CATALOG.map((item) => Object.freeze({ ...item }))
);

export interface ChannelState {
  channels: OTAChannel[];
  culturalTourismChannels: CulturalTourismChannel[];
  mappings: OTAChannelMappingRecord[];
  isLoading: boolean;
  isSaving: boolean;
  savingChannelId: string | null;
  error: string | null;
  selectedChannelForTemplate: string | null;
  isSavingTemplate: boolean;
  isLoadingTemplate: boolean;
}

export const createInitialChannels = (): OTAChannel[] => {
  const initialBase = [
    {
      ...BASE_CHANNELS_CATALOG[0],
      todayOrders: 428,
      lastSyncTime: '3秒前',
      isMapped: false,
    },
    {
      ...BASE_CHANNELS_CATALOG[1],
      todayOrders: 215,
      lastSyncTime: '5秒前',
      isMapped: false,
    },
    {
      ...BASE_CHANNELS_CATALOG[2],
      todayOrders: 362,
      lastSyncTime: '1秒前',
      isMapped: false,
    }
  ];

  return initialBase.map((ch) => {
    const savedSchema = getSavedProtocolSchema(ch.id);
    const savedTemplate = getSavedRemarkTemplate(ch.id);
    return {
      ...ch,
      remarkTemplate: savedTemplate !== null ? savedTemplate : ch.remarkTemplate,
      protocolSchema: savedSchema !== null ? savedSchema : ch.protocolSchema,
    };
  });
};

const initialState: ChannelState = {
  selectedChannelForTemplate: null,
  culturalTourismChannels: [],
  mappings: [],
  isLoading: false,
  isSaving: false,
  savingChannelId: null,
  error: null,
  channels: createInitialChannels(),
  isSavingTemplate: false,
  isLoadingTemplate: false,
};

// 异步 Thunk：加载文旅渠道候选与已映射记录
export const fetchChannelMappingData = createAsyncThunk<
  {
    culturalTourismChannels: CulturalTourismChannel[];
    mappings: OTAChannelMappingRecord[];
  },
  void,
  { rejectValue: string }
>('channel/fetchChannelMappingData', async (_, { rejectWithValue }) => {
  try {
    const [culturalTourismChannels, mappings] = await Promise.all([
      fetchCulturalTourismChannels(),
      fetchChannelMappings(),
    ]);
    return { culturalTourismChannels, mappings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectWithValue(message);
  }
});

// 异步 Thunk：提交渠道映射
export const saveChannelMapping = createAsyncThunk<
  {
    channelId: string;
    savedPayload: SaveChannelMappingPayloadItem;
    message: string;
    mappingId?: string;
  },
  {
    channelId: string; // OTA 渠道标识 (如 'meituan')
    otaChannelCode: string;
    otaChannelName?: string;
    pmsChannelId: string;
    channelCode: string;
    pmsChannelName?: string;
    status?: string;
  },
  { rejectValue: string }
>('channel/saveChannelMapping', async (param, { rejectWithValue }) => {
  try {
    const payload: SaveChannelMappingPayloadItem = {
      otaChannelCode: param.otaChannelCode,
      otaChannelName: param.otaChannelName,
      channelCode: param.channelCode,
      channelId: param.pmsChannelId,
      status: param.status || 'A',
    };

    const res = await saveChannelMappingsBatch([payload]);

    // 优先从服务端返回的 records 中匹配当前渠道的映射实体及 mappingId
    const matchedRecord =
      res.records.find(
        (r) =>
          r.otaChannelCode.toUpperCase() === payload.otaChannelCode.toUpperCase() &&
          r.channelCode === payload.channelCode
      ) || res.records[0];

    const returnedMappingId = matchedRecord?.mappingId || matchedRecord?.id;

    return {
      channelId: param.channelId,
      savedPayload: payload,
      message: res.message,
      mappingId: returnedMappingId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectWithValue(message);
  }
});

// 异步 Thunk：调用远程接口保存渠道备注模板
export const saveRemarkTemplateAsync = createAsyncThunk<
  {
    channelId: string;
    otaChannelCode: string;
    template: string;
    message: string;
  },
  {
    channelId: string;
    otaChannelCode: string;
    template: string;
  },
  { rejectValue: string }
>('channel/saveRemarkTemplateAsync', async (param, { rejectWithValue }) => {
  try {
    const res = await saveChannelRemarkTemplate(param.otaChannelCode, {
      remarkTemplate: param.template,
    });
    return {
      channelId: param.channelId,
      otaChannelCode: param.otaChannelCode,
      template: param.template,
      message: res.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectWithValue(message);
  }
});

// 异步 Thunk：根据 OTA 渠道编码查询备注模板
export const fetchRemarkTemplateAsync = createAsyncThunk<
  {
    channelId: string;
    otaChannelCode: string;
    remarkTemplate: string | null;
  },
  {
    channelId: string;
    otaChannelCode: string;
  },
  { rejectValue: string }
>('channel/fetchRemarkTemplateAsync', async (param, { rejectWithValue }) => {
  try {
    const res = await fetchChannelRemarkTemplate(param.otaChannelCode);
    return {
      channelId: param.channelId,
      otaChannelCode: param.otaChannelCode,
      remarkTemplate: res.remarkTemplate,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectWithValue(message);
  }
});

export const channelSlice = createSlice({
  name: 'channel',
  initialState,
  reducers: {
    addChannelById: (state, action: PayloadAction<string>) => {
      const catalogItem = ALL_CHANNELS_CATALOG.find(c => c.id === action.payload);
      if (!catalogItem) return;
      if (state.channels.some(c => c.id === catalogItem.id)) return;

      // 检查当前映射中是否已有该 OTA 渠道配置
      const existingMapping = state.mappings.find(
        m => m.otaChannelCode.toUpperCase() === catalogItem.code.toUpperCase()
      );

      const savedSchema = getSavedProtocolSchema(catalogItem.id);
      const savedTemplate = getSavedRemarkTemplate(catalogItem.id);

      const newChannel: OTAChannel = {
        ...catalogItem,
        remarkTemplate: savedTemplate !== null ? savedTemplate : catalogItem.remarkTemplate,
        protocolSchema: savedSchema !== null ? savedSchema : catalogItem.protocolSchema,
        targetSystem: existingMapping?.channelCode || catalogItem.targetSystem || '',
        channelId: existingMapping?.channelId,
        channelCode: existingMapping?.channelCode,
        channelName: existingMapping?.channelName,
        mappingId: existingMapping?.mappingId,
        isMapped: !!existingMapping,
        todayOrders: 0,
        lastSyncTime: '刚刚初始化'
      };
      state.channels.push(newChannel);
    },
    removeChannel: (state, action: PayloadAction<string>) => {
      const targetChannel = state.channels.find(c => c.id === action.payload);
      const targetCode = targetChannel ? targetChannel.code.toUpperCase() : action.payload.toUpperCase();
      state.channels = state.channels.filter(c => c.id !== action.payload);
      state.mappings = state.mappings.filter(
        m => m.otaChannelCode.toUpperCase() !== targetCode
      );
    },
    updateChannelTargetSystem: (state, action: PayloadAction<{ channelId: string; targetSystem: string }>) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        ch.targetSystem = action.payload.targetSystem;
      }
    },
    selectCulturalTourismChannel: (
      state,
      action: PayloadAction<{
        channelId: string; // OTA Channel id
        pmsChannelId: string;
        pmsChannelCode: string;
        pmsChannelName?: string;
      }>
    ) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        if (!action.payload.pmsChannelId) {
          ch.channelId = '';
          ch.channelCode = '';
          ch.channelName = '';
          ch.targetSystem = '';
          ch.isMapped = false;
        } else {
          ch.channelId = action.payload.pmsChannelId;
          ch.channelCode = action.payload.pmsChannelCode;
          ch.channelName = action.payload.pmsChannelName || action.payload.pmsChannelCode;
          ch.targetSystem = action.payload.pmsChannelCode;

          const existingMapping = state.mappings.find(
            m => m.otaChannelCode.toUpperCase() === ch.code.toUpperCase()
          );
          ch.isMapped = !!existingMapping && existingMapping.channelId === action.payload.pmsChannelId;
        }
      }
    },
    updateRemarkTemplate: (state, action: PayloadAction<{ channelId: string; template: string }>) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        ch.remarkTemplate = action.payload.template;
      }
    },
    updateChannelFieldMapping: (
      state,
      action: PayloadAction<{
        channelId: string;
        fieldKey: string;
        updates: Partial<ProtocolFieldMapping>;
        updatedAt?: string;
      }>
    ) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        if (!ch.protocolSchema) {
          const defaultSchema = ch.id === 'douyin' ? DEFAULT_DOUYIN_PROTOCOL_SCHEMA : DEFAULT_MEITUAN_PROTOCOL_SCHEMA;
          const cloned = JSON.parse(JSON.stringify(defaultSchema)) as ChannelProtocolSchema;
          cloned.channelId = ch.id;
          cloned.channelCode = ch.code;
          ch.protocolSchema = cloned;
        }
        const schema = ch.protocolSchema;
        if (schema) {
          const field = schema.fields.find(f => f.key === action.payload.fieldKey);
          if (field) {
            Object.assign(field, action.payload.updates);
            if (action.payload.updatedAt) {
              schema.updatedAt = action.payload.updatedAt;
            }
          }
        }
      }
    },
    toggleChannelField: (
      state,
      action: PayloadAction<{
        channelId: string;
        fieldKey: string;
        enabled: boolean;
        updatedAt?: string;
      }>
    ) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        if (!ch.protocolSchema) {
          const defaultSchema = ch.id === 'douyin' ? DEFAULT_DOUYIN_PROTOCOL_SCHEMA : DEFAULT_MEITUAN_PROTOCOL_SCHEMA;
          const cloned = JSON.parse(JSON.stringify(defaultSchema)) as ChannelProtocolSchema;
          cloned.channelId = ch.id;
          cloned.channelCode = ch.code;
          ch.protocolSchema = cloned;
        }
        const schema = ch.protocolSchema;
        if (schema) {
          const field = schema.fields.find(f => f.key === action.payload.fieldKey);
          if (field) {
            field.enabled = action.payload.enabled;
            if (action.payload.updatedAt) {
              schema.updatedAt = action.payload.updatedAt;
            }
          }
        }
      }
    },
    resetChannelProtocol: (state, action: PayloadAction<{ channelId: string }>) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        if (ch.id === 'meituan') {
          ch.protocolSchema = JSON.parse(JSON.stringify(DEFAULT_MEITUAN_PROTOCOL_SCHEMA));
          ch.remarkTemplate = DEFAULT_MEITUAN_REMARK_TEMPLATE;
        } else if (ch.id === 'douyin') {
          ch.protocolSchema = JSON.parse(JSON.stringify(DEFAULT_DOUYIN_PROTOCOL_SCHEMA));
          ch.remarkTemplate = DEFAULT_DOUYIN_REMARK_TEMPLATE;
        } else {
          const baseItem = BASE_CHANNELS_CATALOG.find(c => c.id === ch.id);
          ch.protocolSchema = baseItem?.protocolSchema
            ? JSON.parse(JSON.stringify(baseItem.protocolSchema))
            : JSON.parse(JSON.stringify(DEFAULT_MEITUAN_PROTOCOL_SCHEMA));
          ch.remarkTemplate = baseItem?.remarkTemplate || '';
        }
      }
    },
    updateChannelProtocolSchema: (
      state,
      action: PayloadAction<{ channelId: string; schema: ChannelProtocolSchema }>
    ) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        ch.protocolSchema = action.payload.schema;
      }
    },
    setSelectedChannelForTemplate: (state, action: PayloadAction<string | null>) => {
      state.selectedChannelForTemplate = action.payload;
    },
    updateChannelStoreCrawlUrl: (
      state,
      action: PayloadAction<{ channelId: string; storeCrawlUrl: string }>
    ) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        ch.storeCrawlUrl = action.payload.storeCrawlUrl;
      }
    },
    clearChannelError: (state) => {
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    builder
      // fetchChannelMappingData
      .addCase(fetchChannelMappingData.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchChannelMappingData.fulfilled, (state, action) => {
        state.isLoading = false;
        state.culturalTourismChannels = action.payload.culturalTourismChannels;
        state.mappings = action.payload.mappings;

        // 1. 若远程已配置某些渠道映射（如携程、同程等）且未在当前列表中，自动补齐展示
        for (const mapping of action.payload.mappings) {
          const mCode = mapping.otaChannelCode.toUpperCase().replace(/[-_]/g, '');
          const exists = state.channels.some(
            c => c.code.toUpperCase().replace(/[-_]/g, '') === mCode ||
                 c.id.toUpperCase().replace(/[-_]/g, '') === mCode
          );
          if (!exists) {
            const catalogItem = ALL_CHANNELS_CATALOG.find(
              c => c.code.toUpperCase().replace(/[-_]/g, '') === mCode ||
                   c.id.toUpperCase().replace(/[-_]/g, '') === mCode
            );
            if (catalogItem) {
              const savedSchema = getSavedProtocolSchema(catalogItem.id);
              const savedTemplate = getSavedRemarkTemplate(catalogItem.id);
              state.channels.push({
                ...catalogItem,
                remarkTemplate: savedTemplate !== null ? savedTemplate : catalogItem.remarkTemplate,
                protocolSchema: savedSchema !== null ? savedSchema : catalogItem.protocolSchema,
                targetSystem: mapping.channelCode,
                channelId: mapping.channelId,
                channelCode: mapping.channelCode,
                channelName: mapping.channelName,
                mappingId: mapping.mappingId || mapping.id,
                isMapped: true,
                todayOrders: 0,
                lastSyncTime: '已同步',
              });
            } else {
              state.channels.push({
                id: mapping.otaChannelCode.toLowerCase(),
                name: mapping.otaChannelName || mapping.otaChannelCode,
                code: mapping.otaChannelCode,
                short: (mapping.otaChannelName || mapping.otaChannelCode).slice(0, 1),
                bgColor: 'bg-blue-50',
                textColor: 'text-blue-700',
                targetSystem: mapping.channelCode,
                channelId: mapping.channelId,
                channelCode: mapping.channelCode,
                channelName: mapping.channelName,
                mappingId: mapping.mappingId || mapping.id,
                isMapped: true,
                remarkTemplate: '',
                status: 'active',
                crawlerStatus: 'online',
                todayOrders: 0,
                lastSyncTime: '已同步',
              });
            }
          }
        }

        // 2. 将远程真实映射数据匹配更新到 channels 中
        for (const ch of state.channels) {
          const chCode = ch.code.toUpperCase().replace(/[-_]/g, '');
          const chId = ch.id.toUpperCase().replace(/[-_]/g, '');
          const mapping = action.payload.mappings.find(
            m => {
              const mCode = m.otaChannelCode.toUpperCase().replace(/[-_]/g, '');
              return mCode === chCode || mCode === chId;
            }
          );
          if (mapping) {
            ch.channelId = mapping.channelId;
            ch.channelCode = mapping.channelCode;
            ch.channelName = mapping.channelName;
            ch.mappingId = mapping.mappingId || mapping.id;
            ch.targetSystem = mapping.channelCode;
            ch.isMapped = true;
          } else {
            ch.isMapped = false;
            ch.channelId = '';
            ch.channelCode = '';
            ch.channelName = '';
            ch.targetSystem = '';
          }
        }
      })
      .addCase(fetchChannelMappingData.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload || action.error.message || '加载渠道映射数据失败';
      })

      // saveChannelMapping
      .addCase(saveChannelMapping.pending, (state, action) => {
        state.isSaving = true;
        state.savingChannelId = action.meta.arg.channelId;
        state.error = null;
      })
      .addCase(saveChannelMapping.fulfilled, (state, action) => {
        state.isSaving = false;
        state.savingChannelId = null;

        const ch = state.channels.find(c => c.id === action.payload.channelId);
        const resolvedChannelName = action.meta?.arg?.pmsChannelName || ch?.channelName;

        const existingIdx = state.mappings.findIndex(
          m => m.otaChannelCode.toUpperCase() === action.payload.savedPayload.otaChannelCode.toUpperCase()
        );
        const existingRecord = existingIdx !== -1 ? state.mappings[existingIdx] : undefined;

        // 优先采用服务端回传的真实 mappingId，若无则沿用已有 mappingId 或 fallback
        const resolvedMappingId =
          action.payload.mappingId ||
          existingRecord?.mappingId ||
          ch?.mappingId ||
          '';

        if (ch) {
          ch.channelId = action.payload.savedPayload.channelId;
          ch.channelCode = action.payload.savedPayload.channelCode;
          ch.channelName = resolvedChannelName || ch.channelName;
          ch.targetSystem = action.payload.savedPayload.channelCode;
          ch.mappingId = resolvedMappingId;
          ch.isMapped = true;
        }

        // 同步更新或插入 mappings 缓存
        const newRecord: OTAChannelMappingRecord = {
          id: resolvedMappingId || `${action.payload.savedPayload.otaChannelCode}_${action.payload.savedPayload.channelCode}`,
          mappingId: resolvedMappingId,
          otaChannelCode: action.payload.savedPayload.otaChannelCode,
          otaChannelName: action.payload.savedPayload.otaChannelName || ch?.name || action.payload.savedPayload.otaChannelCode,
          channelId: action.payload.savedPayload.channelId,
          channelCode: action.payload.savedPayload.channelCode,
          channelName: resolvedChannelName || ch?.channelName || action.payload.savedPayload.channelCode,
          status: action.payload.savedPayload.status || 'A',
        };

        if (existingIdx !== -1) {
          state.mappings[existingIdx] = { ...state.mappings[existingIdx], ...newRecord };
        } else {
          state.mappings.push(newRecord);
        }
      })
      .addCase(saveChannelMapping.rejected, (state, action) => {
        state.isSaving = false;
        state.savingChannelId = null;
        state.error = action.payload || action.error.message || '保存渠道映射失败';
      })

      // saveRemarkTemplateAsync
      .addCase(saveRemarkTemplateAsync.pending, (state) => {
        state.isSavingTemplate = true;
        state.error = null;
      })
      .addCase(saveRemarkTemplateAsync.fulfilled, (state, action) => {
        state.isSavingTemplate = false;
        const ch = state.channels.find(
          (c) =>
            c.id === action.payload.channelId ||
            c.code.toUpperCase() === action.payload.otaChannelCode.toUpperCase()
        );
        if (ch) {
          ch.remarkTemplate = action.payload.template;
        }
      })
      .addCase(saveRemarkTemplateAsync.rejected, (state, action) => {
        state.isSavingTemplate = false;
        state.error = action.payload || action.error.message || '保存渠道备注模板失败';
      })

      // fetchRemarkTemplateAsync
      .addCase(fetchRemarkTemplateAsync.pending, (state) => {
        state.isLoadingTemplate = true;
        state.error = null;
      })
      .addCase(fetchRemarkTemplateAsync.fulfilled, (state, action) => {
        state.isLoadingTemplate = false;
        if (action.payload.remarkTemplate !== null) {
          const ch = state.channels.find(
            (c) =>
              c.id === action.payload.channelId ||
              c.code.toUpperCase() === action.payload.otaChannelCode.toUpperCase()
          );
          if (ch) {
            ch.remarkTemplate = action.payload.remarkTemplate;
          }
        }
      })
      .addCase(fetchRemarkTemplateAsync.rejected, (state, action) => {
        state.isLoadingTemplate = false;
        state.error = action.payload || action.error.message || '获取渠道备注模板失败';
      });
  }
});

export const {
  addChannelById,
  removeChannel,
  updateChannelTargetSystem,
  selectCulturalTourismChannel,
  updateRemarkTemplate,
  updateChannelFieldMapping,
  toggleChannelField,
  resetChannelProtocol,
  updateChannelProtocolSchema,
  setSelectedChannelForTemplate,
  updateChannelStoreCrawlUrl,
  clearChannelError,
} = channelSlice.actions;

export default channelSlice.reducer;
