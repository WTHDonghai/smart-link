import { createHash } from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { StationIdentity, StationRegistration } from '../../types';
import { registerStation } from '../../services/dutyRuntimeApi';

type NetworkEntry = {
  address: string;
  family: string | number;
  internal: boolean;
  mac: string;
};

function usableMac(value: unknown): boolean {
  const mac = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(mac) && mac !== '0:0:0:0:0:0' && mac !== '00:00:00:00:00:00';
}

function fallbackMac(hostname: string, platform: string): string {
  const bytes = createHash('sha256').update(`${hostname}\n${platform}`).digest().subarray(0, 6);
  bytes[0] = ((bytes[0] ?? 0) | 0x02) & 0xfe;
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(':');
}

export function buildStationRegistration(appId = 'smart-link'): StationRegistration {
  const hostname = os.hostname();
  const platform = os.platform();
  const release = os.release();
  const arch = os.arch();

  const networkInterfaces = os.networkInterfaces() as Record<string, NetworkEntry[] | undefined>;
  const entries = Object.values(networkInterfaces).flatMap((val) => val || []);
  const selected =
    entries.find((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4) && usableMac(entry.mac)) ||
    entries.find((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4));

  const macAddress = selected && usableMac(selected.mac)
    ? selected.mac.toLowerCase()
    : fallbackMac(hostname, platform);

  return {
    macAddress,
    hostname,
    ip: selected?.address || '127.0.0.1',
    appId,
    osName: `${platform} ${release} ${arch}`,
    agentVersion: '1.0.0',
  };
}

const DEFAULT_STATION_CACHE_FILE = path.join(process.cwd(), '.config', 'platform-station.json');

export async function getOrRegisterStationIdentity(
  appId = 'smart-link',
  cacheFilePath = DEFAULT_STATION_CACHE_FILE
): Promise<StationIdentity> {
  // 1. 尝试从本地缓存读取
  try {
    if (fs.existsSync(cacheFilePath)) {
      const content = fs.readFileSync(cacheFilePath, 'utf-8');
      const parsed = JSON.parse(content) as StationIdentity;
      if (parsed.stationId && parsed.appId === appId) {
        return parsed;
      }
    }
  } catch {
    // 缓存失效或格式不正确，走远程注册
  }

  // 2. 远程向中台注册当前工位
  const reg = buildStationRegistration(appId);
  const identity = await registerStation(reg);

  // 3. 写入持久化缓存
  try {
    const dir = path.dirname(cacheFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cacheFilePath, JSON.stringify(identity, null, 2), 'utf-8');
  } catch {
    // 忽略缓存写失败
  }

  return identity;
}
