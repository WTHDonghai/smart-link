import { spawn } from 'node:child_process';
import http from 'node:http';

function checkHttpReady(urlStr = 'http://localhost:3000', timeoutMs = 400) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const req = http.get(
        {
          hostname: u.hostname,
          port: u.port || 80,
          path: '/',
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
    } catch {
      resolve(false);
    }
  });
}

async function main() {
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  const npxCmd = isWindows ? 'npx.cmd' : 'npx';

  // 1. 编译 Electron 主进程与预加载脚本
  console.log('[Smart-Link] 正在编译 Electron 主进程与预加载脚本...');
  const buildProc = spawn(npmCmd, ['run', 'build:electron'], {
    stdio: 'inherit',
    shell: isWindows,
  });

  await new Promise((resolve, reject) => {
    buildProc.on('exit', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`build:electron 编译失败，退出码: ${code}`));
    });
  });

  // 2. 检测本地 3000 端口是否已存在运行中的 Vite 服务
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
  const isAlreadyRunning = await checkHttpReady(devServerUrl);
  let viteProcess = null;

  if (!isAlreadyRunning) {
    console.log(`[Smart-Link] 正在启动 Vite 前端开发服务器 (${devServerUrl})...`);
    viteProcess = spawn(npmCmd, ['run', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows,
    });

    viteProcess.stdout?.on('data', (data) => {
      const line = data.toString();
      if (line.includes('Local:') || line.includes('ready in')) {
        process.stdout.write(`[Vite] ${line}`);
      }
    });

    viteProcess.stderr?.on('data', (data) => {
      process.stderr.write(`[Vite Error] ${data.toString()}`);
    });

    // 等待 Vite 服务就绪 (最多等待 15 秒)
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await checkHttpReady(devServerUrl)) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      console.warn('[Smart-Link] 等待 Vite 服务超时，将由 Electron 智能加载本地构建产物...');
    } else {
      console.log('[Smart-Link] Vite 开发服务器已就绪！');
    }
  } else {
    console.log(`[Smart-Link] 检测到已有 Vite 开发服务器在运行 (${devServerUrl})，复用当前服务。`);
  }

  // 3. 启动 Electron 桌面视窗
  console.log('[Smart-Link] 正在启动 Electron 桌面应用窗口...');
  const electronProcess = spawn(npxCmd, ['electron', '.'], {
    stdio: 'inherit',
    shell: isWindows,
  });

  const cleanup = () => {
    if (viteProcess && !viteProcess.killed) {
      console.log('[Smart-Link] 关闭本地 Vite 后台服务...');
      try {
        viteProcess.kill('SIGTERM');
      } catch {
        // 忽略
      }
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  electronProcess.on('exit', (code) => {
    cleanup();
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error('[Smart-Link] 启动异常:', err);
  process.exit(1);
});
