import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  OrderFilterBar,
  ORDER_STATUS_OPTIONS,
  ORDER_TYPE_OPTIONS,
  type OrderFilterValues,
} from '@/src/components/orders/OrderFilterBar';

describe('OrderFilterBar 筛选与搜索组件', () => {
  const emptyFilters: OrderFilterValues = {
    unitId: '',
    otaChannel: '',
    status: '',
    orderType: '',
    otaOrderId: '',
    contactName: '',
    createdStart: '',
    createdEnd: '',
  };

  const defaultProps = {
    filters: emptyFilters,
    onFilterChange: vi.fn(),
    hotelOptions: [{ label: '西湖度假酒店', value: 'unit-01' }],
    channelOptions: [{ label: '美团', value: 'MEITUAN' }],
    onSearch: vi.fn(),
    onReset: vi.fn(),
  };

  it('导出标准状态与订单类型筛选字典选项', () => {
    expect(ORDER_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      'PENDING',
      'SUCCESS',
      'FAILED',
      'CANCEL',
      'IMPORTING',
    ]);
    expect(ORDER_TYPE_OPTIONS).toEqual([
      { label: '新订', value: 'NEW' },
      { label: '修改', value: 'MODIFY' },
      { label: '取消', value: 'CANCEL' },
    ]);
  });

  it('未选中时正确渲染全部 7 项查询条件标签与默认占位符', () => {
    const html = renderToStaticMarkup(<OrderFilterBar {...defaultProps} />);

    expect(html).toContain('酒店：');
    expect(html).toContain('选择酒店');
    expect(html).toContain('渠道：');
    expect(html).toContain('选择渠道');
    expect(html).toContain('状态：');
    expect(html).toContain('选择状态');
    expect(html).toContain('类型：');
    expect(html).toContain('选择类型');
    expect(html).toContain('OTA订单号：');
    expect(html).toContain('placeholder="输入订单号"');
    expect(html).toContain('客人姓名：');
    expect(html).toContain('placeholder="输入姓名"');
    expect(html).toContain('搬单日期：');
    expect(html).toContain('查询');
    expect(html).toContain('重置');
  });

  it('正确回显选中的酒店、渠道、状态、类型、OTA订单号、客人姓名及搬单起止日期', () => {
    const html = renderToStaticMarkup(
      <OrderFilterBar
        {...defaultProps}
        filters={{
          unitId: 'unit-01',
          otaChannel: 'MEITUAN',
          status: 'FAILED',
          orderType: 'NEW',
          otaOrderId: 'MT-20261001',
          contactName: '张三',
          createdStart: '2026-10-01',
          createdEnd: '2026-10-05',
        }}
      />
    );

    expect(html).toContain('西湖度假酒店');
    expect(html).toContain('美团');
    expect(html).toContain('失败');
    expect(html).toContain('新订');
    expect(html).toContain('value="MT-20261001"');
    expect(html).toContain('value="张三"');
    expect(html).toContain('value="2026-10-01"');
    expect(html).toContain('value="2026-10-05"');
  });

  it('当 loading 为 true 时禁用查询和重置按钮并展示文字', () => {
    const html = renderToStaticMarkup(
      <OrderFilterBar {...defaultProps} loading={true} />
    );

    expect(html).toContain('查询中...');
    expect(html).toContain('disabled=""');
  });
});
