import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditOrderDrawer } from '../../../src/components/orders/EditOrderDrawer';
import type { ToolkitOrder, InternalProductOptions } from '../../../src/types';

describe('EditOrderDrawer 编辑订单抽屉组件', () => {
  const mockOrder: ToolkitOrder = {
    id: 'ord-101',
    unitId: 'hotel-001',
    unitName: '隐居江南度假酒店',
    otaChannel: 'MEITUAN',
    otaOrderId: 'MT-888999',
    contact: { name: '王五', mobile: '13812345678' },
    booking: {
      arrival: '2026-10-01',
      departure: '2026-10-03',
      roomType: '大床房',
      roomTypeId: 'RT-KING',
      rateCode: 'OTA',
      paytype: '预付全额',
      nights: 2,
      quantity: 1,
      totalPrice: 600,
      pricing: [
        { date: '2026-10-01', price: 300 },
        { date: '2026-10-02', price: 300 },
      ],
    },
    status: 'FAILED',
    allowedActions: ['EDIT', 'IMPORT', 'DELETE'],
  };

  const mockOptions: InternalProductOptions = {
    roomTypes: [
      { code: 'RT-KING', name: '豪华大床房', displayLabel: '豪华大床房（RT-KING）' },
      { code: 'RT-TWIN', name: '豪华双床房', displayLabel: '豪华双床房（RT-TWIN）' },
    ],
    rateCodes: [
      { rateCode: 'OTA', rateName: '在线分销净价', displayLabel: '在线分销净价（OTA）' },
      { rateCode: 'RACK', rateName: '门市挂牌价', displayLabel: '门市挂牌价（RACK）' },
    ],
    reservationTypes: [
      { code: 'PREPAID', label: '预付在线全额扣款', displayLabel: '预付在线全额扣款（PREPAID）' },
    ],
  };

  const defaultProps = {
    order: mockOrder,
    productOptions: mockOptions,
    isOpen: true,
    isLoading: false,
    isSaving: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
  };

  it('当 isOpen 为 false 时不输出任何 DOM 内容', () => {
    const html = renderToStaticMarkup(
      <EditOrderDrawer {...defaultProps} isOpen={false} />
    );

    expect(html).toBe('');
  });

  it('当 isOpen 为 true 时展示订单单号、客人信息、房型房价与动态价格明细', () => {
    const html = renderToStaticMarkup(<EditOrderDrawer {...defaultProps} />);

    expect(html).toContain('编辑文旅订单');
    expect(html).toContain('OTA单号: MT-888999');
    expect(html).toContain('value="王五"');
    expect(html).toContain('value="13812345678"');
    expect(html).toContain('每日价格明细 (2 晚)');
    expect(html).toContain('2026-10-01');
    expect(html).toContain('2026-10-02');
    expect(html).toContain('¥600.00');
    expect(html).toContain('保存并导入');
  });

  it('在 loading 状态下展示沉浸式加载动画而隐藏表单', () => {
    const html = renderToStaticMarkup(
      <EditOrderDrawer {...defaultProps} isLoading={true} />
    );

    expect(html).toContain('正在加载订单详情与产品目录...');
    expect(html).not.toContain('id="edit-order-form"');
  });

  it('在展示 error 提示时渲染错误警告横幅', () => {
    const html = renderToStaticMarkup(
      <EditOrderDrawer {...defaultProps} error="保存修改失败: 接口响应超时" />
    );

    expect(html).toContain('保存修改失败: 接口响应超时');
  });

  it('在 isReadOnly 只读模式下展示详情标题、禁用输入框并隐藏保存按钮', () => {
    const html = renderToStaticMarkup(
      <EditOrderDrawer
        {...defaultProps}
        isReadOnly={true}
        onSwitchToEdit={vi.fn()}
      />
    );

    // 标题变更为“文旅订单详情”
    expect(html).toContain('文旅订单详情');
    expect(html).not.toContain('编辑文旅订单');

    // 含有只读/禁用标识
    expect(html).toContain('disabled=""');

    // 底部只读 footer 展现“关闭”与“转为编辑”按钮，不出现“保存并导入”
    expect(html).toContain('关闭');
    expect(html).toContain('转为编辑');
    expect(html).not.toContain('保存并导入');
  });

  it('在 isReadOnly 只读模式下若订单失败展示失败错误提示', () => {
    const failedOrder: ToolkitOrder = {
      ...mockOrder,
      errorMessage: '房型映射缺失或已被下架',
    };

    const html = renderToStaticMarkup(
      <EditOrderDrawer
        {...defaultProps}
        order={failedOrder}
        isReadOnly={true}
      />
    );

    expect(html).toContain('房型映射缺失或已被下架');
  });
});
