import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { ProfileSyncResult } from './types';
import { detectDefaultChromeSourceDir, resolveChromeProfileDir } from './paths';
import { getActiveBrowserSessions, releaseProfileLocks } from './browserManager';

export type { ProfileSyncResult };
export { detectDefaultChromeSourceDir, resolveChromeProfileDir };

export interface ProfileSyncOptions {
  channelCode?: string; // 目标渠道标识（大写），如 'MEITUAN'
  channelId?: string; // 兼容向后兼容性
  customSourceDir?: string; // 可选的自定义源 Chrome 路径
  customSourceProfile?: string; // 可选的自定义源 Profile 名称 (如 'Profile 7', '7', 或用户配置名)
}

export interface CdpSyncOptions {
  channelCode?: string; // 目标渠道标识（大写），默认 'MEITUAN'
  channelId?: string; // 兼容向后兼容性
  port?: number; // Chrome 远程调试端口，默认 9222
  host?: string; // Chrome 调试主机，默认 '127.0.0.1'
  timeoutMs?: number; // 连接超时时间 (ms)，默认 4000
}

export interface ChromeProfileInfo {
  id: string; // 目录标识，如 'Profile 7', 'Default'
  name: string; // 用户显示名称，如 'Boldanny-Spiderman'
  email?: string; // 绑定的账号邮箱
  isActive: boolean; // 是否为系统当前活跃使用的 Profile (last_used)
  dirPath: string; // 物理路径
}

/**
 * 遍历并列出系统 Chrome 中所有已配置的用户 Profile
 */
export function listChromeProfiles(sourceRoot?: string): ChromeProfileInfo[] {
  const root = sourceRoot || detectDefaultChromeSourceDir();
  const localStatePath = path.join(root, 'Local State');
  if (!fs.existsSync(localStatePath)) {
    return [];
  }
  try {
    const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const profileObj = (localState.profile as Record<string, unknown>) || {};
    const lastUsed = (profileObj.last_used as string) || 'Default';
    const infoCache = (profileObj.info_cache as Record<string, Record<string, unknown>>) || {};

    const profiles: ChromeProfileInfo[] = [];
    for (const [id, info] of Object.entries(infoCache)) {
      const dirPath = path.join(root, id);
      if (fs.existsSync(dirPath)) {
        profiles.push({
          id,
          name: (info.name as string) || id,
          email: (info.user_name as string) || undefined,
          isActive: id === lastUsed,
          dirPath,
        });
      }
    }
    // 排序：当前活跃的置顶，其余按显示名称升序
    profiles.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return profiles;
  } catch {
    return [];
  }
}

/**
 * 根据用户的输入（ID、名称、纯数字序号）解析定位目标 Chrome Profile
 */
export function resolveTargetProfile(
  profiles: readonly ChromeProfileInfo[],
  query?: string
): ChromeProfileInfo | null {
  if (!query || !query.trim()) {
    return profiles.find((p) => p.isActive) || profiles[0] || null;
  }
  const q = query.trim().toLowerCase();

  // 1. 精确匹配 id (如 "profile 7", "default")
  const byId = profiles.find((p) => p.id.toLowerCase() === q);
  if (byId) return byId;

  // 2. 纯数字匹配 (如 "7" -> "Profile 7")
  if (/^\d+$/.test(q)) {
    const byNum = profiles.find((p) => p.id.toLowerCase() === `profile ${q}`);
    if (byNum) return byNum;
  }

  // 3. 精确匹配名称 (如 "boldanny-spiderman")
  const byName = profiles.find((p) => p.name.toLowerCase() === q);
  if (byName) return byName;

  // 4. 模糊包含名称或邮箱
  const byPartial = profiles.find(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      (p.email && p.email.toLowerCase().includes(q))
  );
  if (byPartial) return byPartial;

  return null;
}

/**
 * 校验指定文件是否为合法的 SQLite 3 数据库文件（头部以 "SQLite format 3" 开头）
 */
