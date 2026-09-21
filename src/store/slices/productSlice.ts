import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type {
  ProductMapping,
  SaveProductMappingPayloadItem,
  RoomTypeOption,
  RatePlanOption,
  ReservationTypeOption,
} from '../../types';
import type { ProductCrawlRequest, DiscoveredProductCandidate } from '../../crawler/types';
import {
  fetchProductMappings,
  fetchRoomTypes,
  fetchRatePlans,
  fetchReservationTypes,
  saveProductMappingsBatch,
  deleteProductMapping,
} from '../../services/productApi';
import { collectProductsByHotel } from '../../services/crawlerBridge';
import { addLog } from './systemLogSlice';

export interface ProductState {
  filterChannel: string;
  filterExtUnitCode: string;
  filterHotelName: string;
  filterUnitId: string;
  filterUnitType: string;
  searchKeyword: string;
  isLoading: boolean;
  isSaving: boolean;
  isCrawling: boolean;
  error: string | null;
  products: ProductMapping[];
  roomTypes: RoomTypeOption[];
  rateCodes: RatePlanOption[];
  reservationTypes: ReservationTypeOption[];
}

const initialState: ProductState = {
  filterChannel: '',
  filterExtUnitCode: '',
  filterHotelName: '',
  filterUnitId: '',
  filterUnitType: 'Property',
  searchKeyword: '',
  isLoading: false,
  isSaving: false,
  isCrawling: false,
  error: null,
  products: [],
  roomTypes: [],
  rateCodes: [],
  reservationTypes: [],
};

/**
 * 纯函数：生成产品映射唯一标识键
 */
export function getProductIdentityKey(item: {
  otaRoomTypeId: string;
  otaBasicRoomId?: string;
}): string {
  return `${String(item.otaRoomTypeId || '').trim()}\u001f${String(item.otaBasicRoomId || '').trim()}`;
}

/**
 * 纯函数：将 OTA 采集到的候选与文旅平台历史映射合并展示
 * - 遵循唯一数据源准则，历史映射中的已配置字段优先保留
 * - 新采集到的候选予以追加，otaProductPresent 标记为 true
 */
export function mergeCandidatesWithHistoricalMappings(
  historicalMappings: ProductMapping[],
  candidates: DiscoveredProductCandidate[],
  scope: {
    channelCode: string;
    extUnitCode: string;
    unitId: string;
    unitType: string;
    hotelName?: string;
  }
): ProductMapping[] {
  const exactMap = new Map<string, ProductMapping>();
  const roomIdMap = new Map<string, ProductMapping>();

  for (const mapping of historicalMappings) {
    exactMap.set(getProductIdentityKey(mapping), mapping);
    if (!roomIdMap.has(mapping.otaRoomTypeId)) {
      roomIdMap.set(mapping.otaRoomTypeId, mapping);
    }
  }

  const mergedList: ProductMapping[] = [];
  const processedHistorical = new Set<ProductMapping>();

  // 1. 处理采集到的候选
  for (const candidate of candidates) {
    const exactKey = getProductIdentityKey(candidate);
    let existing = exactMap.get(exactKey);

    if (!existing) {
      const fallback = roomIdMap.get(candidate.otaRoomTypeId);
      if (fallback && !processedHistorical.has(fallback)) {
        existing = fallback;
      }
    }

    if (existing) {
      processedHistorical.add(existing);
      // 历史映射已存在：保留其 internal 映射配置与 status，融合 OTA 元数据
      mergedList.push({
        ...existing,
        otaRoomTypeName: candidate.otaRoomTypeName || existing.otaRoomTypeName,
        otaBasicRoomId: candidate.otaBasicRoomId || existing.otaBasicRoomId,
        otaBasicRoomName: candidate.otaBasicRoomName || existing.otaBasicRoomName,
        otaRateCodeId: candidate.otaRateCodeId || existing.otaRateCodeId,
        otaPayType: candidate.otaPayType || existing.otaPayType || 'PP',
        // 视图兼容字段
        otaProductName: candidate.otaRoomTypeName || existing.otaProductName,
        otaPhysicalRoomName: candidate.otaBasicRoomName || existing.otaPhysicalRoomName,
        otaPhysicalRoomCode: candidate.otaBasicRoomId || existing.otaPhysicalRoomCode,
        otaProductPresent: true,
        source: 'merged',
      });
    } else {
      // 全新采集候选：未映射内部房型、房价码，允许为空
      mergedList.push({
        channelCode: scope.channelCode,
        extUnitCode: scope.extUnitCode,
        unitId: scope.unitId,
        unitType: scope.unitType || 'Property',
        hotelName: scope.hotelName,
        otaRoomTypeId: candidate.otaRoomTypeId,
        otaRoomTypeName: candidate.otaRoomTypeName,
        otaBasicRoomId: candidate.otaBasicRoomId,
        otaBasicRoomName: candidate.otaBasicRoomName,
        otaRateCodeId: candidate.otaRateCodeId,
        otaPayType: candidate.otaPayType || 'PP',
        // 视图兼容字段
        otaProductName: candidate.otaRoomTypeName,
        otaProductCode: candidate.otaRoomTypeId,
        otaPhysicalRoomName: candidate.otaBasicRoomName,
        otaPhysicalRoomCode: candidate.otaBasicRoomId,
        roomType: '',
        rateCode: '',
        payType: '',
        internalRoomType: '',
        bookingType: '',
        status: 'pending',
        source: 'ota-collection',
        otaProductPresent: true,
      });
    }
  }

  // 2. 追加尚未被当次采集覆盖到的平台历史映射
  for (const mapping of historicalMappings) {
    if (!processedHistorical.has(mapping)) {
      mergedList.push({
        ...mapping,
        otaProductPresent: false,
        source: 'remote-platform',
      });
    }
  }

  return mergedList;
}

