import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { HotelMapping } from '../../types';
import type { DiscoveredHotelCandidate } from '../../crawler/types';
import { executeHotelCrawl } from '../../services/crawlerApi';
import {
  fetchRemoteHotelMappings,
  saveHotelMappingsBatch,
  deleteRemoteHotelMappings,
} from '../../services/hotelApi';
import { addLog } from './systemLogSlice';
import { showToast } from './appSlice';

export type CrawlStatus = 'idle' | 'running' | 'success' | 'failed';

export interface HotelState {
  hotels: HotelMapping[];
  isScraping: boolean;
  isFetching: boolean;
  isSaving: boolean;
  crawlStatus: CrawlStatus;
  crawlError: string | null;
  fetchError: string | null;
  filterChannel: string;
  searchKeyword: string;
  selectedCrawlChannel: string;
  lastCrawlSummary: {
    channelId: string;
    discoveredCount: number;
    durationMs: number;
    timestamp: string;
  } | null;
}

const initialState: HotelState = {
  isScraping: false,
  isFetching: false,
  isSaving: false,
  crawlStatus: 'idle',
  crawlError: null,
  fetchError: null,
  filterChannel: 'all',
  searchKeyword: '',
  selectedCrawlChannel: 'meituan',
  lastCrawlSummary: null,
  hotels: [],
};

export interface SaveHotelMappingParams {
  id: string;
  mappingId?: string;
  otaChannelCode: string;
  extUnitCode: string;
  otaHotelName: string;
  unitId?: string | number;
  unitType?: string;
  pmsHotelName?: string;
}

export interface DeleteHotelMappingParams {
  mappingId: string | number;
  localId: string;
  otaHotelName?: string;
}

/**
 * 异步 Thunk：从文旅中台拉取真实 OTA 酒店/门店映射列表 (GET /toolkit/hotel-mappings)
 * 对应 Apifox 接口ID: 475704117
 */
export const fetchHotelMappingsThunk = createAsyncThunk<
  HotelMapping[],
  string | undefined,
  { rejectValue: string }
>('hotel/fetchHotelMappings', async (channelCode, { dispatch, rejectWithValue }) => {
  try {
    const otaChannelCode = channelCode && channelCode !== 'all' ? channelCode : undefined;
    dispatch(
      addLog({
        level: 'INFO',
        message: `[HotelMapping] 正在从文旅中台查询门店映射列表${otaChannelCode ? ` (渠道代码: ${otaChannelCode})` : ''}...`,
      })
    );

    const mappings = await fetchRemoteHotelMappings({ otaChannelCode });

    dispatch(
      addLog({
        level: 'SUCCESS',
        message: `[HotelMapping] 成功从文旅中台拉取 ${mappings.length} 条门店映射数据`,
      })
    );

    return mappings;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    dispatch(
      addLog({
        level: 'ERROR',
        message: `[HotelMapping] 获取门店映射列表失败: ${errorMsg}`,
      })
    );
    dispatch(
      showToast({
        title: '获取门店映射失败',
        description: errorMsg,
        type: 'error',
      })
    );
    return rejectWithValue(errorMsg);
  }
});

/**
 * 异步 Thunk：向文旅中台保存/更新 OTA 酒店/门店映射 (POST /toolkit/hotel-mappings/batch)
 * 对应 Apifox 接口ID: 475704116
 */
export const saveHotelMappingThunk = createAsyncThunk<
  SaveHotelMappingParams,
  SaveHotelMappingParams,
  { rejectValue: string }
