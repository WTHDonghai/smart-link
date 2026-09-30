#!/usr/bin/env node
import { MeituanDutyRunner } from '../channels/meituan/meituanDutyRunner';
import { DouyinDutyRunner } from '../channels/douyin/douyinDutyRunner';
import { DutyOrderStatus } from '../dutyTaskContext';
import { PROCESS_ENV_KEYS } from '@/src/types/env';

interface CliOptions {
  channel: 'meituan' | 'douyin';
  orderId?: string;
  isDryRun: boolean;
  isSubmit: boolean;
  headless: boolean;
  waitManualClose: boolean;
  closeBrowser: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let channel: 'meituan' | 'douyin' = 'meituan';
  let orderId: string | undefined;
  let isDryRun = argv.includes('--dry-run');
  const isSubmit = argv.includes('--submit');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--channel') {
      const ch = (argv[i + 1] || '').toLowerCase();
      channel = ch === 'douyin' ? 'douyin' : 'meituan';
      i++;
    } else if (arg.startsWith('--channel=')) {
      const ch = arg.split('=')[1]?.toLowerCase() || '';
      channel = ch === 'douyin' ? 'douyin' : 'meituan';
    } else if (arg === '--order-id' || arg === '--orderId') {
      orderId = argv[i + 1];
      i++;
    } else if (arg.startsWith('--order-id=')) {
      orderId = arg.split('=')[1];
    } else if (!arg.startsWith('--') && !orderId) {
      orderId = arg;
    }
  }

  // 若未显式传入渠道但单号以 DY 开头，自动推断为抖音
  if (channel === 'meituan' && orderId && /^DY/i.test(orderId)) {
    channel = 'douyin';
  }

  // 若未显式传入 --submit，则默认启用安全演练模式（Dry-Run）以防止意外确认真实取消订单
  if (!isSubmit && !isDryRun) {
    isDryRun = true;
  }

  return {
    channel,
    orderId,
    isDryRun,
    isSubmit,
    headless: argv.includes('--headless'),
    waitManualClose: argv.includes('--wait-manual-close') || !argv.includes('--close-browser'),
    closeBrowser: argv.includes('--close-browser'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const isDouyin = options.channel === 'douyin';
  const runner: MeituanDutyRunner | DouyinDutyRunner = isDouyin ? new DouyinDutyRunner() : new MeituanDutyRunner();

  console.log('\n======================================================');
  console.log(isDouyin ? '       抖音来客 取消确认（我知道了）测试 CLI      ' : '       美团 E-booking 取消确认（我已知晓）测试 CLI      ');
  console.log('======================================================');
  console.log(`  目标渠道:     ${isDouyin ? '抖音来客 (DOUYIN)' : '美团 (MEITUAN)'}`);
  console.log(`  运行模式:     ${options.isSubmit ? '🔴 真实提交模式 (--submit)' : '🟢 安全演练模式 (--dry-run)'}`);
  console.log(`  无头模式:     ${options.headless}`);
  console.log(`  保持窗口:     ${options.waitManualClose}`);
  console.log('======================================================\n');

  process.env[PROCESS_ENV_KEYS.playwrightHeadless] = options.headless ? 'true' : 'false';

  try {
    await runner.start();

    let targetOrderId = options.orderId;

    if (!targetOrderId) {
      console.log(`[DutyConfirmCancel:CLI] 未指定 --order-id，正在刷新${isDouyin ? '抖音' : '美团'}取消/退款列表自动获取第 1 笔订单...`);
      const orders = await runner.collectUnhandledOrders(DutyOrderStatus.CANCEL);
      if (!orders || orders.length === 0) {
        console.log(`[DutyConfirmCancel:CLI] ⚠️ 当前${isDouyin ? '抖音' : '美团'}「取消/退款」列表中暂无待处理订单。`);
        console.log(`[DutyConfirmCancel:CLI] 提示: 您可通过 \`npm run duty:confirm-cancel -- ${isDouyin ? '--channel douyin ' : ''}--order-id <订单号>\` 指定已取消的订单。`);
        if (options.waitManualClose) {
          console.log('[DutyConfirmCancel:CLI] 浏览器保持开启；手动关闭浏览器窗口后退出。');
          await runner.waitForBrowserClose();
          await runner.stop();
        }
        return;
      }
      targetOrderId = orders[0].orderId;
      console.log(`[DutyConfirmCancel:CLI] 成功获取到 ${orders.length} 笔订单，选择第 1 笔: 「${targetOrderId}」`);
    }

    console.log(`\n[DutyConfirmCancel:CLI] 目标订单号: 「${targetOrderId}」`);

    if (options.isDryRun) {
      console.log('[DutyConfirmCancel:CLI] 🛡️ 正在以【安全演练模式 (Dry-Run)】执行定位验证...');
      const verification = await runner.confirmCancel(targetOrderId, { dryRun: true });
      console.log('\n======================================================');
      console.log('🎉 演练全流程验证成功！卡片激活与「我已知晓」按钮定位完全匹配！');
      console.log(`  验证步骤: ${verification.verifiedSteps.join(' -> ')}`);
      console.log('   （若需要在生产环境真实点击「我已知晓」，请加上 `--submit` 参数）');
      console.log('======================================================\n');
    } else {
      console.log('[DutyConfirmCancel:CLI] ⚠️ 【真实提交模式】正在执行真实的「我已知晓」点击提交...');
      await runner.confirmCancel(targetOrderId);
      console.log('\n======================================================');
      console.log(`🎉 订单「${targetOrderId}」已成功点击「我已知晓」完成取消确认！`);
      console.log('======================================================\n');
    }

    if (options.waitManualClose) {
      console.log('[DutyConfirmCancel:CLI] 操作完成；浏览器保持开启供您目视核对。手动关闭窗口后退出。');
      await runner.waitForBrowserClose();
      console.log('[DutyConfirmCancel:CLI] 浏览器已手动关闭，正在清理会话。');
      await runner.stop();
    }
  } catch (error) {
    console.error('\n[DutyConfirmCancel:CLI:Fatal 异常阻断]', error instanceof Error ? error.message : error);
    if (options.waitManualClose) {
      console.log('[DutyConfirmCancel:CLI] 发生错误；窗口保持开启供现场排查。手动关闭浏览器即可退出。');
      await runner.waitForBrowserClose();
      await runner.stop();
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[DutyConfirmCancel:CLI:Unhandled]', error instanceof Error ? error.message : error);
  process.exit(1);
});
