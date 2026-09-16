/**
 * 安全属性导航与纯 AST 表达式求值器 (Safe Evaluator)
 * 严格 0% eval / new Function，避免任何安全拦截与注入风险
 * Fail-Fast 异常捕获机制
 */

/**
 * 安全属性深度导航 (支持类似 "data.guests[0].name" 或 "a.b.c")
 */
export function getNestedValue(target: unknown, path: string): unknown {
  if (target === null || target === undefined) return undefined;
  const trimmed = path.trim();
  if (!trimmed) return target;

  // 将 array index 格式如 a[0].b 转换为统一的 a.0.b，将 a[*].b 或 a[].b 转换为 a.*.b
  const normalizedPath = trimmed
    .replace(/\[\*\]/g, '.*')
    .replace(/\[\]/g, '.*')
    .replace(/\[(\w+)\]/g, '.$1')
    .replace(/^\./, '');

  const segments = normalizedPath.split('.');
  let current: unknown = target;

  for (let i = 0; i < segments.length; i++) {
    if (current === null || current === undefined) {
      return undefined;
    }

    const seg = segments[i];

    // 处理通配符数组投影 [*]
    if (seg === '*') {
      if (!Array.isArray(current)) {
        return undefined;
      }
      const remainingPath = segments.slice(i + 1).join('.');
      if (!remainingPath) {
        // 如果通配符在末尾，如 data.rightsNames.*，过滤空值并返回数组
        return current.filter((item) => item !== undefined && item !== null && item !== '');
      }
      // 对当前数组中的每个元素递归提取剩余路径
      const projected: unknown[] = [];
      for (const item of current) {
        const itemVal = getNestedValue(item, remainingPath);
        if (itemVal !== undefined && itemVal !== null && itemVal !== '') {
          if (Array.isArray(itemVal)) {
            projected.push(...itemVal);
          } else {
            projected.push(itemVal);
          }
        }
      }
      return projected;
    }

    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * 表达式 Token 类型
 */
type TokenType =
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'NULL'
  | 'IDENTIFIER'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'NOT';

interface Token {
  type: TokenType;
  value: string;
  raw: string;
}

/**
 * 表达式词法分词器
 */
function tokenizeExpr(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const char = expr[i];

    // 忽略空白
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // 括号
    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(', raw: '(' });
      i++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')', raw: ')' });
      i++;
      continue;
    }

    // 字符串字面量 '...' 或 "..."
    if (char === "'" || char === '"') {
      const quote = char;
      let strVal = '';
      i++; // 跳过起始引号
      while (i < len && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < len) {
          strVal += expr[i + 1];
          i += 2;
        } else {
          strVal += expr[i];
          i++;
        }
      }
      if (i >= len) {
        throw new Error(`[Expression Error] 未闭合的字符串字面量: ${expr}`);
      }
      i++; // 跳过结束引号
      tokens.push({ type: 'STRING', value: strVal, raw: quote + strVal + quote });
      continue;
    }

    // 双字符操作符: ==, !=, ===, !==, <=, >=, &&, ||
    const twoChars = expr.slice(i, i + 2);
    const threeChars = expr.slice(i, i + 3);

    if (threeChars === '===' || threeChars === '!==') {
      tokens.push({ type: 'OPERATOR', value: threeChars.slice(0, 2), raw: threeChars });
      i += 3;
      continue;
    }

    if (
      twoChars === '==' ||
      twoChars === '!=' ||
      twoChars === '<=' ||
      twoChars === '>=' ||
      twoChars === '&&' ||
      twoChars === '||'
    ) {
      tokens.push({ type: 'OPERATOR', value: twoChars, raw: twoChars });
      i += 2;
      continue;
    }

    // 单字符操作符: >, <, !
    if (char === '!' && expr[i + 1] !== '=') {
      tokens.push({ type: 'NOT', value: '!', raw: '!' });
      i++;
      continue;
    }
    if (char === '>' || char === '<') {
      tokens.push({ type: 'OPERATOR', value: char, raw: char });
      i++;
      continue;
    }

    // 数字字面量
    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(expr[i + 1] || ''))) {
      let numStr = char;
      i++;
      while (i < len && /[0-9.]/.test(expr[i])) {
        numStr += expr[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: numStr, raw: numStr });
      continue;
    }

    // 标识符或布尔/null关键字 (支持中文标签、英文标识符与带点属性路径如 data.floorPrice)
    if (/[a-zA-Z_$\u4e00-\u9fa5]/.test(char)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_$.[\]\u4e00-\u9fa5]/.test(expr[i])) {
        ident += expr[i];
        i++;
      }

      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'BOOLEAN', value: ident, raw: ident });
      } else if (ident === 'null' || ident === 'undefined') {
        tokens.push({ type: 'NULL', value: ident, raw: ident });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: ident, raw: ident });
      }
      continue;
    }

    throw new Error(`[Expression Error] 无法识别的字符 '${char}'，在表达式: "${expr}" (位置 ${i})`);
  }

  return tokens;
}