/**
 * 异步 Thunk: 加载当前选定门店的远程产品映射及内部字典选项
 */
export const loadProductMappingsAndOptions = createAsyncThunk(
  'product/loadProductMappingsAndOptions',
  async (
    payload: {
      channelCode: string;
      extUnitCode: string;
      unitId: string | number;
      unitType?: string;
      hotelName?: string;
    },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const channelCode = payload.channelCode.trim();
      const unitId = String(payload.unitId).trim();
      const unitType = payload.unitType || 'Property';
      const extUnitCode = payload.extUnitCode.trim();

      if (!channelCode) {
        throw new Error('未提供有效文旅渠道编码 channelCode');
      }
      if (!unitId) {
        throw new Error('未提供文旅酒店 unitId');
      }

      // 并行请求产品映射与三大字典选项
      const [mappingsResult, roomTypesResult, rateCodesResult, reservationTypesResult] =
        await Promise.allSettled([
          fetchProductMappings({
            channelCode,
            unitId,
            unitType,
            extUnitCode,
          }),
          fetchRoomTypes({ unitId, unitType }),
          fetchRatePlans({ unitId, unitType }),
          fetchReservationTypes({ unitId }),
        ]);

      if (mappingsResult.status === 'rejected') {
        throw mappingsResult.reason;
      }

      if (roomTypesResult.status === 'rejected') {
        dispatch(
          addLog({
            level: 'WARN',
            module: 'PRODUCT',
            message: '加载内部房型字典失败',
            details: String(roomTypesResult.reason),
          })
        );
      }
      if (rateCodesResult.status === 'rejected') {
        dispatch(
          addLog({
            level: 'WARN',
            module: 'PRODUCT',
            message: '加载内部房价码字典失败',
            details: String(rateCodesResult.reason),
          })
        );
      }
      if (reservationTypesResult.status === 'rejected') {
        dispatch(
          addLog({
            level: 'WARN',
            module: 'PRODUCT',
            message: '加载预订类型字典失败',
            details: String(reservationTypesResult.reason),
          })
        );
      }

      return {
        products: mappingsResult.value,
        roomTypes: roomTypesResult.status === 'fulfilled' ? roomTypesResult.value : [],
        rateCodes: rateCodesResult.status === 'fulfilled' ? rateCodesResult.value : [],
        reservationTypes:
          reservationTypesResult.status === 'fulfilled' ? reservationTypesResult.value : [],
      };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : String(error));
    }
  }
);

