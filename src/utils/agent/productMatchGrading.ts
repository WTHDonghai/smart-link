/**
 * 映射结果评级（设计 6.6：模型给出的字段等级只是输入之一，最终等级由代码规则约束）。
 *
 * 首期确定性规则（P2 文档化约定，第二阶段再基于人工确认样本校准）：
 * - code 为 null 的字段等级固定 undetermined；
 * - roomType：物理房型名称一致 + 无同名歧义候选时允许 high；存在同名的其他候选时封顶 medium；
 * - rateCode / reservationType：首期 PMS 候选只有名称与编码（无早餐/取消条款/业务规则等属性证据），
 *   名称语义匹配最多 medium；模型自评 high 一律封顶 medium（缺业务证据不得给高）；
 * - 任一字段 reason 为空且 code 非空（防御：校验层已拦截，此处兜底封顶）封顶 medium；
 * - 低置信字段不自动选定：selectedCode 置空，模型弱候选进 alternatives 供人工核对（设计 6.6）；
 * - 整条等级 = 三个字段最弱者；outcome: conflict 优先于 matched/partial/unmatched。
 */

import type {
  CandidateOption,
  FieldMatch,
  MatchGrade,
  ProductAutoMapping,
} from '@/src/types/agent';
import type { ValidatedSelection } from './productMatchValidation';
import { gradeStrength } from './productMatchValidation';

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

interface FieldGradeInput {
  selection: ValidatedSelection['roomType'];
  candidates: CandidateOption[];
  /** 该字段是否具备给出 high 等级的业务证据（首期仅房型具备） */
  allowHigh: boolean;
}

function gradeField({ selection, candidates, allowHigh }: FieldGradeInput): FieldMatch {
  if (!selection || !selection.code) {
    return {
      selectedCode: null,
      grade: 'undetermined',
      reason: selection?.reason || '模型未提供该字段结果',
      alternatives: [],
    };
  }

  const selected = candidates.find((option) => option.code === selection.code);
  const selectedNormalizedName = selected ? normalizeName(selected.name) : '';
  const alternatives = selectedNormalizedName
    ? candidates
        .filter((option) => option.code !== selection.code && normalizeName(option.name) === selectedNormalizedName)
        .map((option) => option.code)
    : [];

  const modelGrade: MatchGrade =
    selection.confidence === 'high' || selection.confidence === 'medium' || selection.confidence === 'low'
      ? selection.confidence
      : 'medium';

  let grade = modelGrade;
  if (!allowHigh && gradeStrength(grade) > gradeStrength('medium')) {
    grade = 'medium';
  }
  if (alternatives.length > 0 && gradeStrength(grade) > gradeStrength('medium')) {
    grade = 'medium';
  }
  if (!selection.reason) {
    grade = gradeStrength(grade) > gradeStrength('medium') ? 'medium' : grade;
  }

  // 低置信不自动选定（设计 6.6）：置空 selectedCode，模型弱候选进 alternatives 供人工核对
  if (grade === 'low') {
    return {
      selectedCode: null,
      grade,
      reason: selection.reason,
      alternatives: [...new Set([selection.code, ...alternatives])],
    };
  }

  return {
    selectedCode: selection.code,
    grade,
    reason: selection.reason,
    alternatives,
  };
}

function minGrade(grades: MatchGrade[]): MatchGrade {
  return grades.reduce<MatchGrade>(
    (weakest, current) => (gradeStrength(current) < gradeStrength(weakest) ? current : weakest),
    'high'
  );
}

function resolveOutcome(fields: FieldMatch[]): ProductAutoMapping['outcome'] {
  if (fields.some((field) => field.selectedCode !== null && field.alternatives.length > 0)) {
    return 'conflict';
  }
  const selectedCount = fields.filter((field) => field.selectedCode !== null).length;
  if (selectedCount === fields.length) return 'matched';
  if (selectedCount === 0) return 'unmatched';
  return 'partial';
}

/** 将一条已通过契约校验的模型选择转换为最终映射结果（评级与 outcome 全部由代码裁决） */
export function gradeProductMapping(
  selection: ValidatedSelection,
  candidates: {
    roomTypes: CandidateOption[];
    rateCodes: CandidateOption[];
    reservationTypes: CandidateOption[];
  },
  snapshotId: string
): ProductAutoMapping {
  const roomType = gradeField({ selection: selection.roomType, candidates: candidates.roomTypes, allowHigh: true });
  const rateCode = gradeField({
    selection: selection.rateCode,
    candidates: candidates.rateCodes,
    allowHigh: false,
  });
  const reservationType = gradeField({
    selection: selection.reservationType,
    candidates: candidates.reservationTypes,
    allowHigh: false,
  });

  return {
    productKey: selection.productKey,
    snapshotId,
    roomType,
    rateCode,
    reservationType,
    outcome: resolveOutcome([roomType, rateCode, reservationType]),
    overallGrade: minGrade([roomType.grade, rateCode.grade, reservationType.grade]),
  };
}
