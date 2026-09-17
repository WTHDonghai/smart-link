import path from 'node:path';
import fs from 'node:fs';
import type { PlatformAuthTokens } from '../../types';
import { resolveUserDataDir } from '../paths';
import { saveTokensToStorage, clearTokensFromStorage } from '../../services/platformAuth';
import { logger } from '../../services/logger';

/**
 * 获取 Electron 标准用户数据目录下的 Token 缓存文件路径
 */
export function getDefaultTokenCacheFile(): string {
  return path.join(resolveUserDataDir(), 'platform-token.json');
}

/**
 * 从本地安全配置文件中读取 PlatformAuthTokens
 */
export function loadPlatformTokenFile(filePath = getDefaultTokenCacheFile()): PlatformAuthTokens | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) {
      return null;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const accessToken = typeof parsed.accessToken === 'string' ? parsed.accessToken.trim() : '';
    const refreshToken = typeof parsed.refreshToken === 'string' ? parsed.refreshToken.trim() : '';
    const expiresAt = Number(parsed.expiresAt || 0);

    if (!accessToken || !refreshToken || !expiresAt) {
      return null;
    }

    return {
      accessToken,
      refreshToken,
      expiresAt,
      tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : 'bearer',
      platformBaseUrl: typeof parsed.platformBaseUrl === 'string' ? parsed.platformBaseUrl : '',
      tenantId: typeof parsed.tenantId === 'string' ? parsed.tenantId : 'DEFAULT',
      authenticatedAt: typeof parsed.authenticatedAt === 'string' ? parsed.authenticatedAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch (error) {
    logger.warn('[平台凭证] 读取本地 Token 缓存文件异常', {
      module: 'AUTH',
      details: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 安全持久化 Token 至本地标准用户数据目录（0o600 权限）
 */
export function savePlatformTokenFile(
  tokens: PlatformAuthTokens,
  filePath = getDefaultTokenCacheFile()
): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (error) {
    logger.warn('[平台凭证] 写入本地 Token 缓存文件异常', {
      module: 'AUTH',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 清除本地 Token 缓存文件
 */
export function clearPlatformTokenFile(filePath = getDefaultTokenCacheFile()): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logger.warn('[平台凭证] 删除本地 Token 缓存文件异常', {
      module: 'AUTH',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Node.js 运行时宿主初始化：从标准 userData 目录读取已存 Token 并注入内存
 */
export function initNodePlatformTokens(filePath = getDefaultTokenCacheFile()): PlatformAuthTokens | null {
  const tokens = loadPlatformTokenFile(filePath);
  if (tokens) {
    saveTokensToStorage(tokens);
  } else {
    clearTokensFromStorage();
  }
  return tokens;
}
