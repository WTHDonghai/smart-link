/**
 * 产品自动映射输入快照构建（渲染层纯函数，设计 6.1 步骤 5）。
 *
 * 职责：把采集合并后的产品、PMS 三类字典选项与作用域冻结为不可变 MappingInputSnapshot，
 * 交主进程结构校验与业务校验后执行模型映射。
 *
 * Fail-Fast：
 * - 三类字典任一为空即构建失败（当前字典请求失败与权威空列表在状态中不可区分，
 *   一律显式失败提示人工核对，绝不把空候选当作权威数据送入模型）；
 * - 不存在待映射产品时显式失败（不发起空 run）。
 */

import type {
  CandidateOption,
  ProductMappingSnapshot,
  ProductMappingScope,
  SnapshotProduct,
} from '@/src/types/agent';
import { buildProductKey, MAX_MAPPING_REFERENCE_EXAMPLES, type MappingReferenceExample } from '@/src/types/agent';
import { randomIdSuffix } from '@/src/utils/randomIdSuffix';
import type {
  ProductMapping,
  RatePlanOption,
  ReservationTypeOption,
  RoomTypeOption,
} from '@/src/types';

export type SnapshotBuildOutcome =
  | { ok: true; snapshot: ProductMappingSnapshot }
  | { ok: false; reason: string };

/** 一行产品是否存在缺失的映射字段（任一字段为空即需要映射，设计 6.1 步骤 6） */
export function hasIncompleteMapping(product: ProductMapping): boolean {
  return !(product.roomType?.trim() && product.rateCode?.trim() && product.payType?.trim());
}

function generateCollectionRunId(): string {
  return `coll-${Date.now().toString(36)}-${randomIdSuffix()}`;
}

function generateSnapshotId(): string {
  return `snap-${Date.now().toString(36)}-${randomIdSuffix()}`;
}

export interface BuildSnapshotInput {
  scope: ProductMappingScope;
  products: ProductMapping[];
  roomTypes: RoomTypeOption[];
  rateCodes: RatePlanOption[];
  reservationTypes: ReservationTypeOption[];
  /** 采集批次标识；直接采集触发时生成新 ID，重跑复用 */
  collectionRunId?: string;
}

export function buildProductMappingSnapshot(input: BuildSnapshotInput): SnapshotBuildOutcome {
  if (input.roomTypes.length === 0) {
    return { ok: false, reason: 'PMS 房型字典为空或加载失败，自动匹配已停止，请人工核对字典后重试' };
  }
  if (input.rateCodes.length === 0) {
    return { ok: false, reason: 'PMS 房价码字典为空或加载失败，自动匹配已停止，请人工核对字典后重试' };
  }
  if (input.reservationTypes.length === 0) {
    return { ok: false, reason: 'PMS 预订类型字典为空或加载失败，自动匹配已停止，请人工核对字典后重试' };
  }

  const pendingProducts = input.products.filter(hasIncompleteMapping);
  if (pendingProducts.length === 0) {
    return { ok: false, reason: '当前产品均已配置完整映射，无需自动匹配' };
  }

  const snapshotProducts: SnapshotProduct[] = pendingProducts.map((product) => ({
    productKey: buildProductKey(product.otaRoomTypeId, product.otaBasicRoomId || ''),
    otaRoomTypeId: product.otaRoomTypeId.trim(),
    otaRoomTypeName: product.otaRoomTypeName || product.otaProductName || product.otaRoomTypeId,
    otaBasicRoomId: (product.otaBasicRoomId || '').trim(),
    otaBasicRoomName: product.otaBasicRoomName || product.otaPhysicalRoomName || '',
    otaRateCodeId: product.otaRateCodeId || '',
    otaPayType: product.otaPayType || '',
  }));

  const roomTypeCandidates: CandidateOption[] = input.roomTypes.map((option) => ({
    code: option.code,
    name: option.name || option.code,
  }));
  const rateCodeCandidates: CandidateOption[] = input.rateCodes.map((option) => ({
    code: option.rateCode,
    name: option.rateName || option.rateCode,
  }));
  const reservationTypeCandidates: CandidateOption[] = input.reservationTypes.map((option) => ({
    code: option.code,
    name: option.label || option.code,
  }));

  // 已完成映射的前 MAX 条作为只读参考示例（设计 6.4）：仅供模型对齐既往习惯，不进入结果与回填
  const referenceMappings: MappingReferenceExample[] = input.products
    .filter((product) => !hasIncompleteMapping(product))
    .slice(0, MAX_MAPPING_REFERENCE_EXAMPLES)
    .map((product) => ({
      productName: product.otaRoomTypeName || product.otaProductName || product.otaRoomTypeId,
      physicalRoomName: product.otaBasicRoomName || product.otaPhysicalRoomName || '',
      otaRateCodeId: product.otaRateCodeId || '',
      otaPayType: product.otaPayType || '',
      roomType: product.roomType.trim(),
      rateCode: product.rateCode.trim(),
      payType: product.payType.trim(),
    }));

  return {
    ok: true,
    snapshot: {
      snapshotId: generateSnapshotId(),
      collectionRunId: input.collectionRunId || generateCollectionRunId(),
      capturedAt: new Date().toISOString(),
      scope: input.scope,
      products: snapshotProducts,
      ...(referenceMappings.length > 0 ? { referenceMappings } : {}),
      roomTypes: roomTypeCandidates,
      rateCodes: rateCodeCandidates,
      reservationTypes: reservationTypeCandidates,
    },
  };
}
