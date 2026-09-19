import { createHash } from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type {
  StationIdentity,
  StationRegistration,
  StationMachineProfileOptions,
} from '../../types';
import { registerStation } from '../../services/dutyRuntimeApi';
import { getPlatformBaseUrl } from '../../services/platformAuth';
import { logger } from '../../services/logger';
import { resolveUserDataDir } from '../paths';

type NetworkEntry = {
  address: string;
  family: string | number;
  internal: boolean;
  mac: string;
};

/**
 * 校验 MAC 地址是否有效且非全零/虚拟无效地址
 */
export function usableMac(value: unknown): boolean {
  const mac = String(value || '').trim().toLowerCase();
  return (
    /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(mac) &&
    mac !== '0:0:0:0:0:0' &&
    mac !== '00:00:00:00:00:00' &&
    mac !== 'ff:ff:ff:ff:ff:ff'
  );
}

/**
 * 当物理网卡 MAC 不可用时，基于主机名与操作系统类型生成确定性的 SHA-256 回退 MAC
 */
export function fallbackMac(hostname: string, platform: string): string {
  const bytes = createHash('sha256').update(`${hostname}\n${platform}`).digest().subarray(0, 6);
  bytes[0] = ((bytes[0] ?? 0) | 0x02) & 0xfe;
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(':');
}

/**
 * 规范化平台基础 URL，消除末尾斜杠
 */