>('hotel/saveHotelMapping', async (params, { dispatch, rejectWithValue }) => {
  try {
    const otaChannelCode = String(params.otaChannelCode || '').trim().toUpperCase();
    const extUnitCode = String(params.extUnitCode || '').trim();
    const otaHotelName = String(params.otaHotelName || '').trim();

    if (!otaChannelCode) {
      throw new Error('缺少渠道代码 (otaChannelCode)');
    }
    if (!extUnitCode) {
      throw new Error('缺少 OTA 门店编码 (extUnitCode)');
    }
    if (!otaHotelName) {
      throw new Error('缺少 OTA 门店名称 (otaHotelName)');
    }

    const payloadItem = {
      otaChannelCode,
      extUnitCode,
      otaHotelName,
      unitId: params.unitId,
      unitType: params.unitType || 'Property',
    };

    dispatch(
      addLog({
        level: 'INFO',
        message: `[HotelMapping] 正在保存门店映射: ${otaHotelName} (${extUnitCode}) -> 中台单位: ${params.unitId || '未指定'}`,
      })
    );

    await saveHotelMappingsBatch([payloadItem]);

    dispatch(
      addLog({
        level: 'SUCCESS',
        message: `[HotelMapping] 成功保存门店「${otaHotelName}」映射`,
      })
    );

    dispatch(
      showToast({
        title: `已保存「${otaHotelName}」映射`,
        description: params.unitId
          ? `成功关联至中台酒店 (ID: ${params.unitId})`
          : '门店信息已同步至中台',
        type: 'success',
      })
    );

    return {
      ...params,
      otaChannelCode,
      extUnitCode,
      otaHotelName,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    dispatch(
      addLog({
        level: 'ERROR',
        message: `[HotelMapping] 保存门店映射失败: ${errorMsg}`,
      })
    );
    dispatch(
      showToast({
        title: '保存门店映射失败',
        description: errorMsg,
        type: 'error',
      })
    );
    return rejectWithValue(errorMsg);
  }
});

/**
 * 异步 Thunk：从文旅中台删除 OTA 酒店/门店映射记录 (DELETE /toolkit/hotel-mappings)
 * 对应 Apifox 接口ID: 475704118
 */
export const deleteHotelMappingThunk = createAsyncThunk<
  DeleteHotelMappingParams,
  DeleteHotelMappingParams,
  { rejectValue: string }
>('hotel/deleteHotelMapping', async (params, { dispatch, rejectWithValue }) => {
  try {
    if (!params.mappingId) {
      throw new Error('缺少要删除的映射记录 ID (mappingId)');
    }

    dispatch(
      addLog({
        level: 'INFO',
        message: `[HotelMapping] 正在删除门店映射记录 (ID: ${params.mappingId})...`,
      })
    );

    await deleteRemoteHotelMappings([params.mappingId]);

    dispatch(
      addLog({
        level: 'SUCCESS',
        message: `[HotelMapping] 成功删除门店映射记录 (ID: ${params.mappingId})`,
      })
    );

    dispatch(
      showToast({
        title: '已删除门店映射',
        description: params.otaHotelName
          ? `已移除「${params.otaHotelName}」的映射记录`
          : `映射记录 (ID: ${params.mappingId}) 已删除`,
        type: 'success',
      })
    );

    return params;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    dispatch(
      addLog({
        level: 'ERROR',
        message: `[HotelMapping] 删除门店映射失败: ${errorMsg}`,
      })
    );
    dispatch(
      showToast({
        title: '删除门店映射失败',
        description: errorMsg,
        type: 'error',
      })
    );
    return rejectWithValue(errorMsg);
  }
});

/**
 * 异步 Thunk：触发指定渠道的 Playwright 门店自动化采集
 */
export const crawlHotelsByChannel = createAsyncThunk<
  {
    channelId: string;
    hotels: DiscoveredHotelCandidate[];
    durationMs: number;
  },
  {
    channelId: string;
    targetUrl: string;
    headless?: boolean;
    timeoutMs?: number;
    waitMs?: number;
  },
  { rejectValue: string }
>('hotel/crawlHotelsByChannel', async (param, { dispatch, rejectWithValue }) => {
  try {
    dispatch(
      addLog({
        level: 'PLAYWRIGHT',
        channelId: param.channelId,
        message: `[Crawler] 发起渠道「${param.channelId}」门店自动化采集: ${param.targetUrl}`,
      })
    );

    const result = await executeHotelCrawl({
      channelId: param.channelId,
      targetUrl: param.targetUrl,
      headless: param.headless,
      timeoutMs: param.timeoutMs,
      waitMs: param.waitMs,
    });

    if (result.logs && Array.isArray(result.logs)) {
      for (const logItem of result.logs) {
        dispatch(
          addLog({
            level: logItem.level,
            channelId: param.channelId,
            message: logItem.message,
            details: logItem.details,
          })
        );
      }
    }

    dispatch(
      showToast({
        title: `「${param.channelId}」门店采集完成`,
        description: `成功发现 ${result.hotels.length} 家门店候选 (耗时: ${(result.diagnostics.durationMs / 1000).toFixed(1)}s)`,
        type: 'success',
      })
    );

    return {
      channelId: param.channelId,
      hotels: result.hotels,
      durationMs: result.diagnostics.durationMs,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    dispatch(
      addLog({
        level: 'ERROR',
        channelId: param.channelId,
        message: `[Crawler] 渠道「${param.channelId}」门店采集失败: ${errorMsg}`,
      })
    );
    dispatch(
      showToast({
        title: `门店采集失败`,
        description: errorMsg,
        type: 'error',
      })
    );
    return rejectWithValue(errorMsg);
  }
});

export const hotelSlice = createSlice({
  name: 'hotel',
  initialState,
  reducers: {
    setFilterChannel: (state, action: PayloadAction<string>) => {
      state.filterChannel = action.payload;
    },
    setSearchKeyword: (state, action: PayloadAction<string>) => {
      state.searchKeyword = action.payload;
    },
    setSelectedCrawlChannel: (state, action: PayloadAction<string>) => {
      state.selectedCrawlChannel = action.payload;
    },
    setIsScraping: (state, action: PayloadAction<boolean>) => {
      state.isScraping = action.payload;
    },
    clearCrawlError: (state) => {
      state.crawlError = null;
    },
    updateHotelMapping: (
      state,
      action: PayloadAction<{ id: string; pmsHotelId: string; pmsHotelName: string }>
    ) => {
      const h = state.hotels.find((x) => x.id === action.payload.id);
      if (h) {
        h.pmsHotelId = action.payload.pmsHotelId;
        h.pmsHotelName = action.payload.pmsHotelName;
        h.status = action.payload.pmsHotelId ? 'mapped' : 'pending';
      }
    },
    addDiscoveredHotel: (state, action: PayloadAction<HotelMapping>) => {
      state.hotels.unshift(action.payload);
    },
    upsertDiscoveredHotels: (
      state,
      action: PayloadAction<DiscoveredHotelCandidate[]>
    ) => {
      const candidates = action.payload;
      for (const candidate of candidates) {
        const existing = state.hotels.find(
          (h) =>
            h.otaChannelId.toLowerCase() === candidate.otaChannelId.toLowerCase() &&
            (h.otaHotelId === candidate.otaHotelId || h.extUnitCode === candidate.otaHotelId)
        );

        if (existing) {
          existing.otaHotelName = candidate.otaHotelName;
          if (candidate.city) existing.city = candidate.city;
          if (candidate.starRating) existing.starRating = candidate.starRating;
          if (candidate.partnerId) existing.partnerId = candidate.partnerId;
          existing.source = candidate.source;
        } else {
          const newHotel: HotelMapping = {
            id: `hm-${candidate.otaChannelId}-${candidate.otaHotelId}-${Date.now()}`,
            otaChannelId: candidate.otaChannelId.toLowerCase(),
            otaChannelCode: candidate.otaChannelCode || candidate.otaChannelId.toUpperCase(),
            otaHotelId: candidate.otaHotelId,
            extUnitCode: candidate.otaHotelId,
            otaHotelName: candidate.otaHotelName,
            pmsHotelId: '',
            pmsHotelName: '待关联中台酒店',
            unitType: 'Property',
            city: candidate.city || '',
            starRating: candidate.starRating || '',
            status: 'pending',
            roomCount: candidate.roomCount ?? 0,
            partnerId: candidate.partnerId,
            source: candidate.source,
          };
          state.hotels.unshift(newHotel);
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      // 门店采集 Thunk
      .addCase(crawlHotelsByChannel.pending, (state) => {
        state.isScraping = true;
        state.crawlStatus = 'running';
        state.crawlError = null;
      })
      .addCase(crawlHotelsByChannel.fulfilled, (state, action) => {
        state.isScraping = false;
        state.crawlStatus = 'success';
        state.crawlError = null;
        state.lastCrawlSummary = {
          channelId: action.payload.channelId,
          discoveredCount: action.payload.hotels.length,
          durationMs: action.payload.durationMs,
          timestamp: new Date().toLocaleTimeString(),
        };

        hotelSlice.caseReducers.upsertDiscoveredHotels(state, {
          type: 'hotel/upsertDiscoveredHotels',
          payload: action.payload.hotels,
        });
      })
      .addCase(crawlHotelsByChannel.rejected, (state, action) => {
        state.isScraping = false;
        state.crawlStatus = 'failed';
        state.crawlError = action.payload || action.error.message || '门店采集失败';
      })
      // 查询门店映射列表 Thunk
      .addCase(fetchHotelMappingsThunk.pending, (state) => {
        state.isFetching = true;
        state.fetchError = null;
      })
      .addCase(fetchHotelMappingsThunk.fulfilled, (state, action) => {
        state.isFetching = false;
        state.hotels = action.payload;
        state.fetchError = null;
      })
      .addCase(fetchHotelMappingsThunk.rejected, (state, action) => {
        state.isFetching = false;
        state.fetchError = action.payload || '获取门店映射列表失败';
      })
      // 保存门店映射 Thunk
      .addCase(saveHotelMappingThunk.pending, (state) => {
        state.isSaving = true;
      })
      .addCase(saveHotelMappingThunk.fulfilled, (state, action) => {
        state.isSaving = false;
        const target = state.hotels.find(
          (h) =>
            h.id === action.payload.id ||
            (h.otaChannelId.toLowerCase() === action.payload.otaChannelCode.toLowerCase() &&
              (h.otaHotelId === action.payload.extUnitCode || h.extUnitCode === action.payload.extUnitCode))
        );
        if (target) {
          const unitIdStr =
            action.payload.unitId !== undefined && action.payload.unitId !== null
              ? String(action.payload.unitId)
              : '';
          target.pmsHotelId = unitIdStr;
          if (action.payload.pmsHotelName) {
            target.pmsHotelName = action.payload.pmsHotelName;
          }
          target.status = unitIdStr ? 'mapped' : 'pending';
          target.extUnitCode = action.payload.extUnitCode;
          target.otaChannelCode = action.payload.otaChannelCode;
          if (action.payload.unitType) {
            target.unitType = action.payload.unitType;
          }
        }
      })
      .addCase(saveHotelMappingThunk.rejected, (state) => {
        state.isSaving = false;
      })
      // 删除门店映射 Thunk
      .addCase(deleteHotelMappingThunk.fulfilled, (state, action) => {
        state.hotels = state.hotels.filter(
          (h) =>
            h.id !== action.payload.localId &&
            (!h.mappingId || String(h.mappingId) !== String(action.payload.mappingId))
        );
      });
  },
});

export const {
  setFilterChannel,
  setSearchKeyword,
  setSelectedCrawlChannel,
  setIsScraping,
  clearCrawlError,
  updateHotelMapping,
  addDiscoveredHotel,
  upsertDiscoveredHotels,
} = hotelSlice.actions;

export default hotelSlice.reducer;
