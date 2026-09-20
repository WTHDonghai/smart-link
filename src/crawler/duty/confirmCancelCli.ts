#!/usr/bin/env node
import { MeituanDutyRunner, humanDelay } from './meituanDutyRunner';
import { PROCESS_ENV_KEYS } from '../../types/env';
import { updateVisualTrackerStatus, visualClickLocator } from '../visualTracker';

interface CliOptions {
  orderId?: string;
  isDryRun: boolean;
  isSubmit: boolean;
  headless: boolean;
  waitManualClose: boolean;
  closeBrowser: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let orderId: string | undefined;
  let isDryRun = argv.includes('--dry-run');
  const isSubmit = argv.includes('--submit');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--order-id' || arg === '--orderId') {
      orderId = argv[i + 1];
      i++;
    } else if (arg.startsWith('--order-id=')) {
      orderId = arg.split('=')[1];
    } else if (!arg.startsWith('--') && !orderId) {
      orderId = arg;
    }
  }

  // 若未显式传入 --submit，则默认启用安全演练模式（Dry-Run）以防止意外确认真实取消订单
  if (!isSubmit && !isDryRun) {
    isDryRun = true;
  }

  return {
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
  const runner = new MeituanDutyRunner();

  console.log('\n======================================================');
  console.log('       美团 E-booking 取消确认（我已知晓）测试 CLI      ');
  console.log('======================================================');
  console.log(`  运行模式:     ${options.isSubmit ? '🔴 真实提交模式 (--submit)' : '🟢 安全演练模式 (--dry-run)'}`);
  console.log(`  无头模式:     ${options.headless}`);
  console.log(`  保持窗口:     ${options.waitManualClose}`);
  console.log('======================================================\n');

  process.env[PROCESS_ENV_KEYS.playwrightHeadless] = options.headless ? 'true' : 'false';

  try {
    await runner.start();

    let targetOrderId = options.orderId;

    if (!targetOrderId) {
      console.log('[DutyConfirmCancel:CLI] 未指定 --order-id，正在刷新待确认列表自动获取第 1 笔订单...');
      const orders = await runner.collectUnhandledOrders();
      if (!orders || orders.length === 0) {
        console.log('[DutyConfirmCancel:CLI] ⚠️ 当前美团「待确认订单」列表中暂无待处理订单。');
        console.log('[DutyConfirmCancel:CLI] 提示: 您可通过 `npm run duty:confirm-cancel -- --order-id <订单号>` 指定已取消的订单。');
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
      const page = (runner as unknown as { getActivePage: (op: string) => import('playwright').Page }).getActivePage('取消确认演练');
      const scope = (runner as unknown as { getOrderScope: (p: import('playwright').Page) => import('playwright').Page | import('playwright').FrameLocator }).getOrderScope(page);

      // 1. 定位订单卡片并激活详情
      console.log('[DutyConfirmCancel:CLI] [1/3] 定位订单卡片...');
      let orderCard = await (runner as unknown as { locateOrderCard: (p: unknown, s: unknown, id: string) => Promise<import('playwright').Locator | null> }).locateOrderCard(page, scope, targetOrderId);
      if (!orderCard) {
        console.log('[DutyConfirmCancel:CLI] 未直接找到卡片，尝试刷新列表...');
        await runner.refreshOrderList(page);
        await humanDelay(page, 500, 800);
        orderCard = await (runner as unknown as { locateOrderCard: (p: unknown, s: unknown, id: string) => Promise<import('playwright').Locator | null> }).locateOrderCard(page, scope, targetOrderId);
      }

      if (!orderCard || !await orderCard.isVisible({ timeout: 2000 }).catch(() => false)) {
        throw new Error(`未在页面上找到订单「${targetOrderId}」卡片`);
      }

      const isCurrentDetail = await scope.locator(`.detail-header:has-text("${targetOrderId}")`).first().isVisible({ timeout: 500 }).catch(() => false);
      if (!isCurrentDetail) {
        console.log('[DutyConfirmCancel:CLI] 点击订单卡片激活右侧详情展示...');
        await visualClickLocator(page, orderCard, `点击订单「${targetOrderId}」卡片激活详情展示`);
        await humanDelay(page, 400, 700);
      }

      // 2. 定位详情头部「我已知晓」取消确认操作按钮
      console.log('[DutyConfirmCancel:CLI] [2/3] 定位详情头部「我已知晓」按钮...');
      const ackBtn = scope.locator(
        '.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓"), ' +
        '.detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓"), ' +
        '.btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓")'
      ).first();

      if (!await ackBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        throw new Error(`订单「${targetOrderId}」详情头部未找到「我已知晓」操作按钮（请确认该订单是否为已取消订单）`);
      }
      console.log('[DutyConfirmCancel:CLI] ✅ 成功精确定位到「我已知晓」操作按钮！');

      // 3. 安全演练提示
      console.log('[DutyConfirmCancel:CLI] [3/3] 安全演练收尾...');
      await updateVisualTrackerStatus(page, '✅ 取消确认按钮定位验证完毕，演练模式未执行点击', 'success');
      console.log('\n======================================================');
      console.log('🎉 演练全流程验证成功！卡片激活与「我已知晓」按钮定位完全匹配！');
      console.log('   （若需要在生产环境真实点击「我已知晓」，请加上 `--submit` 参数）');
      console.log('======================================================\n');
    } else {
      // 真实提交模式：调用 runner.confirmCancel(targetOrderId)
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
