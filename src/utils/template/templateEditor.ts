/**
 * 模板编辑与语法辅助纯函数工具
 * 遵循 AGENTS.md 规范：无副作用纯函数，严禁 any，强类型约束
 */
import {
  validateTemplate,
  extractTemplateVariables,
} from './templateEngine';

export interface CursorInsertionResult {
  newText: string;
  nextCursorPos: number;
}

export interface TemplateSchemaField {
  key?: string;
  label?: string;
  enabled?: boolean;
}

/**
 * 在光标处或选中选区插入文本并计算下一个光标位置
 *
 * @param currentText 当前文本内容
 * @param textToInsert 待插入的文本
 * @param selectionStart 选区起点（若未传递或非数字则默认追加在末尾）
 * @param selectionEnd 选区终点（若未传递或非数字则默认追加在末尾）
 */
export function insertAtCursor(
  currentText: string,
  textToInsert: string,
  selectionStart?: number,
  selectionEnd?: number
): CursorInsertionResult {
  const len = currentText.length;
  let start = len;
  let end = len;

  if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
    let s = Math.max(0, Math.min(selectionStart, len));
    let e = Math.max(0, Math.min(selectionEnd, len));
    if (s > e) {
      [s, e] = [e, s];
    }
    start = s;
    end = e;
  } else if (typeof selectionStart === 'number') {
    start = Math.max(0, Math.min(selectionStart, len));
    end = start;
  }

  const newText = currentText.slice(0, start) + textToInsert + currentText.slice(end);
  const nextCursorPos = start + textToInsert.length;
  return { newText, nextCursorPos };
}

/**
 * 检测模板中未在当前 Schema 或上下文中定义的变量
 * 用于友好防错提示，不阻断保存
 *
 * @param template 模板文本
 * @param schemaFields 协议字段列表
 * @param cleanContext 已清洗的标准上下文数据
 * @returns 未识别的变量名列表
 */
export function detectUnknownVariables(
  template: string,
  schemaFields: TemplateSchemaField[],
  cleanContext: Record<string, unknown>
): string[] {
  const validation = validateTemplate(template);
  if (!validation.valid || !template.trim()) return [];

  const usedVars = extractTemplateVariables(template, { throwOnError: false });
  if (usedVars.length === 0) return [];

  const validSet = new Set<string>();

  for (const field of schemaFields) {
    if (field.enabled) {
      if (field.key) validSet.add(field.key);
      if (field.label) validSet.add(field.label);
    }
  }

  for (const key of Object.keys(cleanContext)) {
    validSet.add(key);
  }

  return usedVars.filter((v) => {
    if (validSet.has(v)) return false;
    // 截取点号前的 root 时剔除中括号及其内容，避免将合法的列表投影变量误报为未知变量
    const root = v.split('.')[0].replace(/\[.*\]/g, '');
    if (root && validSet.has(root)) return false;
    return true;
  });
}
