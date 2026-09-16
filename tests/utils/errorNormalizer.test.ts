import { describe, it, expect } from 'vitest';
import { normalizeAppError } from '../../src/utils/errorNormalizer';

describe('errorNormalizer - 统一错误智能归一化解析器', () => {
  it('应当精准解析用户截图中的网关 30 秒超时与内网 IP 报错为 AUTH_NET_TIMEOUT', () => {
    // 真实报错样本（与用户截图中完全一致）
    const sampleError =
      '刷新 Token 失败: Failed to handle request [POST https://xctp-api.devops.foxhis.com/identity/oauth/token]: connection timed out after 30000 ms: /10.233.109.82:8090';

    const normalized = normalizeAppError(sampleError, 'AUTH');

    // 严密断言：确切核对错误代码、领域、标题与可重试标志
    expect(normalized.code).toBe('AUTH_NET_TIMEOUT');
    expect(normalized.domain).toBe('AUTH');
    expect(normalized.userTitle).toBe('授权服务响应超时');
    expect(normalized.userMessage).toContain('响应时间过长');
    expect(normalized.suggestion).toContain('稍后点击重试');
    expect(normalized.retryable).toBe(true);

    // 严密断言：原始技术错误现场完整保留，支持技术审计
    expect(normalized.rawMessage).toBe(sampleError);
    expect(normalized.timestamp).toBeDefined();
  });

  it('应当精准识别 OAuth 凭据失效错误并映射为 AUTH_CRED_INVALID', () => {
    const errorObj = new Error('刷新 Token 失败: invalid_grant: Refresh token has expired');
    const normalized = normalizeAppError(errorObj, 'AUTH');

    expect(normalized.code).toBe('AUTH_CRED_INVALID');
    expect(normalized.domain).toBe('AUTH');
    expect(normalized.userTitle).toBe('登录凭据已失效');
    expect(normalized.retryable).toBe(false);
    expect(normalized.rawMessage).toContain('invalid_grant');
  });

  it('应当精准识别用户主动取消操作为 AUTH_USER_CANCELLED', () => {
    const normalized = normalizeAppError('授权流程已被用户取消', 'AUTH');

    expect(normalized.code).toBe('AUTH_USER_CANCELLED');
    expect(normalized.userTitle).toBe('授权已取消');
  });

  it('应当精准识别订单房型未匹配错误为 ORDER_MAP_ROOM_NOT_FOUND', () => {
    const normalized = normalizeAppError('预订类型不存在', 'ORDER');

    expect(normalized.code).toBe('ORDER_MAP_ROOM_NOT_FOUND');
    expect(normalized.domain).toBe('ORDER');
    expect(normalized.userTitle).toBe('预订房型未匹配');
    expect(normalized.suggestion).toContain('房型映射');
  });

  it('应当识别 HTTP 502/503 为 AUTH_NET_UNAVAILABLE', () => {
    const errorWithStatus = {
      message: '502 Bad Gateway: nginx/1.18.0',
      statusCode: 502,
    };
    const normalized = normalizeAppError(errorWithStatus, 'AUTH');

    expect(normalized.code).toBe('AUTH_NET_UNAVAILABLE');
    expect(normalized.statusCode).toBe(502);
    expect(normalized.userTitle).toBe('授权服务暂时不可用');
  });

  it('应当将非 AUTH 领域的 502/503 网关异常正确映射为 NET_REQUEST_TIMEOUT 而非穿透', () => {
    const errorWithStatus = {
      message: '502 Bad Gateway: Upstream PMS connection closed',
      statusCode: 502,
    };
    const normalized = normalizeAppError(errorWithStatus, 'ORDER');

    expect(normalized.code).toBe('NET_REQUEST_TIMEOUT');
    expect(normalized.domain).toBe('NET');
    expect(normalized.statusCode).toBe(502);
    expect(normalized.userTitle).toBe('网络请求超时');
  });

  it('应当对未知异常安全兜底为 SYS_UNKNOWN_ERROR 并保持 domain: SYS 一致性', () => {
    const unknownError = new Error('Some unexpected internal failure code: 0x999');
    const normalized = normalizeAppError(unknownError, 'ORDER');

    expect(normalized.code).toBe('SYS_UNKNOWN_ERROR');
    expect(normalized.domain).toBe('SYS');
    expect(normalized.userTitle).toBe('发生未预期的异常');
    expect(normalized.rawMessage).toBe('Some unexpected internal failure code: 0x999');
    expect(normalized.retryable).toBe(true);
  });
});
