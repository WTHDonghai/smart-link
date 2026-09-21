import { describe, it, expect, vi, beforeEach } from 'vitest';
import productReducer, {
  setProductFilterChannel,
  setProductFilterHotel,
  setProductSearch,
  deleteProduct,
  clearProductState,
  getProductIdentityKey,
  mergeCandidatesWithHistoricalMappings,
  loadProductMappingsAndOptions,
  saveProductMappingsThunk,
  deleteProductMappingThunk,
  crawlOtaProductsThunk,
  type ProductState,
} from '../../../src/store/slices/productSlice';
import type { ProductMapping } from '../../../src/types';
import type { DiscoveredProductCandidate } from '../../../src/crawler/types';
import * as productApiModule from '../../../src/services/productApi';
import * as crawlerBridgeModule from '../../../src/services/crawlerBridge';

describe('productSlice', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with empty products and zero mock data', () => {
    const state = productReducer(undefined, { type: '@@INIT' });

    expect(state.filterChannel).toBe('');
    expect(state.filterExtUnitCode).toBe('');
    expect(state.filterHotelName).toBe('');
    expect(state.searchKeyword).toBe('');
    expect(state.products).toEqual([]);
    expect(state.roomTypes).toEqual([]);
    expect(state.rateCodes).toEqual([]);
    expect(state.reservationTypes).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  describe('filter and selection reducers', () => {
    it('updates channel and clears hotel scope on setProductFilterChannel', () => {
      const initialState: ProductState = {
        filterChannel: 'MEITUAN',
        filterExtUnitCode: 'POI-123',
        filterHotelName: '旧酒店',
        filterUnitId: '99',
        filterUnitType: 'Property',
        searchKeyword: '大床',
        isLoading: false,
        isSaving: false,
        isCrawling: false,
        error: null,
        products: [{ otaRoomTypeId: '1', otaRoomTypeName: '测试', channelCode: 'MT', extUnitCode: '1', unitId: '1', unitType: 'Property', roomType: '', rateCode: '', payType: '', status: 'pending' }],
        roomTypes: [],
        rateCodes: [],
        reservationTypes: [],
      };

      const nextState = productReducer(initialState, setProductFilterChannel('DOUYIN'));

      expect(nextState.filterChannel).toBe('DOUYIN');
      expect(nextState.filterExtUnitCode).toBe('');
      expect(nextState.filterHotelName).toBe('');
      expect(nextState.filterUnitId).toBe('');
      expect(nextState.products).toEqual([]);
    });

    it('updates hotel scope on setProductFilterHotel', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(
        initialState,
        setProductFilterHotel({
          extUnitCode: 'POI-888',
          hotelName: '成都豪华酒店',
          unitId: '2001',
          unitType: 'Property',
        })
      );

      expect(nextState.filterExtUnitCode).toBe('POI-888');
      expect(nextState.filterHotelName).toBe('成都豪华酒店');
      expect(nextState.filterUnitId).toBe('2001');
      expect(nextState.filterUnitType).toBe('Property');
    });

    it('updates searchKeyword on setProductSearch', () => {
      const initialState = productReducer(undefined, { type: '@@INIT' });
      const nextState = productReducer(initialState, setProductSearch('豪华房'));

      expect(nextState.searchKeyword).toBe('豪华房');
    });

    it('deletes product by id or otaRoomTypeId', () => {
      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        products: [
          {
            id: 'map-1',
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '1001',
            unitType: 'Property',
            otaRoomTypeId: 'G-100',
            otaRoomTypeName: '房型1',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'pending',
          },
          {
            id: 'map-2',
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '1001',
            unitType: 'Property',
            otaRoomTypeId: 'G-200',
            otaRoomTypeName: '房型2',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'pending',
          },
        ],
      };

      const stateAfterDeleteId = productReducer(initialState, deleteProduct('map-1'));
      expect(stateAfterDeleteId.products).toHaveLength(1);
      expect(stateAfterDeleteId.products[0].otaRoomTypeId).toBe('G-200');

      const stateAfterDeleteRoomType = productReducer(stateAfterDeleteId, deleteProduct('G-200'));
      expect(stateAfterDeleteRoomType.products).toHaveLength(0);
    });

    it('deletes product accurately by composite key ({ otaRoomTypeId, otaBasicRoomId }) without deleting other products under the same otaRoomTypeId', () => {
      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        products: [
          {
            id: '',
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '1001',
            unitType: 'Property',
            otaRoomTypeId: 'SAME-RT',
            otaRoomTypeName: '大床房商品A',
            otaBasicRoomId: 'BASIC-ROOM-1',
            otaBasicRoomName: '物理房型1',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'pending',
          },
          {
            id: '',
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '1001',
            unitType: 'Property',
            otaRoomTypeId: 'SAME-RT',
            otaRoomTypeName: '大床房商品B',
            otaBasicRoomId: 'BASIC-ROOM-2',
            otaBasicRoomName: '物理房型2',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'pending',
          },
          {
            id: '',
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '1001',
            unitType: 'Property',
            otaRoomTypeId: 'OTHER-RT',
            otaRoomTypeName: '双床房',
            otaBasicRoomId: 'BASIC-ROOM-3',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'pending',
          },
        ],
      };

      // 仅删除物理房型为 BASIC-ROOM-1 的 SAME-RT
      const nextState = productReducer(
        initialState,
        deleteProduct({ otaRoomTypeId: 'SAME-RT', otaBasicRoomId: 'BASIC-ROOM-1' })
      );

      expect(nextState.products).toHaveLength(2);
      // 验证精准删除了 BASIC-ROOM-1，而保留了 BASIC-ROOM-2
      const remainingBasic1 = nextState.products.find(
        (p) => p.otaRoomTypeId === 'SAME-RT' && p.otaBasicRoomId === 'BASIC-ROOM-1'
      );
      expect(remainingBasic1).toBeUndefined();

      const remainingBasic2 = nextState.products.find(
        (p) => p.otaRoomTypeId === 'SAME-RT' && p.otaBasicRoomId === 'BASIC-ROOM-2'
      );
      expect(remainingBasic2).toBeDefined();
      expect(remainingBasic2?.otaRoomTypeName).toBe('大床房商品B');

      // 另外一个完全不同房型的商品也完好保留
      const remainingOther = nextState.products.find((p) => p.otaRoomTypeId === 'OTHER-RT');
      expect(remainingOther).toBeDefined();
    });

    it('clears product state on clearProductState', () => {
      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        products: [
          {
            id: 'p-1',
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '1001',
            unitType: 'Property',
            otaRoomTypeId: 'G-1',
            otaRoomTypeName: '房型1',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'pending',
          },
        ],
        roomTypes: [{ code: 'STD', name: '标准间', displayLabel: '标准间' }],
        rateCodes: [{ rateCode: 'BAR', rateName: '门市价', displayLabel: '门市价' }],
        reservationTypes: [{ code: 'R01', label: '散客', displayLabel: '散客' }],
      };

      const nextState = productReducer(initialState, clearProductState());
      expect(nextState.products).toEqual([]);
      expect(nextState.roomTypes).toEqual([]);
      expect(nextState.rateCodes).toEqual([]);
      expect(nextState.reservationTypes).toEqual([]);
    });

    it('generates consistent product identity key with getProductIdentityKey', () => {
      const key = getProductIdentityKey({
        otaRoomTypeId: 'ROOM-1',
        otaBasicRoomId: 'BASIC-1',
      });
      expect(key).toBe('ROOM-1\u001fBASIC-1');
    });
  });

  describe('pure helper: mergeCandidatesWithHistoricalMappings', () => {
    const scope = {
      channelCode: 'MT01',
      extUnitCode: 'POI-1',
      unitId: '1001',
      unitType: 'Property',
      hotelName: '测试门店',
    };

    it('retains historical internal mappings when candidate matches otaRoomTypeId', () => {
      const historical: ProductMapping[] = [
        {
          id: 'hist-1',
          channelCode: 'MT01',
          extUnitCode: 'POI-1',
          unitId: '1001',
          unitType: 'Property',
          otaRoomTypeId: 'G-100',
          otaRoomTypeName: '大床房历史名',
          roomType: 'EXK',
          rateCode: 'RACK',
          payType: 'R01',
          status: 'completed',
          source: 'remote-platform',
        },
      ];

      const candidates: DiscoveredProductCandidate[] = [
        {
          otaChannelCode: 'MEITUAN',
          extUnitCode: 'POI-1',
          otaRoomTypeId: 'G-100',
          otaRoomTypeName: '大床房最新OTA名',
          otaBasicRoomId: 'B-10',
          otaBasicRoomName: '物理大床房',
          source: 'ota-collection',
        },
      ];

      const merged = mergeCandidatesWithHistoricalMappings(historical, candidates, scope);

      expect(merged).toHaveLength(1);
      const item = merged[0];
      expect(item.id).toBe('hist-1');
      expect(item.otaRoomTypeId).toBe('G-100');
      expect(item.otaRoomTypeName).toBe('大床房最新OTA名');
      expect(item.otaBasicRoomName).toBe('物理大床房');
      expect(item.roomType).toBe('EXK');
      expect(item.rateCode).toBe('RACK');
      expect(item.payType).toBe('R01');
      expect(item.status).toBe('completed');
      expect(item.otaProductPresent).toBe(true);
      expect(item.source).toBe('merged');
    });

    it('appends unmapped candidates as pending and allows empty roomType & rateCode', () => {
      const historical: ProductMapping[] = [];
      const candidates: DiscoveredProductCandidate[] = [
        {
          otaChannelCode: 'MEITUAN',
          extUnitCode: 'POI-1',
          otaRoomTypeId: 'G-200',
          otaRoomTypeName: '全新采集家庭房',
          source: 'ota-collection',
        },
      ];

      const merged = mergeCandidatesWithHistoricalMappings(historical, candidates, scope);

      expect(merged).toHaveLength(1);
      const item = merged[0];
      expect(item.otaRoomTypeId).toBe('G-200');
      expect(item.roomType).toBe('');
      expect(item.rateCode).toBe('');
      expect(item.payType).toBe('');
      expect(item.status).toBe('pending');
      expect(item.source).toBe('ota-collection');
      expect(item.otaProductPresent).toBe(true);
    });

    it('keeps historical mappings even if not observed in current crawl', () => {
      const historical: ProductMapping[] = [
        {
          id: 'hist-2',
          channelCode: 'MT01',
          extUnitCode: 'POI-1',
          unitId: '1001',
          unitType: 'Property',
          otaRoomTypeId: 'G-OLD',
          otaRoomTypeName: '未被本轮抓到的历史房型',
          roomType: 'DBL',
          rateCode: 'BAR',
          payType: 'R01',
          status: 'completed',
        },
      ];

      const candidates: DiscoveredProductCandidate[] = [
        {
          otaChannelCode: 'MEITUAN',
          extUnitCode: 'POI-1',
          otaRoomTypeId: 'G-NEW',
          otaRoomTypeName: '新抓到的房型',
          source: 'ota-collection',
        },
      ];

      const merged = mergeCandidatesWithHistoricalMappings(historical, candidates, scope);

      expect(merged).toHaveLength(2);
      expect(merged.some((p) => p.otaRoomTypeId === 'G-OLD' && !p.otaProductPresent)).toBe(true);
      expect(merged.some((p) => p.otaRoomTypeId === 'G-NEW' && p.otaProductPresent)).toBe(true);
    });
  });

  describe('async thunks', () => {
    it('handles loadProductMappingsAndOptions.fulfilled', async () => {
      vi.spyOn(productApiModule, 'fetchProductMappings').mockResolvedValue([
        {
          id: 'p-1',
          channelCode: 'MT01',
          extUnitCode: 'POI-1',
          unitId: '100',
          unitType: 'Property',
          otaRoomTypeId: 'R-1',
          otaRoomTypeName: '商务房',
          roomType: 'BIZ',
          rateCode: 'RACK',
          payType: 'R01',
          status: 'completed',
        },
      ]);
      vi.spyOn(productApiModule, 'fetchRoomTypes').mockResolvedValue([
        { code: 'BIZ', name: '商务房', displayLabel: '商务房（BIZ）' },
      ]);
      vi.spyOn(productApiModule, 'fetchRatePlans').mockResolvedValue([
        { rateCode: 'RACK', rateName: '门市价', displayLabel: '门市价（RACK）' },
      ]);
      vi.spyOn(productApiModule, 'fetchReservationTypes').mockResolvedValue([
        { code: 'R01', label: '散客', displayLabel: '散客（R01）' },
      ]);

      const action = await loadProductMappingsAndOptions({
        channelCode: 'MT01',
        extUnitCode: 'POI-1',
        unitId: '100',
        unitType: 'Property',
      })(vi.fn(), () => ({}), undefined);

      const state = productReducer(undefined, action);

      expect(state.isLoading).toBe(false);
      expect(state.products).toHaveLength(1);
      expect(state.roomTypes).toHaveLength(1);
      expect(state.rateCodes).toHaveLength(1);
      expect(state.reservationTypes).toHaveLength(1);
    });

    it('在 loadProductMappingsAndOptions.fulfilled 后，当前未持久化的采集草稿仍然完好保留在列表中', async () => {
      const existingRemoteProduct: ProductMapping = {
        id: 'remote-1',
        channelCode: 'MT01',
        extUnitCode: 'POI-1',
        unitId: '100',
        unitType: 'Property',
        otaRoomTypeId: 'R-EXISTING',
        otaRoomTypeName: '已有大床房',
        roomType: 'DBL',
        rateCode: 'BAR',
        payType: 'R01',
        status: 'completed',
        source: 'remote-platform',
      };
      const unpersistedDraft: ProductMapping = {
        channelCode: 'MT01',
        extUnitCode: 'POI-1',
        unitId: '100',
        unitType: 'Property',
        otaRoomTypeId: 'R-DRAFT',
        otaBasicRoomId: 'B-DRAFT',
        otaRoomTypeName: '待保存草稿房型',
        roomType: '',
        rateCode: '',
        payType: '',
        status: 'pending',
        source: 'ota-collection',
      };
      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        products: [existingRemoteProduct, unpersistedDraft],
      };

      const updatedRemoteProduct1: ProductMapping = {
        ...existingRemoteProduct,
        otaRoomTypeName: '已有大床房（远程更新）',
      };
      const newRemoteProduct2: ProductMapping = {
        id: 'remote-2',
        channelCode: 'MT01',
        extUnitCode: 'POI-1',
        unitId: '100',
        unitType: 'Property',
        otaRoomTypeId: 'R-NEW',
        otaRoomTypeName: '新配置房型',
        roomType: 'TWN',
        rateCode: 'PROMO',
        payType: 'R01',
        status: 'completed',
        source: 'remote-platform',
      };

      vi.spyOn(productApiModule, 'fetchProductMappings').mockResolvedValue([
        updatedRemoteProduct1,
        newRemoteProduct2,
      ]);
      vi.spyOn(productApiModule, 'fetchRoomTypes').mockResolvedValue([]);
      vi.spyOn(productApiModule, 'fetchRatePlans').mockResolvedValue([]);
      vi.spyOn(productApiModule, 'fetchReservationTypes').mockResolvedValue([]);

      const action = await loadProductMappingsAndOptions({
        channelCode: 'MT01',
        extUnitCode: 'POI-1',
        unitId: '100',
        unitType: 'Property',
      })(vi.fn(), () => ({}), undefined);

      const nextState = productReducer(initialState, action);

      expect(nextState.products).toHaveLength(3);
      expect(nextState.products.map((p) => p.otaRoomTypeId)).toEqual([
        'R-EXISTING',
        'R-NEW',
        'R-DRAFT',
      ]);
      const draft = nextState.products.find((p) => p.otaRoomTypeId === 'R-DRAFT');
      expect(draft).toBeDefined();
      expect(draft?.id).toBeUndefined();
      expect(draft?.source).toBe('ota-collection');
      expect(draft?.otaRoomTypeName).toBe('待保存草稿房型');
    });

    it('dispatches addLog with WARN level when dictionary options fail to load', async () => {
      vi.spyOn(productApiModule, 'fetchProductMappings').mockResolvedValue([]);
      vi.spyOn(productApiModule, 'fetchRoomTypes').mockRejectedValue(new Error('Room types error'));
      vi.spyOn(productApiModule, 'fetchRatePlans').mockRejectedValue(new Error('Rate plans error'));
      vi.spyOn(productApiModule, 'fetchReservationTypes').mockRejectedValue(new Error('Reservation types error'));

      const mockDispatch = vi.fn();
      await loadProductMappingsAndOptions({
        channelCode: 'MT01',
        extUnitCode: 'POI-1',
        unitId: '100',
        unitType: 'Property',
      })(mockDispatch, () => ({}), undefined);

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'systemLog/addLog',
          payload: expect.objectContaining({
            level: 'WARN',
            module: 'PRODUCT',
            message: '加载内部房型字典失败',
          }),
        })
      );
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'systemLog/addLog',
          payload: expect.objectContaining({
            level: 'WARN',
            module: 'PRODUCT',
            message: '加载内部房价码字典失败',
          }),
        })
      );
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'systemLog/addLog',
          payload: expect.objectContaining({
            level: 'WARN',
            module: 'PRODUCT',
            message: '加载预订类型字典失败',
          }),
        })
      );
    });

    it('handles saveProductMappingsThunk.fulfilled and marks saved items completed when fields non-empty', async () => {
      vi.spyOn(productApiModule, 'saveProductMappingsBatch').mockResolvedValue({
        success: true,
        count: 1,
      });

      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        products: [
          {
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '100',
            unitType: 'Property',
            otaRoomTypeId: 'R-99',
            otaRoomTypeName: '未填写房型的采集商品',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'pending',
          },
        ],
      };

      const action = await saveProductMappingsThunk([
        {
          channelCode: 'MT01',
          extUnitCode: 'POI-1',
          unitId: '100',
          unitType: 'Property',
          otaRoomTypeId: 'R-99',
          otaRoomTypeName: '未填写房型的采集商品',
          otaPayType: 'PP',
          roomType: 'EXK',
          rateCode: 'BAR01',
          payType: 'R01',
        },
      ])(vi.fn(), () => ({}), undefined);

      const nextState = productReducer(initialState, action);

      expect(nextState.isSaving).toBe(false);
      expect(nextState.products[0].status).toBe('completed');
      expect(nextState.products[0].roomType).toBe('EXK');
      expect(nextState.products[0].rateCode).toBe('BAR01');
      expect(nextState.products[0].payType).toBe('R01');
      expect(nextState.products[0].internalRoomType).toBe('EXK');
      expect(nextState.products[0].bookingType).toBe('R01');
    });

    it('handles saveProductMappingsThunk.fulfilled and marks status pending when saved fields are all empty', async () => {
      vi.spyOn(productApiModule, 'saveProductMappingsBatch').mockResolvedValue({
        success: true,
        count: 1,
      });

      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        products: [
          {
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '100',
            unitType: 'Property',
            otaRoomTypeId: 'R-EMPTY',
            otaRoomTypeName: '留空的采集商品',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'pending',
          },
        ],
      };

      const action = await saveProductMappingsThunk([
        {
          channelCode: 'MT01',
          extUnitCode: 'POI-1',
          unitId: '100',
          unitType: 'Property',
          otaRoomTypeId: 'R-EMPTY',
          otaRoomTypeName: '留空的采集商品',
          otaPayType: 'PP',
          roomType: '',
          rateCode: '',
          payType: '',
        },
      ])(vi.fn(), () => ({}), undefined);

      const nextState = productReducer(initialState, action);

      expect(nextState.isSaving).toBe(false);
      expect(nextState.products[0].status).toBe('pending');
      expect(nextState.products[0].roomType).toBe('');
      expect(nextState.products[0].rateCode).toBe('');
      expect(nextState.products[0].payType).toBe('');
    });

    it('handles deleteProductMappingThunk.fulfilled', async () => {
      vi.spyOn(productApiModule, 'deleteProductMapping').mockResolvedValue({ success: true });

      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        products: [
          {
            id: 'to-delete',
            channelCode: 'MT01',
            extUnitCode: 'POI-1',
            unitId: '100',
            unitType: 'Property',
            otaRoomTypeId: 'R-DEL',
            otaRoomTypeName: '待删除房型',
            roomType: '',
            rateCode: '',
            payType: '',
            status: 'completed',
          },
        ],
      };

      const action = await deleteProductMappingThunk({
        mappingId: 'to-delete',
        otaRoomTypeId: 'R-DEL',
      })(vi.fn(), () => ({}), undefined);

      const nextState = productReducer(initialState, action);

      expect(nextState.products).toHaveLength(0);
    });

    it('handles crawlOtaProductsThunk.fulfilled and merges candidates', async () => {
      vi.spyOn(crawlerBridgeModule, 'collectProductsByHotel').mockResolvedValue({
        success: true,
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-1',
        products: [
          {
            otaChannelCode: 'MEITUAN',
            extUnitCode: 'POI-1',
            otaRoomTypeId: 'CRAWLED-1',
            otaRoomTypeName: '采集到的新房型',
            source: 'meituan-catalog',
          },
        ],
      });

      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        filterChannel: 'MEITUAN',
        filterExtUnitCode: 'POI-1',
        filterUnitId: '100',
        products: [],
      };

      const action = await crawlOtaProductsThunk({
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-1',
        otaHotelName: '测试酒店',
      })(vi.fn(), () => ({}), undefined);

      const nextState = productReducer(initialState, action);

      expect(nextState.isCrawling).toBe(false);
      expect(nextState.products).toHaveLength(1);
      expect(nextState.products[0].otaRoomTypeId).toBe('CRAWLED-1');
      expect(nextState.products[0].channelCode).toBe('MEITUAN');
      expect(nextState.products[0].source).toBe('ota-collection');
    });

    it('handles crawlOtaProductsThunk.fulfilled and prioritizes pmsChannelCode when provided', async () => {
      vi.spyOn(crawlerBridgeModule, 'collectProductsByHotel').mockResolvedValue({
        success: true,
        channelCode: 'MEITUAN',
        extUnitCode: 'POI-1',
        products: [
          {
            otaChannelCode: 'MEITUAN',
            extUnitCode: 'POI-1',
            otaRoomTypeId: 'CRAWLED-PMS-1',
            otaRoomTypeName: 'PMS渠道对齐房型',
            source: 'meituan-catalog',
          },
        ],
      });

      const initialState: ProductState = {
        ...productReducer(undefined, { type: '@@INIT' }),
        filterChannel: 'MEITUAN',
        filterExtUnitCode: 'POI-1',
        filterUnitId: '100',
        products: [],
      };

      const action = await crawlOtaProductsThunk({
        channelCode: 'MEITUAN',
        pmsChannelCode: 'MT01',
        extUnitCode: 'POI-1',
        otaHotelName: '测试酒店',
      })(vi.fn(), () => ({}), undefined);

      const nextState = productReducer(initialState, action);

      expect(nextState.isCrawling).toBe(false);
      expect(nextState.products).toHaveLength(1);
      expect(nextState.products[0].otaRoomTypeId).toBe('CRAWLED-PMS-1');
      // 核心断言：优先采用 pmsChannelCode (MT01) 而不是 OTA 渠道编码 (MEITUAN)
      expect(nextState.products[0].channelCode).toBe('MT01');
      expect(nextState.products[0].source).toBe('ota-collection');
    });
  });
});
