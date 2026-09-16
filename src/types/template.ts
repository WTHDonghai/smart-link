/**
 * 渠道模版与协议映射领域模型 (Channel Template & Protocol Domain Models)
 * 严格遵循 TypeScript 强类型规范，杜绝 any
 */

export type ProtocolFieldCategory =
  | 'basic'    // 基础信息 (单号、状态、下单时间)
  | 'hotel'    // 酒店与房型 (酒店名、房型名、间数)
  | 'date'     // 入离时间 (入住日期、离店日期、到店时间)
  | 'guest'    // 住客信息 (入住人、电话)
  | 'finance'  // 财务结算 (底价、售价、佣金、预结算)
  | 'rights'   // 权益服务 (早餐、延迟退房等特殊权益)
  | 'invoice'; // 发票信息 (是否开票、开票主体、税前参考额)

export type ProtocolFieldTransform =
  | 'none'          // 原始值直接输出
  | 'string'        // 显式字符串化
  | 'centsToYuan'   // 分转换为元 (保留2位小数，如 26555 -> 265.55)
  | 'date'          // 日期时间戳/格式清洗
  | 'boolean'       // 转为布尔值
  | 'maskPhone';    // 手机号脱敏

export interface ProtocolFieldMapping {
  /** 变量标识符 (英文唯一键)，如 'orderNo', 'floorPrice', 'needInvoice' */
  key: string;
  /** 中文业务展示名称，如 '美团单号', '结算底价' */
  label: string;
  /** 原始 JSON 取值路径，支持点号和数组索引，如 'data.orderId', 'data.floorPrice' */
  path: string;
  /** 所属业务分类 */
  category: ProtocolFieldCategory;
  /** 清洗转换管道 */
  transform: ProtocolFieldTransform;
  /** 可选：派生布尔条件表达式，如 'data.invoiceTagModel.invoiceParty == 3' */
  conditionExpr?: string;
  /** 字段描述与取值示例 */
  description?: string;
  /** 示例值 */
  sampleValue?: string;
  /** 是否启用（支持使用者自由裁剪与白名单控制） */
  enabled: boolean;
  /** 是否为核心必需字段（若缺失将触发 Fail-Fast 协议漂移报警） */
  required?: boolean;
}

export interface ChannelProtocolSchema {
  /** 渠道唯一标识，如 'meituan', 'douyin' */
  channelId: string;
  /** 渠道大写代码，如 'MEITUAN' */
  channelCode: string;
  /** 协议版本，如 '2026.09' */
  version: string;
  /** 协议更新时间 */
  updatedAt: string;
  /** 字段映射规则清单 */
  fields: ProtocolFieldMapping[];
}

/** 清洗提炼后的标准化业务订单上下文 (键值对映射，值统一归一化为可打印文本或布尔标记) */
export type CleanOrderContext = Record<
  string,
  string | number | boolean | null | undefined | Record<string, unknown>
>;

/** 协议漂移警报 (当原始报文中关键字段缺失时抛出) */
export interface ProtocolDriftWarning {
  channelCode: string;
  missingRequiredFields: string[];
  message: string;
  rawSampleSnippet: string;
}
