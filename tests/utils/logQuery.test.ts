import { describe, it, expect } from 'vitest';
import { parse } from 'liqe';
import {
  compileLogQuery,
  evaluateLogQuery,
  getParsedAst,
  isLogQuerySyntaxValid,
  normalizeQueryString,
} from '../../src/utils/logQuery';
import type { SystemLogEntry } from '../../src/types';

function createMockLog(overrides: Partial<SystemLogEntry> = {}): SystemLogEntry {
  return {
    id: 'log-1',
    timestamp: '2026-09-18 10:00:00',
    createdAt: 1726624800000,
    level: 'INFO',
    module: 'ORDER',
    event: 'ORDER_TRANSFER_PMS_SUCCESS',
    orderNo: '1116956085050906669',
    taskActionStage: 'order-import-submit',
    message: '[OrderGuardian] 用户手动导入订单 1116956085050906669',
    details: '酒店: 丽呈酒店 | 客人: 张三',
    channelId: 'MEITUAN',
    taskId: 'TASK-1001',
    msgType: 'OTA_IMPORT_ORDER',
    ...overrides,
  };
}

function matchesLogSearch(log: SystemLogEntry, search: string): boolean {
  return evaluateLogQuery(log, compileLogQuery({ search }));
}

describe('logQuery (基于 liqe 的专业日志查询引擎)', () => {
  describe('normalizeQueryString', () => {
    it('应将订单号查询改写为全文子串匹配', () => {
      const q = 'order:1116956085050906669';
      // 纯数字必须带引号，否则 liqe 会按 Number 解析并丢失长单号精度
      expect(normalizeQueryString(q)).toBe('fullText:"1116956085050906669"');
      expect(normalizeQueryString('ORDERNO:123')).toBe('fullText:"123"');
    });

    it('应将友好别名替换为实体标准属性名', () => {
      expect(normalizeQueryString('stage:claim')).toBe('taskActionStage:claim');
      expect(normalizeQueryString('action:claim')).toBe('taskActionStage:claim');
      expect(normalizeQueryString('level:ERROR')).toBe('level:ERROR');
      expect(normalizeQueryString('channel:MEITUAN')).toBe('channelId:MEITUAN');
      expect(normalizeQueryString('type:OTA_IMPORT_ORDER')).toBe('msgType:OTA_IMPORT_ORDER');
    });

    it('应自动包裹 URL 路径中的斜杠', () => {
      const q = 'url:/toolkit/orders/import';
      expect(normalizeQueryString(q)).toBe('apiUrl:"/toolkit/orders/import"');
    });

    it('对含正则元字符的订单号应安全加引号而不是编译成正则字面量', () => {
      expect(normalizeQueryString('order:"MT-99(88)+77"')).toBe(
        'fullText:"MT-99(88)+77"'
      );
    });
  });

  describe('compileLogQuery', () => {
    it('应将界面所有离散过滤条件编译为合法的 Lucene 组合表达式', () => {
      const compiled = compileLogQuery({
        taskActionStage: 'order-import-submit',
        module: 'ORDER',
        level: 'INFO',
        orderNo: '1116956085050906669',
        channelId: 'MEITUAN',
        search: '丽呈酒店',
      });

      expect(compiled).toContain('taskActionStage:order-import-submit');
      expect(compiled).toContain('module:"ORDER"');
      expect(compiled).toContain('level:"INFO"');
      expect(compiled).toContain('fullText:"1116956085050906669"');
      expect(compiled).toContain('channelId:MEITUAN');
      expect(compiled).toContain('(丽呈酒店)');
      expect(compiled).toContain(' AND ');
    });

    it('当所有过滤条件为 ALL 或为空时，应返回空字符串', () => {
      const compiled = compileLogQuery({
        taskActionStage: 'ALL',
        module: 'ALL',
        level: 'ALL',
        orderNo: '',
        search: '',
      });
      expect(compiled).toBe('');
    });

    it('应将日期边界编译为 createdAt 的毫秒范围比较', () => {
      const compiled = compileLogQuery(
        {},
        { startMs: 1000, endMs: 2000 }
      );
      expect(compiled).toBe('createdAt:>=1000 AND createdAt:<=2000');
    });

    it('应将 onlyErrors 编译为 ERROR 与 WARN 的级别并集', () => {
      const compiled = compileLogQuery({ onlyErrors: true });
      expect(compiled).toBe('(level:"ERROR" OR level:"WARN")');
    });

    it('module 为 API 时应保留多维嗅探语义', () => {
      const compiled = compileLogQuery({ module: 'API' });
      expect(compiled).toBe('(module:"API" OR apiUrl:* OR event:API_)');
    });

    it('对含正则元字符的过滤值应安全加引号，避免编译出非法表达式', () => {
      const compiled = compileLogQuery({ orderNo: 'MT-99(88)+77' });
      expect(compiled).toBe('fullText:"MT-99(88)+77"');
    });

    it('多个子串维度组合时必须仍可解析，不得触发 liqe 正则歧义', () => {
      const log = createMockLog({
        channelId: 'MEITUAN',
        taskActionStage: 'order-import-submit',
        taskId: 'TASK-1001',
        orderNo: '1116956085050906669',
      });

      const compiled = compileLogQuery({
        channelId: 'meituan',
        taskActionStage: 'ORDER_IMPORT_SUBMIT',
        taskId: 'task-1001',
        orderNo: '1116956085050906669',
      });

      expect(() => parse(compiled)).not.toThrow();
      expect(evaluateLogQuery(log, compiled)).toBe(true);
    });

    it('多个订单号以 OR 组合时应各自命中，而不是整体退化为字面量匹配', () => {
      const first = createMockLog({ orderNo: 'MT-111222' });
      const second = createMockLog({ orderNo: 'MT-333444' });
      const third = createMockLog({ orderNo: 'MT-555666' });

      const compiled = compileLogQuery({ search: 'order:MT-111222 OR order:MT-333444' });

      expect(() => parse(compiled)).not.toThrow();
      expect(evaluateLogQuery(first, compiled)).toBe(true);
      expect(evaluateLogQuery(second, compiled)).toBe(true);
      expect(evaluateLogQuery(third, compiled)).toBe(false);
    });
  });

  describe('compileLogQuery + evaluateLogQuery', () => {
    const log = createMockLog();

    it('空查询应无条件通过', () => {
      expect(matchesLogSearch(log, '')).toBe(true);
      expect(matchesLogSearch(log, '   ')).toBe(true);
    });

    it('按单号进行全文子串匹配', () => {
      expect(matchesLogSearch(log, 'order:1116956085050906669')).toBe(true);
      expect(matchesLogSearch(log, 'order:9999999999999999999')).toBe(false);
    });

    it('按任务阶段匹配 (stage: 或 taskActionStage:)', () => {
      expect(matchesLogSearch(log, 'stage:order-import-submit')).toBe(true);
      expect(matchesLogSearch(log, 'stage:claim')).toBe(false);
    });

    it('按日志级别匹配 (level:)', () => {
      expect(matchesLogSearch(log, 'level:INFO')).toBe(true);
      expect(matchesLogSearch(log, 'level:ERROR')).toBe(false);
    });

    it('复合多条件 AND 匹配', () => {
      expect(
        matchesLogSearch(
          log,
          'level:INFO AND order:1116956085050906669 AND stage:order-import-submit'
        )
      ).toBe(true);

      expect(
        matchesLogSearch(
          log,
          'level:ERROR AND order:1116956085050906669'
        )
      ).toBe(false);
    });

    it('自由文本全文匹配', () => {
      expect(matchesLogSearch(log, '丽呈酒店')).toBe(true);
      expect(matchesLogSearch(log, '张三')).toBe(true);
      expect(matchesLogSearch(log, '希尔顿')).toBe(false);
    });

    it('当输入不完整查询语法时，与其他过滤条件组合仍应正常筛选', () => {
      const matchLog = createMockLog({
        level: 'INFO',
        message: '用户输入了 order: 正在处理',
      });
      const wrongLevelLog = createMockLog({
        level: 'WARN',
        message: '用户输入了 order: 正在处理',
      });

      // 当 search 输入不完整的 'order:'，但设置了 level: 'INFO' 时
      const compiled = compileLogQuery({
        level: 'INFO',
        search: 'order:',
      });

      expect(evaluateLogQuery(matchLog, compiled)).toBe(true);
      expect(evaluateLogQuery(wrongLevelLog, compiled)).toBe(false);

      // 输入包含未闭合括号 '(' 的搜索词
      const parenLog = createMockLog({
        level: 'INFO',
        message: '包含特殊符号 (待确认)',
      });
      const parenCompiled = compileLogQuery({
        level: 'INFO',
        search: '(待确认',
      });
      expect(evaluateLogQuery(parenLog, parenCompiled)).toBe(true);
      expect(evaluateLogQuery(wrongLevelLog, parenCompiled)).toBe(false);
    });
  });

  describe('isLogQuerySyntaxValid', () => {
    it('应准确识别合法查询语法', () => {
      expect(isLogQuerySyntaxValid('')).toBe(true);
      expect(isLogQuerySyntaxValid('level:INFO')).toBe(true);
    });

    it('应准确识别非法查询语法', () => {
      expect(isLogQuerySyntaxValid('(')).toBe(false);
      expect(isLogQuerySyntaxValid('module:"AUTH')).toBe(false);
    });
  });

  describe('getParsedAst', () => {
    it('对相同查询表达式应复用缓存的 AST 实例', () => {
      const q = 'level:"ERROR" AND fullText:"12345"';
      const ast1 = getParsedAst(q);
      const ast2 = getParsedAst(q);
      expect(ast1).not.toBeNull();
      expect(ast1).toBe(ast2);
    });

    it('对非法表达式应安全返回 null 而不抛出异常', () => {
      expect(getParsedAst('level:"ERROR" AND (')).toBeNull();
    });

    it('对空输入返回 null', () => {
      expect(getParsedAst('')).toBeNull();
      expect(getParsedAst('   ')).toBeNull();
    });
  });
});