/**
 * 递归下降条件表达式解析与求值
 */
class ExpressionParser {
  private tokens: Token[];
  private current = 0;
  private context: Record<string, unknown>;

  constructor(tokens: Token[], context: Record<string, unknown>) {
    this.tokens = tokens;
    this.context = context;
  }

  public evaluate(): boolean {
    if (this.tokens.length === 0) return false;
    const result = this.parseOr();
    if (!this.isAtEnd()) {
      const remaining = this.tokens.slice(this.current).map((t) => t.raw).join(' ');
      throw new Error(`[Expression Error] 表达式存在无法解析的多余语法内容: "${remaining}"`);
    }
    return Boolean(result);
  }

  // OR 级: a || b
  private parseOr(): unknown {
    let left = this.parseAnd();

    while (this.matchOperator('||')) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }

    return left;
  }

  // AND 级: a && b
  private parseAnd(): unknown {
    let left = this.parseComparison();

    while (this.matchOperator('&&')) {
      const right = this.parseComparison();
      left = Boolean(left) && Boolean(right);
    }

    return left;
  }

  // Comparison 级: ==, !=, >, <, >=, <=
  private parseComparison(): unknown {
    const left = this.parseUnary();

    if (
      this.checkOperator('==') ||
      this.checkOperator('!=') ||
      this.checkOperator('>') ||
      this.checkOperator('>=') ||
      this.checkOperator('<') ||
      this.checkOperator('<=')
    ) {
      const op = this.advance().value;
      const right = this.parseUnary();
      return this.computeComparison(left, op, right);
    }

    return left;
  }

  // Unary 级: !expr
  private parseUnary(): unknown {
    if (this.matchType('NOT')) {
      const operand = this.parseUnary();
      return !operand;
    }
    return this.parsePrimary();
  }

  // Primary 级: 括号、字面量、标识符
  private parsePrimary(): unknown {
    if (this.matchType('LPAREN')) {
      const exprVal = this.parseOr();
      if (!this.matchType('RPAREN')) {
        throw new Error('[Expression Error] 缺少右括号 )');
      }
      return exprVal;
    }

    if (this.isAtEnd()) {
      throw new Error('[Expression Error] 表达式意外终止');
    }

    const token = this.advance();

    switch (token.type) {
      case 'STRING':
        return token.value;
      case 'NUMBER':
        return Number(token.value);
      case 'BOOLEAN':
        return token.value === 'true';
      case 'NULL':
        return null;
      case 'IDENTIFIER':
        return this.resolveIdentifier(token.value);
      default:
        throw new Error(`[Expression Error] 意外的 Token: ${token.raw}`);
    }
  }

  private resolveIdentifier(identifier: string): unknown {
    // 优先从 context 顶级查找
    if (Object.prototype.hasOwnProperty.call(this.context, identifier)) {
      return this.context[identifier];
    }
    // 支持深层路径提取，例如 data.price
    return getNestedValue(this.context, identifier);
  }

  private computeComparison(left: unknown, op: string, right: unknown): boolean {
    // 针对数值做宽松比对处理 (如 "26555" == 26555)
    if (typeof left === 'number' && typeof right === 'string' && !isNaN(Number(right))) {
      right = Number(right);
    } else if (typeof right === 'number' && typeof left === 'string' && !isNaN(Number(left))) {
      left = Number(left);
    }

    switch (op) {
      case '==':
        return left == right; // eslint-disable-line eqeqeq
      case '!=':
        return left != right; // eslint-disable-line eqeqeq
      case '>':
        return (left as number) > (right as number);
      case '>=':
        return (left as number) >= (right as number);
      case '<':
        return (left as number) < (right as number);
      case '<=':
        return (left as number) <= (right as number);
      default:
        throw new Error(`[Expression Error] 未知比较操作符: ${op}`);
    }
  }

  private matchOperator(op: string): boolean {
    if (this.checkOperator(op)) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkOperator(op: string): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    return token.type === 'OPERATOR' && token.value === op;
  }

  private matchType(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    if (this.peek().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private isAtEnd(): boolean {
    return this.current >= this.tokens.length;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.tokens[this.current - 1];
  }
}

/**
 * 执行条件表达式计算
 * @param expr 表达式文本，如 "data.floorPrice > 20000 && needInvoice"
 * @param context 数据上下文
 * @returns 最终布尔判断结果
 */
export function evaluateCondition(expr: string, context: Record<string, unknown>): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;

  try {
    const tokens = tokenizeExpr(trimmed);
    const parser = new ExpressionParser(tokens, context);
    return parser.evaluate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Condition Evaluation Failed] 表达式 "${expr}" 计算失败: ${message}`);
  }
}
