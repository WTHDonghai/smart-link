import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../../src/store';
import { ChannelDutyPanel } from '../../../src/components/orders/ChannelDutyPanel';
import { fetchChannelMappingData } from '../../../src/store/slices/channelSlice';

vi.mock('../../../src/services/dutyBridge', () => ({
  queryDutyStatus: vi.fn().mockResolvedValue({
    coordinatorStatus: 'STOPPED',
    channels: {},
  }),
  startDutyByChannel: vi.fn(),
  stopDutyByChannel: vi.fn(),
}));

vi.mock('../../../src/services/channelApi', () => ({
  fetchCulturalTourismChannels: vi.fn().mockResolvedValue([]),
  fetchChannelMappings: vi.fn().mockResolvedValue([]),
}));

describe('ChannelDutyPanel 渠道自动化值守面板', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展示空状态提示与前往配置渠道映射行动入口', () => {
    const store = createAppStore();
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ChannelDutyPanel />
      </Provider>
    );

    expect(html).toContain('渠道自动化值守');
    expect(html).toContain('0 / 0 运行中');
    expect(html).toContain('暂未映射任何 OTA 渠道');
    expect(html).toContain('前往配置渠道映射');
  });

  it('当存在已映射渠道时，正确渲染渠道列表及其状态与操作按钮', () => {
    const store = createAppStore();
    store.dispatch(
      fetchChannelMappingData.fulfilled(
        {
          culturalTourismChannels: [],
          mappings: [
            {
              id: 'map-dy',
              mappingId: 'map-dy-1',
              otaChannelCode: 'DOUYIN',
              otaChannelName: '抖音生活服务',
              channelId: 'pms-dy',
              channelCode: 'DY_PMS',
              channelName: '抖音直连',
              status: 'A',
            },
          ],
        },
        'req-test',
        undefined
      )
    );

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ChannelDutyPanel />
      </Provider>
    );

    expect(html).toContain('0 / 1 运行中');
    expect(html).toContain('抖音生活服务');
    expect(html).toContain('抖音新订/退款订单业务协同值守');
    expect(html).toContain('开始值守');
    expect(html).not.toContain('美团酒店');
  });
});
