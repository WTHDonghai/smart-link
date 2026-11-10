import { describe, it, expect } from 'vitest';
import {
  validateModelBatchResponse,
  type RawModelBatchResponse,
} from '../../../src/utils/agent/productMatchValidation';
import { buildProductKey, type CandidateOption, type SnapshotProduct } from '../../../src/types/agent';

const ROOM_TYPES: CandidateOption[] = [
  { code: 'DLX_K', name: '豪华大床房' },
  { code: 'TWN', name: '双床房' },
];
const RATE_CODES: CandidateOption[] = [
  { code: 'ADV_BF2', name: '提前订含双早' },
  { code: 'STD', name: '标准价' },
];
const RESERVATION_TYPES: CandidateOption[] = [
  { code: 'OTA', name: '渠道预订' },
  { code: 'DIRECT', name: '直接预订' },
];

function buildProduct(index: number): SnapshotProduct {
  const otaRoomTypeId = `goods-${index}`;
  const otaBasicRoomId = `real-${index % 2}`;
  return {
    productKey: buildProductKey(otaRoomTypeId, otaBasicRoomId),
    otaRoomTypeId,
    otaRoomTypeName: `产品${index}`,
    otaBasicRoomId,
    otaBasicRoomName: index % 2 === 0 ? '豪华大床房' : '双床房',
    otaRateCodeId: '',
    otaPayType: 'PP',
  };
}

const PRODUCTS = [buildProduct(0), buildProduct(1)];
const REFS = ['P001', 'P002'];

const CANDIDATES = { roomTypes: ROOM_TYPES, rateCodes: RATE_CODES, reservationTypes: RESERVATION_TYPES };

function buildValidResponse(): RawModelBatchResponse {
  return {
    mappings: [
      {
        productRef: 'P001',
        roomType: { code: 'DLX_K', confidence: 'high', reason: '物理房型名称一致' },
        rateCode: { code: null, confidence: 'undetermined', reason: '缺少早餐证据' },
        reservationType: { code: 'OTA', confidence: 'medium', reason: '渠道单语义匹配' },
      },
      {
        productRef: 'P002',
        roomType: { code: 'TWN', confidence: 'high', reason: '物理房型名称一致' },
        rateCode: { code: 'STD', confidence: 'medium', reason: '名称语义匹配' },
        reservationType: null,
      },
    ],
  };
}

describe('validateModelBatchResponse 通过路径', () => {
  it('恰好覆盖本批全部产品且编码在候选内时通过', () => {
    const outcome = validateModelBatchResponse(buildValidResponse(), PRODUCTS, REFS, CANDIDATES);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.selections).toHaveLength(2);
    expect(outcome.selections[0]).toEqual({
      productKey: PRODUCTS[0].productKey,
      roomType: { code: 'DLX_K', confidence: 'high', reason: '物理房型名称一致' },
      rateCode: { code: '', confidence: 'undetermined', reason: '缺少早餐证据' },
      reservationType: { code: 'OTA', confidence: 'medium', reason: '渠道单语义匹配' },
    });
    expect(outcome.selections[1].reservationType).toBeNull();
  });
});

describe('validateModelBatchResponse 契约违规（批次 Fail-Fast）', () => {
  it('缺少 mappings 数组失败', () => {
    const outcome = validateModelBatchResponse({ foo: 1 }, PRODUCTS, REFS, CANDIDATES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('缺少 mappings 数组');
  });

  it('遗漏任一产品即失败并列明缺漏引用', () => {
    const partial = { mappings: [buildValidResponse().mappings[0]] };
    const outcome = validateModelBatchResponse(partial, PRODUCTS, REFS, CANDIDATES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('遗漏产品: P002');
  });

  it('同一产品重复输出失败', () => {
    const duplicated = {
      mappings: [buildValidResponse().mappings[0], buildValidResponse().mappings[0]],
    };
    const outcome = validateModelBatchResponse(duplicated, PRODUCTS, REFS, CANDIDATES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('重复输出');
  });

  it('批外产品引用失败', () => {
    const outOfRange = {
      mappings: [
        buildValidResponse().mappings[0],
        { productRef: 'P999', roomType: { code: 'DLX_K', confidence: 'high', reason: 'x' } },
      ],
    };
    const outcome = validateModelBatchResponse(outOfRange, PRODUCTS, REFS, CANDIDATES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('超出本批范围: P999');
  });

  it('候选外编码失败并列明编码值', () => {
    const forged = {
      mappings: [
        {
          productRef: 'P001',
          roomType: { code: 'NOT_EXIST', confidence: 'high', reason: '编造' },
        },
        buildValidResponse().mappings[1],
      ],
    };
    const outcome = validateModelBatchResponse(forged, PRODUCTS, REFS, CANDIDATES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('候选外编码: NOT_EXIST');
  });

  it('选定编码但缺少 reason 失败', () => {
    const noReason = {
      mappings: [
        { productRef: 'P001', roomType: { code: 'DLX_K', confidence: 'high', reason: '' } },
        buildValidResponse().mappings[1],
      ],
    };
    const outcome = validateModelBatchResponse(noReason, PRODUCTS, REFS, CANDIDATES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('缺少 reason');
  });

  it('confidence 越界失败', () => {
    const badConfidence = {
      mappings: [
        { productRef: 'P001', roomType: { code: 'DLX_K', confidence: 'certain', reason: 'x' } },
        buildValidResponse().mappings[1],
      ],
    };
    const outcome = validateModelBatchResponse(badConfidence, PRODUCTS, REFS, CANDIDATES);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('confidence 非法');
  });
});
