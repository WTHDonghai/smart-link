import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderFilterBar } from '../../../src/components/orders/OrderFilterBar';

describe('OrderFilterBar 筛选与搜索组件', () => {
  const defaultProps = {
    status: 'all',
    onStatusChange: vi.fn(),
    query: '',
    onQueryChange: vi.fn(),
    arrivalStart: '',
    arrivalEnd: '',
    onArrivalStartChange: vi.fn(),
    onArrivalEndChange: vi.fn(),
    onSearch: vi.fn(),
    onReset: vi.fn(),
  };

  it('正确渲染全部 6 个状态 Tabs (全部、待确认、已导入、失败、已取消、导入中)', () => {
    const html = renderToStaticMarkup(<OrderFilterBar {...defaultProps} />);

    expect(html).toContain('全部');
    expect(html).toContain('待确认');
    expect(html).toContain('已导入');
    expect(html).toContain('失败');
    expect(html).toContain('已取消');
    expect(html).toContain('导入中');
  });

  it('针对当前选中状态高亮渲染白底与主色文字', () => {
    const html = renderToStaticMarkup(
      <OrderFilterBar {...defaultProps} status="FAILED" />
    );

    // 失败选项应具有激活态 class (bg-white text-[#004ac6])
    expect(html).toContain('bg-white text-[#004ac6] shadow-2xs font-semibold');
  });

  it('正确回显搜索关键字与入住起止日期', () => {
    const html = renderToStaticMarkup(
      <OrderFilterBar
        {...defaultProps}
        query="张三"
        arrivalStart="2026-10-01"
        arrivalEnd="2026-10-05"
      />
    );

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
