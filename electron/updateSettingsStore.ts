import path from 'node:path';
import fs from 'node:fs';
import { resolveUserDataDir } from '../src/crawler/paths';
import { logger } from '../src/services/logger';

/** 更新设置：自动安装开关（关闭后退化为手动模式，仅角标提醒） */
export interface UpdateSettings {
  autoInstallEnabled: boolean;
}

const SETTINGS_FORMAT_VERSION = 1;
const DEFAULT_SETTINGS: UpdateSettings = { autoInstallEnabled: true };

/**
 * 获取 Electron 标准用户数据目录下的更新设置文件路径
 */
export function getUpdateSettingsFile(): string {
  return path.join(resolveUserDataDir(), 'update-settings.json');
}

/**
 * 校验并收敛设置载荷：结构非法整体判无效（返回 null），不做部分恢复
 */
export function parseUpdateSettings(parsed: unknown): UpdateSettings | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== SETTINGS_FORMAT_VERSION) {
    return null;
  }
  if (typeof record.autoInstallEnabled !== 'boolean') {
    return null;
  }
  return { autoInstallEnabled: record.autoInstallEnabled };
}

/**
 * 读取更新设置。文件缺失属正常态（从未调整过设置），静默返回默认值；
 * 结构无效或读取异常时显式 WARN 后按默认值处理（设置读取是尽力恢复，不阻断启动）
 */
export function loadUpdateSettings(filePath = getUpdateSettingsFile()): UpdateSettings {
  try {
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_SETTINGS };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) {
      return { ...DEFAULT_SETTINGS };
    }
    const settings = parseUpdateSettings(JSON.parse(raw));
    if (!settings) {
      logger.warn('[系统更新] 设置文件版本或结构无效，已按默认设置处理', {
        module: 'SYSTEM',
        details: `文件: ${filePath}`,
      });
      return { ...DEFAULT_SETTINGS };
    }
    return settings;
  } catch (error) {
    logger.warn('[系统更新] 读取设置文件异常，已按默认设置处理', {
      module: 'SYSTEM',
      details: `${error instanceof Error ? error.message : String(error)} | 文件: ${filePath}`,
    });
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 持久化更新设置至标准用户数据目录（0o600 权限）
 */
export function saveUpdateSettings(
  settings: UpdateSettings,
  filePath = getUpdateSettingsFile()
): { success: boolean; error?: string } {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = {
      version: SETTINGS_FORMAT_VERSION,
      autoInstallEnabled: Boolean(settings.autoInstallEnabled),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    return { success: true };
  } catch (error) {
    const message = `写入更新设置失败: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn('[系统更新] 写入设置文件异常', {
      module: 'SYSTEM',
      details: message,
    });
    return { success: false, error: message };
  }
}
