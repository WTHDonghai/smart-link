/**
 * 产品映射模型提示词（版本化，设计 9.3：提示词固定部分通过版本定位）。
 *
 * 输出契约（模型必须返回的 JSON 结构）：
 * { "mappings": [ { "productRef": "P001",
 *     "roomType":         { "code": "DLX_K" | null, "confidence": "high|medium|low|undetermined", "reason": "..." },
 *     "rateCode":         { ... } | null,
 *     "reservationType":  { ... } | null } ] }
 *
 * confidence 仅为模型自评输入；最终等级由 productMatchGrading 的代码规则约束。
 */

import type {
  CandidateOption,
  MappingReferenceExample,
  ProductMappingSnapshot,
  SnapshotProduct,
} from '@/src/types/agent';
import type { ModelChatMessage } from '@/src/agent/agentModelClient';

export const PRODUCT_MAPPING_PROMPT_VERSION = 'product-mapping-v2';

const SYSTEM_INSTRUCTIONS = `你是酒店渠道产品映射助手。你的任务是把 OTA 渠道产品映射到 PMS（酒店管理系统）的房型、房价码与预订类型候选上。

必须遵守的规则：
1. 只能从本次输入给出的候选列表中选择编码；候选列表之外的编码一律禁止输出。
2. 每个产品必须且只能输出一条映射；三个字段分别给出 code（候选编码或 null）、confidence 与 reason。
3. 无法确定时必须输出 code 为 null，并在 reason 中说明缺少什么证据；绝不允许选一个"差不多的"编码凑齐。
4. reason 必须引用输入中真实存在的事实（名称、物理房型、编码）；禁止编造输入中没有的属性（如床型、早餐、面积）。
5. otaPayType 是 OTA 的付款方式，不是 PMS 预订类型；禁止仅凭付款方式推导预订类型。
6. 输入可能包含该酒店已完成的历史映射示例（referenceMappings，最多 10 条）：它们代表该酒店既往的映射习惯，可作为一致性参考（如同一物理房型既往对应的 PMS 编码）；但你的输出仍只能从本次候选列表的编码中选择，示例中不在候选列表内的编码禁止采用。
7. confidence 取值：high=有直接语义/属性证据且无歧义；medium=合理但缺一个影响业务的证据或存在近似候选；low=仅有弱名称相似；undetermined=无法判断。
8. 必须只返回一个 JSON 对象，不含任何解释文字或代码块标记。

输出 JSON 结构：
{"mappings":[{"productRef":"P001","roomType":{"code":"DLX_K","confidence":"high","reason":"物理房型名称一致"},"rateCode":{"code":null,"confidence":"undetermined","reason":"缺少早餐与取消条款证据"},"reservationType":{"code":"OTA","confidence":"medium","reason":"渠道单语义匹配，缺酒店确认规则"}}]}`;

/** 批内产品引用前缀（模型只处理短引用，复合键由代码侧维护） */
export const PRODUCT_REF_PREFIX = 'P';

export function buildProductRef(index: number): string {
  return `${PRODUCT_REF_PREFIX}${String(index + 1).padStart(3, '0')}`;
}

function serializeCandidates(label: string, options: CandidateOption[]): string {
  const list = options.map((option) => `${option.code}=${option.name}`).join('; ');
  return `${label}: ${list}`;
}

export interface MappingPromptPayload {
  products: Array<{ ref: string; product: SnapshotProduct }>;
  roomTypes: CandidateOption[];
  rateCodes: CandidateOption[];
  reservationTypes: CandidateOption[];
  /** 已完成映射的只读参考示例（可为空，设计 6.4） */
  referenceMappings: MappingReferenceExample[];
}

/** 构建一批产品的模型消息（system 指令 + user 结构化输入） */
export function buildProductMappingMessages(payload: MappingPromptPayload): ModelChatMessage[] {
  const productLines = payload.products.map(({ ref, product }) => {
    return {
      ref,
      productName: product.otaRoomTypeName,
      physicalRoomName: product.otaBasicRoomName,
      otaRateCodeId: product.otaRateCodeId || null,
      otaPayType: product.otaPayType || null,
    };
  });

  const userPayload = {
    products: productLines,
    ...(payload.referenceMappings.length > 0 ? { referenceMappings: payload.referenceMappings } : {}),
    roomTypes: payload.roomTypes,
    rateCodes: payload.rateCodes,
    reservationTypes: payload.reservationTypes,
  };

  return [
    { role: 'system', content: SYSTEM_INSTRUCTIONS },
    {
      role: 'user',
      content: `请对以下 OTA 产品逐条完成三项映射，返回规定结构的 JSON。\n${JSON.stringify(userPayload, null, 0)}`,
    },
  ];
}

/** 供追踪 payload 记录的脱敏摘要（不含完整候选，控制事件体积） */
export function describeSnapshotForTrace(snapshot: ProductMappingSnapshot): Record<string, unknown> {
  return {
    snapshotId: snapshot.snapshotId,
    collectionRunId: snapshot.collectionRunId,
    scope: `${snapshot.scope.hotelName}/${snapshot.scope.channelCode}/${snapshot.scope.extUnitCode}`,
    productCount: snapshot.products.length,
    referenceMappingCount: snapshot.referenceMappings?.length ?? 0,
    roomTypeCount: snapshot.roomTypes.length,
    rateCodeCount: snapshot.rateCodes.length,
    reservationTypeCount: snapshot.reservationTypes.length,
    promptVersion: PRODUCT_MAPPING_PROMPT_VERSION,
  };
}
