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

  it('应当精准解析用户真实遭遇的 404 NOT_FOUND 报错为 NET_NOT_FOUND 而非未知异常', () => {
    // 真实报错样本（与用户截图报错 100% 一致）
    const notFoundSample =
      '平台接口调用失败 (404): Failed to handle request [PUT https://xctp-api.devops.foxhis.com/channel-remark-templates/MEITUAN]: 404 NOT_FOUND "No static resource channel-remark-templates/MEITUAN."';

    const normalized = normalizeAppError(notFoundSample, 'NET');

    expect(normalized.code).toBe('NET_NOT_FOUND');
    expect(normalized.domain).toBe('NET');
    expect(normalized.statusCode).toBe(404);
    expect(normalized.userTitle).toBe('服务接口或资源不存在 (404)');
    expect(normalized.userMessage).toContain('未找到 (HTTP 404)');
    expect(normalized.suggestion).toContain('检查服务模块配置');
    expect(normalized.retryable).toBe(false);
    expect(normalized.rawMessage).toBe(notFoundSample);
  });

  it('应当识别 HTTP 400 请求参数校验失败为 NET_BAD_REQUEST', () => {
    const errorWith400 = {
      message: '平台接口调用失败 (400): Bad Request: Field remarkTemplate is required',
      statusCode: 400,
    };
    const normalized = normalizeAppError(errorWith400, 'NET');

    expect(normalized.code).toBe('NET_BAD_REQUEST');
    expect(normalized.domain).toBe('NET');
    expect(normalized.statusCode).toBe(400);
    expect(normalized.userTitle).toBe('请求参数校验失败 (400)');
    expect(normalized.retryable).toBe(false);
  });

  it('应当识别 HTTP 403 权限受限为 NET_FORBIDDEN', () => {
    const normalized = normalizeAppError('平台接口调用失败 (403): 403 Forbidden - Access denied to module', 'NET');

    expect(normalized.code).toBe('NET_FORBIDDEN');
    expect(normalized.domain).toBe('NET');
    expect(normalized.statusCode).toBe(403);
    expect(normalized.userTitle).toBe('操作权限受限 (403)');
    expect(normalized.retryable).toBe(false);
  });

  it('应当识别 HTTP 500 远端服务错误为 NET_SERVER_ERROR', () => {
    const normalized = normalizeAppError('平台接口调用失败 (500): Internal Server Error', 'NET');

    expect(normalized.code).toBe('NET_SERVER_ERROR');
    expect(normalized.domain).toBe('NET');
    expect(normalized.statusCode).toBe(500);
    expect(normalized.userTitle).toBe('平台服务处理异常 (500)');
    expect(normalized.retryable).toBe(true);
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

  it('应当精准识别 Playwright 缺失本地 Chrome 可执行文件为 CRAWLER_CHROME_NOT_FOUND', () => {
    const chromeMissingMsg =
      "browserType.launchPersistentContext: Executable doesn't exist at /Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const normalized = normalizeAppError(chromeMissingMsg, 'CRAWLER');

    expect(normalized.code).toBe('CRAWLER_CHROME_NOT_FOUND');
    expect(normalized.domain).toBe('CRAWLER');
    expect(normalized.userTitle).toBe('未检测到 Chrome 浏览器');
    expect(normalized.userMessage).toContain('Google Chrome');
    expect(normalized.suggestion).toContain('安装官方 Google Chrome 浏览器');
    expect(normalized.retryable).toBe(true);
  });
});
