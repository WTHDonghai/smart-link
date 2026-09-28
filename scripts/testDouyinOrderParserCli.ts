/**
 * 抖音订单列表接口（新订/取消）原始报文解析与校验 CLI 工具
 *
 * ============================================================================
 * 1. 背景与工程定位
 * ============================================================================
 * 本脚本专门用于验证与诊断 `src/crawler/duty/douyinOrderParsers.ts` 中的核心解析逻辑：
 * - `extractDouyinOrdersFromPayload`（深度提取完整 RawDouyinDutyOrder 领域模型）
 * - `parseDouyinOrderListResponse`（清洗为值守调度引擎消费的 DutyUnhandledOrderSummary）
 *
 * 遵循项目规范 (AGENTS.md):
 * - Fail-Fast 刚性约束：业务错误码 (code !== 0) 立即暴露，绝不隐式兜底降级。
 * - 真实诚实核验：核对单号、分转元换算、间夜推算、联系人多层兜底及取消单态判定。
 *
 * ============================================================================
 * 2. 真实样本资产化说明 (tests/fixtures/)
 * ============================================================================
 * 为保持与已有美团报文资产 (tests/fixtures/meituanRealOrder.json) 风格高度统一，
 * 本脚本直接与 tests/fixtures/ 下的脱敏生产报文打通：
 * - tests/fixtures/douyinRealBookOrderList.json:
 *     对应抖音商家后台「新订/变更」列表接口真实返回
 *     (/life/trade_view/v1/workbench/book/query/list)
 *     涵盖了抖音特色的「条目为 JSON 字符串」与「普通 JSON 对象」两种混用形态。
 * - tests/fixtures/douyinRealRefundOrderList.json:
 *     对应抖音商家后台「取消/退款」列表接口真实返回
 *     (/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list)
 *     包含售后单号 (after_sale_id) 与退款标记特征。
 *
 * ============================================================================
 * 3. 使用方式与常用命令
 * ============================================================================
 * 场景 A: 零参数直接校验默认真实基准样本 (新订列表):
 *    npm run duty:test-douyin-parser
 *    # 或者: npx vite-node scripts/testDouyinOrderParserCli.ts
 *
 * 场景 B: 校验真实退款/取消列表样本资产:
 *    npm run duty:test-douyin-parser -- tests/fixtures/douyinRealRefundOrderList.json --cancel
 *
 * 场景 C: 传入任意抓包工具导出的自定义 JSON 文件:
 *    npm run duty:test-douyin-parser -- /path/to/my_capture.json
 *
 * 场景 D: macOS 剪贴板快速管道验证 (无需存为文件，从 DevTools 复制即测):
 *    pbpaste | npm run duty:test-douyin-parser
 *
 * 场景 E: 打印完整对比明细与原始报文:
 *    npm run duty:test-douyin-parser -- --verbose
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  extractDouyinOrdersFromPayload,
  parseDouyinOrderListResponse,
} from '@/src/crawler/duty/channels/douyin/douyinOrderParsers';
import { DutyExecutionError } from '@/src/crawler/duty/dutyContracts';
import type { RawDouyinDutyOrder } from '@/src/crawler/duty/dutyContracts';

const DEFAULT_BOOK_FIXTURE_PATH = 'tests/fixtures/douyinRealBookOrderList.json';

interface CliOptions {
  filePath?: string;
  isCancel: boolean;
  verbose: boolean;
  summaryOnly: boolean;
  showHelp: boolean;
}

function printUsage() {
  console.log(`
================================================================================
🛠️  抖音订单列表解析校验 CLI (Douyin Duty Order Parser Diagnostic)
================================================================================

【用法说明】
  1. 默认运行内置新订样本:
     npx vite-node scripts/testDouyinOrderParserCli.ts

  2. 指定报文文件测试:
     npx vite-node scripts/testDouyinOrderParserCli.ts <filePath> [options]

  3. 标准输入 (stdin) 管道测试 (如 macOS pbpaste):
     pbpaste | npx vite-node scripts/testDouyinOrderParserCli.ts [options]

【命令行选项】
  --cancel, --refund     标记该报文来源于「取消/退款」列表 Tab (defaultIsCancel = true)
  --verbose, -v          打印第一条订单的完整字段前后对比与原始 JSON 报文
  --summary              仅输出值守调度引擎所需的待处理概要列表 (DutyUnhandledOrderSummary)
  --help, -h             显示帮助信息
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    isCancel: false,
    verbose: false,
    summaryOnly: false,
    showHelp: false,
  };

  for (const arg of args) {
    if (arg === '--cancel' || arg === '--refund') {
      options.isCancel = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--summary') {
      options.summaryOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      options.showHelp = true;
    } else if (!arg.startsWith('-') && !options.filePath) {
      options.filePath = arg;
    }
  }

  return options;
}

/**
 * 读取标准输入流全部内容 (如果存在管道数据)
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
  });
}

/**
 * 诊断与健康度检查：核查提取结果是否存在关键数据异常
 */
