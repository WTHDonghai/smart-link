#!/usr/bin/env node
import {
  listChromeProfiles,
  resolveTargetProfile,
  syncChromeProfile,
  syncChromeSessionViaCDP,
} from './profileSync';

async function main() {
  const args = process.argv.slice(2);
  let channel = 'MEITUAN';
  let requestedProfile: string | undefined;
  let isListMode = false;
  let isCdpMode = false;
  let cdpPort = 9222;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list' || arg === '-l') {
      isListMode = true;
    } else if (arg.startsWith('--profile=')) {
      requestedProfile = arg.replace('--profile=', '').trim();
    } else if (arg === '--profile' || arg === '-p') {
      requestedProfile = args[++i]?.trim();
    } else if (arg === '--cdp') {
      isCdpMode = true;
    } else if (arg.startsWith('--port=')) {
      isCdpMode = true;
      const parsedPort = parseInt(arg.replace('--port=', ''), 10);
      if (!Number.isNaN(parsedPort) && parsedPort > 0) {
        cdpPort = parsedPort;
      }
    } else if (!arg.startsWith('--')) {
      channel = arg;
    }
  }

  const normalizedChannel = channel.toUpperCase();

  // 1. 列出本地所有可用 Chrome Profiles
  if (isListMode) {
    const profiles = listChromeProfiles();
    if (profiles.length === 0) {
      console.log('\n⚠️ 未找到任何本地 Chrome Profile。请确认 Chrome 已安装并运行过。\n');
      return;
    }
    console.log('\n╭─────────────────────────────────────────────────────────────────────────────╮');
    console.log('│  本地系统 Chrome Profiles 列表                                              │');
    console.log('╰─────────────────────────────────────────────────────────────────────────────╯');
    for (const p of profiles) {
      const activeTag = p.isActive ? ' [当前活跃 ⭐️]' : '            ';
      const emailStr = p.email ? ` (${p.email})` : '';
      console.log(`${activeTag} ${p.id.padEnd(12)} - ${p.name}${emailStr}`);
    }
    console.log('\n💡 切换与同步命令示例：');
    console.log('  npm run profile:sync -- --profile="7"              # 按数字序号指定 Profile 7');
    console.log('  npm run profile:sync -- --profile="Default"        # 指定 Default 主账号');
    console.log('  npm run profile:sync -- --profile="Spiderman"      # 按名称关键词匹配');
    console.log('  npm run profile:sync                               # 默认使用当前活跃 Profile\n');
    return;
  }

  // 2. CDP 调试端口模式（若用户显式指定了 --cdp）
  if (isCdpMode) {
    console.log(`[ProfileSync:CLI] 正在通过 CDP 调试端口 (${cdpPort}) 同步「${normalizedChannel}」登录态...`);
    const result = await syncChromeSessionViaCDP({
      channelCode: normalizedChannel,
      port: cdpPort,
    });
    console.log('\n✅ [ProfileSync:CLI] CDP 同步成功!');
    console.log(`- 来源: ${result.sourceProfile}`);
    console.log(`- 目标专用目录: ${result.targetDir}`);
    console.log(`- 状态信息: ${result.message}\n`);
    return;
  }

  // 3. 默认：白名单物理蒸馏同步（无需关闭日常 Chrome，无需开端口，100% 仅保留美团凭证）
  const allProfiles = listChromeProfiles();
  const matchedProfile = resolveTargetProfile(allProfiles, requestedProfile);

  if (requestedProfile && !matchedProfile) {
    const available = allProfiles.map((p) => `"${p.id}" (${p.name})`).join(', ');
    console.error(`\n❌ 未找到指定的 Chrome Profile: "${requestedProfile}"`);
    console.error(`可用 Profiles: [${available}]`);
    console.error(`可通过 npm run profile:sync -- --list 查看完整列表。\n`);
    process.exit(1);
  }

  const profileDisplayName = matchedProfile
    ? `${matchedProfile.id} (${matchedProfile.name})${matchedProfile.isActive ? ' [当前活跃]' : ''}`
    : '默认活跃 Profile';

  console.log(`[ProfileSync:CLI] 开始从 Chrome Profile「${profileDisplayName}」同步登录态至「${normalizedChannel}」...`);

  const result = syncChromeProfile({
    channelCode: normalizedChannel,
    customSourceProfile: matchedProfile?.id || requestedProfile,
  });

  console.log('\n✅ [ProfileSync:CLI] 同步成功!');
  console.log(`- 来源 Profile: ${result.sourceProfile}`);
  console.log(`- 目标专用目录: ${result.targetDir}`);
  console.log(`- 状态信息: ${result.message}`);
  console.log('💡 提示: 可通过 `npm run profile:sync -- --list` 查看所有可用 Profile，或使用 `--profile=<名称|序号>` 切换\n');
}

main().catch((err) => {
  console.error('\n❌ [ProfileSync:CLI:Error]\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
