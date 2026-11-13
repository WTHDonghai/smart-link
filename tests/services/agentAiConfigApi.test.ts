import { describe, it, expect } from 'vitest';
import {
  AGENT_AI_CONFIG_PATH,
  AGENT_AI_PUBLIC_KEY_PATH,
  AgentAiConfigError,
  describeAgentAiConfigForLog,
  fetchAgentAiConfig,
  parseAgentAiConfigPayload,
} from '@/src/services/agentAiConfigApi';
import {
  constants,
  createCipheriv,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

interface ServerKeyPair {
  publicKeyBase64: string;
  privateKey: KeyObject;
}

function createServerKeyPair(): ServerKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey,
  };
}

function decryptRequestAesKey(keyPair: ServerKeyPair, encryptedKeyBase64: string): Buffer {
  return privateDecrypt(
    {
      key: keyPair.privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encryptedKeyBase64, 'base64')
  );
}

function encryptPayloadForClient(aesKey: Buffer, payload: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64'),
  };
}

const BASE_DEPS = {
  baseUrl: 'https://gateway.example.com',
  accessToken: 'test-token',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchAgentAiConfig 加密链路', () => {
  it('按文档流程取公钥、RSA-OAEP 加密一次性 AES 密钥并解密租户配置', async () => {
    const keyPair = createServerKeyPair();
    const calls: Array<{ url: string; method: string; appAuth: string; body: string }> = [];

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        appAuth: headers.get('App-Auth') ?? '',
        body: typeof init?.body === 'string' ? init.body : '',
      });

      if (url.endsWith(AGENT_AI_PUBLIC_KEY_PATH)) {
        return jsonResponse(200, {
          code: 200,
          success: true,
          data: {
            keyId: 'default',
            algorithm: 'RSA-OAEP-256',
            publicKey: keyPair.publicKeyBase64,
          },
          msg: '操作成功',
        });
      }
      if (url.endsWith(AGENT_AI_CONFIG_PATH)) {
        const request = JSON.parse(String(init?.body)) as {
          keyId: string;
          encryptedKey: string;
        };
        expect(request.keyId).toBe('default');
        const aesKey = decryptRequestAesKey(keyPair, request.encryptedKey);
        expect(aesKey).toHaveLength(32);
        const encrypted = encryptPayloadForClient(aesKey, {
          baseUrl: 'https://datapulse.example.com',
          apiKey: 'sk-tenant-secret',
          model: 'qwen-vl-max',
          timeoutSeconds: 45,
          enabled: true,
          extras: { mappingModel: 'qwen-max' },
        });
        return jsonResponse(200, {
          code: 200,
          success: true,
          data: {
            keyId: 'default',
            alg: 'RSA-OAEP-256+A256GCM',
            ...encrypted,
          },
          msg: '操作成功',
        });
      }
      return jsonResponse(404, { code: 404, success: false, msg: 'not found' });
    }) as typeof fetch;

    const result = await fetchAgentAiConfig({ ...BASE_DEPS, fetchImpl });

    expect(result.keyId).toBe('default');
    expect(result.payload).toEqual({
      baseUrl: 'https://datapulse.example.com',
      apiKey: 'sk-tenant-secret',
      model: 'qwen-vl-max',
      timeoutSeconds: 45,
      enabled: true,
      extras: { mappingModel: 'qwen-max' },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('POST');
    expect(calls.every((call) => call.appAuth === 'bearer test-token')).toBe(true);
  });

  it('服务端轮换 keyId 返回 AI_CONFIG_DECRYPT_FAILED 时，重取一次公钥后成功', async () => {
    let keyPair = createServerKeyPair();
    let configAttempts = 0;
    let publicKeyFetches = 0;

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(AGENT_AI_PUBLIC_KEY_PATH)) {
        publicKeyFetches += 1;
        return jsonResponse(200, {
          code: 200,
          success: true,
          data: {
            keyId: publicKeyFetches === 1 ? 'key-old' : 'key-new',
            algorithm: 'RSA-OAEP-256',
            publicKey: keyPair.publicKeyBase64,
          },
        });
      }
      if (url.endsWith(AGENT_AI_CONFIG_PATH)) {
        configAttempts += 1;
        if (configAttempts === 1) {
          // 模拟服务端 active-key-id 已轮换：旧 keyId 直接拒绝
          keyPair = createServerKeyPair();
          return jsonResponse(400, {
            code: 400,
            success: false,
            error: 'AI_CONFIG_DECRYPT_FAILED',
            msg: '密钥已轮换',
          });
        }
        const request = JSON.parse(String(init?.body)) as { encryptedKey: string };
        const aesKey = decryptRequestAesKey(keyPair, request.encryptedKey);
        const encrypted = encryptPayloadForClient(aesKey, {
          baseUrl: 'https://gateway.example.com/v1',
          apiKey: 'sk-rotated',
          model: 'qwen-vl-max',
        });
        return jsonResponse(200, {
          code: 200,
          success: true,
          data: { keyId: 'key-new', alg: 'RSA-OAEP-256+A256GCM', ...encrypted },
        });
      }
      return jsonResponse(404, { code: 404, success: false });
    }) as typeof fetch;

    const result = await fetchAgentAiConfig({ ...BASE_DEPS, fetchImpl });

    expect(publicKeyFetches).toBe(2);
    expect(configAttempts).toBe(2);
    expect(result.keyId).toBe('key-new');
    expect(result.payload.apiKey).toBe('sk-rotated');
  });

  it('租户未配置时抛出 AI_CONFIG_NOT_FOUND，错误信息不包含任何密钥', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith(AGENT_AI_PUBLIC_KEY_PATH)) {
        return jsonResponse(404, {
          code: 404,
          success: false,
          error: 'AI_CONFIG_NOT_FOUND',
          msg: '租户未配置 AI 能力',
        });
      }
      return jsonResponse(500, {});
    }) as typeof fetch;

    await expect(fetchAgentAiConfig({ ...BASE_DEPS, fetchImpl })).rejects.toMatchObject({
      code: 'AI_CONFIG_NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('IV 长度非法时按协议错误拒绝，不尝试解密', async () => {
    const keyPair = createServerKeyPair();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith(AGENT_AI_PUBLIC_KEY_PATH)) {
        return jsonResponse(200, {
          code: 200,
          success: true,
          data: { keyId: 'default', algorithm: 'RSA-OAEP-256', publicKey: keyPair.publicKeyBase64 },
        });
      }
      return jsonResponse(200, {
        code: 200,
        success: true,
        data: {
          keyId: 'default',
          alg: 'RSA-OAEP-256+A256GCM',
          iv: Buffer.alloc(8).toString('base64'),
          ciphertext: Buffer.alloc(64).toString('base64'),
        },
      });
    }) as typeof fetch;

    await expect(fetchAgentAiConfig({ ...BASE_DEPS, fetchImpl })).rejects.toMatchObject({
      code: 'PROTOCOL',
    });
  });
});