function performHealthDiagnostics(orders: RawDouyinDutyOrder[]) {
  console.log('\n🏥 [数据健康度体检诊断]');
  const issues: string[] = [];

  orders.forEach((o, idx) => {
    const prefix = `第 ${idx + 1} 单 (${o.orderId || '无单号'}):`;

    if (!o.orderId) {
      issues.push(`❌ ${prefix} 严重缺失主订单号 (orderId)！`);
    }
    if (!o.hotelId) {
      issues.push(`⚠️ ${prefix} 未能匹配到酒店标识 (hotelId/poi_life_account_id/poi_id)`);
    }
    if (!o.hotelName) {
      issues.push(`⚠️ ${prefix} 缺失酒店名称 (hotelName)`);
    }
    if (!o.roomName && !o.productName) {
      issues.push(`⚠️ ${prefix} 房型与产品名称皆为空`);
    }
    if (!o.checkInDate || !o.checkOutDate) {
      issues.push(`⚠️ ${prefix} 入住或离店日期未解析出来 (in: ${o.checkInDate}, out: ${o.checkOutDate})`);
    }
    if ((o.nights ?? 0) <= 0) {
      issues.push(`⚠️ ${prefix} 间夜数异常: ${o.nights}`);
    }
    if (o.totalAmount === undefined || o.totalAmount < 0) {
      issues.push(`⚠️ ${prefix} 订单总金额异常: ${o.totalAmount}`);
    }
    if (!o.contacts || o.contacts.length === 0) {
      issues.push(`⚠️ ${prefix} 未找到有效入住人或买家联系方式`);
    }
  });

  if (issues.length === 0) {
    console.log('  ✅ 所有订单关键字段提取完整，未发现结构性缺陷。');
  } else {
    for (const issue of issues) {
      console.log(`  ${issue}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.showHelp) {
    printUsage();
    process.exit(0);
  }

  let rawContent = '';
  let inputSourceDesc = '';

  // 1. 尝试从管道 stdin 读取
  const stdinContent = await readStdin();
  if (stdinContent) {
    rawContent = stdinContent;
    inputSourceDesc = '标准输入流 (stdin / 剪贴板管道)';
  } else if (options.filePath) {
    // 2. 从指定路径读取
    const fullPath = path.resolve(process.cwd(), options.filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ [错误] 找不到指定的报文文件: ${fullPath}`);
      process.exit(1);
    }
    rawContent = fs.readFileSync(fullPath, 'utf-8');
    inputSourceDesc = `自定义文件: ${fullPath}`;
  } else {
    // 3. 默认从资产目录 tests/fixtures/ 读取
    const defaultFixtureFullPath = path.resolve(process.cwd(), DEFAULT_BOOK_FIXTURE_PATH);
    if (!fs.existsSync(defaultFixtureFullPath)) {
      console.error(`❌ [错误] 默认样本资产文件缺失: ${defaultFixtureFullPath}`);
      process.exit(1);
    }
    rawContent = fs.readFileSync(defaultFixtureFullPath, 'utf-8');
    inputSourceDesc = `默认基准资产: ${DEFAULT_BOOK_FIXTURE_PATH} (抖音真实新订列表)`;
  }

  // 4. 解析 JSON Payload
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawContent);
  } catch (err) {
    console.error(`❌ [格式错误] 输入内容无法被解析为合法 JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`\n================================================================================`);
  console.log(`📥 [输入数据源] ${inputSourceDesc}`);
  console.log(`⚙️ [解析模式]   ${options.isCancel ? '⚠️ 取消/退款 Tab 模式 (defaultIsCancel = true)' : '📥 新订/变更 Tab 模式'}`);
  console.log(`================================================================================`);

  // 5. 执行解析 (遵循 Fail-Fast 原则)
  const startTime = performance.now();
  let extractedOrders: RawDouyinDutyOrder[] = [];

  try {
    extractedOrders = extractDouyinOrdersFromPayload(parsedPayload, options.isCancel);
  } catch (err) {
    if (err instanceof DutyExecutionError) {
      console.error(`\n🚨 [Fail-Fast 触发] 抖音解析器拦截到业务异常:`);
      console.error(`  错误码: [${err.errorCode}]`);
      console.error(`  原因:   ${err.message}`);
      console.error(`  重试性: ${err.retryable ? '可重试' : '不可重试 (硬错误)'}`);
    } else {
      console.error(`\n❌ [未捕获的解析错误]:`, err);
    }
    process.exit(1);
  }

  const durationMs = (performance.now() - startTime).toFixed(2);
  const dutySummaries = parseDouyinOrderListResponse(parsedPayload, options.isCancel);

  // 若指定 --summary，则专精输出调度引擎消费的摘要 JSON，方便管道消费
  if (options.summaryOnly) {
    console.log(JSON.stringify(dutySummaries, null, 2));
    process.exit(0);
  }

  // 6. 概览输出
  const cancelCount = extractedOrders.filter((o) => o.cancelOrder).length;
  const bookCount = extractedOrders.length - cancelCount;

  console.log(`\n📊 [解析统计概览]`);
  console.log(`  - 提取总单数:     ${extractedOrders.length} 单 (耗时: ${durationMs}ms)`);
  console.log(`  - 新订/变更单数:  ${bookCount} 单`);
  console.log(`  - 取消/退款单数:  ${cancelCount} 单`);

  if (extractedOrders.length === 0) {
    console.log(`\n⚠️ 未能从当前报文中提取到任何有效订单。请检查报文外层是否包含 data.data 结构。`);
    process.exit(0);
  }

  // 7. 结构化表格打印 (格式化高频业务字段)
  console.log(`\n📋 [核心字段提取对照表]`);
  const tableData = extractedOrders.map((o, idx) => ({
    序号: idx + 1,
    订单号: o.orderId,
    预约单号: o.bookId || '-',
    售后单号: o.afterSaleId || '-',
    酒店名称: o.hotelName ? (o.hotelName.length > 12 ? o.hotelName.slice(0, 11) + '…' : o.hotelName) : '-',
    房型: o.roomName ? (o.roomName.length > 8 ? o.roomName.slice(0, 7) + '…' : o.roomName) : '-',
    入住日期: o.checkInDate || '-',
    离店日期: o.checkOutDate || '-',
    间夜: `${o.nights ?? 1}晚 x ${o.quantity ?? 1}间`,
    '实付(元)': o.totalAmount !== undefined ? `¥${o.totalAmount.toFixed(2)}` : '-',
    联系人: o.contacts?.map((c) => `${c.name}${c.phone ? `(${c.phone})` : ''}`).join('、') || '-',
    类型: o.cancelOrder ? '🔴 取消' : '🟢 新订',
  }));
  console.table(tableData);

  // 8. 字段健康度自检
  performHealthDiagnostics(extractedOrders);

  // 9. 输出值守调度引擎消费的 DutyUnhandledOrderSummary
  console.log('\n🤖 [值守调度引擎摘要实体 (DutyUnhandledOrderSummary)]');
  console.log(JSON.stringify(dutySummaries, null, 2));

  // 10. 详细比对模式 (--verbose)
  if (options.verbose) {
    console.log('\n================================================================================');
    console.log('🔍 [详细模式: 第一单完整领域实体与原始数据比对]');
    console.log('================================================================================');
    const firstOrder = extractedOrders[0];
    const { raw: rawItem, ...cleanFields } = firstOrder;

    console.log('\n【清洗后 RawDouyinDutyOrder】:');
    console.log(JSON.stringify(cleanFields, null, 2));

    console.log('\n【对应原始抓包条目 (raw)】:');
    console.log(JSON.stringify(rawItem, null, 2));
  }
}

main().catch((err) => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
