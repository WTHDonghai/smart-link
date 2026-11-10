import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildIncidentNotificationText,
  sendAgentNotificationText,
  signDingtalkPayload,
  MAX_NOTIFICATION_TEXT_LENGTH,
} from '../../src/services/notificationApi';
import type { AgentNotificationConfig } from '../../src/config/agentNotificationConfig';

/**
 * Agent 值守通知客户端（群机器人 webhook 最省事路径）。
 * 仅 Mock 不可控外部 I/O（fetch），报文构造、加签、受理解析、状态语义全部为真实逻辑。
 */

function buildConfig(overrides?: Partial<AgentNotificationConfig>): AgentNotificationConfig {
  return {
    enabled: true,
    webhookType: 'wecom',
    webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    dingtalkSecret: '',
    timeoutMs: 10_000,
    ...overrides,
  };
}

function buildText(): string {
  return buildIncidentNotificationText({
    hotelName: '青山酒店',
    channelName: '美团',
    orderNo: '202611021234',
    summaryLines: ['页面出现登录验证，自动处理已停止。', '系统未再次提交订单。'],
    manualAction: '在该电脑完成登录验证后核对订单状态',
    traceRef: 'AG-20261102-0001',
  });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(respond: (call: FetchCall) => Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  const mocked = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  });
  vi.stubGlobal('fetch', mocked);
  return calls;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildIncidentNotificationText 确定性模板', () => {
  it('按设计 8.1 形态输出完整文案', () => {
    expect(buildText()).toBe(
      [
        '【SmartLink 值守提醒】',
        '青山酒店 的美团订单 202611021234 暂未完成搬单。',
        '页面出现登录验证，自动处理已停止。',
        '系统未再次提交订单。',
        '请人工处理：在该电脑完成登录验证后核对订单状态',
        '处理记录：AG-20261102-0001',
      ].join('\n')
    );
  });

  it('必填字段缺失时立即报错，不兜底拼接', () => {
    expect(() => buildIncidentNotificationText({
      hotelName: ' ',
      channelName: '美团',
      orderNo: 'O1',
      summaryLines: ['事实'],
      manualAction: '动作',
      traceRef: 'AG-1',
    })).toThrow('值守通知内容缺少必须字段: hotelName');

    expect(() => buildIncidentNotificationText({
      hotelName: '青山酒店',
      channelName: '美团',
      orderNo: 'O1',
      summaryLines: [],
      manualAction: '动作',
      traceRef: 'AG-1',
    })).toThrow('summaryLines（至少一条已观察事实）');
  });

  it('超长内容显式报错，禁止悄悄截断', () => {
    expect(() =>
      buildIncidentNotificationText({
        hotelName: '青山酒店',
        channelName: '美团',
        orderNo: 'O1',
        summaryLines: [`${'很长的事实描述'.repeat(400)}`],
        manualAction: '动作',
        traceRef: 'AG-1',
      })
    ).toThrow(`超出 ${MAX_NOTIFICATION_TEXT_LENGTH} 字上限`);
  });
});

describe('sendAgentNotificationText 企业微信机器人', () => {
  const calls = () => installFetchMock(() => Promise.resolve(jsonResponse({ errcode: 0, errmsg: 'ok' })));

  it('errcode=0 时按企业微信契约发送并返回 accepted', async () => {
    const fetchCalls = calls();
    const result = await sendAgentNotificationText(buildConfig(), buildText());

    expect(result).toEqual({ status: 'accepted', detail: '企业微信机器人已受理' });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc');
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(JSON.parse(String(fetchCalls[0].init.body))).toEqual({
      msgtype: 'text',
      text: { content: buildText() },
    });
  });

  it('errcode 非 0 时返回 failed 并携带服务端拒绝原因', async () => {
    installFetchMock(() => Promise.resolve(jsonResponse({ errcode: 93000, errmsg: 'invalid webhook url' })));

    const result = await sendAgentNotificationText(buildConfig(), buildText());

    expect(result.status).toBe('failed');
    expect(result.detail).toContain('errcode=93000');
    expect(result.detail).toContain('invalid webhook url');
  });
});

