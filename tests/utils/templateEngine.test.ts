import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  validateTemplate,
  extractTemplateVariables,
} from '../../src/utils/template/templateEngine';
import { evaluateCondition, getNestedValue } from '../../src/utils/template/evaluator';
import {
  centsToYuan,
  formatDate,
  maskPhone,
  defaultVal,
  applyFilter,
} from '../../src/utils/template/filters';

describe('templateEngine & filters', () => {
  describe('filters', () => {
    it('correctly converts cents to yuan (centsToYuan)', () => {
      expect(centsToYuan(26555)).toBe('265.55');
      expect(centsToYuan(23900)).toBe('239.00');
      expect(centsToYuan(0)).toBe('0.00');
      expect(centsToYuan('1250')).toBe('12.50');
      expect(centsToYuan(null)).toBe('0.00');
      expect(centsToYuan(undefined)).toBe('0.00');
    });

    it('throws error when cents is invalid non-numeric string', () => {
      expect(() => centsToYuan('invalid')).toThrowError('[Filter Error] 无法将非数值金额转换为元');
    });

    it('formats date correctly', () => {
      expect(formatDate('2026-09-15 00:00:00', 'YYYY-MM-DD')).toBe('2026-09-15');
      expect(formatDate('2026-09-15 14:30:00', 'HH:mm')).toBe('14:30');
    });

    it('correctly handles 13-digit timestamp string in formatDate', () => {
      const formatted = formatDate('1789401600000', 'YYYY-MM-DD');
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('throws error when formatDate receives invalid date string', () => {
      expect(() => formatDate('not-a-valid-date')).toThrowError('[Filter Error] 无法解析有效日期: not-a-valid-date');
    });

    it('throws error for unsupported filter in applyFilter', () => {
      expect(() => applyFilter(100, 'unknownFilter')).toThrowError('[Filter Error] 不支持的过滤器: unknownFilter');
    });

    it('masks phone number correctly', () => {
      expect(maskPhone('13812345678')).toBe('138****5678');
      expect(maskPhone('')).toBe('-');
      expect(maskPhone(undefined)).toBe('-');
    });

    it('provides fallback for defaultVal', () => {
      expect(defaultVal('', '无')).toBe('无');
      expect(defaultVal(null, '保密')).toBe('保密');
      expect(defaultVal('已有内容', '兜底')).toBe('已有内容');
    });
  });

  describe('evaluateCondition', () => {
    const ctx = {
      orderId: '1001',
      price: 26555,
      floorPrice: 23900,
      status: 'CONSUMED',
      isVip: true,
      hasRights: false,
      data: {
        invoiceParty: 3,
        canCreate: true,
        items: [1, 2, 3],
      },
    };

    it('evaluates boolean and identity conditions', () => {
      expect(evaluateCondition('isVip', ctx)).toBe(true);
      expect(evaluateCondition('hasRights', ctx)).toBe(false);
      expect(evaluateCondition('!hasRights', ctx)).toBe(true);
    });

    it('evaluates comparison operators', () => {
      expect(evaluateCondition('price > 20000', ctx)).toBe(true);
      expect(evaluateCondition('price < 10000', ctx)).toBe(false);
      expect(evaluateCondition("status == 'CONSUMED'", ctx)).toBe(true);
      expect(evaluateCondition("status != 'CANCELLED'", ctx)).toBe(true);
      expect(evaluateCondition('data.invoiceParty == 3', ctx)).toBe(true);
      expect(evaluateCondition('data.items.length == 3', ctx)).toBe(true);
    });

    it('evaluates strict equality (===) and strict inequality (!==)', () => {
      expect(evaluateCondition('price === 26555', ctx)).toBe(true);
      expect(evaluateCondition("price === '26555'", ctx)).toBe(false);
      expect(evaluateCondition("price !== '26555'", ctx)).toBe(true);
      expect(evaluateCondition('price !== 26555', ctx)).toBe(false);
      expect(evaluateCondition("status === 'CONSUMED'", ctx)).toBe(true);
      expect(evaluateCondition("status !== 'CANCELLED'", ctx)).toBe(true);
    });

    it('evaluates logical AND (&&) and OR (||)', () => {
      expect(evaluateCondition('isVip && price > 20000', ctx)).toBe(true);
      expect(evaluateCondition('isVip && hasRights', ctx)).toBe(false);
      expect(evaluateCondition('hasRights || data.canCreate', ctx)).toBe(true);
      expect(evaluateCondition('data.invoiceParty == 3 && data.canCreate == true', ctx)).toBe(true);
    });

    it('handles parentheses precedence', () => {
      expect(evaluateCondition('(hasRights || isVip) && price > 20000', ctx)).toBe(true);
      expect(evaluateCondition('hasRights || (isVip && price < 10000)', ctx)).toBe(false);
    });

    it('throws Fail-Fast error on malformed condition syntax and trailing unparsed tokens', () => {
      expect(() => evaluateCondition('price >', ctx)).toThrowError('[Condition Evaluation Failed]');
      expect(() => evaluateCondition('(isVip && price', ctx)).toThrowError('[Condition Evaluation Failed]');
      expect(() => evaluateCondition('price > 20000 INVALID_TRAILING', ctx)).toThrowError('存在无法解析的多余语法内容');
    });
  });

  describe('getNestedValue with array wildcards [*]', () => {
    const mockOrder = {
      orderId: 'MT-999',
      data: {
        guests: [
          { name: '张三', age: 25 },
          { name: '李四', age: 30 },
          { name: '王五', age: 28 },
        ],
        contacts: [
          { phone: '13800001111' },
          { phone: '13900002222' },
        ],
        emptyList: [],
        tags: ['亲子', '含早', '可加床'],
        mixedList: [
          { item: 'A' },
          { item: null },
          { item: '' },
          { item: 'B' },
        ],
      },
    };

    it('extracts values from array using [*] wildcard', () => {
      const names = getNestedValue(mockOrder, 'data.guests[*].name');
      expect(names).toEqual(['张三', '李四', '王五']);
    });

    it('extracts values from array using [] shorthand wildcard', () => {
      const names = getNestedValue(mockOrder, 'data.guests[].name');
      expect(names).toEqual(['张三', '李四', '王五']);
    });

    it('extracts tail array using [*]', () => {
      const tags = getNestedValue(mockOrder, 'data.tags[*]');
      expect(tags).toEqual(['亲子', '含早', '可加床']);
    });

    it('filters out null, undefined, and empty string elements in projection', () => {
      const items = getNestedValue(mockOrder, 'data.mixedList[*].item');
      expect(items).toEqual(['A', 'B']);
    });

    it('returns empty array when target array is empty', () => {
      const res = getNestedValue(mockOrder, 'data.emptyList[*].id');
      expect(res).toEqual([]);
    });

    it('returns undefined when property along the path does not exist or is not an array', () => {
      expect(getNestedValue(mockOrder, 'data.nonExistent[*].name')).toBeUndefined();
      expect(getNestedValue(mockOrder, 'orderId[*].name')).toBeUndefined();
    });

    it('supports combined numeric indexing and wildcard projection', () => {
      const firstGuest = getNestedValue(mockOrder, 'data.guests[0].name');
      expect(firstGuest).toBe('张三');
      const secondGuest = getNestedValue(mockOrder, 'data.guests.1.name');
      expect(secondGuest).toBe('李四');
    });
  });

  describe('renderTemplate', () => {
    it('renders array variables by joining with Chinese pause marks', () => {
      const template = '入住人:{guests} | 手机:{phones}';
      const result = renderTemplate(template, {
        guests: ['张三', '李四', '王五'],
        phones: ['138****0000', '139****1111'],
      });
      expect(result).toBe('入住人:张三、李四、王五 | 手机:138****0000、139****1111');
    });

    it('renders wildcard projected paths directly in templates', () => {
      const template = '入住人:{guests[*].name}';
      const result = renderTemplate(template, {
        guests: [{ name: '赵六' }, { name: '钱七' }],
      });
      expect(result).toBe('入住人:赵六、钱七');
    });

    it('renders plain text and variables with single brace syntax', () => {
      const template = '单号:{orderNo} | 房型:{roomName}';
      const result = renderTemplate(template, { orderNo: 'MT-8888', roomName: '豪华大床房' });
      expect(result).toBe('单号:MT-8888 | 房型:豪华大床房');
    });

    it('renders double brace variables with filter pipeline', () => {
      const template = '实付:¥{{ price | money }} | 手机:{{ phone | maskPhone }}';
      const result = renderTemplate(template, { price: 26555, phone: '13912345678' });
      expect(result).toBe('实付:¥265.55 | 手机:139****5678');
    });

    it('renders conditional if-else branches', () => {
      const template = '{{#if needInvoice}}【需要开票】{{#else}}【无需开票】{{/if}}';
      expect(renderTemplate(template, { needInvoice: true })).toBe('【需要开票】');
      expect(renderTemplate(template, { needInvoice: false })).toBe('【无需开票】');
    });

    it('renders conditional blocks with expression logic', () => {
      const template =
        '{{#if floorPrice > 20000}}高价值订单(¥{{ floorPrice | money }}){{#else}}普通订单{{/if}}';
      expect(renderTemplate(template, { floorPrice: 23900 })).toBe('高价值订单(¥239.00)');
      expect(renderTemplate(template, { floorPrice: 9900 })).toBe('普通订单');
    });

    it('renders nested if conditions correctly', () => {
      const template =
        '{{#if isVip}}VIP客户:{{#if needLateCheckout}}延迟退房{{#else}}正常退房{{/if}}{{#else}}普通客户{{/if}}';
      expect(renderTemplate(template, { isVip: true, needLateCheckout: true })).toBe('VIP客户:延迟退房');
      expect(renderTemplate(template, { isVip: true, needLateCheckout: false })).toBe('VIP客户:正常退房');
      expect(renderTemplate(template, { isVip: false, needLateCheckout: true })).toBe('普通客户');
    });

    it('throws Fail-Fast compile error for unclosed {{#if}}', () => {
      const badTemplate = '单号:{{ orderNo }} {{#if isVip}}请优先排房';
      expect(() => renderTemplate(badTemplate, { orderNo: '123' })).toThrowError(
        '[Template Compile Error]'
      );
    });

    it('validates template successfully and catches syntax error', () => {
      expect(validateTemplate('合法的模板 {orderNo} {{#if a}}1{{/if}}').valid).toBe(true);
      const invalidRes = validateTemplate('非法的模板 {{#if a}}缺少闭合');
      expect(invalidRes.valid).toBe(false);
      expect(invalidRes.error).toContain('[Template Compile Error]');
    });

    it('catches condition syntax errors in validateTemplate and renderTemplate', () => {
      const invalidCondTemplate = '{{#if price > }}内容{{/if}}';
      const res = validateTemplate(invalidCondTemplate);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('[Template Compile Error]');
      expect(() => renderTemplate(invalidCondTemplate, { price: 100 })).toThrowError(
        '[Template Compile Error]'
      );
    });

    it('throws error for unsupported filter in renderTemplate', () => {
      expect(() => renderTemplate('{{ price | unknownFilter }}', { price: 100 })).toThrowError(
        '[Filter Error] 不支持的过滤器'
      );
    });

    it('handles empty double braces {{}} safely without rendering [object Object]', () => {
      expect(renderTemplate('单号:{{}}', {})).toBe('单号:');
      expect(renderTemplate('{{   }}', {})).toBe('');
    });

    it('extracts all referenced variables including condition variables', () => {
      const template = '单号:{orderNo} 房型:{{ roomName }} {{#if needInvoice}}发票:{{ invoiceAmount }}{{/if}}';
      const vars = extractTemplateVariables(template);
      expect(vars).toContain('orderNo');
      expect(vars).toContain('roomName');
      expect(vars).toContain('invoiceAmount');
      expect(vars).toContain('needInvoice');
    });

    it('extractTemplateVariables provides best-effort UI tolerance by default and throws when throwOnError is true', () => {
      const malformedTemplate = '单号:{{ orderNo }} {{#if isVip}}缺少闭合标签';

      // 默认情况：面向 UI 输入容错，不抛出异常，返回空数组
      const defaultVars = extractTemplateVariables(malformedTemplate);
      expect(defaultVars).toEqual([]);

      // throwOnError: false 显式传入同样安全容错
      expect(extractTemplateVariables(malformedTemplate, { throwOnError: false })).toEqual([]);

      // throwOnError: true 严格模式：向外抛出编译语法异常 (Fail-Fast)
      expect(() =>
        extractTemplateVariables(malformedTemplate, { throwOnError: true })
      ).toThrowError('[Template Compile Error]');

      // 合法模板在 throwOnError: true 下正常提取变量（包括 IF 条件中的 isVip 变量）
      const validTemplate = '{{#if isVip}}VIP单号:{{ orderNo }}{{/if}}';
      const validVars = extractTemplateVariables(validTemplate, { throwOnError: true });
      expect(validVars).toEqual(expect.arrayContaining(['isVip', 'orderNo']));
      expect(validVars.length).toBe(2);
    });

  });
});
