import { spawn } from 'node:child_process';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import processEnvKeys from '../src/types/processEnvKeys.json' with { type: 'json' };
import rendererServerConfig from '../src/config/rendererServer.json' with { type: 'json' };

const rendererAssetServerUrl = rendererServerConfig.url;

export function probeHttpPort(url, timeoutMs = 400) {
  const target = new URL(url);

  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function settleRendererServerReadiness({
  url,
  probe = probeHttpPort,
  getFailure,
  attempts = 30,
  intervalMs = 500,
  settleMs = 50,
}) {
  let ready = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const failure = getFailure();
    if (failure) throw failure;
    if (await probe(url)) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (!ready) {
    throw new Error(`Electron 渲染层资源服务启动超时: ${url}`);
  }

  const immediateFailure = getFailure();
  if (immediateFailure) throw immediateFailure;

  await new Promise((resolve) => setTimeout(resolve, settleMs));

  const settledFailure = getFailure();
  if (settledFailure) throw settledFailure;
}

async function main() {
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  const npxCmd = isWindows ? 'npx.cmd' : 'npx';

  const args = process.argv.slice(2);
  let mode = process.env[processEnvKeys.mode] || 'development';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1].trim();
      break;
    }
  }

  process.env[processEnvKeys.mode] = mode;

  console.log(`[Smart-Link] 正在编译 Electron 主进程与预加载脚本 (模式: ${mode})...`);
  const buildProc = spawn(npmCmd, ['run', 'build:electron'], {
    stdio: 'inherit',
    shell: isWindows,
    env: process.env,
  });

  await new Promise((resolve, reject) => {
    buildProc.on('error', (error) => {
      reject(new Error(`无法启动 build:electron: ${error.message}`, { cause: error }));
    });
    buildProc.on('exit', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`build:electron 编译失败，退出码: ${code ?? 'unknown'}`));
    });
  });

  if (await probeHttpPort(rendererAssetServerUrl)) {
    throw new Error(`开发端口已被占用: ${rendererAssetServerUrl}`);
  }

  console.log(
    `[Smart-Link] 正在启动 Electron 渲染层资源服务 (${rendererAssetServerUrl}, mode: ${mode})...`
  );
  const viteArgs = [
    'vite',
    '--port',
    String(rendererServerConfig.port),
    '--host',
    rendererServerConfig.hostname,
    '--strictPort',
  ];
  if (mode && mode !== 'development') {
    viteArgs.push('--mode', mode);
  }

  const viteProcess = spawn(npxCmd, viteArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    env: process.env,
  });
  let electronProcess;

  const cleanup = () => {
    const isRunning = !viteProcess.killed && viteProcess.exitCode === null && viteProcess.signalCode === null;
    if (isRunning) {
      console.log('[Smart-Link] 关闭本地 Vite 后台服务...');
      try {
        viteProcess.kill('SIGTERM');
      } catch (error) {
        console.warn(
          `[Smart-Link] 停止渲染层资源服务失败: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  };

  viteProcess.stdout?.on('data', (data) => {
    const line = data.toString();
    if (line.includes('Local:') || line.includes('ready in')) {
      process.stdout.write(`[Vite] ${line}`);
    }
  });

  viteProcess.stderr?.on('data', (data) => {
    process.stderr.write(`[Vite Error] ${data.toString()}`);
  });

  let viteFailure;
  viteProcess.on('error', (error) => {
    viteFailure = new Error(`无法启动渲染层资源服务: ${error.message}`, { cause: error });
  });
  viteProcess.on('exit', (code, signal) => {
    viteFailure = new Error(
      `渲染层资源服务提前退出 (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`
    );

    if (electronProcess && electronProcess.exitCode === null && electronProcess.signalCode === null) {
      console.error(`[Smart-Link] ${viteFailure.message}`);
      electronProcess.kill('SIGTERM');
      cleanup();
      process.exit(1);
    }
  });

  try {
    await settleRendererServerReadiness({
      url: rendererAssetServerUrl,
      getFailure: () => viteFailure,
    });
  } catch (error) {
    if (viteProcess.exitCode === null && viteProcess.signalCode === null) {
      viteProcess.kill('SIGTERM');
    }
    throw error;
  }

  console.log('[Smart-Link] Electron 渲染层资源服务已就绪！');
  console.log('[Smart-Link] 正在启动 Electron 桌面应用窗口...');
  electronProcess = spawn(npxCmd, ['electron', '.'], {
    stdio: 'inherit',
    shell: isWindows,
    env: process.env,
  });

  electronProcess.on('error', (error) => {
    console.error(`[Smart-Link] 无法启动 Electron: ${error.message}`);
    cleanup();
    process.exit(1);
  });

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  electronProcess.on('exit', (code) => {
    if (code === null) {
      console.error('[Smart-Link] Electron 被信号终止，未收到正常退出码。');
      cleanup();
      process.exit(1);
    }

    cleanup();
    process.exit(code);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('[Smart-Link] 启动异常:', err);
    process.exit(1);
  });
}
