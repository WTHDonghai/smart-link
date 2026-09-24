import fs from 'node:fs';
import path from 'node:path';
import { cleanMeituanOrder, MEITUAN_RAW_SAMPLE_ORDER } from '../src/services/protocols/meituanProtocol';

/**
 * 订单原始报文导入测试 CLI 工具
 * 用法:
 * 1. 使用内置生产样本测试:
 *    npx vite-node scripts/testOrderImportCli.ts
 * 2. 传入自定义 JSON 文件测试:
 *    npx vite-node scripts/testOrderImportCli.ts path/to/your_order.json
 */
async function main() {
  const filePath = process.argv[2];
  let rawPayload: unknown;

  if (filePath) {
    const fullPath = path.resolve(process.cwd(), filePath);
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
  } else {
    console.log(`ℹ️ [输入] 未指定报文路径，默认使用内置美团标准报文样本进行测试`);
    console.log(`💡 [提示] 你也可以指定自定义报文文件: npx vite-node scripts/testOrderImportCli.ts /path/to/order.json`);
    rawPayload = MEITUAN_RAW_SAMPLE_ORDER;
  }

  const order = cleanMeituanOrder(rawPayload);
  const vars = order.getTemplateVariables();
  const unified = order.toUnifiedOrder('【自动入单】渠道无早，已由系统处理');

  const { raw: _raw, data: _data, ...cleanVars } = vars;
  const { rawPayload: _ignoredRaw, ...cleanUnified } = unified;

  console.log('\n======================================================');
  console.log('📌 1. 模版变量 (Template Variables)');
  console.log('======================================================');
  console.log(JSON.stringify(cleanVars, null, 2));

  console.log('\n======================================================');
  console.log('🚀 2. 最终导入中台实体 (UnifiedOrderProtocol)');
  console.log('======================================================');
  console.log(JSON.stringify(cleanUnified, null, 2));
}

main().catch((err) => {
  console.error('❌ [解析失败]:', err);
  process.exit(1);
});
