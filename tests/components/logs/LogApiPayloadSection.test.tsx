import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LogApiPayloadSection } from '@/src/components/logs/LogApiPayloadSection';
import type { SystemLogEntry } from '@/src/types';

describe('LogApiPayloadSection (API 传参与返回详情区组件)', () => {
  const baseLog: SystemLogEntry = {
    id: 'log-api-test',
    timestamp: '2026-09-29 10:00:00.000',
    createdAt: 1727575200000,
    level: 'INFO',
    message: '调用美团接口',
  };

  it('当日志不含任何 API 相关字段时，返回 null 并不渲染任何节点', () => {
    const html = renderToStaticMarkup(
      <LogApiPayloadSection
        log={baseLog}
        expanded={false}
        copiedKey={null}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('折叠模式下仅渲染轻量方法标签与展开按钮，不渲染大体积 JSON 预格式化 DOM (<pre>)', () => {
    const apiLog: SystemLogEntry = {
      ...baseLog,
      apiUrl: '/api/v1/orders/query',
      apiMethod: 'POST',
      httpStatus: 200,
      durationMs: 45,
      apiParams: { page: 1, limit: 100, filter: { channel: 'meituan' } },
      apiResponse: { code: 0, data: [{ orderId: '123456789' }] },
    };

    const html = renderToStaticMarkup(
      <LogApiPayloadSection
        log={apiLog}
        expanded={false}
        copiedKey={null}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
      />
    );

    // 渲染方法、URL、状态码与展开按钮
    expect(html).toContain('POST');
    expect(html).toContain('/api/v1/orders/query');
    expect(html).toContain('HTTP 200');
    expect(html).toContain('45ms');
    expect(html).toContain('展开传参与返回');

    // 核心断言：未展开时不渲染 <pre> 元素和 JSON 格式化字符串，杜绝 Fiber 树内存膨胀
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('123456789');
  });

  it('展开模式下正确渲染已格式化的入参与返回数据块及复制按钮', () => {
    const apiLog: SystemLogEntry = {
      ...baseLog,
      apiUrl: '/api/v1/order/claim',
      apiMethod: 'POST',
      httpStatus: 500,
      apiParams: { taskId: 'task-999' },
      apiResponse: { error: 'Database locked' },
    };

    const html = renderToStaticMarkup(
      <LogApiPayloadSection
        log={apiLog}
        expanded={true}
        copiedKey="log-api-test-params"
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
      />
    );

    // 展开状态文案
    expect(html).toContain('收起传参与返回');
    expect(html).toContain('HTTP 500');

    // 渲染请求参数与返回数据
    expect(html).toContain('请求入参 (Params / Body)');
    expect(html).toContain('task-999');
    expect(html).toContain('接口返回 (Response Data)');
    expect(html).toContain('Database locked');

    // 已复制状态指示
    expect(html).toContain('已复制');
  });
});
