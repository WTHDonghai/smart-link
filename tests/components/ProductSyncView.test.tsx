import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../src/store';
import { ProductSyncView } from '../../src/components/products/ProductSyncView';
import {
  setProductFilterChannel,
  setProductFilterHotel,
} from '../../src/store/slices/productSlice';
import { saveChannelMapping } from '../../src/store/slices/channelSlice';
import { addDiscoveredHotel } from '../../src/store/slices/hotelSlice';

describe('ProductSyncView 组件测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('未选择已映射渠道与酒店时：采集按钮处于禁用状态，提示请先选择已完成映射的渠道', () => {
    const store = createAppStore();

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProductSyncView />
      </Provider>
    );

    // 禁用属性
    expect(html).toContain('disabled=""');
    expect(html).toContain('请先选择已经完成渠道映射的 OTA 渠道');
    expect(html).toContain('采集 OTA 产品');
    expect(html).toContain('请先选择渠道与已绑定酒店');
  });

  it('当同时选择已完成渠道映射与门店绑定的酒店后：采集按钮解除禁用，展示门店已就绪', () => {
    const store = createAppStore();

    // 模拟添加已映射渠道
    store.dispatch(
      saveChannelMapping.fulfilled(
        {
          channelId: 'meituan',
          savedPayload: {
            otaChannelCode: 'MEITUAN',
            otaChannelName: '美团',
            channelCode: 'MT01',
            channelId: '101',
          },
          message: '映射成功',
          mappingId: 'map-101',
        },
        'test-action',
        {
          channelId: 'meituan',
          otaChannelCode: 'MEITUAN',
          channelCode: 'MT01',
          pmsChannelId: '101',
          pmsChannelName: '文旅美团',
        }
      )
    );

    // 模拟添加已绑定门店
    store.dispatch(
      addDiscoveredHotel({
        id: 'h-1',
        otaChannelId: 'meituan',
        otaChannelCode: 'MEITUAN',
        otaHotelId: 'POI-100',
        extUnitCode: 'POI-100',
        otaHotelName: '自贡方特恐龙王国店',
        pmsHotelId: '8888',
        pmsHotelName: '恐龙主题酒店',
        unitId: '8888',
        status: 'mapped',
      })
    );

    // 选中渠道与酒店
    store.dispatch(setProductFilterChannel('MEITUAN'));
    store.dispatch(
      setProductFilterHotel({
        extUnitCode: 'POI-100',
        hotelName: '自贡方特恐龙王国店',
        unitId: '8888',
        unitType: 'Property',
      })
    );

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProductSyncView />
      </Provider>
    );

    // 此时采集按钮不应带有 disabled
    expect(html).toContain('当前门店已就绪');
    expect(html).toContain('自贡方特恐龙王国店');
    expect(html).toContain('批量保存 (允许留空)');
  });

  it('展示产品列表时支持未填写房型/房价状态，并包含批量保存按钮', () => {
    const store = createAppStore();

    store.dispatch(setProductFilterChannel('MEITUAN'));
    store.dispatch(
      setProductFilterHotel({
        extUnitCode: 'POI-100',
        hotelName: '自贡方特恐龙王国店',
        unitId: '8888',
        unitType: 'Property',
      })
    );

    // 派发商品数据（包含留空的内部映射）
    store.dispatch({
      type: 'product/loadProductMappingsAndOptions/fulfilled',
      payload: {
        products: [
          {
            id: 'pm-1',
            channelCode: 'MT01',
            extUnitCode: 'POI-100',
            unitId: '8888',
            unitType: 'Property',
            otaRoomTypeId: 'ROOM-1',
            otaRoomTypeName: '阳光家庭房-未关联内部房型',
            otaBasicRoomName: '物理家庭房',
            otaBasicRoomId: 'BASIC-1',
            roomType: '', // 留空
            rateCode: '', // 留空
            payType: '',  // 留空
            status: 'pending',
            source: 'ota-collection',
            otaProductPresent: true,
          },
        ],
        roomTypes: [{ code: 'FAM', name: '家庭房', displayLabel: '家庭房（FAM）' }],
        rateCodes: [{ rateCode: 'RACK', rateName: '门市价', displayLabel: '门市价（RACK）' }],
        reservationTypes: [{ code: 'R01', label: '散客预订', displayLabel: '散客预订（R01）' }],
      },
    });

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProductSyncView />
      </Provider>
    );

    expect(html).toContain('阳光家庭房-未关联内部房型');
    expect(html).toContain('ROOM-1');
    expect(html).toContain('物理家庭房');
    expect(html).toContain('待配置');
    expect(html).toContain('新采集');
  });

  it('当门店正在拉取中时：对应酒店展示正在获取提示，且页面提供全局刷新数据操作入口', () => {
    const store = createAppStore();
    store.dispatch({
      type: 'hotel/fetchHotelMappings/pending',
    });

    const html = renderToStaticMarkup(
      <Provider store={store}>
        <ProductSyncView />
      </Provider>
    );

    expect(html).toContain('正在获取门店列表...');
    expect(html).toContain('刷新数据');
  });
});
