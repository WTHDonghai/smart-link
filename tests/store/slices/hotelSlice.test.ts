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
import { HotelMapping } from '../../../src/types';

describe('hotelSlice', () => {
  it('loads initial state with 6 hotels and default filter values', () => {
    const state = hotelReducer(undefined, { type: '@@INIT' });

    expect(state.isScraping).toBe(false);
    expect(state.filterChannel).toBe('all');
    expect(state.searchKeyword).toBe('');
    expect(state.hotels.length).toBe(6);

    const firstHotel = state.hotels[0];
    expect(firstHotel.id).toBe('hm-00');
    expect(firstHotel.otaChannelId).toBe('meituan');
    expect(firstHotel.otaHotelName).toBe('禅驿度假酒店（自贡方特恐龙王国店）');
    expect(firstHotel.otaHotelId).toBe('MT-ZG-52019');
    expect(firstHotel.pmsHotelName).toBe('自贡禅驿度假酒店-方特店');
    expect(firstHotel.pmsHotelId).toBe('PMS-ZG-008');
    expect(firstHotel.status).toBe('mapped');
  });

  describe('setFilterChannel and setSearchKeyword', () => {
    it('updates filter channel correctly', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, setFilterChannel('meituan'));

      expect(nextState.filterChannel).toBe('meituan');
      expect(nextState.searchKeyword).toBe('');
    });

    it('updates search keyword correctly', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, setSearchKeyword('亚特兰蒂斯'));

      expect(nextState.searchKeyword).toBe('亚特兰蒂斯');
      expect(nextState.filterChannel).toBe('all');
    });
  });

  describe('setIsScraping', () => {
    it('toggles scraping state between true and false', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      expect(initialState.isScraping).toBe(false);

      const scrapingState = hotelReducer(initialState, setIsScraping(true));
      expect(scrapingState.isScraping).toBe(true);

      const stoppedState = hotelReducer(scrapingState, setIsScraping(false));
      expect(stoppedState.isScraping).toBe(false);
    });
  });

  describe('updateHotelMapping', () => {
    it('updates PMS hotel ID, PMS hotel name and sets status to mapped for matching hotel', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const target = initialState.hotels.find((h) => h.id === 'hm-04');
      expect(target).toBeDefined();
      expect(target?.status).toBe('pending');
      expect(target?.pmsHotelId).toBe('PMS-CD-034');
      expect(target?.pmsHotelName).toBe('花间堂-成都宽窄店');

      const nextState = hotelReducer(
        initialState,
        updateHotelMapping({
          id: 'hm-04',
          pmsHotelId: 'PMS-CD-999',
          pmsHotelName: '成都宽窄花间堂新院',
        })
      );

      const updated = nextState.hotels.find((h) => h.id === 'hm-04');
      expect(updated).toBeDefined();
      expect(updated?.pmsHotelId).toBe('PMS-CD-999');
      expect(updated?.pmsHotelName).toBe('成都宽窄花间堂新院');
      expect(updated?.status).toBe('mapped');

      // Unrelated hotel remains unchanged
      const unaffected = nextState.hotels.find((h) => h.id === 'hm-00');
      expect(unaffected?.pmsHotelId).toBe('PMS-ZG-008');
    });

    it('does not mutate hotels if target ID is not found', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(
        initialState,
        updateHotelMapping({
          id: 'non-existent-id',
          pmsHotelId: 'PMS-NONE',
          pmsHotelName: '不存在的酒店',
        })
      );

      expect(nextState.hotels).toEqual(initialState.hotels);
    });
  });

  describe('addDiscoveredHotel', () => {
    it('prepends discovered hotel to the beginning of hotels array', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const newHotel: HotelMapping = {
        id: 'hm-new-01',
        otaChannelId: 'ctrip',
        otaHotelName: '杭州西湖国宾馆',
        otaHotelId: 'CT-HZ-0001',
        pmsHotelName: '西湖国宾馆-主楼',
        pmsHotelId: 'PMS-HZ-999',
        city: '杭州',
        starRating: '白金五星级',
        status: 'pending',
        lastScraped: '刚刚',
        roomCount: 45,
      };

      const nextState = hotelReducer(initialState, addDiscoveredHotel(newHotel));

      expect(nextState.hotels.length).toBe(7);
      expect(nextState.hotels[0]).toEqual(newHotel);
      expect(nextState.hotels[1].id).toBe('hm-00');
    });
  });

  describe('setSelectedCrawlChannel and clearCrawlError', () => {
    it('updates selected crawl channel correctly', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      expect(initialState.selectedCrawlChannel).toBe('meituan');

      const nextState = hotelReducer(initialState, setSelectedCrawlChannel('douyin'));
      expect(nextState.selectedCrawlChannel).toBe('douyin');
    });

    it('clears crawl error when clearCrawlError is dispatched', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const errorState = { ...initialState, crawlError: '网络超时异常' };

      const cleared = hotelReducer(errorState, clearCrawlError());
      expect(cleared.crawlError).toBeNull();
    });
  });

  describe('upsertDiscoveredHotels', () => {
    it('inserts a brand new candidate as pending status', () => {
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
            source: 'meituan-network',
          },
        ])
      );

      expect(nextState.hotels.length).toBe(initialState.hotels.length + 1);
      const inserted = nextState.hotels[0];
      expect(inserted.otaHotelId).toBe('MT-NEW-8888');
      expect(inserted.otaHotelName).toBe('西湖国宾馆美团直营店');
      expect(inserted.status).toBe('pending');
      expect(inserted.partnerId).toBe('990011');
      expect(inserted.pmsHotelName).toBe('待关联中台酒店');
    });

    it('updates existing hotel metadata while preserving user configured PMS binding', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const target = initialState.hotels.find((h) => h.otaHotelId === 'MT-ZG-52019');
      expect(target).toBeDefined();
      expect(target?.pmsHotelId).toBe('PMS-ZG-008');
      expect(target?.status).toBe('mapped');

      const nextState = hotelReducer(
        initialState,
        upsertDiscoveredHotels([
          {
            otaChannelId: 'meituan',
            otaChannelCode: 'MEITUAN',
            otaHotelId: 'MT-ZG-52019',
            otaHotelName: '自贡方特恐龙王国禅驿度假酒店（最新更名）',
            city: '自贡',
            starRating: '高档度假型',
            partnerId: 'PARTNER-ZG-11',
            source: 'meituan',
          },
        ])
      );

      expect(nextState.hotels.length).toBe(initialState.hotels.length);
      const updated = nextState.hotels.find((h) => h.otaHotelId === 'MT-ZG-52019');
      expect(updated).toBeDefined();
      expect(updated?.otaHotelName).toBe('自贡方特恐龙王国禅驿度假酒店（最新更名）');
      expect(updated?.pmsHotelId).toBe('PMS-ZG-008');
      expect(updated?.status).toBe('mapped');
      expect(updated?.partnerId).toBe('PARTNER-ZG-11');
    });
  });

  describe('crawlHotelsByChannel extraReducers', () => {
    it('sets isScraping to true and crawlStatus to running on pending', () => {
      const initialState = hotelReducer(undefined, { type: '@@INIT' });
      const nextState = hotelReducer(initialState, {
        type: 'hotel/crawlHotelsByChannel/pending',
      });

      expect(nextState.isScraping).toBe(true);
      expect(nextState.crawlStatus).toBe('running');
      expect(nextState.crawlError).toBeNull();
    });

    it('sets isScraping to false, crawlStatus to failed, and captures crawlError on rejected', () => {
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

    it('sets isScraping to false, updates lastCrawlSummary and merges hotels on fulfilled', () => {
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
    });
  });
});