describe('parseAgentAiConfigPayload', () => {
  it('缺省字段按文档归一化：timeoutSeconds=30、enabled=true、extras={}', () => {
    const payload = parseAgentAiConfigPayload(
      JSON.stringify({ baseUrl: ' https://a.example.com ', apiKey: 'sk-1' })
    );

    expect(payload).toEqual({
      baseUrl: 'https://a.example.com',
      apiKey: 'sk-1',
      model: '',
      timeoutSeconds: 30,
      enabled: true,
      extras: {},
    });
  });

  it('enabled 不是布尔值时拒绝解析，避免字符串 "false" 被误判为启用', () => {
    expect(() =>
      parseAgentAiConfigPayload(
        JSON.stringify({ baseUrl: 'https://a', apiKey: 'sk-1', enabled: 'false' })
      )
    ).toThrowError(AgentAiConfigError);
  });

  it('baseUrl/apiKey 缺失时返回 AI_CONFIG_NOT_FOUND', () => {
    expect(() =>
      parseAgentAiConfigPayload(JSON.stringify({ baseUrl: '', apiKey: 'sk-1' }))
    ).toThrowError(AgentAiConfigError);

    try {
      parseAgentAiConfigPayload(JSON.stringify({ baseUrl: 'https://a', apiKey: ' ' }));
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentAiConfigError);
      expect((error as AgentAiConfigError).code).toBe('AI_CONFIG_NOT_FOUND');
      expect(String((error as Error).message)).not.toContain('sk-1');
    }
  });
});

describe('describeAgentAiConfigForLog 安全日志摘要', () => {
  it('非敏感字段原样输出，apiKey 只留首尾 4 位指纹', () => {
    const summary = describeAgentAiConfigForLog(
      parseAgentAiConfigPayload(
        JSON.stringify({
          baseUrl: 'https://datapulse.example.com',
          apiKey: 'sk-abcdefghijklmnop',
          model: 'qwen-vl-max',
          timeoutSeconds: 45,
          extras: { mappingModel: 'qwen-max' },
        })
      )
    );

    expect(summary).toBe(
      'baseUrl=https://datapulse.example.com, model=qwen-vl-max, timeoutSeconds=45, enabled=true, apiKey=sk-a****mnop(len=19), extras=[mappingModel]'
    );
    // 完整密钥绝不出现
    expect(summary).not.toContain('sk-abcdefghijklmnop');
    expect(summary).not.toContain('bcdefghijkl');
  });

  it('短密钥整体脱敏；空模型与空 extras 如实展示', () => {
    const summary = describeAgentAiConfigForLog(
      parseAgentAiConfigPayload(JSON.stringify({ baseUrl: 'https://a', apiKey: 'sk-1' }))
    );

    expect(summary).toBe(
      'baseUrl=https://a, model=(空), timeoutSeconds=30, enabled=true, apiKey=****'
    );
  });
});