/**
 * 异步 Thunk: 批量保存或更新产品映射 (允许房型、房价、预订类型为空)
 */
export const saveProductMappingsThunk = createAsyncThunk(
  'product/saveProductMappings',
  async (items: SaveProductMappingPayloadItem[], { rejectWithValue }) => {
    try {
      const result = await saveProductMappingsBatch(items);
      return {
        success: result.success,
        count: result.count,
        savedItems: items,
      };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : String(error));
    }
  }
);

/**
 * 异步 Thunk: 删除产品映射
 */
export const deleteProductMappingThunk = createAsyncThunk(
  'product/deleteProductMapping',
  async (
    payload: { mappingId: string; otaRoomTypeId?: string; otaBasicRoomId?: string },
    { rejectWithValue }
  ) => {
    try {
      await deleteProductMapping(payload.mappingId);
      return payload;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : String(error));
    }
  }
);

/**
 * 异步 Thunk: 执行 OTA 产品自动化采集
 */
export const crawlOtaProductsThunk = createAsyncThunk(
  'product/crawlOtaProducts',
  async (request: ProductCrawlRequest, { rejectWithValue }) => {
    try {
      const result = await collectProductsByHotel(request);
      return {
        candidates: result.products,
        request,
      };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : String(error));
    }
  }
);

