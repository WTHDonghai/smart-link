#!/usr/bin/env node
import { MeituanDutyRunner } from './meituanDutyRunner';
import { PROCESS_ENV_KEYS } from '../../types/env';

function parseArgs(argv: string[]) {
  return {
    headless: argv.includes('--headless'),
    waitManualClose: argv.includes('--wait-manual-close'),
    closeBrowser: argv.includes('--close-browser'),
  };
}

async function main() {
  const { headless, waitManualClose, closeBrowser } = parseArgs(process.argv.slice(2));
  const runner = new MeituanDutyRunner();

  console.log(`[DutyRefreshList:CLI] 启动美团列表刷新测试 (Headless: ${headless})...`);
  process.env[PROCESS_ENV_KEYS.playwrightHeadless] = headless ? 'true' : 'false';

  try {
    await runner.start();
    try {
      const orders = await runner.collectUnhandledOrders();
      console.log('[DutyRefreshList:CLI] 订单列表接口已返回并通过业务解析。');
      console.log(`[DutyRefreshList:CLI] 待确认订单数量: ${orders.length}`);
      console.log(JSON.stringify(orders, null, 2));
    } catch (error) {
      if (waitManualClose) {
        console.error('[DutyRefreshList:CLI] 执行失败；可继续检查页面，手动关闭浏览器窗口后退出。');
        await runner.waitForBrowserClose();
        await runner.stop();
      }
      console.error('[DutyRefreshList:CLI:Fatal]', error instanceof Error ? error.message : error);
      throw error;
    }

    if (waitManualClose) {
      console.log('[DutyRefreshList:CLI] 可继续检查页面；手动关闭浏览器窗口后退出。');
      await runner.waitForBrowserClose();
      console.log('[DutyRefreshList:CLI] 浏览器已手动关闭，正在清理会话。');
      await runner.stop();
    }
  } finally {
    if (closeBrowser) {
      await runner.stop();
    }
  }
}

main().catch((error) => {
  console.error('[DutyRefreshList:CLI:Fatal]', error instanceof Error ? error.message : error);
  process.exit(1);
});
