import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildStationRegistration,
  getOrRegisterStationIdentity,
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

    it('should allow custom appId', () => {
      const reg = buildStationRegistration('custom-duty-agent');
      expect(reg.appId).toBe('custom-duty-agent');
    });
  });

  describe('getOrRegisterStationIdentity', () => {
    it('should return cached identity when cache file exists with matching appId', async () => {
      const cachedData: StationIdentity = {
        stationId: 'st-mock-123456',
        macAddress: 'aa:bb:cc:dd:ee:ff',
        ip: '192.168.1.100',
        hostname: 'station-host',
        appId: 'smart-link',
        registeredAt: Date.now() - 5000,
      };

      fs.writeFileSync(cacheFilePath, JSON.stringify(cachedData, null, 2), 'utf-8');

      const registerSpy = vi.spyOn(dutyRuntimeApi, 'registerStation');

      const result = await getOrRegisterStationIdentity('smart-link', cacheFilePath);

      expect(result).toEqual(cachedData);
      expect(registerSpy).not.toHaveBeenCalled();
    });

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
      const cachedData: StationIdentity = {
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
