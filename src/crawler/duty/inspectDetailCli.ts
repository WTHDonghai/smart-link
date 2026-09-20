#!/usr/bin/env node
import { MeituanDutyRunner } from './meituanDutyRunner';
import { parseMeituanOrderDetailResponse } from './meituanOrderParsers';
import type { ExtractedOrderDetail } from './dutyContracts';
import { PROCESS_ENV_KEYS } from '../../types/env';
import { alignOrderToProtocol } from '../../utils/template/orderProtocolNormalizer';
import { fetchChannelRemarkTemplate } from '../../services/channelApi';
import { renderRemarkFromProtocol } from '../../utils/template/orderPayloadTransformer';

function parseArgs(argv: string[]) {
  let orderId: string | undefined;
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

  return {
    orderId,
    headless: argv.includes('--headless'),
    waitManualClose: argv.includes('--wait-manual-close'),
    closeBrowser: argv.includes('--close-browser'),
  };
}

async function main() {
  const { orderId: explicitOrderId, headless, waitManualClose, closeBrowser } = parseArgs(process.argv.slice(2));
  const runner = new MeituanDutyRunner();

  console.log(`[DutyInspectDetail:CLI] 启动美团订单详情抓取测试 (Headless: ${headless})...`);
  process.env[PROCESS_ENV_KEYS.playwrightHeadless] = headless ? 'true' : 'false';

  try {
    await runner.start();

    let targetOrderId = explicitOrderId;

    if (!targetOrderId) {
      console.log('[DutyInspectDetail:CLI] 未指定 --order-id，正在刷新待确认列表自动获取第一笔订单...');
      const orders = await runner.collectUnhandledOrders();
      if (!orders || orders.length === 0) {
        console.log('[DutyInspectDetail:CLI] 当前美团「待确认订单」列表中暂无待处理订单。');
        console.log('[DutyInspectDetail:CLI] 提示: 可通过 `npm run duty:inspect-detail -- --order-id <订单号>` 测试指定历史或测试订单。');
        if (waitManualClose) {
          console.log('[DutyInspectDetail:CLI] 可继续检查页面；手动关闭浏览器窗口后退出。');
          await runner.waitForBrowserClose();
          await runner.stop();
        }
        return;
      }
      targetOrderId = orders[0].orderId;
      console.log(`[DutyInspectDetail:CLI] 成功获取到 ${orders.length} 笔待确认订单，选择第 1 笔进行详情抓取: 「${targetOrderId}」`);
    }

    if (!targetOrderId) {
      console.error('[DutyInspectDetail:CLI] 未能获取到有效的订单号。');
      return;
    }

    try {
      console.log(`[DutyInspectDetail:CLI] 正在执行 inspectOrderDetail(otaOrderId: 「${targetOrderId}」)...`);
      const rawDetail = await runner.inspectOrderDetail(targetOrderId);
      const parsed = parseMeituanOrderDetailResponse(rawDetail, targetOrderId);
      if (!parsed) {
        throw new Error(`美团订单「${targetOrderId}」详情原始报文解析失败`);
      }
      const detail: ExtractedOrderDetail = {
        otaOrderId: parsed.otaOrderId || targetOrderId,
        otaChannel: 'MEITUAN',
        unitId: parsed.unitId,
        unitName: parsed.unitName,
        guestName: parsed.guestName || '',
        guestMobile: parsed.guestMobile || '',
        roomTypeName: parsed.roomTypeName || '',
        ratePlanName: parsed.ratePlanName || '',
        arrival: parsed.arrival || '',
        departure: parsed.departure || '',
        nights: parsed.nights || 1,
        quantity: parsed.quantity || 1,
        totalPrice: parsed.totalPrice ?? 0,
        remark: parsed.remark,
        raw: rawDetail,
      };

      // 3. 对齐统一订单协议并驱动模版引擎求值渲染备注
      const protocolData = alignOrderToProtocol(detail, detail.otaChannel);
      let template: string | null = null;
      try {
        const templateRes = await fetchChannelRemarkTemplate(protocolData.otaChannel);
        template = templateRes.remarkTemplate;
      } catch (tmplErr) {
        const errMsg = tmplErr instanceof Error ? tmplErr.message : String(tmplErr);
        console.warn(`[DutyInspectDetail:CLI] 未能拉取到渠道「${protocolData.otaChannel}」远程备注模板 (将使用原备注兜底): ${errMsg}`);
      }
      const renderedRemark = renderRemarkFromProtocol(protocolData, template);

      console.log('\n================ 美团订单详情提取结果 ================\n');
      console.log(`  OTA 渠道:      ${detail.otaChannel}`);
      console.log(`  美团订单号:    ${detail.otaOrderId}`);
      console.log(`  酒店名称:      ${detail.unitName || '-'}`);
      console.log(`  酒店 POI ID:   ${detail.unitId || '-'}`);
      console.log(`  入住客人姓名:  ${detail.guestName}`);
      console.log(`  联系电话:      ${detail.guestMobile || '(未提供或已脱敏)'}`);
      console.log(`  预订房型:      ${detail.roomTypeName}`);
      console.log(`  价格方案:      ${detail.ratePlanName || '-'}`);
      console.log(`  入住日期:      ${detail.arrival}`);
      console.log(`  离店日期:      ${detail.departure}`);
      console.log(`  入住间夜:      ${detail.nights} 晚 / ${detail.quantity || 1} 间`);
      console.log(`  订单总额:      ¥${detail.totalPrice}`);
      console.log(`  客人原始备注:  ${detail.remark || protocolData.rawRemark || '(无)'}`);
      console.log(`  渠道备注模版:  ${template ? `「${template}」` : '(未配置或未能获取，使用原备注兜底)'}`);
      console.log(`  模版渲染备注:  ${renderedRemark || '(空)'}`);
      console.log('\n======================================================\n');
      console.log('[DutyInspectDetail:CLI] 接口原始返回 JSON (已回写姓名):\n', JSON.stringify(rawDetail, null, 2));
      console.log('\n[DutyInspectDetail:CLI] 结构化详情 JSON:\n', JSON.stringify(detail, null, 2));
      console.log('\n[DutyInspectDetail:CLI] 最终提交入单备注 (Remark):\n', renderedRemark || '(空)');
    } catch (error) {
      if (waitManualClose) {
        console.error('[DutyInspectDetail:CLI] 执行失败；可继续检查页面，手动关闭浏览器窗口后退出。');
        await runner.waitForBrowserClose();
        await runner.stop();
      }
      console.error('[DutyInspectDetail:CLI:Fatal]', error instanceof Error ? error.message : error);
      throw error;
    }

    if (waitManualClose) {
      console.log('[DutyInspectDetail:CLI] 操作完成；可继续检查页面，手动关闭浏览器窗口后退出。');
      await runner.waitForBrowserClose();
      console.log('[DutyInspectDetail:CLI] 浏览器已手动关闭，正在清理会话。');
      await runner.stop();
    }
  } finally {
    if (closeBrowser) {
      await runner.stop();
    }
  }
}

main().catch((error) => {
  console.error('[DutyInspectDetail:CLI:Fatal]', error instanceof Error ? error.message : error);
  process.exit(1);
});
