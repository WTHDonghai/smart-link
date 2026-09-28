#!/usr/bin/env node
import { MeituanDutyRunner } from '../channels/meituan/meituanDutyRunner';
import { DouyinDutyRunner } from '../channels/douyin/douyinDutyRunner';
import { PROCESS_ENV_KEYS } from '@/src/types/env';
import { resolveChannelMeta } from '@/src/utils/channelMeta';

function parseArgs(argv: string[]) {
  const channelArg = argv.find((a) => a.startsWith('--channel=') || a === '-c');
  let channel = 'MEITUAN';
  if (channelArg) {
    if (channelArg.startsWith('--channel=')) {
      channel = channelArg.split('=')[1].toUpperCase();
    } else {
      const idx = argv.indexOf(channelArg);
      if (idx !== -1 && argv[idx + 1]) {
        channel = argv[idx + 1].toUpperCase();
      }
    }
  }

  const tabArg = argv.find((a) => a.startsWith('--tab='));
  let tab: 'book' | 'refund' | undefined;
  if (tabArg) {
    const val = tabArg.split('=')[1].toLowerCase();
    tab = val === 'refund' ? 'refund' : 'book';
  }

  return {
    channel,
    tab,
    headless: argv.includes('--headless'),
    waitManualClose: argv.includes('--wait-manual-close'),
    closeBrowser: argv.includes('--close-browser'),
  };
}

async function main() {
  const { channel, tab, headless, waitManualClose, closeBrowser } = parseArgs(process.argv.slice(2));
  const isDouyin = channel === 'DOUYIN' || channel === 'DY';
  const runner = isDouyin ? new DouyinDutyRunner() : new MeituanDutyRunner();
  const channelLabel = resolveChannelMeta(channel).name || channel;

  const tabDesc = isDouyin
    ? (tab === 'refund' ? '取消/退款 (refund)' : '新订/变更 (book，默认)')
    : '待确认订单 (新订与取消同屏展示)';

  console.log(`[DutyRefreshList:CLI] 启动${channelLabel}列表刷新测试 (Channel: ${channel}, Tab: ${tabDesc}, Headless: ${headless})...`);

  if (!isDouyin && tab) {
    console.log(`[DutyRefreshList:CLI] 提示: 美团后台的“新订”与“取消”订单位于同一个「待确认订单」Tab，无需且不依赖 --tab 参数。`);
  }

  process.env[PROCESS_ENV_KEYS.playwrightHeadless] = headless ? 'true' : 'false';

  try {
    await runner.start();
    try {
      const orders = isDouyin
        ? await (runner as DouyinDutyRunner).collectUnhandledOrders(tab || 'book')
        : await runner.collectUnhandledOrders();
      console.log(`[DutyRefreshList:CLI] ${channelLabel}订单列表接口已返回并通过业务解析。`);
      console.log(`[DutyRefreshList:CLI] 待处理订单数量: ${orders.length}`);
      console.log(JSON.stringify(orders, null, 2));
    } catch (error) {
      if (waitManualClose && typeof runner.waitForBrowserClose === 'function') {
        console.error('[DutyRefreshList:CLI] 执行失败；可继续检查页面，手动关闭浏览器窗口后退出。');
        await runner.waitForBrowserClose();
        await runner.stop();
      }
      console.error('[DutyRefreshList:CLI:Fatal]', error instanceof Error ? error.message : error);
      throw error;
    }

    if (waitManualClose && typeof runner.waitForBrowserClose === 'function') {
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
