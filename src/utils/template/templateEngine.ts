/**
 * 模板引擎编译器与渲染器 (Pure Template Engine)
 * 零外部依赖，严格 0% eval，支持条件分支与管道过滤器
 */

import { applyFilter } from './filters';
import {
  getNestedValue,
  evaluateCondition,
  validateExpression,
  tokenizeExpr,
} from './evaluator';

export interface ASTTextNode {
  type: 'TEXT';
  content: string;
}

export interface ASTVariableNode {
  type: 'VARIABLE';
  raw?: string;
  variableKey: string;
  filters: { name: string; arg?: string }[];
}

export interface ASTIfBlockNode {
  type: 'IF_BLOCK';
  condition: string;
  consequent: ASTNode[];
  alternate?: ASTNode[] | undefined;
}

export type ASTNode = ASTTextNode | ASTVariableNode | ASTIfBlockNode;

/**
 * 将模板分词并构建为抽象语法树 (AST)
 */
export function parseTemplate(template: string): ASTNode[] {
  let index = 0;
  const len = template.length;

  function parseBlock(): ASTNode[] {
    const nodes: ASTNode[] = [];

    while (index < len) {
      // 检查 {{#else}} 或 {{/if}} 终结标签
      if (template.startsWith('{{#else}}', index) || template.startsWith('{{/if}}', index)) {
        break;
      }

      // 1. 条件分支起始: {{#if ...}}
      if (template.startsWith('{{#if', index)) {
        const afterIfIdx = index + 5;
        const afterChar = template[afterIfIdx];
        if (
          afterChar === ' ' ||
          afterChar === '\t' ||
          afterChar === '\n' ||
          afterChar === '(' ||
          afterChar === '}' ||
          afterChar === undefined
        ) {
          const closeIdx = template.indexOf('}}', index);
          if (closeIdx === -1) {
            throw new Error(`[Template Compile Error] 未闭合的 {{#if 标签 (位置 ${index})`);
          }
          const condition = template.slice(afterIfIdx, closeIdx).trim();
          if (!condition) {
            throw new Error(`[Template Compile Error] {{#if}} 条件表达式不能为空 (位置 ${index})`);
          }
          try {
            validateExpression(condition);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`[Template Compile Error] 条件表达式语法错误: ${message}`);
          }
          index = closeIdx + 2;

          const consequent = parseBlock();

          let alternate: ASTNode[] | undefined = undefined;
          if (template.startsWith('{{#else}}', index)) {
            index += 9; // 跳过 {{#else}}
            alternate = parseBlock();
          }

          if (!template.startsWith('{{/if}}', index)) {
            throw new Error(`[Template Compile Error] {{#if ${condition}}} 缺少匹配的闭合标签 {{/if}}`);
          }
          index += 7; // 跳过 {{/if}}

          nodes.push({
            type: 'IF_BLOCK',
            condition,
            consequent,
            alternate,
          });
          continue;
        }
      }

      // 2. 双大括号变量与过滤器: {{ variable | filter }}
      if (template.startsWith('{{', index)) {
        const closeIdx = template.indexOf('}}', index);
        if (closeIdx === -1) {
          throw new Error(`[Template Compile Error] 未闭合的双大括号 {{ (位置 ${index})`);
        }
        const inner = template.slice(index + 2, closeIdx).trim();
        index = closeIdx + 2;

        const parts = inner.split('|').map((s) => s.trim());
        const variableKey = parts[0] ?? '';
        const filters = parts.slice(1).map((f) => {
          const colonIdx = f.indexOf(':');
          if (colonIdx !== -1) {
            const name = f.slice(0, colonIdx).trim();
            const rawArg = f.slice(colonIdx + 1).trim();
            // 去除引号如 'YYYY-MM-DD'
            const arg = rawArg.replace(/^['"]|['"]$/g, '');
            return { name, arg };
          }
          return { name: f };
        });

        nodes.push({
          type: 'VARIABLE',
          raw: `{{${inner}}}`,
          variableKey,
          filters,
        });
        continue;
      }

      // 3. 单大括号变量兼容模式: {variable} (用于与原系统平滑过渡)
      if (template[index] === '{' && template[index + 1] !== '{') {
        const closeIdx = template.indexOf('}', index);
        if (closeIdx !== -1 && !template.slice(index, closeIdx).includes('\n')) {
          const variableKey = template.slice(index + 1, closeIdx).trim();
          // 如果里面不含操作符且是常规标识符/中文
          if (variableKey && !/[#\/>=<!|]/.test(variableKey)) {
            nodes.push({
              type: 'VARIABLE',
              raw: `{${variableKey}}`,
              variableKey,
              filters: [],
            });
            index = closeIdx + 1;
            continue;
          }
        }
      }

      // 4. 普通文本节点提取
      let nextSpecial = len;
      const nextDouble = template.indexOf('{{', index);
      const nextSingle = template.indexOf('{', index);

      if (nextDouble !== -1) nextSpecial = Math.min(nextSpecial, nextDouble);
      if (nextSingle !== -1) nextSpecial = Math.min(nextSpecial, nextSingle);

      if (nextSpecial === index) {
        // 单个非变量的 '{'
        nodes.push({ type: 'TEXT', content: template[index] ?? '' });
        index++;
      } else {
        const textChunk = template.slice(index, nextSpecial);
        nodes.push({ type: 'TEXT', content: textChunk });
        index = nextSpecial;
      }
    }

    return nodes;
  }

  const ast = parseBlock();
  if (index < len) {
    const trailing = template.slice(index);
    throw new Error(`[Template Compile Error] 意外的多余闭合标签: ${trailing}`);
  }
  return ast;
}

/**
 * 递归求值渲染 AST 节点
 */
function renderNodes(nodes: ASTNode[], context: Record<string, unknown>): string {
  let result = '';

  for (const node of nodes) {
    if (node.type === 'TEXT') {
      result += node.content;
    } else if (node.type === 'VARIABLE') {
      // 空变量 key 直接跳过，避免输出 [object Object]
      if (!node.variableKey) {
        continue;
      }

      // 1. 尝试直接从 context 取值 (支持中文键或英文标识符)
      let val: unknown = undefined;
      if (Object.hasOwn(context, node.variableKey)) {
        val = context[node.variableKey];
      } else {
        // 2. 尝试深层安全点路径 (如 data.orderId)
        val = getNestedValue(context, node.variableKey);
      }

      // 3. 逐级执行过滤器管道
      if (node.filters && node.filters.length > 0) {
        for (const f of node.filters) {
          val = applyFilter(val, f.name, f.arg);
        }
      }

      if (val !== null && val !== undefined) {
        if (Array.isArray(val)) {
          result += val.filter((v) => v !== null && v !== undefined && v !== '').join('、');
        } else if (typeof val === 'object') {
          result += JSON.stringify(val);
        } else {
          result += String(val);
        }
      }
    } else if (node.type === 'IF_BLOCK') {
      const conditionPassed = evaluateCondition(node.condition, context);
      if (conditionPassed) {
        result += renderNodes(node.consequent, context);
      } else if (node.alternate) {
        result += renderNodes(node.alternate, context);
      }
    }
  }

  return result;
}

/**
 * 编译并渲染模板
 * @param template 模板源码
 * @param context 数据上下文
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  if (!template) return '';
  const ast = parseTemplate(template);
  return renderNodes(ast, context);
}

/**
 * 验证模板语法有效性
 */
export function validateTemplate(template: string): { valid: boolean; error?: string } {
  try {
    parseTemplate(template);
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}

export interface ExtractVariablesOptions {
  /**
   * 当遇到模板语法编译错误时，是否向外抛出异常。
   * 默认 false（尽力而为容错模式，专用于 UI 实时输入时的变量补全与提示，避免打字未闭合时报错崩溃）。
   * 若设为 true，则在语法解析异常时立即抛错，适用于严格模式流水线校验。
   */
  throwOnError?: boolean;
}

/**
 * 提取模板中引用的所有变量名（去重）
 *
 * 契约定位说明：
 * 本函数默认专用于前端 UI 模版编辑输入过程中的实时变量提示与智能自动补全（Best-effort for UI input）。
 * 在用户实时键入模板内容时（例如打字至一半尚未闭合双大括号 `{{` 或 `{{#if`），默认不中断输入流，返回当前已安全识别的变量或空列表；
 * 若传入 `options.throwOnError: true`，则进入严格校验模式，解析出错时向外显式抛出语法编译异常（Fail-Fast）。
 *
 * @param template 模板源码文本
 * @param options 可选配置项（如 throwOnError）
 * @returns 去重后的变量名列表
 */
export function extractTemplateVariables(
  template: string,
  options?: ExtractVariablesOptions
): string[] {
  try {
    const ast = parseTemplate(template);
    const vars = new Set<string>();

    const walk = (nodes: ASTNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'VARIABLE') {
          if (node.variableKey) {
            vars.add(node.variableKey);
          }
        } else if (node.type === 'IF_BLOCK') {
          if (node.condition) {
            try {
              const conditionTokens = tokenizeExpr(node.condition);
              for (const token of conditionTokens) {
                if (token.type === 'IDENTIFIER') {
                  vars.add(token.value);
                }
              }
            } catch (err) {
              if (options?.throwOnError) {
                throw err;
              }
            }
          }
          walk(node.consequent);
          if (node.alternate) walk(node.alternate);
        }
      }
    };

    walk(ast);
    return Array.from(vars);
  } catch (err) {
    if (options?.throwOnError) {
      throw err;
    }
    return [];
  }
}

