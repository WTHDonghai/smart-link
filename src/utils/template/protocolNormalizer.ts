/**
 * 渠道原始报文清洗与协议归一化器 (Protocol Normalizer)
 * 职责：接收庞杂的多层原始 JSON 报文，依据可配置的 Schema 裁剪出 10~15 个精炼的业务变量
 * 契约漂移探测 (Fail-Fast)
 */

import { ChannelProtocolSchema, CleanOrderContext, ProtocolDriftWarning } from '../../types/template';
import { getNestedValue, evaluateCondition } from './evaluator';
import { centsToYuan, formatDate, maskPhone } from './filters';

export class ProtocolNormalizationError extends Error {
  public warning: ProtocolDriftWarning;
  constructor(warning: ProtocolDriftWarning) {
    super(warning.message);
    this.name = 'ProtocolNormalizationError';
    this.warning = warning;
  }
}

/**
 * 将原始渠道报文清洗为标准订单上下文 (CleanOrderContext)
 * @param rawPayload 渠道原始报文 (如美团订单详情 JSON)
 * @param schema 渠道协议 Schema 配置
 * @returns 标准化键值对上下文
 */
export function normalizeOrderPayload(
  rawPayload: unknown,
  schema: ChannelProtocolSchema
): CleanOrderContext {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error(`[Protocol Error] 渠道「${schema.channelCode}」原始报文为空或非合法对象`);
  }

  const context: CleanOrderContext = {};
  const missingRequiredFields: string[] = [];

  // 保留原始 root / data 引用，允许高级表达式直接访问未配置的罕见字段
  const rawRecord = rawPayload as Record<string, unknown>;
  context['raw'] = rawRecord;
  if (rawRecord.data && typeof rawRecord.data === 'object') {
    context['data'] = rawRecord.data as Record<string, unknown>;
  }

  for (const field of schema.fields) {
    // 裁剪过滤：已停用的字段直接跳过
    if (!field.enabled) {
      continue;
    }

    // 1. 如果配置了条件表达式，直接计算布尔值并注入
    if (field.conditionExpr) {
      const boolVal = evaluateCondition(field.conditionExpr, rawRecord);
      context[field.key] = boolVal;
      context[field.label] = boolVal;
      continue;
    }

    // 2. 提取原始路径数据
    const rawVal = getNestedValue(rawRecord, field.path);

    // 3. 协议漂移契约检测 (Fail-Fast)
    if (field.required) {
      if (
        rawVal === undefined ||
        rawVal === null ||
        rawVal === '' ||
        (Array.isArray(rawVal) && rawVal.length === 0)
      ) {
        missingRequiredFields.push(`【${field.label}】(路径: ${field.path})`);
      }
    }

    // 4. 清洗转换管道
    let cleanedVal: string | number | boolean | null | undefined = undefined;

    if (rawVal === undefined || rawVal === null) {
      cleanedVal = '';
    } else if (Array.isArray(rawVal)) {
      // 针对通配符投影提取到的列表数据，自动批量清洗并以中文顿号拼接
      switch (field.transform) {
        case 'maskPhone':
          cleanedVal = rawVal.map(maskPhone).filter((v) => v !== '-').join('、');
          break;
        case 'centsToYuan':
          cleanedVal = rawVal.map((v) => centsToYuan(v as number | string)).join('、');
          break;
        case 'date':
          cleanedVal = rawVal.map((v) => formatDate(v as number | string, 'YYYY-MM-DD')).join('、');
          break;
        case 'boolean':
          cleanedVal = rawVal.length > 0;
          break;
        case 'string':
        case 'none':
        default:
          cleanedVal = rawVal
            .map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v).trim()))
            .filter((v) => v !== '')
            .join('、');
          break;
      }
    } else {
      switch (field.transform) {
        case 'centsToYuan':
          cleanedVal = centsToYuan(rawVal as number | string);
          break;
        case 'date':
          cleanedVal = formatDate(rawVal as number | string, 'YYYY-MM-DD');
          break;
        case 'maskPhone':
          cleanedVal = maskPhone(rawVal);
          break;
        case 'boolean':
          cleanedVal = Boolean(rawVal);
          break;
        case 'string':
          cleanedVal = String(rawVal);
          break;
        case 'none':
        default:
          cleanedVal = typeof rawVal === 'object' ? JSON.stringify(rawVal) : (rawVal as string | number | boolean);
          break;
      }
    }

    // 同时注入英文 key 和中文 label，兼顾开发与使用习惯
    context[field.key] = cleanedVal;
    context[field.label] = cleanedVal;
  }

  // 触发 Fail-Fast 报警
  if (missingRequiredFields.length > 0) {
    const warning: ProtocolDriftWarning = {
      channelCode: schema.channelCode,
      missingRequiredFields,
      message: `[协议漂移告警] 渠道「${schema.channelCode}」原始报文缺失关键字段：${missingRequiredFields.join(', ')}。请检查渠道协议或调整映射路径！`,
      rawSampleSnippet: JSON.stringify(rawPayload).slice(0, 300),
    };
    throw new ProtocolNormalizationError(warning);
  }

  return context;
}