describe('sendAgentNotificationText 钉钉机器人', () => {
  it('未配置加签密钥时直接 POST 原始 webhook 地址', async () => {
    const fetchCalls = installFetchMock(() => Promise.resolve(jsonResponse({ errcode: 0, errmsg: 'ok' })));
    const config = buildConfig({
      webhookType: 'dingtalk',
      webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=tok',
    });

    const result = await sendAgentNotificationText(config, buildText());

    expect(result.status).toBe('accepted');
    expect(fetchCalls[0].url).toBe('https://oapi.dingtalk.com/robot/send?access_token=tok');
  });

  it('配置加签密钥时按官方算法追加 timestamp 与 sign（可注入时钟保持确定性）', async () => {
    const fetchCalls = installFetchMock(() => Promise.resolve(jsonResponse({ errcode: 0, errmsg: 'ok' })));
    const secret = 'SECdingtalksecret';
    const config = buildConfig({
      webhookType: 'dingtalk',
      webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=tok',
      dingtalkSecret: secret,
    });
    const fixedTimestamp = 1780000000000;

    await sendAgentNotificationText(config, buildText(), { now: () => fixedTimestamp });

    // 依据钉钉官方文档独立复算期望签名：HMAC-SHA256(`${timestamp}\n${secret}`) -> base64 -> urlencode
    const expectedSign = encodeURIComponent(
      createHmac('sha256', secret).update(`${fixedTimestamp}\n${secret}`).digest('base64')
    );
    expect(fetchCalls[0].url).toBe(
      `https://oapi.dingtalk.com/robot/send?access_token=tok&timestamp=${fixedTimestamp}&sign=${expectedSign}`
    );
  });
});

describe('sendAgentNotificationText 飞书机器人', () => {
  it('按飞书契约发送且 code=0 受理（兼容旧版 StatusCode）', async () => {
    const fetchCalls = installFetchMock(() => Promise.resolve(jsonResponse({ code: 0, msg: 'success' })));
    const config = buildConfig({
      webhookType: 'feishu',
      webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx',
    });

    const result = await sendAgentNotificationText(config, buildText());

    expect(result).toEqual({ status: 'accepted', detail: '飞书机器人已受理' });
    expect(JSON.parse(String(fetchCalls[0].init.body))).toEqual({
      msg_type: 'text',
      content: { text: buildText() },
    });

    // 旧版回执
    installFetchMock(() => Promise.resolve(jsonResponse({ StatusCode: 0, StatusMessage: 'success' })));
    const legacy = await sendAgentNotificationText(config, buildText());
    expect(legacy.status).toBe('accepted');
  });

  it('code 非 0 返回 failed 并携带原因', async () => {
    installFetchMock(() => Promise.resolve(jsonResponse({ code: 19021, msg: 'sign match fail' })));
    const config = buildConfig({
      webhookType: 'feishu',
      webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx',
    });

    const result = await sendAgentNotificationText(config, buildText());

    expect(result.status).toBe('failed');
    expect(result.detail).toContain('sign match fail');
  });
});

describe('sendAgentNotificationText 传输与输入防护', () => {
  it('网络层异常返回 unknown（结果未知，不得伪装失败或成功）', async () => {
    installFetchMock(() => Promise.reject(new TypeError('fetch failed')));

    const result = await sendAgentNotificationText(buildConfig(), buildText());

    expect(result.status).toBe('unknown');
    expect(result.detail).toContain('结果未知');
  });

  it('超时中断同样返回 unknown', async () => {
    installFetchMock(() => {
      const abortError = new Error('The operation was aborted due to timeout');
      abortError.name = 'TimeoutError';
      return Promise.reject(abortError);
    });

    const result = await sendAgentNotificationText(buildConfig(), buildText());

    expect(result.status).toBe('unknown');
    expect(result.detail).toContain('TimeoutError');
  });

  it('HTTP 非 2xx 返回 failed', async () => {
    installFetchMock(() => Promise.resolve(new Response('gateway down', { status: 502, statusText: 'Bad Gateway' })));

    const result = await sendAgentNotificationText(buildConfig(), buildText());

    expect(result).toEqual({ status: 'failed', detail: '机器人服务返回 HTTP 502 Bad Gateway' });
  });

  it('HTTP 200 但响应不是 JSON 返回 failed', async () => {
    installFetchMock(() => Promise.resolve(new Response('<html>not json</html>', { status: 200, statusText: 'OK' })));

    const result = await sendAgentNotificationText(buildConfig(), buildText());

    expect(result).toEqual({ status: 'failed', detail: '机器人响应不是合法 JSON' });
  });

  it('空内容与超长内容在发送前显式拒绝', async () => {
    const fetchCalls = installFetchMock(() => Promise.resolve(jsonResponse({ errcode: 0, errmsg: 'ok' })));

    await expect(sendAgentNotificationText(buildConfig(), '   ')).rejects.toThrow('通知内容不能为空');
    await expect(
      sendAgentNotificationText(buildConfig(), `${'x'.repeat(MAX_NOTIFICATION_TEXT_LENGTH + 1)}`)
    ).rejects.toThrow(`超出 ${MAX_NOTIFICATION_TEXT_LENGTH} 字上限`);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('signDingtalkPayload 加签纯函数', () => {
  it('输出可校验的 base64 HMAC 签名', () => {
    const signature = signDingtalkPayload(1780000000000, 'secret');
    const expected = createHmac('sha256', 'secret')
      .update('1780000000000\nsecret')
      .digest('base64');
    expect(signature).toBe(expected);
    expect(signature).not.toContain('\n');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
