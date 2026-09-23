#!/usr/bin/env node
import { MeituanDutyRunner } from './meituanDutyRunner';
import { PROCESS_ENV_KEYS } from '../../types/env';
import { cleanChannelOrder } from '../../services/protocols';
import { remarkTemplateManager } from './remarkTemplateManager';
import { renderRemarkFromVariables } from '../../utils/template/orderPayloadTransformer';

function parseArgs(argv: string[]) {
  let orderId: string | undefined;
  let customTemplate: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--order-id' || arg === '--orderId') {
      orderId = argv[i + 1];
      i++;
    } else if (arg.startsWith('--order-id=')) {
      orderId = arg.split('=')[1];
    } else if (arg === '--template') {
      customTemplate = argv[i + 1];
      i++;
    } else if (arg.startsWith('--template=')) {
      customTemplate = arg.slice(arg.indexOf('=') + 1);
    } else if (!arg.startsWith('--') && !orderId) {
      orderId = arg;
    }
  }

  return {
    orderId,
    customTemplate,
    headless: argv.includes('--headless'),
    waitManualClose: argv.includes('--wait-manual-close'),
    closeBrowser: argv.includes('--close-browser'),
  };
}

async function main() {
  const {
    orderId: explicitOrderId,
    customTemplate,
    headless,
    waitManualClose,
    closeBrowser,
  } = parseArgs(process.argv.slice(2));
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
      const channelOrder = cleanChannelOrder('MEITUAN', rawDetail, null, targetOrderId);
      const tmplVars = channelOrder.getTemplateVariables();

      let remoteTemplate: string | null = null;
      try {
        remoteTemplate = await remarkTemplateManager.getTemplate(channelOrder.channelCode);
      } catch (tmplErr) {
        const errMsg = tmplErr instanceof Error ? tmplErr.message : String(tmplErr);
        console.warn(`[DutyInspectDetail:CLI] 未能拉取到渠道「${channelOrder.channelCode}」远程备注模板 (将使用原备注兜底): ${errMsg}`);
      }

      const rawRemark = String(
        rawDetail.remark ||
          (rawDetail.data as Record<string, unknown> | undefined)?.remark ||
          (rawDetail.data as Record<string, unknown> | undefined)?.memo ||
          ''
      );

      // 若指定了命令行 --template 则优先使用命令行测试模版，否则使用远程模版
      const effectiveTemplate = (customTemplate && customTemplate.trim()) ? customTemplate.trim() : remoteTemplate;
      const renderedRemark = renderRemarkFromVariables(tmplVars, effectiveTemplate, rawRemark);

      // 预先使用常用模版算出一个示例预览，帮助直观核对变量提取与渲染能力
      const sampleDemoTemplate = '{{入住人}} / 电话:{{联系电话}} / {{房型名称}} / {{间夜数}}';
      const sampleDemoRendered = renderRemarkFromVariables(tmplVars, sampleDemoTemplate, rawRemark);

      // 转换为统一订单导入协议 (UnifiedOrderProtocol)
      const unified = channelOrder.toUnifiedOrder(renderedRemark);

      console.log('\n================ 美团订单详情提取结果 ================\n');
      console.log(`  OTA 渠道:      ${unified.otaChannel}`);
      console.log(`  美团订单号:    ${unified.otaOrderId}`);
      console.log(`  酒店名称:      ${unified.unitName || '-'}`);
      console.log(`  酒店 POI ID:   ${unified.unitId || '-'}`);
      console.log(`  入住客人姓名:  ${unified.contact.name}`);
      console.log(`  联系电话:      ${unified.contact.mobile || '(未提供或已脱敏)'}`);
      console.log(`  预订房型:      ${unified.booking.roomTypeName}`);
      console.log(`  价格方案:      ${unified.booking.rateCode || '-'}`);
      console.log(`  入住日期:      ${unified.booking.arrival}`);
      console.log(`  离店日期:      ${unified.booking.departure}`);
      console.log(`  入住间夜:      ${unified.booking.nights} 晚 / ${unified.booking.quantity} 间`);
      console.log(`  订单总额:      ¥${unified.booking.totalPrice}`);
      console.log(`  客人原始备注:  ${rawRemark || '(客人下单未填备注)'}`);
      console.log(`  渠道远程模版:  ${remoteTemplate ? `「${remoteTemplate}」` : '(未配置渠道模版或CLI未连中台)'}`);
      if (customTemplate) {
        console.log(`  CLI指定模版:   「${customTemplate}」`);
      }
      console.log(`  最终生效模版:  ${effectiveTemplate ? `「${effectiveTemplate}」` : '(无模版，降级使用客人原始备注)'}`);
      console.log(`  模版渲染结果:  ${renderedRemark || '(空)'}`);
      console.log(`  示例模版求值:  ${sampleDemoRendered} (模版: ${sampleDemoTemplate})`);
      console.log('\n======================================================\n');
      console.log('\n[DutyInspectDetail:CLI] 接口原始返回 JSON (已回写姓名):\n', JSON.stringify(rawDetail, null, 2));
      console.log('\n[DutyInspectDetail:CLI] 统一订单协议 (UnifiedOrderProtocol) JSON:\n', JSON.stringify(unified, null, 2));
      console.log('\n[DutyInspectDetail:CLI] 最终提交入单备注 (Remark):\n', renderedRemark || '(空)');

      if (!renderedRemark) {
        console.log('\n[DutyInspectDetail:CLI:诊断提示] 最终入单备注为空的原因：');
        console.log('  1. 远程模版未配置或无法连接中台；');
        console.log('  2. 当前美团订单客人下单时未填写任何特殊需求 (原备注为空)；');
        console.log('  3. 可通过参数测试模版，例如: npm run duty:inspect-detail -- --template="{{入住人}} {{联系电话}} {{房型名称}}"');
      }
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
