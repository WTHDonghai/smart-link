#!/usr/bin/env node
import { hotelCollectionEngine } from './engine';

function parseArgs(argv: string[]) {
  const options = {
    channelCode: 'MEITUAN',
    headless: false,
    waitMs: 3000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--channel' || arg === '--channel-code') && argv[i + 1]) {
      options.channelCode = argv[++i].trim().toUpperCase();
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '--wait-ms' && argv[i + 1]) {
      options.waitMs = parseInt(argv[++i], 10) || 3000;
    }
  }
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[CLI] 启动渠道「${args.channelCode}」门店采集 (Headless: ${args.headless})...`);

  const result = await hotelCollectionEngine.collectHotels(
    {
      channelCode: args.channelCode,
      headless: args.headless,
      waitMs: args.waitMs,
    },
    (log) => {
      console.log(`[${log.level}] ${log.message}`);
    }
  );

  console.log('\n--- 采集结果 ---');
  console.log(`成功: ${result.success}`);
  console.log(`发现门店数: ${result.hotels.length}`);
  if (result.error) {
    console.error(`错误: ${result.error}`);
    process.exit(1);
  } else {
    console.log(JSON.stringify(result.hotels, null, 2));
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[CLI:Fatal]', err);
  process.exit(1);
});
