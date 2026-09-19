import { requestPlatformApi, TOOLKIT_MODULE } from './platformApi';
import { compareSemVer, parseSemVer } from '../utils/semver';
import type { AppUpdateDescriptor } from '../types/update';

export type PlatformUpdatePlatform = 'windows' | 'mac' | 'linux';

export interface PlatformUpdateDescriptorInput {
  appId: string;
  stationId: string;
  platform: PlatformUpdatePlatform;
  currentVersion: string;
}

export function platformAppUpdatePath(appId: string): string {
  const normalized = appId.trim();
  if (!normalized) {
    throw new Error('平台版本检查路径缺少 appId');
  }
  return `/${TOOLKIT_MODULE}/toolbox/apps/${encodeURIComponent(normalized)}/updates`;
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function responseMessage(response: Record<string, unknown>): string {
  return text(response.msg) || text(response.message) || text(response.error);
}

function validateFeedUrl(value: unknown, version: string): string {
  const normalized = text(value);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('平台更新 downloadDirectory 不是有效 URL');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('平台更新 downloadDirectory 必须是无凭证、无参数的 HTTPS 目录');
  }
  if (!url.pathname.endsWith('/')) {
    throw new Error('平台更新 downloadDirectory 必须指向以 / 结尾的更新目录');
  }

  const pathSegments = url.pathname.split('/').filter(Boolean);
  const versionSegment = pathSegments[pathSegments.length - 1] || '';
  if (decodeURIComponent(versionSegment) !== version) {
    throw new Error('平台更新目录版本与 latestVersion 不一致');
  }
  return url.toString();
}

export function parsePlatformUpdateResponse(
  response: unknown,
  currentVersion: string,
  appId: string
): AppUpdateDescriptor | null {
  const envelope = asRecord(response);
  if (!envelope) {
    throw new Error('平台版本检查响应格式无效');
  }
  if (envelope.success !== true) {
    throw new Error(responseMessage(envelope) || '平台版本检查接口返回失败');
  }

  const data = asRecord(envelope.data);
  if (!data || data.needUpgrade !== true) {
    return null;
  }

  const latestVersion = text(data.latestVersion);
  const version = parseSemVer(latestVersion, 'latestVersion');
  const current = parseSemVer(currentVersion, 'currentVersion');
  if (compareSemVer(version, current) <= 0) {
    throw new Error('平台更新 latestVersion 必须高于当前版本');
  }

  const updateType = text(data.updateType).toUpperCase() || 'NSIS';
  if (updateType !== 'NSIS') {
    throw new Error(`平台更新类型暂不支持: ${updateType}`);
  }

  const descriptorAppId = text(data.appId);
  if (descriptorAppId && descriptorAppId !== appId.trim()) {
    throw new Error(`平台更新 appId 不匹配: ${descriptorAppId}`);
  }

  return {
    version: latestVersion,
    feedUrl: validateFeedUrl(data.downloadDirectory, latestVersion),
  };
}

export async function findPlatformAppUpdateDescriptor(
  input: PlatformUpdateDescriptorInput
): Promise<AppUpdateDescriptor | null> {
  const appId = input.appId.trim();
  const stationId = input.stationId.trim();
  if (!appId) throw new Error('平台版本检查缺少 appId');
  if (!stationId) throw new Error('平台版本检查缺少 stationId');
  if (!['windows', 'mac', 'linux'].includes(input.platform)) {
    throw new Error(`平台版本检查不支持系统: ${input.platform || '<empty>'}`);
  }

  const query = new URLSearchParams({
    platform: input.platform,
    currentVersion: input.currentVersion.trim(),
    stationId,
  });
  const response = await requestPlatformApi<unknown>(
    `${platformAppUpdatePath(appId)}?${query.toString()}`,
    { timeoutMs: 15000 }
  );
  return parsePlatformUpdateResponse(response, input.currentVersion, appId);
}
