import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderStatsCards } from '../../../src/components/orders/OrderStatsCards';

describe('OrderStatsCards 统计卡片组件', () => {
  it('正确展示 4 项核心指标数值与对应中性/语义色彩', () => {
    const html = renderToStaticMarkup(
      <OrderStatsCards
        statistics={{
          today: 28,
          pending: 5,
          success: 22,
          failed: 1,
        }}
      />
    );

    expect(html).toContain('今日导入');
    expect(html).toContain('>28</span>');
    expect(html).toContain('待确认');
    expect(html).toContain('>5</span>');
    expect(html).toContain('已导入');
    expect(html).toContain('>22</span>');
    expect(html).toContain('失败');
    expect(html).toContain('>1</span>');
  });

  it('支持向下兼容 GuardianStats 属性结构', () => {
    const html = renderToStaticMarkup(
      <OrderStatsCards
        stats={{
          todayImported: 15,
          pendingConfirm: 3,
          imported: 10,
          failed: 2,
        }}
      />
    );

    expect(html).toContain('>15</span>');
    expect(html).toContain('>3</span>');
    expect(html).toContain('>10</span>');
    expect(html).toContain('>2</span>');
  });

  it('在 loading 状态下展示脉冲动画样式', () => {
    const html = renderToStaticMarkup(
      <OrderStatsCards
        statistics={{ today: 0, pending: 0, success: 0, failed: 0 }}
        loading={true}
      />
    );

    expect(html).toContain('animate-pulse');
  });
});
