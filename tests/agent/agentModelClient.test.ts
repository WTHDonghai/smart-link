import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  callChatCompletion,
  AgentModelClientError,
  type ModelCallInput,
} from '../../src/agent/agentModelClient';

/**
 * 模型客户端（OpenAI 兼容协议）。仅 Mock 底层 fetch（不可控外部 I/O），
 * 报文构造、鉴权头、超时/取消归因、协议解析全部为真实逻辑。
 */

const ENDPOINT = { baseUrl: 'https://gateway.example.com/v1/', apiKey: 'sk-model-key' };

function buildInput(overrides?: Partial<ModelCallInput>): ModelCallInput {
  return {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: '指令' },
      { role: 'user', content: '输入' },
    ],
    timeoutMs: 5000,
    ...overrides,
  };
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function installFetch(respond: (request: CapturedRequest) => Promise<Response>): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const mocked = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const request = { url: String(url), init: init ?? {} };
    captured.push(request);
    return respond(request);
  });
  vi.stubGlobal('fetch', mocked);
  return captured;
}

function completionsResponse(content: string, usage?: Record<string, unknown>, model?: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
      usage: usage ?? { prompt_tokens: 120, completion_tokens: 30 },
      model: model ?? 'deepseek-chat',
    }),
    { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callChatCompletion 成功路径', () => {
  it('按 OpenAI 兼容契约组装请求并解析 JSON 输出', async () => {
    const captured = installFetch(() =>
      Promise.resolve(completionsResponse('{"mappings":[]}', { prompt_tokens: 88, completion_tokens: 12 }, 'deepseek-chat-v3'))
    );

    const result = await callChatCompletion(ENDPOINT, buildInput());

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://gateway.example.com/v1/chat/completions');
    expect(captured[0].init.method).toBe('POST');
    expect((captured[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-model-key');
    const body = JSON.parse(String(captured[0].init.body));
    expect(body).toMatchObject({
      model: 'deepseek-chat',
      temperature: 0,
      stream: false,
      response_format: { type: 'json_object' },
    });
    expect(body.messages).toEqual(buildInput().messages);

    expect(result.parsedJson).toEqual({ mappings: [] });
    expect(result.usage).toEqual({ promptTokens: 88, completionTokens: 12 });
    expect(result.model).toBe('deepseek-chat-v3');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('供应商未返回 usage 时如实为 null，不伪造 0', async () => {
    const response = new Response(
      JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
      { status: 200, statusText: 'OK' }
    );
    installFetch(() => Promise.resolve(response));

    const result = await callChatCompletion(ENDPOINT, buildInput());

    expect(result.usage).toEqual({ promptTokens: null, completionTokens: null });
  });

  it('供应商未回显模型名时回落到请求模型名', async () => {
    const response = new Response(
      JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }),
      { status: 200, statusText: 'OK' }
    );
    installFetch(() => Promise.resolve(response));

    const result = await callChatCompletion(ENDPOINT, buildInput());

    expect(result.model).toBe('deepseek-chat');
  });
});

describe('callChatCompletion 失败路径（Fail-Fast，无重试）', () => {
  it('HTTP 非 2xx 抛 HTTP_ERROR 并携带状态码与响应摘要', async () => {
    installFetch(() =>
      Promise.resolve(new Response('{"error":{"message":"invalid api key"}}', { status: 401, statusText: 'Unauthorized' }))
    );

    const error = await callChatCompletion(ENDPOINT, buildInput()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AgentModelClientError);
    const clientError = error as AgentModelClientError;
    expect(clientError.code).toBe('HTTP_ERROR');
    expect(clientError.httpStatus).toBe(401);
    expect(clientError.message).toContain('HTTP 401');
    expect(clientError.message).toContain('invalid api key');
  });

  it('模型输出不是合法 JSON 抛 PROTOCOL 并附内容片段', async () => {
    installFetch(() => Promise.resolve(completionsResponse('这不是 JSON')));

    await expect(callChatCompletion(ENDPOINT, buildInput())).rejects.toThrow('模型输出不是合法 JSON');
  });

  it('响应缺少 choices / message.content 抛 PROTOCOL', async () => {
    installFetch(() => Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200, statusText: 'OK' })));
    await expect(callChatCompletion(ENDPOINT, buildInput())).rejects.toThrow('模型服务响应缺少 choices');

    installFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200, statusText: 'OK' }))
    );
    await expect(callChatCompletion(ENDPOINT, buildInput())).rejects.toThrow('缺少 message.content');
  });

  it('传输层异常抛 NETWORK，错误信息不包含密钥', async () => {
    installFetch(() => Promise.reject(new TypeError('fetch failed')));

    const error = await callChatCompletion(ENDPOINT, buildInput()).catch((e: unknown) => e);

    expect((error as AgentModelClientError).code).toBe('NETWORK');
    expect((error as AgentModelClientError).message).not.toContain(ENDPOINT.apiKey);
  });

  it('超时中止抛 TIMEOUT', async () => {
    installFetch(() => {
      const timeoutError = new Error('The operation was aborted due to timeout');
      timeoutError.name = 'TimeoutError';
      return Promise.reject(timeoutError);
    });

    const error = await callChatCompletion(ENDPOINT, buildInput()).catch((e: unknown) => e);

    expect((error as AgentModelClientError).code).toBe('TIMEOUT');
  });

  it('外部取消信号中止时抛 CANCELLED（优先于超时归因）', async () => {
    const controller = new AbortController();
    controller.abort();
    installFetch(() => {
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';
      return Promise.reject(abortError);
    });

    const error = await callChatCompletion(
      ENDPOINT,
      buildInput({ signal: controller.signal })
    ).catch((e: unknown) => e);

    expect((error as AgentModelClientError).code).toBe('CANCELLED');
  });
});
