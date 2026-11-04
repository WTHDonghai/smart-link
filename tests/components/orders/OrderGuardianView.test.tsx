import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '@/src/store';
import { OrderGuardianView } from '@/src/components/orders/OrderGuardianView';
import { fetchChannelMappingData } from '@/src/store/slices/channelSlice';

vi.mock('@/src/services/toolkitOrderApi', () => ({
  fetchToolkitOrders: vi.fn().mockResolvedValue({
    records: [],
    page: 1,
    pageSize: 20,
    total: 0,
  }),
  fetchToolkitStatistics: vi.fn().mockResolvedValue({
    today: 0,
    pending: 0,
    success: 0,
    failed: 0,
  }),
  fetchToolkitOrderDetails: vi.fn(),
  updateToolkitOrder: vi.fn(),
  retryToolkitOrderImport: vi.fn(),
  deleteToolkitOrder: vi.fn(),
  cancelToolkitOrder: vi.fn(),
  fetchPropertyProductOptions: vi.fn().mockResolvedValue({
    roomTypes: [],
    rateCodes: [],
    reservationTypes: [],
  }),
}));

vi.mock('@/src/services/dutyBridge', () => ({
  queryDutyStatus: vi.fn().mockResolvedValue({
    coordinatorStatus: 'STOPPED',
    channels: {},
  }),
  startDutyByChannel: vi.fn(),
  stopDutyByChannel: vi.fn(),
}));

vi.mock('@/src/services/channelApi', () => ({
  fetchCulturalTourismChannels: vi.fn().mockResolvedValue([]),
  fetchChannelMappings: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/src/services/hotelApi', () => ({
  fetchRemoteHotelMappings: vi.fn().mockResolvedValue([]),
  saveHotelMappingsBatch: vi.fn(),
  deleteRemoteHotelMappings: vi.fn(),
  fetchPlatformProperties: vi.fn().mockResolvedValue([]),
}));

describe('OrderGuardianView 订单值守主控制台视图集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('当用户存在已映射渠道时，仅动态渲染已映射的渠道并展示完整筛选栏与订单列表字段', () => {
    const store = createAppStore();
    // 注入接口返回的用户已映射渠道数据（美团与携程）
    store.dispatch(
      fetchChannelMappingData.fulfilled(
        {
          culturalTourismChannels: [],
          mappings: [
            {
              id: 'map-mt',
              mappingId: 'map-mt-1',
              otaChannelCode: 'MEITUAN',
              otaChannelName: '美团酒店',
              channelId: 'pms-1',
              channelCode: 'MT_PMS',
              channelName: '美团直连通道',
              status: 'A',
            },
            {
              id: 'map-ct',
              mappingId: 'map-ct-1',
              otaChannelCode: 'CTRIP',
              otaChannelName: '携程旅行',
              channelId: 'pms-2',
              channelCode: 'CT_PMS',
              channelName: '携程商旅直通',
              status: 'A',
            },
          ],
        },
        'req-test-1',
        undefined
      )
    );

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <OrderGuardianView />
      </Provider>
    );

    // 渠道自动化值守面板
    expect(html).toContain('渠道自动化值守');
    expect(html).toContain('0 / 2 运行中');
    expect(html).toContain('美团酒店');
    expect(html).toContain('携程旅行');
    // 确认未映射的渠道（如抖音、同程）绝不渲染
    expect(html).not.toContain('抖音生活服务');
    expect(html).not.toContain('同程旅行');

    // 统计指标卡片
    expect(html).toContain('今日导入');
    expect(html).toContain('待确认');
    expect(html).toContain('已导入');
    expect(html).toContain('失败');

    // 筛选与搜索栏
    expect(html).toContain('酒店：');
    expect(html).toContain('渠道：');
    expect(html).toContain('状态：');
    expect(html).toContain('类型：');
    expect(html).toContain('OTA订单号：');
    expect(html).toContain('客人姓名：');
    expect(html).toContain('搬单日期：');
    expect(html).toContain('查询');
    expect(html).toContain('重置');

    // 订单高密表格标题与表头
    expect(html).toContain('订单列表 (共 0 条)');
    expect(html).toContain('>OTA订单号</th>');
    expect(html).toContain('>客人</th>');
    expect(html).toContain('>手机号</th>');
    expect(html).toContain('>抵离日期</th>');
    expect(html).toContain('>房型</th>');
    expect(html).toContain('>房价码</th>');
    expect(html).toContain('>预订类型</th>');
    expect(html).toContain('>渠道</th>');
    expect(html).toContain('>酒店</th>');
    expect(html).toContain('>每日房价</th>');
    expect(html).toContain('>备注</th>');
    expect(html).toContain('>搬单时间</th>');
    expect(html).toContain('>状态</th>');
    expect(html).toContain('>类型</th>');
    expect(html).toContain('>操作</th>');

    // 分页信息
    expect(html).toContain('笔订单');
  });

  it('当用户尚未映射任何渠道时，值守面板展示空状态与前往配置引导', () => {
    const store = createAppStore();
    // 初始 mappings 为 []
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <OrderGuardianView />
      </Provider>
    );

    // 渠道自动化值守面板
    expect(html).toContain('渠道自动化值守');
    expect(html).toContain('0 / 0 运行中');
    expect(html).toContain('暂未映射任何 OTA 渠道');
    expect(html).toContain('前往配置渠道映射');
    // 杜绝出现任何硬编码渠道项
    expect(html).not.toContain('美团酒店');
    expect(html).not.toContain('抖音生活服务');
  });
});
