/**
 * 租户 AI 配置下发客户端（仅主进程消费）。
 *
 * 依据《Agent 获取 AI 配置接口说明》：
 * 1. GET /toolkit/toolbox/ai/crypto/public-key 取 RSA 公钥与 keyId；
 * 2. 本地生成一次性 32 字节 AES-256 密钥，用 RSA-OAEP(SHA-256) 加密后
 *    POST /toolkit/toolbox/ai/config；
 * 3. 服务端返回 iv + AES-256-GCM 密文（GCM tag 附在密文末尾），本地解密得到租户配置。
 *
 * 安全约束：
 * - AES 密钥每次请求重新生成，只存活于本次调用栈，绝不落盘、绝不写入日志；
 * - 解密后的 apiKey 仅交给主进程内存缓存，错误信息只包含错误码与安全摘要；
 * - 不做自动重试，唯一例外是文档要求的一次「公钥轮换后重取」。
 */

import { constants, createDecipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';
import { isRecord } from '@/src/utils/typeGuards';
import { joinApiUrl } from '@/src/utils/url';
import { describeErrorMessage } from '@/src/utils/errorCauses';

export const AGENT_AI_PUBLIC_KEY_PATH = '/toolkit/toolbox/ai/crypto/public-key';
export const AGENT_AI_CONFIG_PATH = '/toolkit/toolbox/ai/config';
/** AES-256 传输密钥字节数（文档 §2.1：32 字节） */
const AGENT_AI_AES_KEY_BYTES = 32;
export const AGENT_AI_GCM_IV_BYTES = 12;
export const AGENT_AI_GCM_TAG_BYTES = 16;
export const DEFAULT_AGENT_AI_CONFIG_TIMEOUT_MS = 10_000;
export const DEFAULT_AGENT_AI_MODEL_TIMEOUT_SECONDS = 30;

export type AgentAiConfigErrorCode =
  | 'AI_CONFIG_TENANT_REQUIRED'
  | 'AI_CONFIG_NOT_FOUND'
  | 'AI_CONFIG_DECRYPT_FAILED'
  | 'AI_CONFIG_UNAVAILABLE'
  | 'AI_CONFIG_CRYPTO_KEY_UNAVAILABLE'
  | 'AUTH_REQUIRED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'HTTP_ERROR'
  | 'PROTOCOL';

const KNOWN_ERROR_CODES = new Set<string>([
  'AI_CONFIG_TENANT_REQUIRED',
  'AI_CONFIG_NOT_FOUND',
  'AI_CONFIG_DECRYPT_FAILED',
  'AI_CONFIG_UNAVAILABLE',
  'AI_CONFIG_CRYPTO_KEY_UNAVAILABLE',
]);

/** 远端错误：message 可安全写入日志，绝不包含 apiKey、AES 密钥或密文。 */
export class AgentAiConfigError extends Error {
  readonly code: AgentAiConfigErrorCode;
  readonly httpStatus?: number;

  constructor(code: AgentAiConfigErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'AgentAiConfigError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface AgentAiConfigCryptoKey {
  keyId: string;
  algorithm: string;
  /** X.509/SPKI DER 的 Base64（非 PEM） */
  publicKey: string;
}

/** 解密后的租户配置载荷；字段在解析时已规范化。 */
export interface AgentAiConfigPayload {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
  enabled: boolean;
  extras: Record<string, unknown>;
}

/**
 * 配置的安全日志摘要：非敏感字段原样、apiKey 只留前 4 后 4 的脱敏指纹。
 * 用于确认解密链路是否成功，同时遵守「apiKey 不写入日志」的约束。
 */
export function describeAgentAiConfigForLog(payload: AgentAiConfigPayload): string {
  const key = payload.apiKey;
  const maskedKey = key.length > 8 ? `${key.slice(0, 4)}****${key.slice(-4)}(len=${key.length})` : '****';
  const extrasKeys = Object.keys(payload.extras);
  const extrasPart = extrasKeys.length > 0 ? `, extras=[${extrasKeys.join(',')}]` : '';
  return `baseUrl=${payload.baseUrl}, model=${payload.model || '(空)'}, timeoutSeconds=${payload.timeoutSeconds}, enabled=${payload.enabled}, apiKey=${maskedKey}${extrasPart}`;
}

export interface AgentAiConfigFetchResult {
  keyId: string;
  payload: AgentAiConfigPayload;
}

export interface AgentAiConfigClientDeps {
  /** 平台网关地址（不含 /toolkit 前缀） */
  baseUrl: string;
  /** App-Auth bearer token 的 token 部分 */
  accessToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface JsonResponse {
  status: number;
  ok: boolean;
  payload: unknown;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findKnownErrorCode(value: unknown): AgentAiConfigErrorCode | null {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      const trimmed = current.trim();
      if (KNOWN_ERROR_CODES.has(trimmed)) {
        return trimmed as AgentAiConfigErrorCode;
      }
      continue;
    }
    if (isRecord(current)) {
      pending.push(...Object.values(current));
    }
  }
  return null;
}

function extractServerMessage(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const candidates = [payload.msg, payload.message, payload.error_description];
  if (isRecord(payload.data)) {
    candidates.push(payload.data.msg, payload.data.message);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 160);
    }
  }
  return '';
}

