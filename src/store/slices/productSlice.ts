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
import { getAgentCapabilities, startAgentProductMapping } from '../../services/agentBridge';
import { buildProductMappingSnapshot, hasIncompleteMapping } from '../../utils/agent/productSnapshotBuilder';
import type {
  FieldMatch,
  MatchGrade,
  ProductMappingOutcome,
  ProductMappingProgressEvent,
  ProductMappingRunResult,
} from '../../types/agent';
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
  /** 唯一可编辑草稿源（设计 6.7：正式基线 / 当前草稿 / 只读评级元数据职责分离） */
  drafts: Record<string, ProductDraftEdits>;
  /** 自动映射的只读评级元数据，以产品复合键关联 */
  insights: Record<string, ProductMappingInsight>;
  /** 草稿修订号：人工编辑、重新采集、基线重载时递增，用于丢弃过期的自动填入 */
  draftRevision: number;
  autoMapping: ProductAutoMappingState;
}

export interface ProductDraftEdits {
  roomType?: string;
  rateCode?: string;
  payType?: string;
}

export interface ProductMappingInsight {
  runId: string;
  overallGrade: MatchGrade;
  outcome: ProductMappingOutcome;
  roomType: FieldMatch;
  rateCode: FieldMatch;
  reservationType: FieldMatch;
  /** 本次实际自动填入的草稿字段 */
  appliedFields: Array<'roomType' | 'rateCode' | 'payType'>;
  /** 该行存在人工草稿编辑，Agent 保留人工值未覆盖 */
  manualProtected: boolean;
  /** 人工在自动填入后修改过该行，原评级不再代表当前值 */
  manuallyEdited: boolean;
  appliedAt: string;
}

export interface ProductAutoMappingRunContext {
  runId: string;
  snapshotId: string;
  collectionRunId: string;
  /** 作用域比对字段：渠道切换会整体重置自动匹配状态，此处只需比对门店与酒店 */
  extUnitCode: string;
  unitId: string;
  draftRevision: number;
}

export interface ProductAutoMappingState {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  runContext: ProductAutoMappingRunContext | null;
  processedProducts: number;
  totalProducts: number;
  error: string | null;
  /** 版本校验失败时的丢弃原因（采集成功但自动填入被丢弃，必须显式展示） */
  staleDiscardReason: string | null;
  counts: ProductMappingRunResult['counts'] | null;
}

