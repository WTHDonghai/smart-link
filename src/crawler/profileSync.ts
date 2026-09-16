import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';

export interface ProfileSyncOptions {
  channelId?: string; // 目标渠道标识，如 'meituan'
  customSourceDir?: string; // 可选的自定义源 Chrome 路径
  customSourceProfile?: string; // 可选的自定义源 Profile 名称 (如 'Profile 7')
}

export interface ProfileSyncResult {
  success: boolean;
  sourceDir: string;
  sourceProfile: string;
  targetDir: string;
  message: string;
}

/**
 * 自动探测当前操作系统中 Google Chrome 的默认用户数据根目录
 */
export function detectDefaultChromeSourceDir(): string {
  const platform = os.platform();
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  }
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local');
    return path.join(localAppData, 'Google/Chrome/User Data');
  }
  return path.join(os.homedir(), '.config/google-chrome');
}

/**
 * 将日常 Chrome 的当前活跃 Profile 登录态精简同步到 Smart-Link 本地独立 Profile 中
 * 策略：
 * 1. 排他性过滤：不复制密码库 (Login Data)、历史记录 (History)、标签页会话 (Sessions) 或体积庞大的渲染缓存
 * 2. 仅保留站点授权所需关键数据：Cookies、Local Storage、IndexedDB、Preferences
 * 3. 规范化目标 Local State 为 Default，避免多 Profile 冲突并消除崩溃恢复弹窗
 */
