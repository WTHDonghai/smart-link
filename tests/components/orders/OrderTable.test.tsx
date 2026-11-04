import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderTable } from '@/src/components/orders/OrderTable';
import type { ToolkitOrder } from '@/src/types';

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
      orderType: 'NEW',
      createdTime: '2026-09-30 14:20:00',
      remark: '需要无烟楼层',
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
      orderType: 'MODIFY',
      createdTime: '2026-09-30 15:10:00',
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
      orderType: 'CANCEL',
      allowedActions: [],
    },
  ];

  const defaultProps = {
    orders: mockOrders,
    total: 4,
    onViewDetail: vi.fn(),
    onEdit: vi.fn(),
    onImport: vi.fn(),
    onDelete: vi.fn(),
    onCancel: vi.fn(),
  };

  it('空订单列表时展示 EmptyState 组件及总条数 0', () => {
    const html = renderToStaticMarkup(
      <OrderTable {...defaultProps} orders={[]} total={0} />
    );

    expect(html).toContain('订单列表 (共 0 条)');
    expect(html).toContain('暂无符合条件的订单记录');
    expect(html).toContain('可以尝试调整筛选状态、日期区间或搜索关键字');
  });

  it('完整渲染 15 个标准列表表头字段与各列数据', () => {
    const html = renderToStaticMarkup(<OrderTable {...defaultProps} />);

    // 顶部总条数标题
    expect(html).toContain('订单列表 (共 4 条)');

    // 15 个表头字段
    const headers = [
      'OTA订单号',
      '客人',
      '手机号',
      '抵离日期',
      '房型',
      '房价码',
      '预订类型',
      '渠道',
      '酒店',
      '每日房价',
      '备注',
      '搬单时间',
      '状态',
      '类型',
      '操作',
    ];
    for (const header of headers) {
      expect(html).toContain(`>${header}</th>`);
    }

    // 具体行数据断言
    expect(html).toContain('MT-987654321');
    expect(html).toContain('title="点击查看订单详情"');
    expect(html).toContain('title="复制订单号"');
    expect(html).toContain('张三');
    expect(html).toContain('13800001111');
    expect(html).toContain('2026-10-01');
    expect(html).toContain('至 2026-10-03 (2晚)');
    expect(html).toContain('豪华大床房');
    expect(html).toContain('OTA');
    expect(html).toContain('在线预付');
    expect(html).toContain('隐居江南度假酒店');
    expect(html).toContain('10-01:');
    expect(html).toContain('+1晚');
    expect(html).toContain('每日房价明细 (2晚)');
    expect(html).toContain('¥200.00');
    expect(html).toContain('¥400.00');
    expect(html).toContain('需要无烟楼层');
    expect(html).toContain('2026-09-30 14:20');
    expect(html).toContain('新订');
    expect(html).toContain('修改');
    expect(html).toContain('取消');
  });

  it('操作列统一收起：默认折叠展示更多操作按钮与只读状态', () => {
    const html = renderToStaticMarkup(<OrderTable {...defaultProps} />);

    expect(html).toContain('title="更多操作"');
    expect(html).toContain('title="只读状态"');
  });

  it('遵循操作状态矩阵：FAILED 订单展开菜单提供编辑、导入与删除项', () => {
    const html = renderToStaticMarkup(
      <OrderTable {...defaultProps} initialOpenMenuId="ord-failed" />
    );

    expect(html).toContain('>编辑订单</span>');
    expect(html).toContain('>重新导入</span>');
    expect(html).toContain('>删除订单</span>');
    expect(html).not.toContain('>取消订单</span>');
    expect(html).toContain('文旅房型未绑定映射');
  });

  it('遵循操作状态矩阵：SUCCESS 订单展开菜单提供取消订单项并展示 PMS 单号', () => {
    const html = renderToStaticMarkup(
      <OrderTable {...defaultProps} initialOpenMenuId="ord-success" />
    );

    expect(html).toContain('>取消订单</span>');
    expect(html).not.toContain('>编辑订单</span>');
    expect(html).not.toContain('>重新导入</span>');
    expect(html).not.toContain('>删除订单</span>');
    expect(html).toContain('PMS: PMS-888899');
  });

  it('遵循操作状态矩阵：PENDING 等只读状态展示禁用只读提示', () => {
    const html = renderToStaticMarkup(<OrderTable {...defaultProps} />);

    expect(html).toContain('title="只读状态"');
    expect(html).toContain('aria-label="无可用操作"');
  });

  it('当 actionLoadingId 命中订单时展示加载中动画', () => {
    const html = renderToStaticMarkup(
      <OrderTable {...defaultProps} actionLoadingId="ord-failed" />
    );

    expect(html).toContain('处理中...');
    expect(html).toContain('animate-spin');
  });

  it('操作按钮弹出二次确认：取消操作原位弹出气泡确认卡片与确定/取消按钮', () => {
    const html = renderToStaticMarkup(
      <OrderTable
        {...defaultProps}
        initialOpenMenuId="ord-success"
        initialConfirmAction={{ orderId: 'ord-success', action: 'CANCEL' }}
      />
    );

    expect(html).toContain('确认取消订单？');
    expect(html).toContain('确定在中台发起取消订单「CT-123456789」？');
    expect(html).toContain('确认取消');
    expect(html).toContain('取消');
    expect(html).not.toContain('确定删除订单');
  });

  it('操作按钮弹出二次确认：删除操作原位弹出不可逆警告与确定/取消按钮', () => {
    const html = renderToStaticMarkup(
      <OrderTable
        {...defaultProps}
        initialOpenMenuId="ord-failed"
        initialConfirmAction={{ orderId: 'ord-failed', action: 'DELETE' }}
      />
    );

    expect(html).toContain('确认删除订单？');
    expect(html).toContain('确定删除订单「MT-987654321」吗？此操作不可逆。');
    expect(html).toContain('确认删除');
    expect(html).toContain('取消');
    expect(html).not.toContain('确定在中台发起取消订单');
  });

  it('当订单 otaChannel 为 PMS 渠道代码 6131180 时，表格中正确渲染抖音徽标 [抖] 而非 [61]', () => {
    const douyinOrder: ToolkitOrder = {
      ...mockOrders[0],
      id: 'ord-dy-pms',
      otaChannel: '6131180',
      otaOrderId: 'DY-888999111',
    };

    const html = renderToStaticMarkup(
      <OrderTable {...defaultProps} orders={[douyinOrder]} />
    );

    expect(html).toContain('>抖</div>');
    expect(html).toContain('title="抖音"');
    expect(html).not.toContain('>61</div>');
  });

  it('当订单仅返回 unitId 未携带 unitName 时，自动通过 pmsProperties 或酒店映射反查显示酒店名称', () => {
    const idOnlyOrder: ToolkitOrder = {
      ...mockOrders[0],
      id: 'ord-id-only',
      unitId: '900881',
      unitName: '',
    };

    const html = renderToStaticMarkup(
      <OrderTable
        {...defaultProps}
        orders={[idOnlyOrder]}
        pmsProperties={[{ id: '900881', name: '莫干山竹海温泉度假酒店' }]}
      />
    );

    expect(html).toContain('莫干山竹海温泉度假酒店');
  });
});
