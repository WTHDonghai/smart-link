import { describe, expect, it } from 'vitest';
import { douyinRiskSnippet, findDouyinResponseRisk, redactDouyinDiagnosticText, redactDouyinDiagnosticUrl, serializeDouyinOriginalError } from '@/src/utils/douyinRiskDiagnostics';

const context = { apiUrl: 'https://life.douyin.com/api?token=private#private', httpStatus: 200, method: 'POST' };

describe('抖音响应风控特征诊断纯函数', () => {
  it('没有特征时不生成证据', () => {
    expect(findDouyinResponseRisk('{"status_code":0,"data":[]}', context)).toBeNull();
  });
  it('解析业务提示的实际字段与业务码', () => {
    expect(findDouyinResponseRisk('{"status_code":100,"status_msg":"操作频繁"}', context)).toEqual({
      origin: 'api-response', ...context, apiUrl: 'https://life.douyin.com/api?redacted#redacted', businessCode: 100,
      match: { source: 'response-body', fieldPath: '$.status_msg', matched: '操作频繁', snippet: '操作频繁' },
    });
  });
  it('定位列表中序列化订单 JSON 的具体业务字段', () => {
    const text = JSON.stringify({ data: { data: [JSON.stringify({ remark: '无需验证码入住' })] } });
    expect(findDouyinResponseRisk(text, context)?.match).toEqual({
      source: 'response-body', fieldPath: '$.data.data[0](JSON).remark', matched: '验证码', snippet: '无需验证码入住',
    });
  });
  it('非 JSON 响应保留原始匹配片段', () => {
    expect(findDouyinResponseRisk('<h1>安全验证</h1>', context)?.match).toEqual({
      source: 'response-body', fieldPath: '$raw', matched: '安全验证', snippet: '<h1>安全验证</h1>',
    });
  });
  it('只有 JSON 键命中特征时明确标记为原始文本，而不是捏造字段值', () => {
    expect(findDouyinResponseRisk('{"captcha":true}', context)?.match.fieldPath).toBe('$raw');
  });
  it('列表业务错误只检查 status_msg，不把订单备注当作失败原因', () => {
    const text = JSON.stringify({ status_code: 1, status_msg: '订单无效', data: { remark: '验证码' } });
    expect(findDouyinResponseRisk(text, context, 'status_msg')).toBeNull();
    const escaped = '{"status_code":1,"status_msg":"\\u9a8c\\u8bc1\\u7801"}';
    expect(findDouyinResponseRisk(escaped, context, 'status_msg')?.match).toEqual({
      source: 'response-body', fieldPath: '$.status_msg', matched: '验证码', snippet: '验证码',
    });
  });
  it('转义后的词没有命中原始规则时不扩大拦截范围', () => {
    expect(findDouyinResponseRisk('{"msg":"\\u9a8c\\u8bc1\\u7801"}', context)).toBeNull();
  });
  it('无法解析的字符串仍提供实际文本证据', () => {
    expect(findDouyinResponseRisk('"captcha', context)?.match.snippet).toBe('"captcha');
    expect(findDouyinResponseRisk('"captcha"', context)?.match.fieldPath).toBe('$');
  });
  it('原始错误序列化保留完整换行、堆栈、错误码与 cause，不修改源异常', () => {
    const cause = Object.assign(new Error('连接拒绝'), { code: 'ECONNREFUSED' });
    const error = Object.assign(new TypeError(`fetch failed\n${'original-context'.repeat(80)}`, { cause }), { errorCode: 'NET_FAILED' });
    expect(serializeDouyinOriginalError(error)).toEqual({
      name: 'TypeError', message: error.message, stack: error.stack, errorCode: 'NET_FAILED',
      cause: { name: 'Error', message: cause.message, stack: cause.stack, code: 'ECONNREFUSED' },
    });
    expect(error.cause).toBe(cause);
  });
  it('非 Error 抛出值和循环 cause 可序列化而不丢失已捕获内容', () => {
    expect(serializeDouyinOriginalError('原始字符串错误')).toEqual({ message: '原始字符串错误' });
    const error = new Error('循环异常');
    error.cause = error;
    expect(serializeDouyinOriginalError(error)).toEqual({
      name: 'Error', message: '循环异常', stack: error.stack, cause: { message: '[循环异常引用]', circular: true },
    });
    expect(serializeDouyinOriginalError({ message: '远端失败', code: 503, details: 'not copied' }))
      .toEqual({ message: '远端失败', code: 503 });
  });
  it('完整诊断原文只脱敏凭据，保留业务内容、request_id 和换行', () => {
    const text = '{\n "status_msg":"访问频繁", "request_id":"1234567890123456789", "token":"private-token", "password":"private-password"\n}';
    expect(redactDouyinDiagnosticText(text)).toBe('{\n "status_msg":"访问频繁", "request_id":"1234567890123456789", "token":"[REDACTED]", "password":"[REDACTED]"\n}');
    expect(redactDouyinDiagnosticText('Authorization: Bearer private-token\ntoken=private-token'))
      .toBe('Authorization: Bearer [REDACTED]\ntoken=[REDACTED]');
    const url = `https://life.douyin.com/${'path'.repeat(150)}?token=private-token#private`;
    expect(redactDouyinDiagnosticText(url)).toBe(`https://life.douyin.com/${'path'.repeat(150)}?redacted#redacted`);
  });
  it('嵌套 JSON 字符串中的会话凭据同样脱敏，不影响业务错误内容', () => {
    const body = JSON.stringify({ data: JSON.stringify({ token: 'private-token', status_msg: '安全验证' }) });
    const redacted = redactDouyinDiagnosticText(body);
    expect(redacted).not.toContain('private-token');
    expect(redacted).toContain('安全验证');
    expect(redactDouyinDiagnosticText('Cookie: session=private-session\nstatus_msg=安全验证'))
      .toBe('Cookie: [REDACTED]\nstatus_msg=安全验证');
  });
  it('URL 与片段脱敏，短文本保留命中上下文并隐藏长数字', () => {
    expect(redactDouyinDiagnosticUrl(context.apiUrl)).toBe('https://life.douyin.com/api?redacted#redacted');
    const snippet = douyinRiskSnippet('验证码 13812345678 https://example.com/verify?token=private#private', 0);
    expect(snippet).toBe('验证码 [数字已隐藏] https://example.com/verify?redacted#redacted');
    expect(douyinRiskSnippet('x'.repeat(200) + '验证码' + 'y'.repeat(200), 200)).toHaveLength(160);
  });
});
