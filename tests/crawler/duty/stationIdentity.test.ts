import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildStationRegistration,
  getOrRegisterStationIdentity,
  StationIdentityManager,
  usableMac,
  fallbackMac,
  normalizeBaseUrl,
  getDefaultStationConfigDir,
  getDefaultStationCacheFile,
} from '../../../src/crawler/duty/stationIdentity';
import * as dutyRuntimeApi from '../../../src/services/dutyRuntimeApi';
import type { StationIdentity } from '../../../src/types';

describe('stationIdentity', () => {
  let tempDir: string;
  let cacheFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'station-test-'));
    cacheFilePath = path.join(tempDir, 'platform-station.json');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('mac utilities and fallback', () => {
    it('should validate mac format correctly', () => {
      expect(usableMac('00:1a:2b:3c:4d:5e')).toBe(true);
      expect(usableMac('AA:BB:CC:DD:EE:FF')).toBe(true);
      expect(usableMac('00:00:00:00:00:00')).toBe(false);
      expect(usableMac('ff:ff:ff:ff:ff:ff')).toBe(false);
      expect(usableMac('invalid-mac')).toBe(false);
      expect(usableMac('')).toBe(false);
    });

    it('should generate deterministic fallback MAC for same hostname and platform', () => {
      const mac1 = fallbackMac('test-host-1', 'darwin');
      const mac2 = fallbackMac('test-host-1', 'darwin');
      const mac3 = fallbackMac('test-host-2', 'darwin');

      expect(mac1).toBe(mac2);
      expect(mac1).not.toBe(mac3);
      expect(usableMac(mac1)).toBe(true);
    });

    it('should normalize platformBaseUrl correctly', () => {
      expect(normalizeBaseUrl('https://api.pms.com/')).toBe('https://api.pms.com');
      expect(normalizeBaseUrl('https://api.pms.com///')).toBe('https://api.pms.com');
      expect(normalizeBaseUrl('https://api.pms.com')).toBe('https://api.pms.com');
    });

    it('should respect SMARTLINK_USER_DATA_DIR for standard config dir', () => {
      const originalEnv = process.env.SMARTLINK_USER_DATA_DIR;
      try {
        process.env.SMARTLINK_USER_DATA_DIR = '/custom/electron/userdata';
        expect(getDefaultStationConfigDir()).toBe('/custom/electron/userdata');
        expect(getDefaultStationCacheFile()).toBe(path.join('/custom/electron/userdata', 'platform-station.json'));
      } finally {
        if (originalEnv !== undefined) {
          process.env.SMARTLINK_USER_DATA_DIR = originalEnv;
        } else {
          delete process.env.SMARTLINK_USER_DATA_DIR;
        }
      }
    });
  });

  describe('buildStationRegistration', () => {
    it('should build valid station registration payload with system properties', () => {
      const reg = buildStationRegistration('smart-link');

      expect(reg.appId).toBe('smart-link');
      expect(reg.hostname).toBe(os.hostname());
      expect(typeof reg.ip).toBe('string');
      expect(reg.ip.length).toBeGreaterThan(0);
      expect(reg.agentVersion).toBe('1.0.0');
      expect(typeof reg.osName).toBe('string');
      expect(reg.macAddress).toMatch(/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/);
    });

    it('should allow custom options including custom hostname and mac', () => {
      const reg = buildStationRegistration({
        appId: 'custom-duty-agent',
        customHostname: 'hotel-front-pc',
        customMac: '02:42:ac:11:00:02',
        customIp: '192.168.10.55',
      });
      expect(reg.appId).toBe('custom-duty-agent');
      expect(reg.hostname).toBe('hotel-front-pc');
      expect(reg.macAddress).toBe('02:42:ac:11:00:02');
      expect(reg.ip).toBe('192.168.10.55');
    });
  });

  describe('StationIdentityManager', () => {
    it('should reuse cached identity when cache file exists and platformBaseUrl matches', async () => {
      const cachedData = {
        version: 1,
        stationId: 'st-mock-123456',
        macAddress: 'aa:bb:cc:dd:ee:ff',
        ip: '192.168.1.100',
        hostname: 'station-host',
        appId: 'smart-link',
        platformBaseUrl: 'https://api.pms.hotel.com',
        registeredAt: '2026-09-17T08:00:00.000Z',
      };

      fs.writeFileSync(cacheFilePath, JSON.stringify(cachedData, null, 2), 'utf-8');

      const registerSpy = vi.spyOn(dutyRuntimeApi, 'registerStation');

      const manager = new StationIdentityManager({
        cacheFilePath,
        appId: 'smart-link',
        platformBaseUrl: 'https://api.pms.hotel.com',
      });

      const result = await manager.ensureRegistered();

      expect(result.stationId).toBe('st-mock-123456');
      expect(result.appId).toBe('smart-link');
      expect(registerSpy).not.toHaveBeenCalled();
    });

    it('should invalidate cache and re-register when platformBaseUrl changes (environment switch)', async () => {
      const cachedDevData = {
        version: 1,
        stationId: 'st-dev-111',
        appId: 'smart-link',
        platformBaseUrl: 'https://dev-api.hotel.com',
        registeredAt: '2026-09-17T08:00:00.000Z',
      };

      fs.writeFileSync(cacheFilePath, JSON.stringify(cachedDevData, null, 2), 'utf-8');

      const remoteProdIdentity: StationIdentity = {
        stationId: 'st-prod-999',
        appId: 'smart-link',
        platformBaseUrl: 'https://prod-api.hotel.com',
        registeredAt: Date.now(),
      };

      const registerSpy = vi.spyOn(dutyRuntimeApi, 'registerStation').mockResolvedValue(remoteProdIdentity);

      const manager = new StationIdentityManager({
        cacheFilePath,
        appId: 'smart-link',
        platformBaseUrl: 'https://prod-api.hotel.com',
      });

      const result = await manager.ensureRegistered();

      expect(registerSpy).toHaveBeenCalledTimes(1);
      expect(result.stationId).toBe('st-prod-999');

      // 验证新配置已覆盖保存且 platformBaseUrl 更新
      const updated = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8')) as { platformBaseUrl: string; stationId: string };
      expect(updated.stationId).toBe('st-prod-999');
      expect(updated.platformBaseUrl).toBe('https://prod-api.hotel.com');
    });

    it('should deduplicate concurrent in-flight registration calls', async () => {
      const remoteIdentity: StationIdentity = {
        stationId: 'st-dedup-888',
        appId: 'smart-link',
        platformBaseUrl: 'https://api.pms.com',
        registeredAt: Date.now(),
      };

      let resolvePromise: (val: StationIdentity) => void;
      const deferred = new Promise<StationIdentity>((resolve) => {
        resolvePromise = resolve;
      });

      const registerSpy = vi.spyOn(dutyRuntimeApi, 'registerStation').mockReturnValue(deferred);

      const manager = new StationIdentityManager({
        cacheFilePath,
        appId: 'smart-link',
        platformBaseUrl: 'https://api.pms.com',
      });

      // 并发发起 3 次 ensureRegistered 调用
      const p1 = manager.ensureRegistered();
      const p2 = manager.ensureRegistered();
      const p3 = manager.ensureRegistered();

      resolvePromise!(remoteIdentity);

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(registerSpy).toHaveBeenCalledTimes(1);
      expect(r1.stationId).toBe('st-dedup-888');
      expect(r2.stationId).toBe('st-dedup-888');
      expect(r3.stationId).toBe('st-dedup-888');
    });

    it('should clear cache cleanly', () => {
      fs.writeFileSync(cacheFilePath, JSON.stringify({ stationId: 'test' }), 'utf-8');
      const manager = new StationIdentityManager({ cacheFilePath, appId: 'smart-link' });

      manager.clearCache();

      expect(fs.existsSync(cacheFilePath)).toBe(false);
      expect(manager.getCurrentIdentity()).toBeNull();
    });
  });

  describe('getOrRegisterStationIdentity helper', () => {
    it('should invoke remote registration and save cache when cache file does not exist', async () => {
      const remoteIdentity: StationIdentity = {
        stationId: 'st-remote-999',
        macAddress: '11:22:33:44:55:66',
        ip: '10.0.0.50',
        hostname: 'office-node',
        appId: 'smart-link',
        registeredAt: Date.now(),
      };

      const registerSpy = vi.spyOn(dutyRuntimeApi, 'registerStation').mockResolvedValue(remoteIdentity);

      const result = await getOrRegisterStationIdentity('smart-link', cacheFilePath);

      expect(registerSpy).toHaveBeenCalledTimes(1);
      expect(result.stationId).toBe('st-remote-999');
      expect(fs.existsSync(cacheFilePath)).toBe(true);

      const written = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8')) as StationIdentity;
      expect(written.stationId).toBe('st-remote-999');
      expect(written.appId).toBe('smart-link');
    });

    it('should refresh and re-register if cached identity appId does not match target appId', async () => {
      const cachedData = {
        version: 1,
        stationId: 'st-old-mismatch',
        macAddress: 'aa:bb:cc:dd:ee:ff',
        ip: '192.168.1.100',
        hostname: 'station-host',
        appId: 'other-app',
      };

      fs.writeFileSync(cacheFilePath, JSON.stringify(cachedData), 'utf-8');

      const newIdentity: StationIdentity = {
        stationId: 'st-new-matched',
        macAddress: 'aa:bb:cc:dd:ee:ff',
        ip: '192.168.1.100',
        hostname: 'station-host',
        appId: 'smart-link',
      };

      const registerSpy = vi.spyOn(dutyRuntimeApi, 'registerStation').mockResolvedValue(newIdentity);

      const result = await getOrRegisterStationIdentity('smart-link', cacheFilePath);

      expect(registerSpy).toHaveBeenCalledTimes(1);
      expect(result.stationId).toBe('st-new-matched');
      expect(result.appId).toBe('smart-link');
    });
  });
});