export function syncChromeProfile(options: ProfileSyncOptions = {}): ProfileSyncResult {
  const sourceRoot = options.customSourceDir || detectDefaultChromeSourceDir();
  const localStatePath = path.join(sourceRoot, 'Local State');

  if (!fs.existsSync(localStatePath)) {
    throw new Error(`未在系统 Chrome 中找到配置文件 Local State，路径不存在: ${localStatePath}`);
  }

  // 1. 读取源 Local State 并确定当前活跃使用的 Profile 名称
  let localState: Record<string, unknown> = {};
  try {
    localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
  } catch (e) {
    throw new Error(`读取 Chrome Local State 失败: ${e instanceof Error ? e.message : String(e)}`);
  }

  const profileObj = (localState.profile as Record<string, unknown>) || {};
  const lastUsedProfile = (profileObj.last_used as string) || 'Default';
  const sourceProfileName = options.customSourceProfile || lastUsedProfile;
  const sourceProfileDir = path.join(sourceRoot, sourceProfileName);

  if (!fs.existsSync(sourceProfileDir)) {
    throw new Error(`未找到源 Chrome Profile 目录: ${sourceProfileDir}`);
  }

  // 2. 确定目标工作目录 (.chrome-profile/<channelId>)
  const channelId = options.channelId || 'meituan';
  const targetRoot = path.resolve(process.cwd(), '.chrome-profile', channelId);
  const targetProfileDir = path.join(targetRoot, 'Default');

  if (!fs.existsSync(targetProfileDir)) {
    fs.mkdirSync(targetProfileDir, { recursive: true });
  }

  // 3. 执行选择性精简复制 (排除私密及锁文件)
  const rsyncExcludes = [
    '--exclude=/Accounts/',
    '--exclude=/AutofillStrikeDatabase/',
    '--exclude=/Bookmarks*',
    '--exclude=/Cache/',
    '--exclude=/Code Cache/',
    '--exclude=/Current Session',
    '--exclude=/Current Tabs',
    '--exclude=/DawnGraphiteCache/',
    '--exclude=/DawnWebGPUCache/',
    '--exclude=/DNR Extension Rules/',
    '--exclude=/Extension Cookies*',
    '--exclude=/Extension Rules/',
    '--exclude=/Extension Scripts/',
    '--exclude=/Extension State/',
    '--exclude=/Extensions/',
    '--exclude=/Favicons*',
    '--exclude=/GPUCache/',
    '--exclude=/GrShaderCache/',
    '--exclude=/History*',
    '--exclude=/Last Session',
    '--exclude=/Last Tabs',
    '--exclude=/Local Extension Settings/',
    '--exclude=/Login Data*',
    '--exclude=/Managed Extension Settings/',
    '--exclude=/Media Cache/',
    '--exclude=/Network Action Predictor*',
    '--exclude=/Safe Browsing Cookies*',
    '--exclude=/Service Worker/CacheStorage/',
    '--exclude=/Service Worker/ScriptCache/',
    '--exclude=/Session Storage/',
    '--exclude=/Sessions/',
    '--exclude=/ShaderCache/',
    '--exclude=/Shared Dictionary/',
    '--exclude=/Shortcuts*',
    '--exclude=/Storage/ext/',
    '--exclude=/Sync Data/',
    '--exclude=/Sync Extension Settings/',
    '--exclude=/Top Sites*',
    '--exclude=/Visited Links',
    '--exclude=/Web Applications/',
    '--exclude=/Web Data*',
    '--exclude=/blob_storage/',
    '--exclude=LOCK',
    '--exclude=*.lock',
    '--exclude=*.tmp',
  ];

  try {
    const excludeArgs = rsyncExcludes.join(' ');
    // 使用 rsync 进行高速非阻塞增量复制
    execSync(`rsync -a ${excludeArgs} "${sourceProfileDir}/" "${targetProfileDir}/"`, {
      stdio: 'pipe',
    });
  } catch (err) {
    // 降级使用 Node 递归复制关键子目录
    const essentialItems = ['Cookies', 'Network', 'Local Storage', 'IndexedDB', 'Preferences'];
    for (const item of essentialItems) {
      const srcItem = path.join(sourceProfileDir, item);
      const dstItem = path.join(targetProfileDir, item);
      if (fs.existsSync(srcItem)) {
        fs.cpSync(srcItem, dstItem, { recursive: true, force: true });
      }
    }
  }

  // 4. 清除遗留会话与锁文件
  const filesToClean = [
    path.join(targetProfileDir, 'LOCK'),
    path.join(targetProfileDir, 'Current Session'),
    path.join(targetProfileDir, 'Current Tabs'),
    path.join(targetProfileDir, 'Last Session'),
    path.join(targetProfileDir, 'Last Tabs'),
    path.join(targetProfileDir, 'Sessions'),
    path.join(targetProfileDir, 'Session Storage'),
  ];
  for (const item of filesToClean) {
    if (fs.existsSync(item)) {
      fs.rmSync(item, { recursive: true, force: true });
    }
  }

  // 4.1 清除 Chrome 根目录单例锁与套接字，防止实例冲突
  const rootLocksToClean = [
    path.join(targetRoot, 'SingletonLock'),
    path.join(targetRoot, 'SingletonCookie'),
    path.join(targetRoot, 'SingletonSocket'),
  ];
  for (const item of rootLocksToClean) {
    if (fs.existsSync(item)) {
      try {
        fs.rmSync(item, { recursive: true, force: true });
      } catch {
        // 忽略非致命锁清理异常
      }
    }
  }

  // 4.2 若存在 SQLite 格式的 Cookies 数据库，执行 WAL Checkpoint 合并并清理日志文件
  const targetCookiesCandidate = [
    path.join(targetProfileDir, 'Network', 'Cookies'),
    path.join(targetProfileDir, 'Cookies'),
  ].find((c) => fs.existsSync(c));

  if (targetCookiesCandidate) {
    try {
      const header = fs.readFileSync(targetCookiesCandidate).subarray(0, 16);
      if (header.equals(Buffer.from('SQLite format 3\0'))) {
        execSync(`sqlite3 "${targetCookiesCandidate}" "PRAGMA wal_checkpoint(TRUNCATE);"`, {
          stdio: 'ignore',
        });
        const walFile = `${targetCookiesCandidate}-wal`;
        const shmFile = `${targetCookiesCandidate}-shm`;
        if (fs.existsSync(walFile)) fs.rmSync(walFile, { force: true });
        if (fs.existsSync(shmFile)) fs.rmSync(shmFile, { force: true });
      }
    } catch {
      // 忽略非致命 sqlite3 检查点异常
    }
  }

  // 4.3 赋予目标目录全部写权限，避免源只读文件导致 Playwright 无法写入
  try {
    execSync(`chmod -R u+w "${targetRoot}"`, { stdio: 'ignore' });
  } catch {
    // 忽略在 Windows/非类 Unix 环境下的 chmod
  }

  // 5. 规范化写入 targetRoot/Local State
  const infoCache = (profileObj.info_cache as Record<string, unknown>) || {};
  const sourceInfo = infoCache[sourceProfileName] || {};
  const normalizedLocalState = {
    ...localState,
    profile: {
      ...profileObj,
      info_cache: { Default: sourceInfo },
      last_used: 'Default',
      last_active_profiles: ['Default'],
      profiles_order: ['Default'],
    },
  };
  fs.writeFileSync(
    path.join(targetRoot, 'Local State'),
    JSON.stringify(normalizedLocalState, null, 2),
    'utf8'
  );

  // 6. 标记 Preferences 干净退出，避免启动时弹出“是否恢复标签页”
  const targetPreferencesPath = path.join(targetProfileDir, 'Preferences');
  if (fs.existsSync(targetPreferencesPath)) {
    try {
      const prefs = JSON.parse(fs.readFileSync(targetPreferencesPath, 'utf8'));
      if (!prefs.profile || typeof prefs.profile !== 'object') prefs.profile = {};
      prefs.profile.exit_type = 'Normal';
      prefs.profile.exited_cleanly = true;
      if (prefs.session && typeof prefs.session === 'object') {
        prefs.session.restore_on_startup = 5;
        delete prefs.session.startup_urls;
        delete prefs.session.urls_to_restore_on_startup;
      }
      fs.writeFileSync(targetPreferencesPath, JSON.stringify(prefs, null, 2), 'utf8');
    } catch {
      // 忽略无法解析
    }
  }

  return {
    success: true,
    sourceDir: sourceProfileDir,
    sourceProfile: sourceProfileName,
    targetDir: targetRoot,
    message: `成功从系统 Chrome Profile (${sourceProfileName}) 同步登录态至「${channelId}」专用目录`,
  };
}
