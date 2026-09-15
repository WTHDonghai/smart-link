import { describe, it, expect } from 'vitest';
import hotelReducer, {
  setFilterChannel,
  setSearchKeyword,
  setIsScraping,
  updateHotelMapping,
  addDiscoveredHotel,
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
});
