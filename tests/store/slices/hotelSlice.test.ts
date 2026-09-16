import { describe, it, expect } from 'vitest';
import hotelReducer, {
  setFilterChannel,
  setSearchKeyword,
  setIsScraping,
  setSelectedCrawlChannel,
  clearCrawlError,
  updateHotelMapping,
  addDiscoveredHotel,
  upsertDiscoveredHotels,
} from '../../../src/store/slices/hotelSlice';
import type { HotelMapping } from '../../../src/types';

describe('hotelSlice - 门店管理状态切片', () => {
  it('初始化状态为空列表 (0 家酒店/门店) 与默认过滤设置 (删除硬编码 mock 数据)', () => {
    const state = hotelReducer(undefined, { type: '@@INIT' });

    expect(state.isScraping).toBe(false);
    expect(state.isFetching).toBe(false);
    expect(state.isSaving).toBe(false);
    expect(state.filterChannel).toBe('all');
    expect(state.searchKeyword).toBe('');
    expect(state.selectedCrawlChannel).toBe('meituan');
    expect(state.hotels.length).toBe(0);
    expect(state.lastCrawlSummary).toBeNull();
  });

  describe('setFilterChannel and setSearchKeyword', () => {
    it('正确更新渠道筛选条件', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, setFilterChannel('meituan'));

      expect(nextState.filterChannel).toBe('meituan');
      expect(nextState.searchKeyword).toBe('');
    });

    it('正确更新搜索关键字', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, setSearchKeyword('全季'));

      expect(nextState.searchKeyword).toBe('全季');
      expect(nextState.filterChannel).toBe('all');
    });
  });

  describe('setIsScraping & setSelectedCrawlChannel', () => {
    it('正确切换采集激活状态', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      expect(initialState.isScraping).toBe(false);

      const scrapingState = hotelReducer(initialState, setIsScraping(true));
      expect(scrapingState.isScraping).toBe(true);

      const stoppedState = hotelReducer(scrapingState, setIsScraping(false));
      expect(stoppedState.isScraping).toBe(false);
    });

    it('正确更新采集渠道', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, setSelectedCrawlChannel('douyin'));
      expect(nextState.selectedCrawlChannel).toBe('douyin');
    });

    it('清除采集异常信息', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const errorState = { ...initialState, crawlError: '网络超时异常' };

      const cleared = hotelReducer(errorState, clearCrawlError());
      expect(cleared.crawlError).toBeNull();
    });
  });

  describe('updateHotelMapping & addDiscoveredHotel', () => {
    const sampleHotel: HotelMapping = {
      id: 'hm-01',
      otaChannelId: 'meituan',
      otaChannelCode: 'MEITUAN',
      otaHotelId: 'MT-001',
      extUnitCode: 'MT-001',
      otaHotelName: '自贡方特恐龙王国酒店',
      pmsHotelId: '',
      pmsHotelName: '待关联中台酒店',
      status: 'pending',
    };

    it('添加单家发现的酒店到列表开头', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, addDiscoveredHotel(sampleHotel));

      expect(nextState.hotels.length).toBe(1);
      expect(nextState.hotels[0].id).toBe('hm-01');
      expect(nextState.hotels[0].status).toBe('pending');
    });

    it('本地更新匹配信息为 mapped', () => {
      const stateWithHotel = hotelReducer(
        hotelReducer(undefined, { type: '@@INIT' }),
        addDiscoveredHotel(sampleHotel)
      );

      const updatedState = hotelReducer(
        stateWithHotel,
        updateHotelMapping({
          id: 'hm-01',
          pmsHotelId: 'PMS-ZG-008',
          pmsHotelName: '自贡禅驿-方特店',
        })
      );

      expect(updatedState.hotels[0].pmsHotelId).toBe('PMS-ZG-008');
      expect(updatedState.hotels[0].pmsHotelName).toBe('自贡禅驿-方特店');
      expect(updatedState.hotels[0].status).toBe('mapped');
    });
  });

  describe('upsertDiscoveredHotels 增量合并', () => {
    it('当列表中无此门店时作为新 pending 门店插入', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(
        initialState,
        upsertDiscoveredHotels([
          {
            otaChannelId: 'meituan',
            otaChannelCode: 'MEITUAN',
            otaHotelId: 'MT-NEW-8888',
            otaHotelName: '西湖国宾馆美团直营店',
            city: '杭州',
            starRating: '豪华五星',
            partnerId: '990011',
            source: 'meituan',
          },
        ])
      );

      expect(nextState.hotels.length).toBe(1);
      const inserted = nextState.hotels[0];
      expect(inserted.otaHotelId).toBe('MT-NEW-8888');
      expect(inserted.extUnitCode).toBe('MT-NEW-8888');
      expect(inserted.otaHotelName).toBe('西湖国宾馆美团直营店');
      expect(inserted.status).toBe('pending');
      expect(inserted.partnerId).toBe('990011');
      expect(inserted.pmsHotelName).toBe('待关联中台酒店');
    });

    it('当列表中已有该门店时更新信息并保留用户已匹配的 PMS 关系', () => {
      const baseHotel: HotelMapping = {
        id: 'hm-mt-52019',
        otaChannelId: 'meituan',
        otaChannelCode: 'MEITUAN',
        otaHotelId: 'MT-ZG-52019',
        extUnitCode: 'MT-ZG-52019',
        otaHotelName: '旧酒店名',
        pmsHotelId: 'PMS-ZG-008',
        pmsHotelName: '自贡禅驿度假酒店-方特店',
        status: 'mapped',
      };

      const stateWithHotel = hotelReducer(
        hotelReducer(undefined, { type: '@@INIT' }),
        addDiscoveredHotel(baseHotel)
      );

      const nextState = hotelReducer(
        stateWithHotel,
        upsertDiscoveredHotels([
          {
            otaChannelId: 'meituan',
            otaChannelCode: 'MEITUAN',
            otaHotelId: 'MT-ZG-52019',
            otaHotelName: '新更名-自贡方特恐龙王国禅驿度假酒店',
            city: '自贡',
            starRating: '高档度假型',
            partnerId: 'PARTNER-ZG-11',
            source: 'meituan',
          },
        ])
      );

      expect(nextState.hotels.length).toBe(1);
      const updated = nextState.hotels[0];
      expect(updated.otaHotelName).toBe('新更名-自贡方特恐龙王国禅驿度假酒店');
      expect(updated.pmsHotelId).toBe('PMS-ZG-008');
      expect(updated.status).toBe('mapped');
      expect(updated.partnerId).toBe('PARTNER-ZG-11');
    });
  });

  describe('fetchHotelMappingsThunk extraReducers', () => {
    it('pending 时更新 isFetching 为 true 并清空 fetchError', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, {
        type: 'hotel/fetchHotelMappings/pending',
      });

      expect(nextState.isFetching).toBe(true);
      expect(nextState.fetchError).toBeNull();
    });

    it('fulfilled 时写入远程获取的真实门店映射列表并设置 isFetching 为 false', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const remoteHotels: HotelMapping[] = [
        {
          id: 'map-101',
          mappingId: 'map-101',
          otaChannelId: 'meituan',
          otaChannelCode: 'MEITUAN',
          otaHotelId: 'MT-001',
          extUnitCode: 'MT-001',
          otaHotelName: '自贡禅驿',
          pmsHotelId: 'PMS-ZG-008',
          pmsHotelName: '自贡禅驿-方特店',
          status: 'mapped',
          unitType: 'Property',
        },
      ];

      const nextState = hotelReducer(initialState, {
        type: 'hotel/fetchHotelMappings/fulfilled',
        payload: remoteHotels,
      });

      expect(nextState.isFetching).toBe(false);
      expect(nextState.hotels.length).toBe(1);
      expect(nextState.hotels[0].otaHotelName).toBe('自贡禅驿');
      expect(nextState.hotels[0].status).toBe('mapped');
    });

    it('rejected 时捕获错误信息并将 isFetching 置为 false', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, {
        type: 'hotel/fetchHotelMappings/rejected',
        payload: '网络连接超时 (CODE_408)',
      });

      expect(nextState.isFetching).toBe(false);
      expect(nextState.fetchError).toBe('网络连接超时 (CODE_408)');
    });
  });

  describe('saveHotelMappingThunk extraReducers', () => {
    it('fulfilled 时更新对应门店的 PMS 关联信息与 mapped 状态', () => {
      const initialHotel: HotelMapping = {
        id: 'hm-local-01',
        otaChannelId: 'meituan',
        otaChannelCode: 'MEITUAN',
        otaHotelId: 'MT-9901',
        extUnitCode: 'MT-9901',
        otaHotelName: '国贸大酒店',
        pmsHotelId: '',
        pmsHotelName: '待关联中台酒店',
        status: 'pending',
      };

      const stateWithHotel = hotelReducer(
        hotelReducer(undefined, { type: '@@INIT' }),
        addDiscoveredHotel(initialHotel)
      );

      const nextState = hotelReducer(stateWithHotel, {
        type: 'hotel/saveHotelMapping/fulfilled',
        payload: {
          id: 'hm-local-01',
          otaChannelCode: 'MEITUAN',
          extUnitCode: 'MT-9901',
          otaHotelName: '国贸大酒店',
          unitId: 'PMS-BJ-012',
          pmsHotelName: '国贸商务酒店-北京总店',
          unitType: 'Property',
        },
      });

      expect(nextState.isSaving).toBe(false);
      const saved = nextState.hotels[0];
      expect(saved.pmsHotelId).toBe('PMS-BJ-012');
      expect(saved.pmsHotelName).toBe('国贸商务酒店-北京总店');
      expect(saved.status).toBe('mapped');
    });
  });

  describe('deleteHotelMappingThunk extraReducers', () => {
    it('fulfilled 时从列表中剔除被删除的映射记录', () => {
      const initialHotels: HotelMapping[] = [
        {
          id: 'hm-01',
          mappingId: 'map-del-01',
          otaChannelId: 'meituan',
          otaHotelId: 'MT-01',
          otaHotelName: '将要删除的酒店',
          pmsHotelId: 'PMS-01',
          pmsHotelName: '中台酒店',
          status: 'mapped',
        },
        {
          id: 'hm-02',
          mappingId: 'map-del-02',
          otaChannelId: 'meituan',
          otaHotelId: 'MT-02',
          otaHotelName: '保留的酒店',
          pmsHotelId: 'PMS-02',
          pmsHotelName: '中台酒店2',
          status: 'mapped',
        },
      ];

      const stateWithHotels = hotelReducer(
        hotelReducer(undefined, { type: '@@INIT' }),
        {
          type: 'hotel/fetchHotelMappings/fulfilled',
          payload: initialHotels,
        }
      );

      expect(stateWithHotels.hotels.length).toBe(2);

      const nextState = hotelReducer(stateWithHotels, {
        type: 'hotel/deleteHotelMapping/fulfilled',
        payload: {
          mappingId: 'map-del-01',
          localId: 'hm-01',
        },
      });

      expect(nextState.hotels.length).toBe(1);
      expect(nextState.hotels[0].id).toBe('hm-02');
      expect(nextState.hotels[0].otaHotelName).toBe('保留的酒店');
    });
  });

  describe('crawlHotelsByChannel extraReducers', () => {
    it('pending 时设置 isScraping 为 true 且 crawlStatus 为 running', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, {
        type: 'hotel/crawlHotelsByChannel/pending',
      });

      expect(nextState.isScraping).toBe(true);
      expect(nextState.crawlStatus).toBe('running');
      expect(nextState.crawlError).toBeNull();
    });

    it('rejected 时更新 crawlStatus 为 failed 并捕获 crawlError', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const runningState = { ...initialState, isScraping: true, crawlStatus: 'running' as const };
      const nextState = hotelReducer(runningState, {
        type: 'hotel/crawlHotelsByChannel/rejected',
        payload: '未检测到美团商家后台登录态 (LOGIN_REQUIRED)',
      });

      expect(nextState.isScraping).toBe(false);
      expect(nextState.crawlStatus).toBe('failed');
      expect(nextState.crawlError).toBe('未检测到美团商家后台登录态 (LOGIN_REQUIRED)');
    });

    it('fulfilled 时更新 lastCrawlSummary 并增量合并新发现的门店', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const runningState = { ...initialState, isScraping: true, crawlStatus: 'running' as const };
      const nextState = hotelReducer(runningState, {
        type: 'hotel/crawlHotelsByChannel/fulfilled',
        payload: {
          channelId: 'meituan',
          hotels: [
            {
              otaChannelId: 'meituan',
              otaChannelCode: 'MEITUAN',
              otaHotelId: 'MT-DISCOVER-01',
              otaHotelName: '千岛湖洲际度假酒店',
              city: '淳安',
              starRating: '豪华五星',
              source: 'meituan',
            },
          ],
          durationMs: 3400,
        },
      });

      expect(nextState.isScraping).toBe(false);
      expect(nextState.crawlStatus).toBe('success');
      expect(nextState.crawlError).toBeNull();
      expect(nextState.lastCrawlSummary?.channelId).toBe('meituan');
      expect(nextState.lastCrawlSummary?.discoveredCount).toBe(1);
      expect(nextState.lastCrawlSummary?.durationMs).toBe(3400);
      expect(nextState.hotels[0].otaHotelId).toBe('MT-DISCOVER-01');
      expect(nextState.hotels[0].status).toBe('pending');
    });
  });
});
