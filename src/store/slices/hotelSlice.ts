import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { HotelMapping } from '../../types';
import type { DiscoveredHotelCandidate } from '../../crawler/types';
import {
  executeHotelCrawl,
  requestSyncChromeProfile,
  type ProfileSyncResponseData,
} from '../../services/crawlerApi';
import { addLog } from './systemLogSlice';
import { showToast } from './appSlice';

export type CrawlStatus = 'idle' | 'running' | 'success' | 'failed';

export interface HotelState {
  hotels: HotelMapping[];
  isScraping: boolean;
  crawlStatus: CrawlStatus;
  crawlError: string | null;
  filterChannel: string;
  searchKeyword: string;
  selectedCrawlChannel: string;
  isSyncingProfile: boolean;
  lastCrawlSummary: {
    channelId: string;
    discoveredCount: number;
    durationMs: number;
    timestamp: string;
  } | null;
}

const initialState: HotelState = {
  isScraping: false,
  isSyncingProfile: false,
  crawlStatus: 'idle',
  crawlError: null,
  filterChannel: 'all',
  searchKeyword: '',
  selectedCrawlChannel: 'meituan',
  lastCrawlSummary: null,
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
      roomCount: 8,
      source: 'meituan'
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
      roomCount: 14,
      source: 'meituan'
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
      roomCount: 28,
      source: 'douyin'
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
      roomCount: 18,
      source: 'meituanbiz'
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
      roomCount: 8,
      source: 'meituan'
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
      roomCount: 22,
      source: 'douyin'
    }
  ]
};

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

    // 分发爬虫执行期间的结构化日志
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

/**
 * 异步 Thunk：从日常系统 Chrome 同步活跃登录态至当前渠道独立 Profile
 */
export const syncChromeProfileThunk = createAsyncThunk<
  ProfileSyncResponseData,
  string | undefined,
  { rejectValue: string }
>('hotel/syncChromeProfile', async (channelId, { dispatch, rejectWithValue }) => {
  try {
    const targetChannel = channelId || 'meituan';
    dispatch(
      addLog({
        level: 'PLAYWRIGHT',
        channelId: targetChannel,
        message: `[ProfileSync] 正在从系统 Chrome 活跃会话提取登录态至「${targetChannel}」...`,
      })
    );

    const result = await requestSyncChromeProfile(targetChannel);

    dispatch(
      addLog({
        level: 'SUCCESS',
        channelId: targetChannel,
        message: `[ProfileSync] ${result.message}`,
      })
    );

    dispatch(
      showToast({
        title: '已同步日常 Chrome 登录态',
        description: `成功从系统 ${result.sourceProfile} 提取授权缓存至「${targetChannel}」`,
        type: 'success',
      })
    );

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    dispatch(
      addLog({
        level: 'ERROR',
        message: `[ProfileSync] 同步登录态失败: ${errorMsg}`,
      })
    );
    dispatch(
      showToast({
        title: '同步登录态失败',
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
        h.status = 'mapped';
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
            h.otaHotelId === candidate.otaHotelId
        );

        if (existing) {
          // 更新已有门店的最新信息，保留用户已匹配的 PMS 关系
          existing.otaHotelName = candidate.otaHotelName;
          existing.lastScraped = '刚刚 (Playwright)';
          if (candidate.city) existing.city = candidate.city;
          if (candidate.starRating) existing.starRating = candidate.starRating;
          if (candidate.partnerId) existing.partnerId = candidate.partnerId;
          existing.source = candidate.source;
        } else {
          // 新增候选待匹配门店
          const newHotel: HotelMapping = {
            id: `hm-${candidate.otaChannelId}-${candidate.otaHotelId}-${Date.now()}`,
            otaChannelId: candidate.otaChannelId,
            otaHotelId: candidate.otaHotelId,
            otaHotelName: candidate.otaHotelName,
            pmsHotelId: '',
            pmsHotelName: '待关联中台酒店',
            city: candidate.city || '未知城市',
            starRating: candidate.starRating || '标准酒店',
            status: 'pending',
            lastScraped: '刚刚 (Playwright)',
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

        // 自动合并候选门店
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
      .addCase(syncChromeProfileThunk.pending, (state) => {
        state.isSyncingProfile = true;
      })
      .addCase(syncChromeProfileThunk.fulfilled, (state) => {
        state.isSyncingProfile = false;
      })
      .addCase(syncChromeProfileThunk.rejected, (state) => {
        state.isSyncingProfile = false;
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
