#!/usr/bin/env node
import { MeituanDutyRunner, humanDelay } from './meituanDutyRunner';
import { PROCESS_ENV_KEYS } from '../../types/env';
import { updateVisualTrackerStatus, visualClickLocator } from '../visualTracker';

interface CliOptions {
  orderId?: string;
  confirmNo: string;
  isDryRun: boolean;
  isSubmit: boolean;
  headless: boolean;
  waitManualClose: boolean;
  closeBrowser: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let orderId: string | undefined;
  let confirmNo = `TEST-PMS-${Date.now().toString().slice(-6)}`;
  let isDryRun = argv.includes('--dry-run');
  const isSubmit = argv.includes('--submit');

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--order-id' || arg === '--orderId') {
      orderId = argv[i + 1];
      i++;
    } else if (arg.startsWith('--order-id=')) {
      orderId = arg.split('=')[1];
    } else if (arg === '--confirm-no' || arg === '--confirmNo') {
      confirmNo = argv[i + 1];
      i++;
    } else if (arg.startsWith('--confirm-no=')) {
      confirmNo = arg.slice(arg.indexOf('=') + 1);
    } else if (!arg.startsWith('--') && !orderId) {
      orderId = arg;
    }
  }

  // 若未显式传入 --submit，则默认启用安全演练模式（Dry-Run）以防止意外提交生产订单
  if (!isSubmit && !isDryRun) {
    isDryRun = true;
  }

  return {
    orderId,
    confirmNo,
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
  console.log('       美团 E-booking 接单与确认号回填测试 CLI         ');
  console.log('======================================================');
  console.log(`  运行模式:     ${options.isSubmit ? '🔴 真实提交模式 (--submit)' : '🟢 安全演练模式 (--dry-run)'}`);
  console.log(`  测试确认号:   ${options.confirmNo}`);
  console.log(`  无头模式:     ${options.headless}`);
  console.log(`  保持窗口:     ${options.waitManualClose}`);
  console.log('======================================================\n');

  process.env[PROCESS_ENV_KEYS.playwrightHeadless] = options.headless ? 'true' : 'false';

  try {
    await runner.start();

    let targetOrderId = options.orderId;

    if (!targetOrderId) {
      console.log('[DutyConfirmImport:CLI] 未指定 --order-id，正在刷新待确认列表自动获取第 1 笔订单...');
      const orders = await runner.collectUnhandledOrders();
      if (!orders || orders.length === 0) {
        console.log('[DutyConfirmImport:CLI] ⚠️ 当前美团「待确认订单」列表中暂无订单。');
        console.log('[DutyConfirmImport:CLI] 提示: 您可通过 `npm run duty:confirm-import -- --order-id <订单号>` 指定订单。');
        if (options.waitManualClose) {
          console.log('[DutyConfirmImport:CLI] 浏览器保持开启；手动关闭浏览器窗口后退出。');
          await runner.waitForBrowserClose();
          await runner.stop();
        }
        return;
      }
      targetOrderId = orders[0].orderId;
      console.log(`[DutyConfirmImport:CLI] 成功获取到 ${orders.length} 笔待确认订单，选择第 1 笔: 「${targetOrderId}」`);
    }

    console.log(`\n[DutyConfirmImport:CLI] 目标订单号: 「${targetOrderId}」`);

    if (options.isDryRun) {
      console.log('[DutyConfirmImport:CLI] 🛡️ 正在以【安全演练模式 (Dry-Run)】执行回填验证...');
      const page = (runner as unknown as { getActivePage: (op: string) => import('playwright').Page }).getActivePage('确认号回填演练');
      const scope = (runner as unknown as { getOrderScope: (p: import('playwright').Page) => import('playwright').Page | import('playwright').FrameLocator }).getOrderScope(page);

      // 1. 定位订单卡片并展开详情
      console.log('[DutyConfirmImport:CLI] [1/5] 定位订单卡片...');
      let orderCard = await (runner as unknown as { locateOrderCard: (p: unknown, s: unknown, id: string) => Promise<import('playwright').Locator | null> }).locateOrderCard(page, scope, targetOrderId);
      if (!orderCard) {
        console.log('[DutyConfirmImport:CLI] 未直接找到卡片，尝试刷新列表...');
        await runner.refreshOrderList(page);
        await humanDelay(page, 1000, 2000);
        orderCard = await (runner as unknown as { locateOrderCard: (p: unknown, s: unknown, id: string) => Promise<import('playwright').Locator | null> }).locateOrderCard(page, scope, targetOrderId);
      }

      if (!orderCard || !await orderCard.isVisible({ timeout: 2000 }).catch(() => false)) {
        throw new Error(`未在页面上找到订单「${targetOrderId}」卡片`);
      }

      const isCurrentDetail = await scope.locator(`.detail-header:has-text("${targetOrderId}")`).first().isVisible({ timeout: 500 }).catch(() => false);
      if (!isCurrentDetail) {
        console.log('[DutyConfirmImport:CLI] 点击订单卡片激活右侧详情展示...');
        await visualClickLocator(page, orderCard, `点击订单「${targetOrderId}」卡片激活详情展示`);
        await humanDelay(page, 1000, 2000);
      }

      // 2. 定位详情头部「接受」接单操作按钮
      console.log('[DutyConfirmImport:CLI] [2/5] 定位「接受」接单操作按钮...');
      const acceptBtn = scope.locator(
        '.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受"), ' +
        '.detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受"), ' +
        '.btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受")'
      ).first();

      if (!await acceptBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        throw new Error(`订单「${targetOrderId}」详情头部未找到「接受」接单操作按钮`);
      }
      console.log('[DutyConfirmImport:CLI] ✅ 成功定位到「接受」按钮，正在点击以展开弹窗...');
      await visualClickLocator(page, acceptBtn, `点击订单「${targetOrderId}」接受按钮弹出确认回填框`);
      await humanDelay(page, 1000, 2000);

      // 3. 等待「确认号回填」模态弹窗就绪
      console.log('[DutyConfirmImport:CLI] [3/5] 验证「酒店确认号」模态对话框...');
      const dialog = scope.locator(
        '.mtd-modal-wrapper:not([style*="display: none"]) .modal-container:has-text("酒店确认号"), ' +
        '.modal-container:has-text("酒店确认号")'
      ).first();

      if (!await dialog.isVisible({ timeout: 2500 }).catch(() => false)) {
        throw new Error(`订单「${targetOrderId}」未弹出或未找到包含「酒店确认号」的接单模态弹窗`);
      }
      console.log('[DutyConfirmImport:CLI] ✅ 成功捕获到专属接单回填模态框容器！');

      // 4. 定位弹窗内部「酒店确认号」输入框并演练填入与读回
      console.log('[DutyConfirmImport:CLI] [4/5] 定位输入框并测试填入与读回校验...');
      const targetInput = dialog.locator(
        '.modal-container-content div:has(span:has-text("酒店确认号")) input.mtd-input, ' +
        '.modal-container-content input.mtd-input'
      ).first();

      if (!await targetInput.isVisible({ timeout: 1500 }).catch(() => false)) {
        throw new Error(`接单弹窗内未找到酒店确认号输入框`);
      }

      const existingValue = (await targetInput.inputValue().catch(() => '')).trim();
      console.log(`[DutyConfirmImport:CLI] 输入框当前值: "${existingValue || '(空)'}"`);

      await targetInput.fill(options.confirmNo);
      const readBack = (await targetInput.inputValue().catch(() => '')).trim();
      console.log(`[DutyConfirmImport:CLI] 模拟填入确认号: "${options.confirmNo}"`);
      console.log(`[DutyConfirmImport:CLI] 读回校验结果: "${readBack}"`);
      if (readBack !== options.confirmNo) {
        throw new Error(`读回校验失败: 写入「${options.confirmNo}」但读回为「${readBack}」`);
      }
      console.log('[DutyConfirmImport:CLI] ✅ 输入框定位与读回校验 100% 成功！');

      // 5. 定位底部的「确认接受」提交按钮并断言可见
      console.log('[DutyConfirmImport:CLI] [5/5] 验证弹窗底部「确认接受」提交按钮...');
      const dialogConfirmBtn = dialog.locator(
        '.modal-container-footer button.mtd-btn.btn-item.mtd-btn-primary:has-text("确认接受")'
      ).first();

      if (!await dialogConfirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        throw new Error(`接单弹窗底部未找到「确认接受」按钮`);
      }
      console.log('[DutyConfirmImport:CLI] ✅ 成功精确定位到「确认接受」主要操作按钮！');

      // 安全演练模式：点击「取消」按钮安全关闭模态框，绝不点击提交！
      console.log('\n[DutyConfirmImport:CLI] 🛑 【安全演练收尾】正在点击「取消」按钮关闭弹窗，确保不提交任何数据...');
      const cancelBtn = dialog.locator('.modal-container-footer button:has-text("取消"), .mtd-modal-close').first();
      if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await visualClickLocator(page, cancelBtn, '安全演练收尾：取消弹窗');
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(500);
      await updateVisualTrackerStatus(page, '✅ 确认号回填流程演练验证完毕，已安全关闭弹窗', 'success');
      console.log('\n======================================================');
      console.log('🎉 演练全流程验证成功！所有控件定位、回填与校验完全正确！');
      console.log('   （若需要在生产环境真实提交此订单，请加上 `--submit` 参数）');
      console.log('======================================================\n');
    } else {
      // 真实提交模式：调用 runner.confirmImport(options.confirmNo, targetOrderId)
      console.log('[DutyConfirmImport:CLI] ⚠️ 【真实提交模式】正在执行真实的接单与确认号回填提交...');
      await runner.confirmImport(options.confirmNo, targetOrderId);
      console.log('\n======================================================');
      console.log(`🎉 订单「${targetOrderId}」已成功提交确认号「${options.confirmNo}」并确认接单！`);
      console.log('======================================================\n');
    }

    if (options.waitManualClose) {
      console.log('[DutyConfirmImport:CLI] 操作完成；浏览器保持开启供您目视核对。手动关闭窗口后退出。');
      await runner.waitForBrowserClose();
      console.log('[DutyConfirmImport:CLI] 浏览器已手动关闭，正在清理会话。');
      await runner.stop();
    }
  } catch (error) {
    console.error('\n[DutyConfirmImport:CLI:Fatal 异常阻断]', error instanceof Error ? error.message : error);
    if (options.waitManualClose) {
      console.log('[DutyConfirmImport:CLI] 发生错误；窗口保持开启供现场排查。手动关闭浏览器即可退出。');
      await runner.waitForBrowserClose();
      await runner.stop();
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[DutyConfirmImport:CLI:Unhandled]', error instanceof Error ? error.message : error);
  process.exit(1);
});