export const productSlice = createSlice({
  name: 'product',
  initialState,
  reducers: {
    setProductFilterChannel: (state, action: PayloadAction<string>) => {
      state.filterChannel = action.payload;
      // 切换渠道时重置门店与数据，防止数据串味
      state.filterExtUnitCode = '';
      state.filterHotelName = '';
      state.filterUnitId = '';
      state.products = [];
      state.roomTypes = [];
      state.rateCodes = [];
      state.reservationTypes = [];
      state.error = null;
    },
    setProductFilterHotel: (
      state,
      action: PayloadAction<{
        extUnitCode: string;
        hotelName: string;
        unitId: string | number;
        unitType?: string;
      }>
    ) => {
      state.filterExtUnitCode = action.payload.extUnitCode;
      state.filterHotelName = action.payload.hotelName;
      state.filterUnitId = String(action.payload.unitId);
      state.filterUnitType = action.payload.unitType || 'Property';
      state.products = [];
      state.error = null;
    },
    setProductSearch: (state, action: PayloadAction<string>) => {
      state.searchKeyword = action.payload;
    },
    deleteProduct: (
      state,
      action: PayloadAction<string | { otaRoomTypeId: string; otaBasicRoomId?: string }>
    ) => {
      if (typeof action.payload === 'string') {
        const targetId = action.payload;
        state.products = state.products.filter(
          (p) => p.id !== targetId && p.otaRoomTypeId !== targetId
        );
      } else {
        const { otaRoomTypeId, otaBasicRoomId } = action.payload;
        state.products = state.products.filter((p) => {
          const isSameRoomType = p.otaRoomTypeId === otaRoomTypeId;
          const isSameBasicRoom = (p.otaBasicRoomId || '') === (otaBasicRoomId || '');
          return !(isSameRoomType && isSameBasicRoom);
        });
      }
    },
    clearProductState: (state) => {
      state.products = [];
      state.roomTypes = [];
      state.rateCodes = [];
      state.reservationTypes = [];
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // loadProductMappingsAndOptions
    builder
      .addCase(loadProductMappingsAndOptions.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loadProductMappingsAndOptions.fulfilled, (state, action) => {
        state.isLoading = false;
        const remoteProducts = action.payload.products;
        const remoteKeys = new Set(remoteProducts.map((p) => getProductIdentityKey(p)));
        const unpersistedDrafts = state.products.filter(
          (p) => !p.id && p.source === 'ota-collection' && !remoteKeys.has(getProductIdentityKey(p))
        );
        state.products = [...remoteProducts, ...unpersistedDrafts];
        state.roomTypes = action.payload.roomTypes;
        state.rateCodes = action.payload.rateCodes;
        state.reservationTypes = action.payload.reservationTypes;
      })
      .addCase(loadProductMappingsAndOptions.rejected, (state, action) => {
        state.isLoading = false;
        state.error = (action.payload as string) || '加载产品映射失败';
      });

    // saveProductMappingsThunk
    builder
      .addCase(saveProductMappingsThunk.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(saveProductMappingsThunk.fulfilled, (state, action) => {
        state.isSaving = false;
        // 同步保存属性并依据是否有非空配置动态判定状态
        const savedMap = new Map(
          action.payload.savedItems.map((item) => [getProductIdentityKey(item), item])
        );
        state.products = state.products.map((p) => {
          const saved = savedMap.get(getProductIdentityKey(p));
          if (saved) {
            const nextRoomType = saved.roomType ?? p.roomType;
            const nextRateCode = saved.rateCode ?? p.rateCode;
            const nextPayType = saved.payType ?? p.payType;
            const hasAnyConfig = Boolean(
              (nextRoomType && nextRoomType.trim()) ||
              (nextRateCode && nextRateCode.trim()) ||
              (nextPayType && nextPayType.trim())
            );
            return {
              ...p,
              id: saved.id ?? p.id,
              roomType: nextRoomType,
              rateCode: nextRateCode,
              payType: nextPayType,
              internalRoomType: nextRoomType,
              bookingType: nextPayType,
              status: hasAnyConfig ? 'completed' : 'pending',
              source: 'remote-platform',
            };
          }
          return p;
        });
      })
      .addCase(saveProductMappingsThunk.rejected, (state, action) => {
        state.isSaving = false;
        state.error = (action.payload as string) || '批量保存产品映射失败';
      });

    // deleteProductMappingThunk
    builder
      .addCase(deleteProductMappingThunk.pending, (state) => {
        state.isSaving = true;
        state.error = null;
      })
      .addCase(deleteProductMappingThunk.fulfilled, (state, action) => {
        state.isSaving = false;
        const { mappingId, otaRoomTypeId, otaBasicRoomId } = action.payload;
        state.products = state.products.filter((p) => {
          if (mappingId && p.id === mappingId) return false;
          if (!p.id && otaRoomTypeId && p.otaRoomTypeId === otaRoomTypeId) {
            if (otaBasicRoomId !== undefined) {
              return (p.otaBasicRoomId || '') !== (otaBasicRoomId || '');
            }
            return false;
          }
          return true;
        });
      })
      .addCase(deleteProductMappingThunk.rejected, (state, action) => {
        state.isSaving = false;
        state.error = (action.payload as string) || '删除产品映射失败';
      });

    // crawlOtaProductsThunk
    builder
      .addCase(crawlOtaProductsThunk.pending, (state) => {
        state.isCrawling = true;
        state.error = null;
      })
      .addCase(crawlOtaProductsThunk.fulfilled, (state, action) => {
        state.isCrawling = false;
        const { candidates, request } = action.payload;
        state.products = mergeCandidatesWithHistoricalMappings(
          state.products,
          candidates,
          {
            channelCode: request.pmsChannelCode || request.channelCode,
            extUnitCode: request.extUnitCode,
            unitId: state.filterUnitId,
            unitType: state.filterUnitType,
            hotelName: state.filterHotelName,
          }
        );
      })
      .addCase(crawlOtaProductsThunk.rejected, (state, action) => {
        state.isCrawling = false;
        state.error = (action.payload as string) || 'OTA 产品采集失败';
      });
  },
});

export const {
  setProductFilterChannel,
  setProductFilterHotel,
  setProductSearch,
  deleteProduct,
  clearProductState,
} = productSlice.actions;

export default productSlice.reducer;
