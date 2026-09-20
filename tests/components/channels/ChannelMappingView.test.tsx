import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../../src/store';
import { ChannelMappingView } from '../../../src/components/channels/ChannelMappingView';
import { fetchChannelMappingData, addChannelById } from '../../../src/store/slices/channelSlice';

vi.mock('../../../src/services/channelApi', () => ({
  fetchCulturalTourismChannels: vi.fn().mockResolvedValue([]),
  fetchChannelMappings: vi.fn().mockResolvedValue([]),
  saveChannelMapping: vi.fn().mockResolvedValue({ success: true }),
  deleteChannelMapping: vi.fn().mockResolvedValue({ success: true }),
}));

describe('ChannelMappingView 渠道映射列表视图', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始状态无渠道映射时：表格渲染空状态组件，不显示未映射假数据', () => {
    const store = createAppStore();
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ChannelMappingView />
      </Provider>
    );

    expect(html).toContain('渠道映射');
    expect(html).toContain('暂无配置渠道');
    expect(html).toContain('当前未添加任何 OTA 渠道，请通过右上角「添加渠道」进行添加并配置文旅接收映射');
    expect(html).not.toContain('美团');
    expect(html).not.toContain('抖音');
  });

  it('接口返回已映射数据时：仅渲染已映射的渠道，状态标为「已映射」', () => {
    const store = createAppStore();
    store.dispatch(
      fetchChannelMappingData.fulfilled(
        {
          culturalTourismChannels: [
            {
              channelId: 'pms-mt',
              channelCode: 'MT_PMS',
              channelName: '文旅美团直连',
              status: 'A',
            },
          ],
          mappings: [
            {
              id: 'map-1',
              mappingId: 'map-1',
              otaChannelCode: 'MEITUAN',
              otaChannelName: '美团',
              channelId: 'pms-mt',
              channelCode: 'MT_PMS',
              channelName: '文旅美团直连',
              status: 'A',
            },
          ],
        },
        'req-1',
        undefined
      )
    );

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ChannelMappingView />
      </Provider>
    );

    expect(html).not.toContain('暂无配置渠道');
    expect(html).toContain('美团');
    expect(html).toContain('MEITUAN');
    expect(html).toContain('已映射');
    // 未映射的渠道不应存在
    expect(html).not.toContain('抖音');
    expect(html).not.toContain('美团商旅');
  });

  it('用户点击添加渠道后：表格中动态新增未映射渠道行', () => {
    const store = createAppStore();
    store.dispatch(addChannelById('fliggy'));

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ChannelMappingView />
      </Provider>
    );

    expect(html).not.toContain('暂无配置渠道');
    expect(html).toContain('飞猪旅行');
    expect(html).toContain('FLIGGY');
    expect(html).toContain('未映射');
  });
});
