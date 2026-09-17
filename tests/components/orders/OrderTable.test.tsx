import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderTable } from '../../../src/components/orders/OrderTable';
import type { ToolkitOrder } from '../../../src/types';

describe('OrderTable 高密订单表格组件', () => {
  const mockOrders: ToolkitOrder[] = [
    {
      id: 'ord-failed',
      unitId: 'hotel-001',
      unitName: '隐居江南度假酒店',
      otaChannel: 'MEITUAN',
      otaOrderId: 'MT-987654321',
      contact: { name: '张三', mobile: '13800001111' },
      booking: {
        arrival: '2026-10-01',
        departure: '2026-10-03',
        roomType: '豪华大床房',
        rateCode: 'OTA',
        paytype: '在线预付',
        nights: 2,
        quantity: 1,
        totalPrice: 400,
        pricing: [
          { date: '2026-10-01', price: 200 },
          { date: '2026-10-02', price: 200 },
        ],
      },
      status: 'FAILED',
      errorMessage: '文旅房型未绑定映射',
      allowedActions: ['EDIT', 'IMPORT', 'DELETE'],
    },
    {
      id: 'ord-success',
      unitId: 'hotel-001',
      unitName: '隐居江南度假酒店',
      otaChannel: 'CTRIP',
      otaOrderId: 'CT-123456789',
      contact: { name: '李四', mobile: '13900002222' },
      booking: {
        arrival: '2026-10-02',
        departure: '2026-10-04',
        roomType: '行政套房',
        rateCode: 'BAR',
        paytype: '现付担保',
        nights: 2,
        quantity: 1,
        totalPrice: 880,
        pricing: [],
      },
      status: 'SUCCESS',
      pmsOrderId: 'PMS-888899',
      allowedActions: ['CANCEL'],
    },
    {
      id: 'ord-pending',
      unitId: 'hotel-002',
      unitName: '山水云居精品客栈',
      otaChannel: 'DOUYIN',
      otaOrderId: 'DY-555666777',
      contact: { name: '王五', mobile: '13700003333' },
      booking: {
        arrival: '2026-10-05',
        departure: '2026-10-06',
        roomType: '景观露台房',
        rateCode: 'PROMO',
        paytype: '团购核销',
        nights: 1,
        quantity: 1,
        totalPrice: 260,
        pricing: [],
      },
      status: 'PENDING',
      allowedActions: [],
    },
  ];

  const defaultProps = {
    orders: mockOrders,
    onEdit: vi.fn(),
    onImport: vi.fn(),
    onDelete: vi.fn(),
    onCancel: vi.fn(),
  };

  it('空订单列表时展示 EmptyState 组件', () => {
    const html = renderToStaticMarkup(
      <OrderTable {...defaultProps} orders={[]} />
    );

    expect(html).toContain('暂无符合条件的订单记录');
    expect(html).toContain('可以尝试调整筛选状态、日期区间或搜索关键字');
  });

  it('展示各订单的酒店、OTA单号、抵离日期、金额与渠道徽标', () => {
    const html = renderToStaticMarkup(<OrderTable {...defaultProps} />);

    expect(html).toContain('隐居江南度假酒店');
    expect(html).toContain('MT-987654321');
    expect(html).toContain('2026-10-01');
    expect(html).toContain('至 2026-10-03 (2晚)');
    expect(html).toContain('¥400.00');
    expect(html).toContain('豪华大床房');
    expect(html).toContain('张三 · 13800001111');
  });

  it('遵循操作状态矩阵：FAILED 订单提供编辑、导入与删除按钮', () => {
    const html = renderToStaticMarkup(<OrderTable {...defaultProps} />);

    expect(html).toContain('>编辑</span>');
    expect(html).toContain('>导入</span>');
    expect(html).toContain('title="删除失败订单"');
    expect(html).toContain('文旅房型未绑定映射');
  });

  it('遵循操作状态矩阵：SUCCESS 订单提供取消订单按钮并展示 PMS 单号', () => {
    const html = renderToStaticMarkup(<OrderTable {...defaultProps} />);

    expect(html).toContain('>取消订单</span>');
    expect(html).toContain('PMS: PMS-888899');
  });

  it('遵循操作状态矩阵：PENDING 等只读状态展示只读提示', () => {
    const html = renderToStaticMarkup(<OrderTable {...defaultProps} />);

    expect(html).toContain('只读状态');
  });

  it('当 actionLoadingId 命中订单时展示加载中动画', () => {
    const html = renderToStaticMarkup(
      <OrderTable {...defaultProps} actionLoadingId="ord-failed" />
    );

    expect(html).toContain('处理中...');
    expect(html).toContain('animate-spin');
  });
});
