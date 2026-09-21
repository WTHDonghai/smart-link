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

const builderArgs = process.argv.slice(2);
assertSupportedPackagingHost(builderArgs);

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