export function normalizeBaseUrl(url?: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

/**
 * 获取 Electron 标准用户数据目录
 * 优先遵循 process.env.SMARTLINK_USER_DATA_DIR (Electron app.getPath('userData'))
 * 在 CLI 独立运行环境下自动对齐操作系统原生 Electron 标准路径
 */
export function getDefaultStationConfigDir(): string {
  return resolveUserDataDir();
}

export function getDefaultStationCacheFile(): string {
  return path.join(getDefaultStationConfigDir(), 'platform-station.json');
}

/**
 * 采集确定性机器指纹并构建工位注册数据包
 */
export function buildStationRegistration(
  input: string | StationMachineProfileOptions = 'smart-link'
): StationRegistration {
  const options: StationMachineProfileOptions =
    typeof input === 'string' ? { appId: input } : input || {};

  const appId = (options.appId || 'smart-link').trim();
  const agentVersion = (options.agentVersion || '1.0.0').trim();

  const hostname = options.customHostname || os.hostname();
  const platform = options.customPlatform || os.platform();
  const release = options.customRelease || os.release();
  const arch = options.customArch || os.arch();

  let macAddress = options.customMac;
  let ip = options.customIp;

  if (!macAddress || !ip) {
    const networkInterfaces = os.networkInterfaces() as Record<string, NetworkEntry[] | undefined>;
    const entries = Object.values(networkInterfaces).flatMap((val) => val || []);
    const selected =
      entries.find(
        (entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4) && usableMac(entry.mac)
      ) ||
      entries.find((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 4));

    if (!macAddress) {
      macAddress = selected && usableMac(selected.mac)
        ? selected.mac.toLowerCase()
        : fallbackMac(hostname, platform);
    }
    if (!ip) {
      ip = selected?.address || '127.0.0.1';
    }
  }

  return {
    macAddress: macAddress.toLowerCase(),
    hostname,
    ip,
    appId,
    osName: `${platform} ${release} ${arch}`,
    agentVersion,
  };
}

export interface StationIdentityManagerOptions {
  platformBaseUrl?: string;
  cacheFilePath?: string;
  appId?: string;
  now?: () => number;
  onEvent?: (type: string, data?: Record<string, unknown>) => void;
}

interface StoredStationIdentity extends StationIdentity {
  version: 1;
  platformBaseUrl: string;
  registeredAt: string;
}

/**
 * 工业级工位身份生命周期管理器 (StationIdentityManager)
 * 具备 BaseURL 强绑定校验、本地安全持久化、并发在途防重与多环境隔离能力
 */
export class StationIdentityManager {
  private platformBaseUrl: string;
  private cacheFilePath: string;
  private appId: string;
  private now: () => number;
  private onEvent: (type: string, data?: Record<string, unknown>) => void;

  private current: StationIdentity | null = null;
  private registrationPromise: Promise<StationIdentity> | null = null;

  constructor(options: StationIdentityManagerOptions = {}) {
    let defaultBaseUrl = options.platformBaseUrl;
    if (!defaultBaseUrl) {
      try {
        defaultBaseUrl = getPlatformBaseUrl();
      } catch {
        defaultBaseUrl = '';
      }
    }
    this.platformBaseUrl = normalizeBaseUrl(defaultBaseUrl);
    this.cacheFilePath = options.cacheFilePath || getDefaultStationCacheFile();
    this.appId = (options.appId || 'smart-link').trim();
    this.now = options.now || (() => Date.now());
    this.onEvent = options.onEvent || (() => undefined);
  }

  public setPlatformBaseUrl(url: string): void {
    const normalized = normalizeBaseUrl(url);
    if (this.platformBaseUrl !== normalized) {
      this.platformBaseUrl = normalized;
      // 环境切换，当前内存缓存立即可选废弃
      this.current = null;
    }
  }

  public setCacheFilePath(filePath: string): void {
    this.cacheFilePath = filePath;
    this.current = null;
  }

  /**
   * 确保工位身份已注册并可用
   * 1. 若内存已有且环境匹配，立即返回
   * 2. 若本地磁盘缓存有效且环境匹配，复用并返回
   * 3. 若缓存缺失或环境变更，发起远程注册并保存
   */
  public async ensureRegistered(platformBaseUrl?: string): Promise<StationIdentity> {
    if (platformBaseUrl) {
      this.setPlatformBaseUrl(platformBaseUrl);
    } else if (!this.platformBaseUrl) {
      try {
        this.setPlatformBaseUrl(getPlatformBaseUrl());
      } catch {
        // 尚未配置时保持
      }
    }

    // 1. 检查内存缓存
    if (
      this.current &&
      this.current.stationId &&
      this.current.appId === this.appId &&
      (!this.platformBaseUrl || !this.current.platformBaseUrl || this.current.platformBaseUrl === this.platformBaseUrl)
    ) {
      return { ...this.current };
    }

    // 2. 检查本地磁盘缓存
    const cached = this.load();
    if (cached) {
      this.current = cached;
      this.onEvent('platform_station_identity_reused', {
        stationId: cached.stationId,
        appId: cached.appId,
        platformBaseUrl: cached.platformBaseUrl,
      });
      logger.info('[工位身份] 复用本地缓存工位', {
        module: 'DUTY_TASK',
        details: `工位ID: ${cached.stationId} | 应用: ${cached.appId}`,
        meta: {
          stationId: cached.stationId,
          appId: cached.appId,
        },
      });
      return { ...this.current };
    }

    // 3. 并发防重注册
    if (!this.registrationPromise) {
      this.registrationPromise = this.register().finally(() => {
        this.registrationPromise = null;
      });
    }

    return { ...(await this.registrationPromise) };
  }

  /**
   * 发起远程注册并持久化
   */
  public async register(): Promise<StationIdentity> {
    const payload = buildStationRegistration(this.appId);
    const result = await registerStation(payload);

    const nowIso = new Date(this.now()).toISOString();
    const stored: StoredStationIdentity = {
      version: 1,
      stationId: result.stationId,
      appId: result.appId,
      stationName: result.stationName,
      platformBaseUrl: this.platformBaseUrl,
      macAddress: result.macAddress || payload.macAddress,
      ip: result.ip || payload.ip,
      hostname: result.hostname || payload.hostname,
      osName: result.osName || payload.osName,
      agentVersion: result.agentVersion || payload.agentVersion,
      registeredAt: nowIso,
    };

    this.save(stored);
    this.current = stored;

    this.onEvent('platform_station_registered', {
      stationId: stored.stationId,
      appId: stored.appId,
      platformBaseUrl: stored.platformBaseUrl,
    });
    logger.info('[工位注册] 成功向文旅中台申请并注册新工位', {
      module: 'DUTY_TASK',
      details: `工位ID: ${stored.stationId} | 应用: ${stored.appId} | IP: ${stored.ip || '-'}`,
      meta: {
        stationId: stored.stationId,
        appId: stored.appId,
        ip: stored.ip,
      },
    });

    return { ...this.current };
  }

  /**
   * 从持久化文件读取工位身份并执行严格环境校验
   */
  public load(): StationIdentity | null {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
      if (!raw.trim()) return null;

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }

      const stationId = String(parsed.stationId || '').trim();
      const appId = String(parsed.appId || '').trim();
      const cachedUrl = normalizeBaseUrl(String(parsed.platformBaseUrl || ''));

      // 严格校验：appId 匹配且 stationId 非空
      if (!stationId || appId !== this.appId) {
        return null;
      }

      // 环境隔离核心校验：若存在 platformBaseUrl，必须与当前环境一致
      if (this.platformBaseUrl && cachedUrl && cachedUrl !== this.platformBaseUrl) {
        logger.warn('[工位缓存] 检测到文旅中台环境变更，既有工位缓存已失效', {
          module: 'DUTY_TASK',
          details: `旧环境: ${cachedUrl} -> 当前环境: ${this.platformBaseUrl}`,
          meta: {
            cachedUrl,
            currentUrl: this.platformBaseUrl,
          },
        });
        return null;
      }

      return {
        stationId,
        appId,
        platformBaseUrl: cachedUrl || this.platformBaseUrl,
        stationName: typeof parsed.stationName === 'string' ? parsed.stationName : undefined,
        macAddress: typeof parsed.macAddress === 'string' ? parsed.macAddress : undefined,
        ip: typeof parsed.ip === 'string' ? parsed.ip : undefined,
        hostname: typeof parsed.hostname === 'string' ? parsed.hostname : undefined,
        osName: typeof parsed.osName === 'string' ? parsed.osName : undefined,
        agentVersion: typeof parsed.agentVersion === 'string' ? parsed.agentVersion : undefined,
        registeredAt: typeof parsed.registeredAt === 'string' || typeof parsed.registeredAt === 'number'
          ? parsed.registeredAt
          : undefined,
      };
    } catch (error) {
      this.onEvent('platform_station_identity_cache_read_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 安全写盘，设置 0o600 权限（仅当前系统用户可读写）
   */
  public save(identity: StoredStationIdentity): void {
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(identity, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch (e) {
      logger.warn('[工位缓存] 持久化写入磁盘警告', {
        module: 'DUTY_TASK',
        details: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * 清除当前工位缓存
   */
  public clearCache(): void {
    this.current = null;
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        fs.unlinkSync(this.cacheFilePath);
      }
    } catch {
      // 容错
    }
  }

  /**
   * 获取当前已知工位（不触发网络请求）
   */
  public getCurrentIdentity(): StationIdentity | null {
    if (this.current) return { ...this.current };
    const cached = this.load();
    if (cached) {
      this.current = cached;
      return { ...this.current };
    }
    return null;
  }
}

/**
 * 全局单例工位管理器
 */
export const stationIdentityManager = new StationIdentityManager();

/**
 * 向后兼容的辅助获取/注册方法
 */
export async function getOrRegisterStationIdentity(
  input: string | StationMachineProfileOptions = 'smart-link',
  cacheFilePath?: string,
  platformBaseUrl?: string
): Promise<StationIdentity> {
  const appId = typeof input === 'string' ? input : input?.appId || 'smart-link';
  if (cacheFilePath) {
    const manager = new StationIdentityManager({
      appId,
      cacheFilePath,
      platformBaseUrl,
    });
    return await manager.ensureRegistered();
  }
  return await stationIdentityManager.ensureRegistered(platformBaseUrl);
}
