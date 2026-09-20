#!/usr/bin/env node
import { syncChromeSessionViaCDP } from './profileSync';

async function main() {
  const args = process.argv.slice(2);
  let channel = 'MEITUAN';
  let port = 9222;

  for (const arg of args) {
    if (arg.startsWith('--port=')) {
      const parsedPort = parseInt(arg.replace('--port=', ''), 10);
      if (!Number.isNaN(parsedPort) && parsedPort > 0) {
        port = parsedPort;
      }
    } else if (!arg.startsWith('--')) {
      channel = arg;
    }
  }

  const normalizedChannel = channel.toUpperCase();
  console.log(`[ProfileSync:CLI] 正在通过 CDP 调试端口 (${port}) 同步「${normalizedChannel}」登录态...`);

  const result = await syncChromeSessionViaCDP({
    channelCode: normalizedChannel,
    port,
  });

  console.log('\n✅ [ProfileSync:CLI] 同步成功!');
  console.log(`- 来源: ${result.sourceProfile}`);
  console.log(`- 目标专用目录: ${result.targetDir}`);
  console.log(`- 状态信息: ${result.message}\n`);
}

main().catch((err) => {
  console.error('\n❌ [ProfileSync:CLI:Error]\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
