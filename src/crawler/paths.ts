import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const APP_USER_DATA_NAME = 'smart-link';
export const LEGACY_APP_USER_DATA_NAME = 'Smart-Link';

export interface PathResolutionOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

/**
 * 解析 Smart-Link 的用户应用数据根目录
 * 优先级与策略（向 Electron 标准 userData 统一对齐）：
 * 1. 显式环境变量 SMARTLINK_USER_DATA_DIR：优先使用（便于单元测试或容器化独立存储）
 * 2. 纯 Web 环境 / Vite 开发服务 / CLI 脚本：对齐操作系统原生 Electron 默认 userData 路径：
 *    - macOS: ~/Library/Application Support/smart-link (优先匹配已存在的 Smart-Link / smart-link)
 *    - Windows: %APPDATA%\smart-link
 *    - Linux: ~/.config/smart-link (或 $XDG_CONFIG_HOME/smart-link)
 */
export function resolveUserDataDir(options: PathResolutionOptions = {}): string {
  const env = options.env || process.env;
  if (env.SMARTLINK_USER_DATA_DIR && env.SMARTLINK_USER_DATA_DIR.trim()) {
    return env.SMARTLINK_USER_DATA_DIR.trim();
  }

  const platform = options.platform || os.platform();
  const homeDir = options.homeDir || os.homedir();

  if (platform === 'darwin') {
    const appSupport = path.join(homeDir, 'Library/Application Support');
    // 如果系统已存在 Smart-Link，优先指向保持兼容
    const legacyPath = path.join(appSupport, LEGACY_APP_USER_DATA_NAME);
    const standardPath = path.join(appSupport, APP_USER_DATA_NAME);
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
    return standardPath;
  }

  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(homeDir, 'AppData/Roaming');
    return path.join(appData, APP_USER_DATA_NAME);
  }

  const configHome = env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  return path.join(configHome, APP_USER_DATA_NAME);
}

/**
 * 解析指定渠道的 Chrome 用户独立 Profile 根目录
 * 路径格式：<userDataDir>/.chrome-profile/<channelCode>
 */
export function resolveChromeProfileDir(
  channelCode: string,
  options: PathResolutionOptions = {}
): string {
  const code = (channelCode || 'MEITUAN').trim().toLowerCase();
  const userDataDir = resolveUserDataDir(options);
  return path.resolve(userDataDir, '.chrome-profile', code);
}

/**
 * 自动探测当前操作系统中日常 Google Chrome 的默认用户数据根目录
 */
export function detectDefaultChromeSourceDir(options: PathResolutionOptions = {}): string {
  const platform = options.platform || os.platform();
  const homeDir = options.homeDir || os.homedir();
  const env = options.env || process.env;

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library/Application Support/Google/Chrome');
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData/Local');
    return path.join(localAppData, 'Google/Chrome/User Data');
  }
  return path.join(homeDir, '.config/google-chrome');
}
