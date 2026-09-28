import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FriendlyErrorAlert } from '@/src/components/common/FriendlyErrorAlert';
import type { AppError } from '@/src/types/error';

describe('FriendlyErrorAlert 友好异常告警卡片', () => {
  const mockError: AppError = {
    code: 'AUTH_CRED_INVALID',
    domain: 'AUTH',
    userTitle: '美团平台授权已失效',
    userMessage: '平台登录凭证已过期，请重新登录美团管家完成授权。',
    suggestion: '点击右上方渠道配置，前往美团管家重新扫码登录。',
    rawMessage: 'HTTP 401 Unauthorized: token expired at session-worker:88',
    retryable: true,
    timestamp: '2026-09-28T20:00:00.000Z',
  };

  it('正确渲染错误标题、代码、用户提示与排查指引', () => {
    const html = renderToStaticMarkup(<FriendlyErrorAlert error={mockError} />);

    expect(html).toContain('美团平台授权已失效');
    expect(html).toContain('AUTH_CRED_INVALID');
    expect(html).toContain('平台登录凭证已过期，请重新登录美团管家完成授权。');
    expect(html).toContain('点击右上方渠道配置，前往美团管家重新扫码登录。');
  });

  it('展示技术详情折叠按钮与复制排查日志按钮', () => {
    const html = renderToStaticMarkup(<FriendlyErrorAlert error={mockError} />);

    expect(html).toContain('查看技术排查详情');
    expect(html).toContain('复制日志');
    expect(html).toContain('title="复制包含错误代码与技术堆栈的完整诊断信息"');
  });

  it('当 retryable 为 true 且传入 onRetry 时展示立即重试按钮', () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(
      <FriendlyErrorAlert error={mockError} onRetry={onRetry} />
    );

    expect(html).toContain('立即重试');
  });

  it('当 retryable 为 false 时不展示立即重试按钮', () => {
    const nonRetryableError: AppError = {
      ...mockError,
      retryable: false,
    };
    const html = renderToStaticMarkup(
      <FriendlyErrorAlert error={nonRetryableError} onRetry={vi.fn()} />
    );

    expect(html).not.toContain('立即重试');
  });
});
