import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { HotelMapping } from '../../types';

interface HotelState {
  hotels: HotelMapping[];
  isScraping: boolean;
  filterChannel: string;
  searchKeyword: string;
}

const initialState: HotelState = {
  isScraping: false,
  filterChannel: 'all',
  searchKeyword: '',
  hotels: [
    {
      id: 'hm-00',
      otaChannelId: 'meituan',
      otaHotelName: '禅驿度假酒店（自贡方特恐龙王国店）',
      otaHotelId: 'MT-ZG-52019',
      pmsHotelName: '自贡禅驿度假酒店-方特店',
      pmsHotelId: 'PMS-ZG-008',
      city: '自贡',
      starRating: '高档度假型',
      status: 'mapped',
      lastScraped: '刚刚 (Playwright)',
      roomCount: 8
    },
    {
      id: 'hm-01',
      otaChannelId: 'meituan',
      otaHotelName: '全季酒店(杭州西湖湖滨步行街店)',
      otaHotelId: 'MT-HZ-88192',
      pmsHotelName: '华住全季-杭州湖滨店',
      pmsHotelId: 'PMS-HZ-001',
      city: '杭州',
      starRating: '四星/高档型',
      status: 'mapped',
      lastScraped: '2分钟前 (Playwright)',
      roomCount: 14
    },
    {
      id: 'hm-02',
      otaChannelId: 'douyin',
      otaHotelName: '三亚亚特兰蒂斯度假酒店',
      otaHotelId: 'DY-SY-10492',
      pmsHotelName: '复星旅文-亚特兰蒂斯(海棠湾)',
      pmsHotelId: 'PMS-SY-099',
      city: '三亚',
      starRating: '豪华五星型',
      status: 'mapped',
      lastScraped: '5分钟前 (Playwright)',
      roomCount: 28
    },
    {
      id: 'hm-03',
      otaChannelId: 'meituanbiz',
      otaHotelName: '北京国贸大酒店(CBD店)',
      otaHotelId: 'MTB-BJ-4401',
      pmsHotelName: '国贸商务酒店-北京总店',
      pmsHotelId: 'PMS-BJ-012',
      city: '北京',
      starRating: '超高端商旅',
      status: 'mapped',
      lastScraped: '10分钟前 (Playwright)',
      roomCount: 18
    },
    {
      id: 'hm-04',
      otaChannelId: 'meituan',
      otaHotelName: '成都宽窄巷子花间堂精品客栈',
      otaHotelId: 'MT-CD-7729',
      pmsHotelName: '花间堂-成都宽窄店',
      pmsHotelId: 'PMS-CD-034',
      city: '成都',
      starRating: '精品文化度假',
      status: 'pending',
      lastScraped: '15分钟前 (Playwright)',
      roomCount: 8
    },
    {
      id: 'hm-05',
      otaChannelId: 'douyin',
      otaHotelName: '上海静安瑞吉酒店',
      otaHotelId: 'DY-SH-5512',
      pmsHotelName: '万豪瑞吉-上海静安',
      pmsHotelId: 'PMS-SH-102',
      city: '上海',
      starRating: '奢华五星',
      status: 'mapped',
      lastScraped: '8分钟前 (Playwright)',
      roomCount: 22
    }
  ]
};

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
    setIsScraping: (state, action: PayloadAction<boolean>) => {
      state.isScraping = action.payload;
    },
    updateHotelMapping: (state, action: PayloadAction<{ id: string; pmsHotelId: string; pmsHotelName: string }>) => {
      const h = state.hotels.find(x => x.id === action.payload.id);
      if (h) {
        h.pmsHotelId = action.payload.pmsHotelId;
        h.pmsHotelName = action.payload.pmsHotelName;
        h.status = 'mapped';
      }
    },
    addDiscoveredHotel: (state, action: PayloadAction<HotelMapping>) => {
      state.hotels.unshift(action.payload);
    }
  }
});

export const {
  setFilterChannel,
  setSearchKeyword,
  setIsScraping,
  updateHotelMapping,
  addDiscoveredHotel
} = hotelSlice.actions;

export default hotelSlice.reducer;
