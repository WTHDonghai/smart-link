import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBuilderCli = path.join(rootDir, 'node_modules', 'electron-builder', 'cli.js');
const crossPlatformBuildAllowKey = 'SMARTLINK_ALLOW_CROSS_PLATFORM_WIN_DESKTOP_BUILD';

function targetsWindows(builderArgs) {
  return builderArgs.some((arg) => arg === '--win' || arg === '--windows' || arg === '-w');
}

function assertSupportedPackagingHost(builderArgs) {
  if (process.platform === 'win32' || !targetsWindows(builderArgs)) {
    return;
  }
  if (process.env[crossPlatformBuildAllowKey] === '1') {
    return;
  }

  throw new Error([
    'Windows 桌面包必须在 Windows 构建机或 Windows CI 上构建。',
    `如确需本机实验，请设置 ${crossPlatformBuildAllowKey}=1。`,
  ].join(' '));
}

function assertUpdateFeed(builderArgs) {
  if (builderArgs.includes('--dir') || process.env.SMARTLINK_UPDATE_FEED_URL?.trim()) {
    return;
  }

  throw new Error('正式发布包必须配置 SMARTLINK_UPDATE_FEED_URL，并指向 HTTPS 更新目录。');
}

const builderArgs = process.argv.slice(2);
assertSupportedPackagingHost(builderArgs);
assertUpdateFeed(builderArgs);

const child = spawn(process.execPath, [
  electronBuilderCli,
  '--config',
  path.join(rootDir, 'electron-builder.config.mjs'),
  ...builderArgs,
  '--publish',
  'never',
], {
  cwd: rootDir,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
