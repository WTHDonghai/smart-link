import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getDefaultTokenCacheFile,
  loadPlatformTokenFile,
  savePlatformTokenFile,
  clearPlatformTokenFile,
  initNodePlatformTokens,
} from '../../../src/crawler/duty/platformTokenStore';
import { loadTokensFromStorage } from '../../../src/services/platformAuth';
import type { PlatformAuthTokens } from '../../../src/types';

describe('platformTokenStore', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartlink-token-test-'));
    tempFile = path.join(tempDir, 'platform-token.json');
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('should return default token cache file under standard userData dir', () => {
    const file = getDefaultTokenCacheFile();
    expect(file).toContain('platform-token.json');
    expect(path.isAbsolute(file)).toBe(true);
  });

  it('should save and load platform tokens correctly', () => {
    const mockTokens: PlatformAuthTokens = {
      accessToken: 'test-access-token-123',
      refreshToken: 'test-refresh-token-456',
      expiresAt: Date.now() + 3600000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://api.test.com',
      tenantId: 'TENANT_01',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savePlatformTokenFile(mockTokens, tempFile);
    expect(fs.existsSync(tempFile)).toBe(true);

    const loaded = loadPlatformTokenFile(tempFile);
    expect(loaded).not.toBeNull();
    expect(loaded?.accessToken).toBe(mockTokens.accessToken);
    expect(loaded?.refreshToken).toBe(mockTokens.refreshToken);
    expect(loaded?.expiresAt).toBe(mockTokens.expiresAt);
    expect(loaded?.tenantId).toBe('TENANT_01');

    if (process.platform !== 'win32') {
      const stat = fs.statSync(tempFile);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('should return null when file does not exist or is empty/corrupt', () => {
    expect(loadPlatformTokenFile(path.join(tempDir, 'non-existent.json'))).toBeNull();

    fs.writeFileSync(tempFile, '   ', 'utf-8');
    expect(loadPlatformTokenFile(tempFile)).toBeNull();

    fs.writeFileSync(tempFile, '{ corrupt json', 'utf-8');
    expect(loadPlatformTokenFile(tempFile)).toBeNull();

    fs.writeFileSync(tempFile, JSON.stringify({ accessToken: 'only-token' }), 'utf-8');
    expect(loadPlatformTokenFile(tempFile)).toBeNull();
  });

  it('should clear platform token file safely', () => {
    fs.writeFileSync(tempFile, JSON.stringify({ test: 123 }), 'utf-8');
    expect(fs.existsSync(tempFile)).toBe(true);

    clearPlatformTokenFile(tempFile);
    expect(fs.existsSync(tempFile)).toBe(false);

    // Should not throw if called again
    expect(() => clearPlatformTokenFile(tempFile)).not.toThrow();
  });

  it('should initialize Node platform tokens into platformAuth storage', () => {
    const mockTokens: PlatformAuthTokens = {
      accessToken: 'init-access-token',
      refreshToken: 'init-refresh-token',
      expiresAt: Date.now() + 7200000,
      tokenType: 'bearer',
      platformBaseUrl: 'https://api.test.com',
      tenantId: 'TENANT_INIT',
      authenticatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    savePlatformTokenFile(mockTokens, tempFile);

    const initialized = initNodePlatformTokens(tempFile);
    expect(initialized?.accessToken).toBe('init-access-token');

    const inStorage = loadTokensFromStorage();
    expect(inStorage?.accessToken).toBe('init-access-token');
  });
});
