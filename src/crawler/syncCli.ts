#!/usr/bin/env node
import { syncChromeProfile } from './profileSync';

async function main() {
  const channel = process.argv[2] || 'meituan';
  console.log(`[ProfileSync:CLI] 开始同步日常系统 Chrome 登录态至渠道「${channel}」...`);
  const result = syncChromeProfile({ channelId: channel });
  console.log(`[ProfileSync:CLI] 同步成功!`);
  console.log(`- 来源活跃 Profile: ${result.sourceProfile}`);
  console.log(`- 目标专用目录: ${result.targetDir}`);
  console.log(`- 状态信息: ${result.message}`);
}

main().catch((err) => {
  console.error('[ProfileSync:CLI:Fatal]', err instanceof Error ? err.message : err);
  process.exit(1);
});