function statusFallbackCode(status: number): AgentAiConfigErrorCode {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 404) return 'AI_CONFIG_NOT_FOUND';
  if (status === 400) return 'AI_CONFIG_DECRYPT_FAILED';
  if (status === 503) return 'AI_CONFIG_UNAVAILABLE';
  return 'HTTP_ERROR';
}

function isSuccessEnvelope(response: JsonResponse): boolean {
  if (!response.ok) return false;
  if (!isRecord(response.payload)) return false;
  if (response.payload.success === false) return false;
  if (typeof response.payload.code === 'number' && response.payload.code !== 200) return false;
  return true;
}

function throwResponseError(response: JsonResponse, action: string): never {
  const code =
    findKnownErrorCode(response.payload) ?? statusFallbackCode(response.status);
  const serverMessage = extractServerMessage(response.payload);
  const suffix = serverMessage ? `：${serverMessage}` : '';
  throw new AgentAiConfigError(
    code,
    `${action}失败（HTTP ${response.status}）${suffix}`,
    response.status
  );
}

async function requestJson(
  deps: AgentAiConfigClientDeps,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<JsonResponse> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_AGENT_AI_CONFIG_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Accept: '*/*',
    'App-Auth': `bearer ${deps.accessToken}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetchImpl(joinApiUrl(deps.baseUrl, path), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AgentAiConfigError(
        'TIMEOUT',
        `请求 ${path} 超时（${timeoutMs}ms）`
      );
    }
    throw new AgentAiConfigError('NETWORK', `请求 ${path} 网络异常: ${describeErrorMessage(error)}`);
  }

  const text = await response.text().catch(() => '');
  let payload: unknown = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { status: response.status, ok: response.ok, payload };
}

/** 取当前生效的 RSA 公钥与 keyId。 */
async function fetchAgentAiCryptoKey(
  deps: AgentAiConfigClientDeps
): Promise<AgentAiConfigCryptoKey> {
  const response = await requestJson(deps, 'GET', AGENT_AI_PUBLIC_KEY_PATH);
  if (!isSuccessEnvelope(response)) {
    throwResponseError(response, '获取 AI 配置公钥');
  }

  const data = isRecord(response.payload) ? response.payload.data : undefined;
  if (!isRecord(data)) {
    throw new AgentAiConfigError('PROTOCOL', '获取 AI 配置公钥失败：响应缺少 data');
  }

  const keyId = readNonEmptyString(data.keyId);
  const publicKey = readNonEmptyString(data.publicKey);
  const algorithm = readNonEmptyString(data.algorithm);
  if (!keyId || !publicKey) {
    throw new AgentAiConfigError('PROTOCOL', '获取 AI 配置公钥失败：keyId 或 publicKey 为空');
  }
  if (algorithm && algorithm !== 'RSA-OAEP-256') {
    throw new AgentAiConfigError(
      'PROTOCOL',
      `不支持的 AI 配置加密算法: ${algorithm}，期望 RSA-OAEP-256`
    );
  }

  return { keyId, algorithm: algorithm || 'RSA-OAEP-256', publicKey };
}

/** RSA-OAEP(SHA-256) 加密 AES 密钥；publicKey 为 X.509/SPKI DER 的 Base64。 */
function encryptAgentAiAesKey(publicKeyBase64: string, aesKey: Buffer): string {
  try {
    // 文档约定 publicKey 为 X.509/SPKI DER 的 Base64（非 PEM），先按 DER 解析为 KeyObject
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const encrypted = publicEncrypt(
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      aesKey
    );
    return encrypted.toString('base64');
  } catch (error) {
    throw new AgentAiConfigError(
      'PROTOCOL',
      `AI 配置公钥无法用于 RSA-OAEP 加密: ${describeErrorMessage(error)}`
    );
  }
}

/** 解密 iv + AES-256-GCM 密文（tag 附在密文末尾 16 字节）。 */
function decryptAgentAiConfigPayload(
  aesKey: Buffer,
  ivBase64: string,
  ciphertextBase64: string
): string {
  const iv = Buffer.from(ivBase64, 'base64');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');
  if (iv.length !== AGENT_AI_GCM_IV_BYTES) {
    throw new AgentAiConfigError('PROTOCOL', `AI 配置 IV 长度非法: ${iv.length}`);
  }
  if (ciphertext.length <= AGENT_AI_GCM_TAG_BYTES) {
    throw new AgentAiConfigError('PROTOCOL', 'AI 配置密文长度不足');
  }

  const tag = ciphertext.subarray(ciphertext.length - AGENT_AI_GCM_TAG_BYTES);
  const body = ciphertext.subarray(0, ciphertext.length - AGENT_AI_GCM_TAG_BYTES);

  try {
    const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch (error) {
    // GCM 认证失败说明密钥/密文不匹配；消息保持通用，不回显任何密文片段
    throw new AgentAiConfigError(
      'PROTOCOL',
      `AI 配置解密失败: ${describeErrorMessage(error)}`
    );
  }
}

/** 解析并规范化解密后的租户配置载荷。 */
export function parseAgentAiConfigPayload(plaintext: string): AgentAiConfigPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new AgentAiConfigError('PROTOCOL', 'AI 配置载荷不是合法 JSON');
  }
  if (!isRecord(parsed)) {
    throw new AgentAiConfigError('PROTOCOL', 'AI 配置载荷不是 JSON 对象');
  }

  const baseUrl = readNonEmptyString(parsed.baseUrl);
  const apiKey = readNonEmptyString(parsed.apiKey);
  if (!baseUrl || !apiKey) {
    throw new AgentAiConfigError(
      'AI_CONFIG_NOT_FOUND',
      'AI 配置缺少 baseUrl 或 apiKey，租户尚未完成配置'
    );
  }

  const rawTimeout = parsed.timeoutSeconds;
  const timeoutSeconds =
    typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0
      ? Math.floor(rawTimeout)
      : DEFAULT_AGENT_AI_MODEL_TIMEOUT_SECONDS;

  // enabled 缺失按启用处理；显式给出时必须是布尔值，避免 "false" 字符串被误判为启用
  let enabled = true;
  if (parsed.enabled !== undefined) {
    if (typeof parsed.enabled !== 'boolean') {
      throw new AgentAiConfigError('PROTOCOL', 'AI 配置 enabled 字段不是布尔值');
    }
    enabled = parsed.enabled;
  }

  return {
    baseUrl,
    apiKey,
    model: readNonEmptyString(parsed.model),
    timeoutSeconds,
    enabled,
    extras: isRecord(parsed.extras) ? parsed.extras : {},
  };
}

async function exchangeConfig(
  deps: AgentAiConfigClientDeps,
  cryptoKey: AgentAiConfigCryptoKey
): Promise<AgentAiConfigFetchResult> {
  const aesKey = randomBytes(AGENT_AI_AES_KEY_BYTES);
  const encryptedKey = encryptAgentAiAesKey(cryptoKey.publicKey, aesKey);

  const response = await requestJson(deps, 'POST', AGENT_AI_CONFIG_PATH, {
    keyId: cryptoKey.keyId,
    encryptedKey,
  });
  if (!isSuccessEnvelope(response)) {
    throwResponseError(response, '获取租户 AI 配置');
  }

  const data = isRecord(response.payload) ? response.payload.data : undefined;
  if (!isRecord(data)) {
    throw new AgentAiConfigError('PROTOCOL', '获取租户 AI 配置失败：响应缺少 data');
  }

  const iv = readNonEmptyString(data.iv);
  const ciphertext = readNonEmptyString(data.ciphertext);
  if (!iv || !ciphertext) {
    throw new AgentAiConfigError('PROTOCOL', '获取租户 AI 配置失败：iv 或 ciphertext 为空');
  }
  const alg = readNonEmptyString(data.alg);
  if (alg && alg !== 'RSA-OAEP-256+A256GCM') {
    throw new AgentAiConfigError('PROTOCOL', `不支持的 AI 配置载荷算法: ${alg}`);
  }

  const plaintext = decryptAgentAiConfigPayload(aesKey, iv, ciphertext);
  return {
    keyId: readNonEmptyString(data.keyId) || cryptoKey.keyId,
    payload: parseAgentAiConfigPayload(plaintext),
  };
}

/**
 * 拉取租户 AI 配置：取公钥 -> 加密一次性 AES 密钥换取配置 -> 本地解密。
 * 服务端轮换 keyId 后旧公钥会返回 AI_CONFIG_DECRYPT_FAILED，此时按文档重取一次公钥。
 */
export async function fetchAgentAiConfig(
  deps: AgentAiConfigClientDeps
): Promise<AgentAiConfigFetchResult> {
  const cryptoKey = await fetchAgentAiCryptoKey(deps);
  try {
    return await exchangeConfig(deps, cryptoKey);
  } catch (error) {
    if (error instanceof AgentAiConfigError && error.code === 'AI_CONFIG_DECRYPT_FAILED') {
      const rotatedKey = await fetchAgentAiCryptoKey(deps);
      return exchangeConfig(deps, rotatedKey);
    }
    throw error;
  }
}