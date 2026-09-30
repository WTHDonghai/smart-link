import fs from 'node:fs';
import path from 'node:path';
import {
  cleanChannelOrder,
  MEITUAN_RAW_SAMPLE_ORDER,
  DOUYIN_RAW_SAMPLE_ORDER,
} from '../src/services/protocols';
import { renderRemarkFromVariables } from '../src/utils/template/orderPayloadTransformer';

interface CliArgs {
  filePath?: string;
  channel?: 'MEITUAN' | 'DOUYIN';
  targetOrderId?: string;
  remark: string;
  template?: string;
  showHelp: boolean;
}

function printUsage() {
  console.log(`
================================================================================
🛠️  订单原始报文统一转换与入单测试 CLI (Order Protocol Normalizer Diagnostic)
================================================================================

【用法说明】
  1. 默认运行内置基准样本 (美团):
     npm run test:order-import
     # 或: npx vite-node scripts/testOrderImportCli.ts

  2. 传入自定义报文文件 (支持美团 / 抖音，自动识别渠道):
     npx vite-node scripts/testOrderImportCli.ts <filePath>
     
     # 例如测试抖音真实详情报文:
     npx vite-node scripts/testOrderImportCli.ts tests/fixtures/douyinRealOrderDetail.json

     # 例如测试美团真实详情报文:
     npx vite-node scripts/testOrderImportCli.ts tests/fixtures/meituanRealOrder.json

  3. 显式指定渠道或目标单号:
     npx vite-node scripts/testOrderImportCli.ts <filePath> --channel douyin
     npx vite-node scripts/testOrderImportCli.ts <filePath> --target 1112769276121338025

【命令行选项】
  -c, --channel <name>   显式指定渠道类型: meituan | douyin
  -t, --target <orderId> 指定目标订单号 (若报文中包含多笔订单或需指定单号)
  -r, --remark <text>    自定义入单备注（支持 Liquid / {变量} 模板语法）
  -p, --template <text>  自定义备注模板（同 --remark）
  -h, --help             显示帮助信息
`);
}

function parseCliArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    remark: '【自动入单】渠道无早，已由系统处理',
    showHelp: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      result.showHelp = true;
    } else if (arg === '-c' || arg === '--channel') {
      const val = args[++i]?.toUpperCase();
      if (val === 'MEITUAN' || val === 'DOUYIN') {
        result.channel = val;
      } else {
        console.error(`❌ [参数错误] 不支持的渠道: ${val}，目前仅支持: meituan | douyin`);
        process.exit(1);
      }
    } else if (arg === '-t' || arg === '--target') {
      result.targetOrderId = args[++i];
    } else if (arg === '-r' || arg === '--remark' || arg === '-p' || arg === '--template') {
      result.remark = args[++i] || result.remark;
      result.template = result.remark;
    } else if (!arg.startsWith('-') && !result.filePath) {
      result.filePath = arg;
    }
  }

  return result;
}

/**
 * 根据文件路径和报文特征自动推断渠道类型
 */
function detectChannel(payload: unknown, filePath?: string): 'MEITUAN' | 'DOUYIN' | null {
  if (filePath) {
    const lowerPath = filePath.toLowerCase();
    if (lowerPath.includes('douyin')) return 'DOUYIN';
    if (lowerPath.includes('meituan')) return 'MEITUAN';
  }

  if (payload && typeof payload === 'object') {
    const str = JSON.stringify(payload);
    // 抖音特征
    if (
      str.includes('book_detail_info') ||
      str.includes('poi_life_account_id') ||
      str.includes('workbench_hotel_book') ||
      str.includes('hotel_after_sale_record') ||
      str.includes('sale_product_info')
    ) {
      return 'DOUYIN';
    }
    // 美团特征
    if (
      str.includes('confirmOrderRoomList') ||
      str.includes('priceInfo') ||
      str.includes('partnerIncome') ||
      str.includes('meituan')
    ) {
      return 'MEITUAN';
    }
  }

  return null;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.showHelp) {
    printUsage();
    return;
  }

  let rawPayload: unknown;
  let resolvedChannel: 'MEITUAN' | 'DOUYIN' | null = options.channel || null;

  if (options.filePath) {
    const fullPath = path.resolve(process.cwd(), options.filePath);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ [错误] 文件不存在: ${fullPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    try {
      rawPayload = JSON.parse(content);
    } catch {
      console.error(`❌ [错误] 文件内容不是合法的 JSON 格式: ${fullPath}`);
      process.exit(1);
    }
    console.log(`✅ [输入] 成功读取报文文件: ${fullPath}`);

    if (!resolvedChannel) {
      resolvedChannel = detectChannel(rawPayload, options.filePath);
      if (resolvedChannel) {
        console.log(`🔍 [自动识别] 检测到渠道类型: ${resolvedChannel}`);
      } else {
        console.error('❌ [识别失败] 无法自动推断报文渠道类型，请通过 --channel meituan|douyin 显式指定');
        process.exit(1);
      }
    } else {
      console.log(`📌 [指定渠道] 当前使用显式指定渠道: ${resolvedChannel}`);
    }
  } else {
    resolvedChannel = resolvedChannel || 'MEITUAN';
    console.log(`ℹ️ [输入] 未指定报文路径，默认使用内置 ${resolvedChannel} 标准报文样本进行测试`);
    console.log(`💡 [提示] 你也可以指定自定义报文: npx vite-node scripts/testOrderImportCli.ts /path/to/order.json`);
    rawPayload = resolvedChannel === 'DOUYIN' ? DOUYIN_RAW_SAMPLE_ORDER : MEITUAN_RAW_SAMPLE_ORDER;
  }

  const order = cleanChannelOrder(resolvedChannel, rawPayload, null, options.targetOrderId);
  const vars = order.getTemplateVariables();

  // 若传入了模版或备注字符串，通过模板引擎动态求值渲染
  const templateSource = options.template || options.remark;
  const renderedRemark = renderRemarkFromVariables(vars, templateSource);
  const unified = order.toUnifiedOrder(renderedRemark);

  const { raw: _raw, data: _data, ...cleanVars } = vars;
  const { rawPayload: _ignoredRaw, ...cleanUnified } = unified;

  console.log('\n======================================================');
  console.log(`📌 1. [${resolvedChannel}] 模版变量 (Template Variables)`);
  console.log('======================================================');
  console.log(JSON.stringify(cleanVars, null, 2));

  console.log('\n======================================================');
  console.log(`🚀 2. [${resolvedChannel}] 最终导入中台实体 (UnifiedOrderProtocol)`);
  console.log('======================================================');
  console.log(JSON.stringify(cleanUnified, null, 2));
}

main().catch((err) => {
  console.error('❌ [解析失败]:', err);
  process.exit(1);
});
