import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { OTAChannel } from '../../types';

export const AVAILABLE_CHANNELS_CATALOG: Omit<OTAChannel, 'targetSystem' | 'todayOrders' | 'lastSyncTime'>[] = [
  {
    id: 'ctrip',
    name: '携程旅行',
    code: 'CTRIP',
    short: '携',
    bgColor: 'bg-[#2577e3]',
    textColor: 'text-white',
    targetSystemOptions: [
      { val: 'ctrip_direct', label: '携程直连商户 (CTRIP_DIR)' },
      { val: 'ctrip_corp', label: '携程商旅直通 (CTRIP_CORP)' },
      { val: 'ctrip_agent', label: '携程代理分销 (CTRIP_AGENT)' }
    ],
    remarkTemplate: '【携程直销】订单号:{OTA订单号}，房型:{房型名称}，入住人:{入住人}，底价:{底价}，请及时排房。',
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
    targetSystemOptions: [
      { val: 'tongcheng_main', label: '同程艺龙直连 (TONGCHENG_MAIN)' },
      { val: 'tongcheng_b2b', label: '同程企业集采 (TC_B2B)' }
    ],
    remarkTemplate: '【同程订单】外部单号:{OTA订单号}，客人:{入住人}，间夜:{间夜数}，无早。',
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
    targetSystemOptions: [
      { val: 'fliggy_open', label: '飞猪开放平台直连 (FLIGGY_OPEN)' },
      { val: 'fliggy_alitrip', label: '阿里商旅分销 (ALITRIP_CORP)' }
    ],
    remarkTemplate: '【飞猪信用住】单号:{OTA订单号}，免押免查房，离店后自动结算。',
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
    targetSystemOptions: [
      { val: 'qunar_hotel', label: '去哪儿酒店直连 (QUNAR_HOTEL)' },
      { val: 'qunar_b2b', label: '去哪儿同业分销 (QUNAR_B2B)' }
    ],
    remarkTemplate: '【去哪儿】单号:{OTA订单号}，预留至20:00，房型:{房型名称}。',
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
    targetSystemOptions: [
      { val: 'red_store', label: '小红书自营店铺 (RED_STORE)' },
      { val: 'red_trips', label: '小红书文旅预订 (RED_TRIPS)' }
    ],
    remarkTemplate: '【小红书种草单】单号:{OTA订单号}，网红探店客户，送欢迎水果礼遇。',
    status: 'active',
    crawlerStatus: 'online'
  }
];

interface ChannelState {
  channels: OTAChannel[];
  selectedChannelForTemplate: string | null;
  searchQuery: string;
}

const initialState: ChannelState = {
  selectedChannelForTemplate: null,
  searchQuery: '',
  channels: [
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
      remarkTemplate: '【美团搬单】OTA单号:{OTA订单号} | 预订人:{入住人} ({联系电话}) | 房型:{房型名称} | 结算价:¥{底价} | 入住:{入住离店日期}',
      status: 'active',
      crawlerStatus: 'online',
      todayOrders: 428,
      lastSyncTime: '3秒前'
    },
    {
      id: 'meituanbiz',
      name: '美团商旅',
      code: 'MEITUANBIZ',
      short: '商',
      bgColor: 'bg-[#eef2ff]',
      textColor: 'text-[#004ac6]',
      targetSystem: 'meituanbiz',
      targetSystemOptions: [
        { val: 'meituanbiz', label: '美团商旅 (MEITUANBIZ)' },
        { val: 'meituanbiz_vip', label: '美团企业采购 VIP (MEITUAN_CORP)' }
      ],
      remarkTemplate: '【企业商旅协议】OTA单号:{OTA订单号} | 企业统一结算 | {入住人} | 请提供增值税专用发票',
      status: 'active',
      crawlerStatus: 'online',
      todayOrders: 215,
      lastSyncTime: '5秒前'
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
      remarkTemplate: '【抖音团购核销】团购券/订单号:{OTA订单号} | 房型:{房型名称} | 顾客:{入住人} | 到店请优先安排高楼层',
      status: 'active',
      crawlerStatus: 'online',
      todayOrders: 362,
      lastSyncTime: '1秒前'
    }
  ]
};

export const channelSlice = createSlice({
  name: 'channel',
  initialState,
  reducers: {
    addChannelById: (state, action: PayloadAction<string>) => {
      const catalogItem = AVAILABLE_CHANNELS_CATALOG.find(c => c.id === action.payload);
      if (!catalogItem) return;
      if (state.channels.some(c => c.id === catalogItem.id)) return;

      const newChannel: OTAChannel = {
        ...catalogItem,
        targetSystem: catalogItem.targetSystemOptions[0]?.val || `${catalogItem.id}_main`,
        todayOrders: 0,
        lastSyncTime: '刚刚初始化'
      };
      state.channels.push(newChannel);
    },
    removeChannel: (state, action: PayloadAction<string>) => {
      state.channels = state.channels.filter(c => c.id !== action.payload);
    },
    updateChannelTargetSystem: (state, action: PayloadAction<{ channelId: string; targetSystem: string }>) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        ch.targetSystem = action.payload.targetSystem;
      }
    },
    updateRemarkTemplate: (state, action: PayloadAction<{ channelId: string; template: string }>) => {
      const ch = state.channels.find(c => c.id === action.payload.channelId);
      if (ch) {
        ch.remarkTemplate = action.payload.template;
      }
    },
    setSelectedChannelForTemplate: (state, action: PayloadAction<string | null>) => {
      state.selectedChannelForTemplate = action.payload;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    toggleChannelStatus: (state, action: PayloadAction<string>) => {
      const ch = state.channels.find(c => c.id === action.payload);
      if (ch) {
        ch.status = ch.status === 'active' ? 'paused' : 'active';
      }
    }
  }
});

export const {
  addChannelById,
  removeChannel,
  updateChannelTargetSystem,
  updateRemarkTemplate,
  setSelectedChannelForTemplate,
  setSearchQuery,
  toggleChannelStatus
} = channelSlice.actions;

export default channelSlice.reducer;
