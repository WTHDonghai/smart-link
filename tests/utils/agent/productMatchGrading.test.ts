import { describe, it, expect } from 'vitest';
import { gradeProductMapping } from '../../../src/utils/agent/productMatchGrading';
import type { ValidatedSelection } from '../../../src/utils/agent/productMatchValidation';
import type { CandidateOption } from '../../../src/types/agent';

const ROOM_TYPES: CandidateOption[] = [
  { code: 'DLX_K', name: '豪华大床房' },
  { code: 'DLX_K2', name: '豪华大床房' }, // 与 DLX_K 同名：歧义候选
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

const CANDIDATES = { roomTypes: ROOM_TYPES, rateCodes: RATE_CODES, reservationTypes: RESERVATION_TYPES };
const SNAPSHOT_ID = 'snap-1';

function selection(overrides?: Partial<ValidatedSelection>): ValidatedSelection {
  return {
    productKey: 'goods-1\u001freal-1',
    roomType: { code: 'TWN', confidence: 'high', reason: '物理房型名称一致' },
    rateCode: null,
    reservationType: null,
    ...overrides,
  };
}

describe('gradeProductMapping 字段级评级（代码裁决，非模型自评）', () => {
  it('code 为 null 的字段固定 undetermined 并保留模型给出的缺口原因', () => {
    const graded = gradeProductMapping(
      selection({
        rateCode: null,
        reservationType: null,
      }),
      CANDIDATES,
      SNAPSHOT_ID
    );

    expect(graded.rateCode).toEqual({
      selectedCode: null,
      grade: 'undetermined',
      reason: '模型未提供该字段结果',
      alternatives: [],
    });
    expect(graded.reservationType.selectedCode).toBeNull();
    expect(graded.overallGrade).toBe('undetermined');
    expect(graded.outcome).toBe('partial');
  });

  it('房型无歧义且模型 high 时允许 high', () => {
    const graded = gradeProductMapping(selection(), CANDIDATES, SNAPSHOT_ID);

    expect(graded.roomType.grade).toBe('high');
    expect(graded.roomType.selectedCode).toBe('TWN');
    expect(graded.outcome).toBe('partial');
    expect(graded.overallGrade).toBe('undetermined');
  });

  it('房型选中同名歧义候选时封顶 medium、记录 alternatives 并判为 conflict', () => {
    const graded = gradeProductMapping(
      selection({ roomType: { code: 'DLX_K', confidence: 'high', reason: '名称一致' } }),
      CANDIDATES,
      SNAPSHOT_ID
    );

    expect(graded.roomType.grade).toBe('medium');
    expect(graded.roomType.alternatives).toEqual(['DLX_K2']);
    expect(graded.outcome).toBe('conflict');
  });

  it('房价码/预订类型缺业务属性证据：模型 high 一律封顶 medium（首期规则）', () => {
    const graded = gradeProductMapping(
      selection({
        roomType: { code: 'TWN', confidence: 'high', reason: '物理房型名称一致' },
        rateCode: { code: 'STD', confidence: 'high', reason: '名称语义匹配' },
        reservationType: { code: 'OTA', confidence: 'high', reason: '渠道单语义' },
      }),
      CANDIDATES,
      SNAPSHOT_ID
    );

    expect(graded.roomType.grade).toBe('high');
    expect(graded.rateCode.grade).toBe('medium');
    expect(graded.reservationType.grade).toBe('medium');
    expect(graded.overallGrade).toBe('medium');
    expect(graded.outcome).toBe('matched');
  });

  it('低置信字段不自动选定：selectedCode 置空、弱候选进 alternatives（设计 6.6）', () => {
    const graded = gradeProductMapping(
      selection({
        roomType: { code: 'TWN', confidence: 'high', reason: '物理房型名称一致' },
        rateCode: { code: 'STD', confidence: 'low', reason: '弱名称相似' },
        reservationType: { code: 'OTA', confidence: 'medium', reason: '渠道语义' },
      }),
      CANDIDATES,
      SNAPSHOT_ID
    );

    // 低置信字段不得自动选定，仅保留候选与原因供人工核对
    expect(graded.rateCode).toEqual({
      selectedCode: null,
      grade: 'low',
      reason: '弱名称相似',
      alternatives: ['STD'],
    });
    // 其他字段不受影响，照常选定
    expect(graded.roomType.selectedCode).toBe('TWN');
    expect(graded.reservationType.selectedCode).toBe('OTA');
    expect(graded.overallGrade).toBe('low');
    // 低置信字段未选定：整条不再是 matched，而是部分匹配
    expect(graded.outcome).toBe('partial');
  });

  it('模型 low 自评原样保留，不得被抬高', () => {
    const graded = gradeProductMapping(
      selection({
        roomType: { code: 'TWN', confidence: 'high', reason: '物理房型名称一致' },
        rateCode: { code: 'STD', confidence: 'low', reason: '弱名称相似' },
        reservationType: { code: 'OTA', confidence: 'low', reason: '弱语义匹配' },
      }),
      CANDIDATES,
      SNAPSHOT_ID
    );

    expect(graded.rateCode.grade).toBe('low');
    expect(graded.rateCode.selectedCode).toBeNull();
    expect(graded.reservationType.grade).toBe('low');
    expect(graded.reservationType.selectedCode).toBeNull();
    expect(graded.overallGrade).toBe('low');
    // 仅房型选定：outcome 为 partial 而非 matched
    expect(graded.outcome).toBe('partial');
  });

  it('三项全部为 null 时 outcome=unmatched 且整条 undetermined', () => {
    const graded = gradeProductMapping(
      selection({ roomType: null, rateCode: null, reservationType: null }),
      CANDIDATES,
      SNAPSHOT_ID
    );

    expect(graded.outcome).toBe('unmatched');
    expect(graded.overallGrade).toBe('undetermined');
  });

  it('整条等级等于最弱字段（低置信字段不选定，outcome 降为 partial）', () => {
    const graded = gradeProductMapping(
      selection({
        roomType: { code: 'TWN', confidence: 'high', reason: '物理房型名称一致' },
        rateCode: { code: 'STD', confidence: 'low', reason: '弱匹配' },
        reservationType: { code: 'OTA', confidence: 'medium', reason: '渠道语义' },
      }),
      CANDIDATES,
      SNAPSHOT_ID
    );

    expect(graded.overallGrade).toBe('low');
    expect(graded.rateCode.selectedCode).toBeNull();
    expect(graded.rateCode.alternatives).toEqual(['STD']);
    expect(graded.outcome).toBe('partial');
    expect(graded.snapshotId).toBe(SNAPSHOT_ID);
  });
});