const initialAutoMappingState: ProductAutoMappingState = {
  status: 'idle',
  runContext: null,
  processedProducts: 0,
  totalProducts: 0,
  error: null,
  staleDiscardReason: null,
  counts: null,
};

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
  drafts: {},
  insights: {},
  draftRevision: 0,
  autoMapping: initialAutoMappingState,
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
  const brandNewList: ProductMapping[] = [];
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
      // 全新采集候选：未映射内部房型、房价码，允许为空；单独收集待置顶（本次采集的新结果优先展示）
      brandNewList.push({
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

  // 3. 本次采集的全新产品置顶展示（待配置项优先进入视野），其余按采集/历史顺序
  return [...brandNewList, ...mergedList];
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

/**
 * 异步 Thunk: 智能匹配（由用户经「智能匹配」按钮显式发起，2026-11-09 运营决策，见设计 10.1）。
 * 快照在渲染层构建后交主进程校验执行；进度与结果经订阅通道回流（AppBootstrap 接线）。
 * 返回 started=false 携带可读原因（功能未开启 / 无待映射产品），由界面显式反馈；
 * 真实失败（字典缺失、作用域不全、启动被拒）以 rejectWithValue 显式报错。
 */
export const runAutoMappingThunk = createAsyncThunk(
  'product/runAutoMapping',
  async (
    payload: { pmsChannelCode: string },
    { dispatch, getState, rejectWithValue }
  ) => {
    try {
      const state = (getState() as { product: ProductState }).product;
      if (!state.filterChannel || !state.filterExtUnitCode || !state.filterUnitId) {
        return rejectWithValue('请先选择已完成映射的渠道与酒店');
      }

      const capabilities = await getAgentCapabilities();
      if (!capabilities.productMappingEnabled) {
        return { started: false, reason: '产品自动映射功能未开启' };
      }

      // 无待映射产品时不发起空 run，原因返回给界面显式反馈
      const pendingCount = state.products.filter(hasIncompleteMapping).length;
      if (pendingCount === 0) {
        return { started: false, reason: '当前产品均已配置完整映射，无待匹配项' };
      }

      const build = buildProductMappingSnapshot({
        scope: {
          channelCode: payload.pmsChannelCode,
          extUnitCode: state.filterExtUnitCode,
          unitId: state.filterUnitId,
          unitType: state.filterUnitType || 'Property',
          hotelName: state.filterHotelName,
        },
        products: state.products,
        roomTypes: state.roomTypes,
        rateCodes: state.rateCodes,
        reservationTypes: state.reservationTypes,
      });
      if (!build.ok) {
        return rejectWithValue(build.reason);
      }

      const started = await startAgentProductMapping(build.snapshot);
      if (!started.accepted || !started.runId) {
        return rejectWithValue(started.error || '启动自动匹配失败');
      }

      dispatch(
        setAutoMappingRunStarted({
          runId: started.runId,
          totalProducts: build.snapshot.products.length,
          runContext: {
            runId: started.runId,
            snapshotId: build.snapshot.snapshotId,
            collectionRunId: build.snapshot.collectionRunId,
            extUnitCode: state.filterExtUnitCode,
            unitId: state.filterUnitId,
            draftRevision: state.draftRevision,
          },
        })
      );

      return { started: true, runId: started.runId, totalProducts: build.snapshot.products.length };
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
      // 切换渠道时重置门店与数据，防止数据串味；草稿与自动匹配状态随之作废
      state.filterExtUnitCode = '';
      state.filterHotelName = '';
      state.filterUnitId = '';
      state.products = [];
      state.roomTypes = [];
      state.rateCodes = [];
      state.reservationTypes = [];
      state.error = null;
      state.drafts = {};
      state.insights = {};
      state.autoMapping = { ...initialAutoMappingState };
      state.draftRevision += 1;
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
      state.drafts = {};
      state.insights = {};
      state.autoMapping = { ...initialAutoMappingState };
      state.draftRevision += 1;
    },
    setProductSearch: (state, action: PayloadAction<string>) => {
      state.searchKeyword = action.payload;
    },
    /** 唯一草稿写入入口：人工编辑会递增修订号并标记对应评级元数据「已人工修改」 */
    setProductDraft: (
      state,
      action: PayloadAction<{ key: string; field: keyof ProductDraftEdits; value: string }>
    ) => {
      const { key, field, value } = action.payload;
      state.drafts[key] = { ...(state.drafts[key] || {}), [field]: value };
      state.draftRevision += 1;
      const insight = state.insights[key];
      if (insight) {
        insight.manuallyEdited = true;
      }
    },
    /** 保存成功后清除对应行草稿（草稿变化同样递增修订号，使在运行中的自动填入作废） */
    clearProductDraftsForKeys: (state, action: PayloadAction<string[]>) => {
      for (const key of action.payload) {
        delete state.drafts[key];
      }
      if (action.payload.length > 0) {
        state.draftRevision += 1;
      }
    },
    setAutoMappingRunStarted: (
      state,
      action: PayloadAction<{ runId: string; totalProducts: number; runContext: ProductAutoMappingRunContext }>
    ) => {
      state.autoMapping = {
        status: 'running',
        runContext: action.payload.runContext,
        processedProducts: 0,
        totalProducts: action.payload.totalProducts,
        error: null,
        staleDiscardReason: null,
        counts: null,
      };
    },
    /** 非终态进度与无结果的终态事件（runId 匹配时生效） */
    setAutoMappingProgress: (state, action: PayloadAction<ProductMappingProgressEvent>) => {
      const event = action.payload;
      if (!state.autoMapping.runContext || state.autoMapping.runContext.runId !== event.runId) return;

      if (event.phase === 'failed' || event.phase === 'cancelled') {
        state.autoMapping.status = event.phase;
        state.autoMapping.error = event.error || null;
        return;
      }
      if (state.autoMapping.status !== 'running') return;
      state.autoMapping.processedProducts = event.processedProducts;
      state.autoMapping.totalProducts = event.totalProducts;
      if (event.phase === 'batch-failed' && event.error) {
        state.autoMapping.error = event.error;
      }
    },
    /**
     * 应用映射终态结果：版本校验（作用域 + 快照 + 草稿修订号）通过后，
     * 仅向未被人工保护的空字段写入草稿；过期写入整体丢弃并显式记录原因。
     */
    applyAutoMappingResult: (state, action: PayloadAction<ProductMappingRunResult>) => {
      const result = action.payload;
      const context = state.autoMapping.runContext;
      if (!context || context.runId !== result.runId) return;

      state.autoMapping.status = result.outcome;
      state.autoMapping.counts = result.counts;
      state.autoMapping.processedProducts = result.mappings.length + result.failedProducts.length;
      state.autoMapping.totalProducts = result.counts.total;
      if (result.failureReason) {
        state.autoMapping.error = result.failureReason;
      }

      if (
        context.extUnitCode !== state.filterExtUnitCode ||
        context.unitId !== state.filterUnitId ||
        state.draftRevision !== context.draftRevision
      ) {
        state.autoMapping.staleDiscardReason =
          '匹配期间页面数据发生变化（切换酒店、重新采集或人工修改），自动填入已丢弃，请核对后重新匹配';
        return;
      }

      if (result.outcome !== 'completed') return;

      const appliedAt = new Date().toISOString();
      for (const mapping of result.mappings) {
        const product = state.products.find(
          (item) => getProductIdentityKey(item) === mapping.productKey
        );
        if (!product) continue;

        const draft = state.drafts[mapping.productKey];
        const previousInsight = state.insights[mapping.productKey];
        // 上一轮自动填入且用户从未编辑过的草稿属 Agent 自有：重新匹配时允许刷新（设计 6.7「重新匹配可生成新结果」）
        const agentOwnedDraft = previousInsight !== undefined && !previousInsight.manuallyEdited;
        const manualProtected =
          Boolean(
            draft && (draft.roomType !== undefined || draft.rateCode !== undefined || draft.payType !== undefined)
          ) && !agentOwnedDraft;

        const appliedFields: Array<'roomType' | 'rateCode' | 'payType'> = [];
        if (!manualProtected) {
          const nextDraft = { ...(draft || {}) };
          // 字段可写入：产品值为空，且草稿字段为空或属 Agent 自有（可刷新旧建议值）
          const fieldWritable = (productValue: string | undefined, draftValue: string | undefined): boolean =>
            !productValue?.trim() && (draftValue === undefined || agentOwnedDraft);
          if (mapping.roomType.selectedCode && fieldWritable(product.roomType, nextDraft.roomType)) {
            nextDraft.roomType = mapping.roomType.selectedCode;
            appliedFields.push('roomType');
          }
          if (mapping.rateCode.selectedCode && fieldWritable(product.rateCode, nextDraft.rateCode)) {
            nextDraft.rateCode = mapping.rateCode.selectedCode;
            appliedFields.push('rateCode');
          }
          if (mapping.reservationType.selectedCode && fieldWritable(product.payType, nextDraft.payType)) {
            nextDraft.payType = mapping.reservationType.selectedCode;
            appliedFields.push('payType');
          }
          if (appliedFields.length > 0) {
            state.drafts[mapping.productKey] = nextDraft;
          }
        }

        state.insights[mapping.productKey] = {
          runId: result.runId,
          overallGrade: mapping.overallGrade,
          outcome: mapping.outcome,
          roomType: mapping.roomType,
          rateCode: mapping.rateCode,
          reservationType: mapping.reservationType,
          appliedFields,
          manualProtected,
          manuallyEdited: previousInsight?.manuallyEdited ?? false,
          appliedAt,
        };
      }
    },
    deleteProduct: (state, action: PayloadAction<{ otaRoomTypeId: string; otaBasicRoomId?: string }>) => {
      const { otaRoomTypeId, otaBasicRoomId } = action.payload;
      const removeKey = getProductIdentityKey({ otaRoomTypeId, otaBasicRoomId });
      state.products = state.products.filter((p) => {
        const isSameRoomType = p.otaRoomTypeId === otaRoomTypeId;
        const isSameBasicRoom = (p.otaBasicRoomId || '') === (otaBasicRoomId || '');
        return !(isSameRoomType && isSameBasicRoom);
      });
      delete state.drafts[removeKey];
      delete state.insights[removeKey];
    },
    clearProductState: (state) => {
      state.products = [];
      state.roomTypes = [];
      state.rateCodes = [];
      state.reservationTypes = [];
      state.error = null;
      state.drafts = {};
      state.insights = {};
      state.autoMapping = { ...initialAutoMappingState };
      state.draftRevision += 1;
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
        // 基线重载属于草稿修订：在途自动填入必须作废重比对（设计 6.7 版本校验）
        state.draftRevision += 1;
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
        // 重新采集属于草稿修订：在途自动填入作废，人工草稿保留
        state.draftRevision += 1;
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
  setProductDraft,
  clearProductDraftsForKeys,
  setAutoMappingRunStarted,
  setAutoMappingProgress,
  applyAutoMappingResult,
} = productSlice.actions;

export default productSlice.reducer;
