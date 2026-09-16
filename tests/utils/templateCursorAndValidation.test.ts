import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  validateTemplate,
} from '../../src/utils/template/templateEngine';
import {
  insertAtCursor,
  detectUnknownVariables,
} from '../../src/utils/template/templateEditor';
import { DEFAULT_MEITUAN_PROTOCOL_SCHEMA } from '../../src/services/protocols/meituanProtocol';
import { DEFAULT_DOUYIN_PROTOCOL_SCHEMA } from '../../src/services/protocols/douyinProtocol';

describe('Template Syntax, Cursor Insertion, and Unknown Variable Detection', () => {
  describe('Plan A Condition Syntax & Rendering', () => {
    const invoicePattern = '{{#if needInvoice}}\n【发票提醒】该单客人要求酒店开具发票(参考金额:¥{参考开票金额}){{/if}}';
    const rightsPattern = '{{#if hasRights}}\n【权益】{特色权益}{{#else}}\n【标准入住】无特殊礼遇{{/if}}';

    it('validates syntax for Plan A condition patterns successfully', () => {
      expect(validateTemplate(invoicePattern).valid).toBe(true);
      expect(validateTemplate(rightsPattern).valid).toBe(true);
    });

    it('correctly renders invoice pattern with true and false conditions (Plan A no-extra-blank-lines)', () => {
      const baseTemplate = '【美团搬单】单号:MT-1001' + invoicePattern;

      // 1. 当 needInvoice 为 true 时，前置换行生效，优雅另起一行展示发票提醒
      const renderedTrue = renderTemplate(baseTemplate, {
        needInvoice: true,
        '参考开票金额': '265.55',
      });
      expect(renderedTrue).toBe(
        '【美团搬单】单号:MT-1001\n【发票提醒】该单客人要求酒店开具发票(参考金额:¥265.55)'
      );

      // 2. 当 needInvoice 为 false 时，由于换行符在 if 块内部，外部绝不留下孤立空行 (方案 A 的核心优势)
      const renderedFalse = renderTemplate(baseTemplate, {
        needInvoice: false,
        '参考开票金额': '265.55',
      });
      expect(renderedFalse).toBe('【美团搬单】单号:MT-1001');
    });

    it('correctly renders rights pattern with if and else branches (Plan A)', () => {
      const baseTemplate = '【搬单】单号:MT-1001' + rightsPattern;

      // 1. 当 hasRights 为 true 时，展示特色权益
      const renderedTrue = renderTemplate(baseTemplate, {
        hasRights: true,
        '特色权益': '免费双人早餐+延迟退房至14:00',
      });
      expect(renderedTrue).toBe(
        '【搬单】单号:MT-1001\n【权益】免费双人早餐+延迟退房至14:00'
      );

      // 2. 当 hasRights 为 false 时，展示标准入住
      const renderedFalse = renderTemplate(baseTemplate, {
        hasRights: false,
      });
      expect(renderedFalse).toBe('【搬单】单号:MT-1001\n【标准入住】无特殊礼遇');
    });
  });

  describe('Task 1: Cursor Position Insertion Logic', () => {


    it('inserts at cursor in the middle of text and calculates next cursor position', () => {
      const initial = '单号: | 房型:海景房';
      // 光标在 "单号:" 后面（位置 3）
      const { newText, nextCursorPos } = insertAtCursor(initial, '{美团单号}', 3, 3);
      expect(newText).toBe('单号:{美团单号} | 房型:海景房');
      expect(nextCursorPos).toBe(3 + '{美团单号}'.length);
    });

    it('replaces selected text range when selectionStart < selectionEnd', () => {
      const initial = '单号:OLD_VALUE | 房型:海景房';
      // 选中 "OLD_VALUE" (位置 3 到 12)
      const { newText, nextCursorPos } = insertAtCursor(initial, '{美团单号}', 3, 12);
      expect(newText).toBe('单号:{美团单号} | 房型:海景房');
      expect(nextCursorPos).toBe(3 + '{美团单号}'.length);
    });

    it('inserts at beginning when cursor is at 0', () => {
      const initial = '单号:{美团单号}';
      const { newText, nextCursorPos } = insertAtCursor(initial, '【紧急】', 0, 0);
      expect(newText).toBe('【紧急】单号:{美团单号}');
      expect(nextCursorPos).toBe('【紧急】'.length);
    });

    it('appends to the end when selection is undefined or null (fallback behavior)', () => {
      const initial = '单号:{美团单号}';
      const { newText, nextCursorPos } = insertAtCursor(initial, ' | 状态:成功');
      expect(newText).toBe('单号:{美团单号} | 状态:成功');
      expect(nextCursorPos).toBe(initial.length + ' | 状态:成功'.length);
    });
  });

  describe('Task 3: Unknown Variable Detection Logic', () => {


    it('returns empty list for default Meituan template against Meituan schema', () => {
      const meituanTemplate =
        '【美团搬单】单号:{美团单号} | 房型:{房型名称} x {房间间数}间 | 客人:{入住人} ({联系电话}) | 入住:{入住日期}至{离店日期} | 底价:¥{结算底价} | 早餐:{早餐说明}' +
        '{{#if hasRights}}\n【权益】{特色权益}{{/if}}' +
        '{{#if needInvoice}}\n【发票提醒】该单客人要求酒店开具发票(参考金额:¥{参考开票金额}){{/if}}';

      const unknown = detectUnknownVariables(
        meituanTemplate,
        DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields,
        {
          美团单号: '123',
          房型名称: '大床房',
          房间间数: '1',
          入住人: '张三',
          联系电话: '13888888888',
          入住日期: '2026-09-16',
          离店日期: '2026-09-17',
          结算底价: '239.00',
          早餐说明: '无早',
          特色权益: '双人温泉',
          参考开票金额: '265.55',
        }
      );

      expect(unknown).toEqual([]);
    });

    it('detects typo and undefined variables like {美团订单号}', () => {
      const templateWithTypo = '【美团搬单】单号:{美团订单号} | 客人:{入住人} | 错误:{未知变量}';

      const unknown = detectUnknownVariables(
        templateWithTypo,
        DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields,
        {
          美团单号: '123',
          入住人: '张三',
        }
      );

      expect(unknown).toContain('美团订单号');
      expect(unknown).toContain('未知变量');
      expect(unknown).not.toContain('入住人');
    });

    it('detects disabled schema fields as unknown variables', () => {
      const modifiedFields = DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields.map((f) =>
        f.label === '早餐说明' ? { ...f, enabled: false } : f
      );

      const template = '单号:{美团单号} | 早餐:{早餐说明}';

      const unknown = detectUnknownVariables(template, modifiedFields, {
        美团单号: '123',
      });

      expect(unknown).toEqual(['早餐说明']);
    });

    it('supports root namespace property accesses like data.invoiceParty without false positive', () => {
      const template = '单号:{美团单号} | 原始数据:{{ data.invoiceParty }}';

      const unknown = detectUnknownVariables(
        template,
        DEFAULT_MEITUAN_PROTOCOL_SCHEMA.fields,
        {
          美团单号: '123',
          data: { invoiceParty: 3 },
        }
      );

      expect(unknown).toEqual([]);
    });

    it('handles Douyin schema with Douyin fields accurately', () => {
      const douyinTemplate = '【抖音团购】单号:{抖音主单号} | 预约:{预约单号} | 房型:{房型名称}';

      const unknown = detectUnknownVariables(
        douyinTemplate,
        DEFAULT_DOUYIN_PROTOCOL_SCHEMA.fields,
        {
          抖音主单号: '1116431119643540077',
          预约单号: '800014640948279296216700077',
          房型名称: '豪华大床房',
        }
      );

      expect(unknown).toEqual([]);
    });

    it('detects Meituan-only fields when inserted into Douyin template', () => {
      const mixedTemplate = '【抖音】单号:{抖音主单号} | 美团字段:{美团单号}';

      const unknown = detectUnknownVariables(
        mixedTemplate,
        DEFAULT_DOUYIN_PROTOCOL_SCHEMA.fields,
        {
          抖音主单号: '1116431119643540077',
        }
      );

      expect(unknown).toEqual(['美团单号']);
    });
  });
});
