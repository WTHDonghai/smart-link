import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createAppStore } from '../../../src/store';
import { OrderGuardianView } from '../../../src/components/orders/OrderGuardianView';

vi.mock('../../../src/services/toolkitOrderApi', () => ({
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
  importToolkitOrder: vi.fn(),
  deleteToolkitOrder: vi.fn(),
  cancelToolkitOrder: vi.fn(),
  fetchPropertyProductOptions: vi.fn().mockResolvedValue({
    roomTypes: [],
    rateCodes: [],
    reservationTypes: [],
  }),
}));

vi.mock('../../../src/services/dutyBridge', () => ({
  queryDutyStatus: vi.fn().mockResolvedValue({
    coordinatorStatus: 'STOPPED',
    channels: {},
  }),
  startDutyByChannel: vi.fn(),
  stopDutyByChannel: vi.fn(),
}));

describe('OrderGuardianView 订单值守主控制台视图集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('完整挂载并渲染渠道自动化值守、统计卡片、筛选栏、订单表格与底部分页', () => {
    const store = createAppStore();
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <OrderGuardianView />
      </Provider>
    );

    // 渠道自动化值守面板
    expect(html).toContain('渠道自动化值守');
    expect(html).toContain('美团酒店');
    expect(html).toContain('美团商旅');
    expect(html).toContain('抖音生活服务');
    expect(html).toContain('携程旅行');

    // 统计指标卡片
    expect(html).toContain('今日导入');
    expect(html).toContain('待确认');
    expect(html).toContain('已导入');
    expect(html).toContain('失败');

    // 筛选与搜索栏
    expect(html).toContain('搜索 OTA 订单号、中台单号、客人姓名、手机号...');
    expect(html).toContain('查询');
    expect(html).toContain('重置');

    // 订单高密表格表头
    expect(html).toContain('酒店 / 单位');
    expect(html).toContain('OTA 订单');
    expect(html).toContain('抵离日期');
    expect(html).toContain('房型 / 房价码');
    expect(html).toContain('操作');

    // 分页信息
    expect(html).toContain('笔订单');
  });
});