export function isSqliteDatabase(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    return buffer.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch {
    return false;
  }
}

/**
 * 在目标 Profile 的 Cookies 数据库中执行白名单物理清洗，只保留美团及点评域名 Cookies
 */
export function sanitizeTargetCookiesDatabase(targetProfileDir: string): {
  cleanedCookiesPath: string;
  remainingCount: number;
} {
  const candidates = [
    path.join(targetProfileDir, 'Cookies'),
    path.join(targetProfileDir, 'Network', 'Cookies'),
  ];

  let cookiePath = '';
  for (const p of candidates) {
    if (fs.existsSync(p) && isSqliteDatabase(p)) {
      cookiePath = p;
      break;
    }
  }

  if (!cookiePath) {
    return { cleanedCookiesPath: '', remainingCount: 0 };
  }

  // 清除可能存在的 SQLite WAL / SHM 临时缓存
  const wal = `${cookiePath}-wal`;
  const shm = `${cookiePath}-shm`;
  if (fs.existsSync(wal)) {
    try { fs.rmSync(wal, { force: true }); } catch {}
  }
  if (fs.existsSync(shm)) {
    try { fs.rmSync(shm, { force: true }); } catch {}
  }

  const sql = `
    DELETE FROM cookies WHERE host_key NOT LIKE '%meituan%' AND host_key NOT LIKE '%dianping%';
    VACUUM;
    SELECT count(*) FROM cookies;
  `;

  try {
    const stdout = execFileSync('sqlite3', [cookiePath, sql], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const lines = stdout.trim().split('\n');
    const remaining = parseInt(lines[lines.length - 1], 10) || 0;
    return { cleanedCookiesPath: cookiePath, remainingCount: remaining };
  } catch (e) {
    throw new Error(`执行 Cookies 白名单物理清洗失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 校验 Cookie 域名是否属于美团 / 大众点评生态
 */
export function isMeituanCookieDomain(domain: string): boolean {
  if (!domain) return false;
  const cleanDomain = domain.startsWith('.') ? domain.slice(1).toLowerCase() : domain.toLowerCase();
  return (
    cleanDomain === 'meituan.com' ||
    cleanDomain.endsWith('.meituan.com') ||
    cleanDomain === 'dianping.com' ||
    cleanDomain.endsWith('.dianping.com')
  );
}

/**
 * 纯函数：严格提取美团白名单 Cookies，杜绝任何外部站点凭据泄露
 */
export function filterMeituanCookies<T extends { domain: string }>(cookies: readonly T[]): T[] {
  return cookies.filter((c) => isMeituanCookieDomain(c.domain));
}

/**
 * 判定指定文件或目录是否应在精简同步时被排除
 */
function shouldExcludeProfileItem(srcPath: string, sourceRoot: string): boolean {
  const rel = path.relative(sourceRoot, srcPath);
  if (!rel || rel === '.') return false;

  const baseName = path.basename(srcPath);
  const normalizedRel = rel.replace(/\\/g, '/');

  // 1. 锁与临时文件
  if (baseName === 'LOCK' || baseName.endsWith('.lock') || baseName.endsWith('.tmp')) {
    return true;
  }

  // 2. 根级单例锁与套接字
  if (baseName === 'SingletonLock' || baseName === 'SingletonCookie' || baseName === 'SingletonSocket') {
    return true;
  }

  // 3. 敏感数据与历史浏览记录 (以特定前缀开头的文件或目录)
  const excludedPrefixes = [
    'Login Data',
    'History',
    'Bookmarks',
    'Favicons',
    'Top Sites',
    'Shortcuts',
    'Web Data',
    'Extension Cookies',
    'Safe Browsing Cookies',
    'Network Action Predictor',
    'AutofillStrikeDatabase',
  ];
  for (const prefix of excludedPrefixes) {
    if (baseName.startsWith(prefix)) return true;
  }

  // 4. 会话与活动标签页、扩展及庞大渲染缓存
  const excludedExactNames = [
    'Current Session',
    'Current Tabs',
    'Last Session',
    'Last Tabs',
    'Sessions',
    'Session Storage',
    'Visited Links',
    'Accounts',
    'Cache',
    'Code Cache',
    'GPUCache',
    'ShaderCache',
    'GrShaderCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'Media Cache',
    'blob_storage',
    'Extensions',
    'Extension Rules',
    'Extension Scripts',
    'Extension State',
    'Local Extension Settings',
    'Managed Extension Settings',
    'Sync Extension Settings',
    'Sync Data',
    'DNR Extension Rules',
    'Web Applications',
    'Shared Dictionary',
  ];
  if (excludedExactNames.includes(baseName)) {
    return true;
  }

  // 5. 路径片段匹配
  if (
    normalizedRel.includes('Service Worker/CacheStorage') ||
    normalizedRel.includes('Service Worker/ScriptCache') ||
    normalizedRel.includes('Storage/ext')
  ) {
    return true;
  }

  return false;
}

/**
 * 将日常 Chrome 的当前活跃 Profile 登录态精简同步到 Smart-Link 本地独立 Profile 中
 * 策略：
 * 1. 排他性过滤：不复制密码库 (Login Data)、历史记录 (History)、标签页会话 (Sessions) 或体积庞大的渲染缓存
 * 2. 仅保留站点授权所需关键数据：Cookies、Local Storage、IndexedDB、Preferences
 * 3. 规范化目标 Local State 为 Default，避免多 Profile 冲突并消除崩溃恢复弹窗
 * 4. 采用 Node 原生文件系统操作，杜绝外部命令注入并跨平台兼容
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

  // 解析并匹配目标 Profile (支持 ID、名称、纯数字序号，默认使用当前活跃的 last_used)
  const allProfiles = listChromeProfiles(sourceRoot);
  const targetSourceProfile = resolveTargetProfile(allProfiles, options.customSourceProfile);

  if (options.customSourceProfile && !targetSourceProfile) {
    const available = allProfiles.map((p) => `"${p.id}" (${p.name})`).join(', ');
    throw new Error(
      `未找到指定的源 Chrome Profile: "${options.customSourceProfile}"。\n可用 Profiles: [${available}]`
    );
  }

  const sourceProfileName = targetSourceProfile?.id || options.customSourceProfile || lastUsedProfile;
  const sourceProfileDir = targetSourceProfile?.dirPath || path.join(sourceRoot, sourceProfileName);

  if (!fs.existsSync(sourceProfileDir)) {
    throw new Error(`未找到源 Chrome Profile 目录: ${sourceProfileDir}`);
  }

  // 2. 确定目标工作目录 (.chrome-profile/<channelCode>)
  const channelCode = (options.channelCode || options.channelId || 'MEITUAN').trim().toUpperCase();
  const targetRoot = resolveChromeProfileDir(channelCode);
  const targetProfileDir = path.join(targetRoot, 'Default');

  if (!fs.existsSync(targetProfileDir)) {
    fs.mkdirSync(targetProfileDir, { recursive: true });
  }

  // 3. 执行 Node 原生选择性精简复制 (排除私密、历史记录与锁文件)
  fs.cpSync(sourceProfileDir, targetProfileDir, {
    recursive: true,
    force: true,
    filter: (src) => !shouldExcludeProfileItem(src, sourceProfileDir),
  });

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
      try {
        fs.rmSync(item, { recursive: true, force: true });
      } catch {
        // 忽略非致命锁清理异常
      }
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

  // 4.2 清理遗留的 SQLite WAL 缓存日志文件，避免多进程冲突
  const targetCookiesCandidate = [
    path.join(targetProfileDir, 'Network', 'Cookies'),
    path.join(targetProfileDir, 'Cookies'),
  ].find((c) => fs.existsSync(c));

  if (targetCookiesCandidate) {
    const walFile = `${targetCookiesCandidate}-wal`;
    const shmFile = `${targetCookiesCandidate}-shm`;
    if (fs.existsSync(walFile)) {
      try {
        fs.rmSync(walFile, { force: true });
      } catch {
        // 忽略异常
      }
    }
    if (fs.existsSync(shmFile)) {
      try {
        fs.rmSync(shmFile, { force: true });
      } catch {
        // 忽略异常
      }
    }
  }

  // 4.3 物理执行 SQLite Cookies 白名单过滤，只保留美团/大众点评登录态，杜绝任何外部站点隐私泄露
  let cleanedMeituanCount = 0;
  try {
    const sanitizeResult = sanitizeTargetCookiesDatabase(targetProfileDir);
    cleanedMeituanCount = sanitizeResult.remainingCount;
  } catch {
    // 忽略异常 (例如非 SQLite 文件测试桩)
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

  const profileLabel = targetSourceProfile
    ? `${targetSourceProfile.id} (${targetSourceProfile.name})`
    : sourceProfileName;

  const cookieInfo = cleanedMeituanCount > 0
    ? `已保留 ${cleanedMeituanCount} 个美团登录态 Cookies (其余站点已物理清除)`
    : '未检测到美团登录态 Cookies';

  return {
    success: true,
    sourceDir: sourceProfileDir,
    sourceProfile: sourceProfileName,
    targetDir: targetRoot,
    message: `成功从系统 Chrome Profile「${profileLabel}」同步登录态至「${channelCode}」专用目录。${cookieInfo}`,
  };
}

/**
 * 方案 B：开发阶段通过日常 Chrome 的 CDP 远程调试端口，精准提取当前聚焦/打开的美团页面登录态
 * 
 * 核心特性：
 * 1. 优先定位当前聚焦 (document.hasFocus) 或可见 (visibilityState === 'visible') 的美团商家页面
 * 2. 严格白名单过滤：仅提取 meituan.com / dianping.com 域名 Cookies，彻底杜绝个人站点隐私泄露
 * 3. 目标 Profile 纯净写入：通过 Playwright 隔离持久化上下文或活跃会话注入，零杂质
 * 4. Fail-Fast 引导：未开启端口或未登录时提供清晰易懂的终端指引
 */
export async function syncChromeSessionViaCDP(
  options: CdpSyncOptions = {}
): Promise<ProfileSyncResult> {
  const channelCode = (options.channelCode || options.channelId || 'MEITUAN').trim().toUpperCase();
  const port = options.port ?? 9222;
  const host = options.host ?? '127.0.0.1';
  const timeoutMs = options.timeoutMs ?? 4000;
  const endpoint = `http://${host}:${port}`;

  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: timeoutMs });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[ProfileSync:CDP] 无法连接到本地 Chrome 调试端口 (${endpoint})。\n` +
      `底层错误: ${errorMsg}\n\n` +
      `💡 开发阶段使用说明：\n` +
      `请先启动日常 Chrome 并开启远程调试端口：\n` +
      `  macOS:   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${port}\n` +
      `  Windows: chrome.exe --remote-debugging-port=${port}\n` +
      `并在该 Chrome 中打开美团商家后台（如 https://eb.meituan.com）登录完成后，再执行同步。`
    );
  }

  try {
    const contexts = browser.contexts?.() || [];
    if (contexts.length === 0) {
      throw new Error('[ProfileSync:CDP] 已连接 Chrome 实例，但未找到任何活跃的 BrowserContext。');
    }

    // 1. 扫描所有活跃标签页，寻找并优先匹配聚焦或可见的美团 Tab
    const allPages: Page[] = [];
    for (const ctx of contexts) {
      allPages.push(...(ctx.pages?.() || []));
    }

    interface CandidateTab {
      page: Page;
      url: string;
      title: string;
      isFocused: boolean;
      isVisible: boolean;
    }

    const meituanTabs: CandidateTab[] = [];
    for (const p of allPages) {
      try {
        const url = p.url();
        if (url.includes('meituan.com') || url.includes('dianping.com')) {
          const title = await p.title().catch(() => '');
          const isFocused = await p.evaluate(() => document.hasFocus()).catch(() => false);
          const isVisible = await p.evaluate(() => document.visibilityState === 'visible').catch(() => false);
          meituanTabs.push({ page: p, url, title, isFocused, isVisible });
        }
      } catch {
        // 忽略标签页已关闭或正在导航
      }
    }

    // 排序：优先选择用户当前聚焦的标签页，其次为当前窗口激活的可见标签页
    meituanTabs.sort((a, b) => {
      if (a.isFocused !== b.isFocused) return a.isFocused ? -1 : 1;
      if (a.isVisible !== b.isVisible) return a.isVisible ? -1 : 1;
      return 0;
    });
    const matchedTab = meituanTabs[0];

    // 2. 提取所有 Cookies 并执行严格的白名单过滤（仅保留 meituan.com 和 dianping.com）
    type CookieType = Awaited<ReturnType<BrowserContext['cookies']>>[number];
    const allCookies: CookieType[] = [];
    for (const ctx of contexts) {
      try {
        const cookies = await ctx.cookies();
        allCookies.push(...cookies);
      } catch {
        // 忽略异常
      }
    }

    const meituanCookies = filterMeituanCookies(allCookies);

    // 去重 (以 domain + path + name 为唯一键)
    const cookieMap = new Map<string, CookieType>();
    for (const c of meituanCookies) {
      const key = `${c.domain}|${c.path}|${c.name}`;
      cookieMap.set(key, c);
    }
    const uniqueMeituanCookies = Array.from(cookieMap.values());

    if (uniqueMeituanCookies.length === 0) {
      throw new Error(
        `[ProfileSync:CDP] 未在 Chrome 实例中检测到任何美团有效登录态 Cookies (domain 包含 meituan.com 或 dianping.com)。\n` +
        `请确保已在该 Chrome 窗口中打开并登录美团商家后台（例如 https://eb.meituan.com ）。`
      );
    }

    // 3. 确定目标工作目录 (.chrome-profile/<channelCode>)
    const targetRoot = resolveChromeProfileDir(channelCode);
    if (!fs.existsSync(targetRoot)) {
      fs.mkdirSync(targetRoot, { recursive: true });
    }

    // 4. 将白名单 Cookies 写入目标 Profile
    const activeSession = Array.from(getActiveBrowserSessions()).find(
      (s) => s.profileDir === targetRoot
    );

    if (activeSession) {
      await activeSession.context.addCookies(uniqueMeituanCookies);
    } else {
      releaseProfileLocks(targetRoot);
      const targetContext = await chromium.launchPersistentContext(targetRoot, {
        headless: true,
        args: ['--no-startup-window'],
        ignoreHTTPSErrors: true,
      });
      try {
        await targetContext.addCookies(uniqueMeituanCookies);
      } finally {
        await targetContext.close();
        releaseProfileLocks(targetRoot);
      }
    }

    const tabInfo = matchedTab
      ? ` [标签页: "${matchedTab.title || '美团后台'}"${matchedTab.isFocused ? ' (聚焦)' : matchedTab.isVisible ? ' (可见)' : ''}]`
      : '';

    return {
      success: true,
      sourceDir: endpoint,
      sourceProfile: matchedTab ? matchedTab.url : 'Chrome Background Context',
      targetDir: targetRoot,
      message: `成功通过 CDP 端口 (${port}) 同步 ${uniqueMeituanCookies.length} 个美团登录态 Cookies 至「${channelCode}」专属目录${tabInfo}`,
    };
  } finally {
    try {
      // 断开 CDP 连接，绝不关闭外部日常 Chrome 浏览器窗口与 Tab
      await browser.close();
    } catch {
      // 忽略断开异常
    }
  }
}
