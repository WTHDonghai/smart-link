/**
 * 模型映射批次输出的业务校验（设计 6.5：schema 通过只是结构正确，不等于业务正确）。
 *
 * 校验规则全部为确定性纯函数：
 * - 本批产品恰好覆盖一次：不漏项、不重复、不出现批外引用；
 * - 非空编码必须存在于本次相应 PMS 候选集合；
 * - 选定编码必须携带 reason；
 * - confidence 必须为合法枚举。
 *
 * 任何违规使「对应批次」失败（Fail-Fast），绝不静默修正模型输出后继续。
 */

import type { CandidateOption, MatchGrade, SnapshotProduct } from '@/src/types/agent';
import { isRecord } from '@/src/utils/typeGuards';

export type RawFieldConfidence = 'high' | 'medium' | 'low' | 'undetermined';

export interface RawFieldSelection {
  code: string | null;
  confidence: RawFieldConfidence;
  reason: string;
}

export interface RawModelMapping {
  productRef: string;
  roomType?: RawFieldSelection | null;
  rateCode?: RawFieldSelection | null;
  reservationType?: RawFieldSelection | null;
}

export interface RawModelBatchResponse {
  mappings: RawModelMapping[];
}

export interface ValidatedFieldSelection {
  code: string;
  confidence: RawFieldConfidence;
  reason: string;
}

export interface ValidatedSelection {
  productKey: string;
  roomType: ValidatedFieldSelection | null;
  rateCode: ValidatedFieldSelection | null;
  reservationType: ValidatedFieldSelection | null;
}

export type BatchValidationOutcome =
  | { ok: true; selections: ValidatedSelection[] }
  | { ok: false; reason: string };

const VALID_GRADES: readonly RawFieldConfidence[] = ['high', 'medium', 'low', 'undetermined'];

function buildCandidateCodeSet(options: CandidateOption[]): Set<string> {
  return new Set(options.map((option) => option.code));
}

function parseField(
  value: unknown,
  fieldName: string,
  candidateCodes: Set<string>,
  productRef: string,
  errors: string[]
): ValidatedFieldSelection | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    errors.push(`${productRef}.${fieldName} 不是对象`);
    return null;
  }

  const code = value.code;
  if (code !== null && typeof code !== 'string') {
    errors.push(`${productRef}.${fieldName}.code 必须为字符串或 null`);
    return null;
  }

  const confidence = value.confidence;
  if (!VALID_GRADES.includes(confidence as RawFieldConfidence)) {
    errors.push(`${productRef}.${fieldName}.confidence 非法: ${String(confidence)}`);
    return null;
  }

  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  if (code !== null) {
    if (!reason) {
      errors.push(`${productRef}.${fieldName} 选定编码但缺少 reason`);
      return null;
    }
    if (!candidateCodes.has(code)) {
      errors.push(`${productRef}.${fieldName} 返回候选外编码: ${code}`);
      return null;
    }
  }

  return {
    code: code ?? '',
    confidence: confidence as RawFieldConfidence,
    reason,
  };
}

/**
 * 校验一批模型输出。productRefs 与 products 一一对应（由调用方按批内顺序构建）。
 */
export function validateModelBatchResponse(
  raw: unknown,
  batchProducts: SnapshotProduct[],
  batchRefs: string[],
  candidates: { roomTypes: CandidateOption[]; rateCodes: CandidateOption[]; reservationTypes: CandidateOption[] }
): BatchValidationOutcome {
  if (!isRecord(raw) || !Array.isArray(raw.mappings)) {
    return { ok: false, reason: '模型输出缺少 mappings 数组' };
  }

  const productsByRef = new Map<string, SnapshotProduct>();
  for (let i = 0; i < batchProducts.length; i++) {
    productsByRef.set(batchRefs[i], batchProducts[i]);
  }

  const roomTypeCodes = buildCandidateCodeSet(candidates.roomTypes);
  const rateCodeCodes = buildCandidateCodeSet(candidates.rateCodes);
  const reservationTypeCodes = buildCandidateCodeSet(candidates.reservationTypes);

  const errors: string[] = [];
  const selections: ValidatedSelection[] = [];
  const coveredRefs = new Set<string>();

  for (const item of raw.mappings) {
    if (!isRecord(item) || typeof item.productRef !== 'string') {
      errors.push('mappings 包含缺少 productRef 的条目');
      continue;
    }
    const productRef = item.productRef;
    const product = productsByRef.get(productRef);
    if (!product) {
      errors.push(`产品引用超出本批范围: ${productRef}`);
      continue;
    }
    if (coveredRefs.has(productRef)) {
      errors.push(`产品重复输出: ${productRef}`);
      continue;
    }
    coveredRefs.add(productRef);

    const roomType = parseField(item.roomType, 'roomType', roomTypeCodes, productRef, errors);
    const rateCode = parseField(item.rateCode, 'rateCode', rateCodeCodes, productRef, errors);
    const reservationType = parseField(
      item.reservationType,
      'reservationType',
      reservationTypeCodes,
      productRef,
      errors
    );

    if (errors.length > 0) break;

    selections.push({
      productKey: product.productKey,
      roomType,
      rateCode,
      reservationType,
    });
  }

  if (errors.length > 0) {
    return { ok: false, reason: `模型输出契约违规: ${errors.slice(0, 3).join('；')}` };
  }

  const missingRefs = batchRefs.filter((ref) => !coveredRefs.has(ref));
  if (missingRefs.length > 0) {
    return { ok: false, reason: `模型输出遗漏产品: ${missingRefs.slice(0, 5).join('、')}` };
  }

  return { ok: true, selections };
}

/** 评级辅助：字段置信枚举转等级强度（high 最强） */
export function gradeStrength(grade: MatchGrade): number {
  switch (grade) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}
