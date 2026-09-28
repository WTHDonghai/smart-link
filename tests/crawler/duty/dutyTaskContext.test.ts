import { describe, it, expect } from 'vitest';
import {
  parseDutyTaskContext,
  extractTaskChannelCode,
  extractTaskOrderId,
  extractTaskOrderNo,
  isRiskControlError,
  RISK_CONTROL_PATTERN,
} from '../../../src/crawler/duty/dutyTaskContext';
import type { DutyClaimedTask } from '../../../src/types';

describe('dutyTaskContext', () => {
  const createBaseTask = (overrides: Partial<DutyClaimedTask> = {}): DutyClaimedTask => ({
    id: 'task-context-100',
    stationId: 'station-ctx-1',
    businessId: 'BIZ-CTX-001',
    businessType: 'OTA_MIGRATION',
    msgType: 'OTA_IMPORT_ORDER',
    leaseToken: 'lease-ctx-100',
    data: '',
    ...overrides,
  });

  describe('isRiskControlError', () => {
    it('应正确过滤空值与未定义输入', () => {
      expect(isRiskControlError(null)).toBe(false);
      expect(isRiskControlError(undefined)).toBe(false);
      expect(isRiskControlError('')).toBe(false);
    });

    it('应命中字符串形式的风控关键词', () => {
      expect(isRiskControlError('出现安全验证，请在浏览器中完成验证')).toBe(true);
      expect(isRiskControlError('系统检测到访问频繁，请稍后再试')).toBe(true);
      expect(isRiskControlError('yoda-verify-required')).toBe(true);
      expect(isRiskControlError('captcha slider verification')).toBe(true);
      expect(isRiskControlError('RISK_VERIFICATION_REQUIRED')).toBe(true);
      expect(isRiskControlError('操作频繁，已被拦截')).toBe(true);
      expect(isRiskControlError('拖动滑块完成人机验证')).toBe(true);
    });

    it('不应将普通业务或网络错误误判为风控异常', () => {
      expect(isRiskControlError('网络连接超时: 504 Gateway Timeout')).toBe(false);
      expect(isRiskControlError('订单不存在: NOT_FOUND')).toBe(false);
      expect(isRiskControlError('房型映射缺失')).toBe(false);
    });

    it('应能正确检测 Error 实例的消息与名称', () => {
      const err = new Error('美团后台提示安全验证或操作频繁，需要人工在浏览器中完成验证 (RISK_VERIFICATION_REQUIRED)');
      expect(isRiskControlError(err)).toBe(true);

      const standardErr = new Error('Database connection failed');
      expect(isRiskControlError(standardErr)).toBe(false);
    });

    it('应能正确检测包含 errorCode, errorMessage, code 或 details 的结构化对象', () => {
      expect(isRiskControlError({ errorCode: 'RISK_VERIFICATION_REQUIRED' })).toBe(true);
      expect(isRiskControlError({ errorMessage: '请拖动滑块完成人机验证' })).toBe(true);
      expect(isRiskControlError({ message: 'yoda box active' })).toBe(true);
      expect(isRiskControlError({ code: 'RISK_VERIFICATION_REQUIRED' })).toBe(true);
      expect(isRiskControlError({ details: '检测到安全验证拦截' })).toBe(true);
      expect(isRiskControlError({ errorCode: 'ORDER_NOT_FOUND', errorMessage: '未找到订单' })).toBe(false);
    });

    it('导出的 RISK_CONTROL_PATTERN 应为有效的正则表达式', () => {
      expect(RISK_CONTROL_PATTERN instanceof RegExp).toBe(true);
    });
  });

  describe('extractTaskChannelCode (Fixed Protocol Paths & Zero Guesswork)', () => {
    it('OTA_COLLECT_ORDER 应严格从 otaChannelCode 固定契约路径提取渠道', () => {
      const task = createBaseTask({ msgType: 'OTA_COLLECT_ORDER' });
      expect(extractTaskChannelCode(task, { otaChannelCode: 'ctrip' })).toBe('CTRIP');
      expect(extractTaskChannelCode(task, { otaChannelCode: '  meituan  ' })).toBe('MEITUAN');
      // 契约红线：采集任务绝对不从非契约字段 (如 channelCode 或 channel) 猜测
      expect(extractTaskChannelCode(task, { channelCode: 'douyin' })).toBeUndefined();
      expect(extractTaskChannelCode(task, { channel: 'fliggy' })).toBeUndefined();
    });

    it('OTA_CONFIRM_IMPORT 应严格从 channelCode 固定契约路径提取渠道', () => {
      const task = createBaseTask({ msgType: 'OTA_CONFIRM_IMPORT' });
      expect(extractTaskChannelCode(task, { channelCode: 'douyin' })).toBe('DOUYIN');
      // 契约红线：确认任务绝对不从非契约字段 (如 channel 或 otaChannelCode) 猜测
      expect(extractTaskChannelCode(task, { otaChannelCode: 'meituan' })).toBeUndefined();
      expect(extractTaskChannelCode(task, { channel: 'fliggy' })).toBeUndefined();
    });

    it('OTA_CONFIRM_CANCEL 应严格从 channelCode 固定契约路径提取渠道', () => {
      const task = createBaseTask({ msgType: 'OTA_CONFIRM_CANCEL' });
      expect(extractTaskChannelCode(task, { channelCode: 'meituan' })).toBe('MEITUAN');
      // 契约红线：取消确认任务绝对不从非契约字段猜测
      expect(extractTaskChannelCode(task, { otaChannelCode: 'ctrip' })).toBeUndefined();
    });

    it('OTA_IMPORT_ORDER 应按契约路径支持 channel, otaChannelCode 与 orders[0].otaChannel 提取', () => {
      const task = createBaseTask({ msgType: 'OTA_IMPORT_ORDER' });
      expect(extractTaskChannelCode(task, { channel: 'fliggy' })).toBe('FLIGGY');
      expect(extractTaskChannelCode(task, { otaChannelCode: 'ctrip' })).toBe('CTRIP');
      expect(extractTaskChannelCode(task, { orders: [{ otaChannel: 'meituan' }] })).toBe('MEITUAN');
    });

    it('未提供任何合法渠道标识或仅提供空白字符时，必须返回 undefined 绝不隐式兜底', () => {
      const collectTask = createBaseTask({ msgType: 'OTA_COLLECT_ORDER' });
      expect(extractTaskChannelCode(collectTask, {})).toBeUndefined();
      expect(extractTaskChannelCode(collectTask, { otaChannelCode: '   ' })).toBeUndefined();
      expect(extractTaskChannelCode(collectTask, { otaChannelCode: '' })).toBeUndefined();

      const confirmTask = createBaseTask({ msgType: 'OTA_CONFIRM_IMPORT' });
      expect(extractTaskChannelCode(confirmTask, {})).toBeUndefined();
      expect(extractTaskChannelCode(confirmTask, { channelCode: '   ' })).toBeUndefined();

      const cancelTask = createBaseTask({ msgType: 'OTA_CONFIRM_CANCEL' });
      expect(extractTaskChannelCode(cancelTask, {})).toBeUndefined();
      expect(extractTaskChannelCode(cancelTask, { channelCode: '' })).toBeUndefined();

      const importTask = createBaseTask({ msgType: 'OTA_IMPORT_ORDER' });
      expect(extractTaskChannelCode(importTask, {})).toBeUndefined();
      expect(extractTaskChannelCode(importTask, { channel: '   ' })).toBeUndefined();
      expect(extractTaskChannelCode(importTask, { otaChannelCode: '' })).toBeUndefined();
      expect(extractTaskChannelCode(importTask, { orders: [{ otaChannel: '  ' }] })).toBeUndefined();
    });

    it('未知或不受支持的 msgType 必须严格返回 undefined，绝不擅自猜测', () => {
      const unsupportedTask = createBaseTask({
        msgType: 'UNSUPPORTED_MSG_TYPE' as unknown as DutyClaimedTask['msgType'],
      });
      expect(
        extractTaskChannelCode(unsupportedTask, {
          channelCode: 'ctrip',
          otaChannelCode: 'ctrip',
          channel: 'ctrip',
        })
      ).toBeUndefined();
    });
  });

  describe('extractTaskOrderId', () => {
    it('订单类任务中，中台 businessId 即为权威渠道订单号 (otaOrderId)', () => {
      const task = createBaseTask({ businessId: 'ORD-BIZ-888' });
      expect(extractTaskOrderId(task)).toBe('ORD-BIZ-888');
      expect(extractTaskOrderId(task, { otaOrderId: 'ORD-OTHER' })).toBe('ORD-BIZ-888');
    });

    it('采集巡检任务 (OTA_COLLECT_ORDER) 无单体关联订单号，返回 undefined', () => {
      const task = createBaseTask({ msgType: 'OTA_COLLECT_ORDER', businessId: 'BIZ-COLLECT-SESSION' });
      expect(extractTaskOrderId(task)).toBeUndefined();
      expect(extractTaskOrderId(task, { otaOrderId: 'ORD-IGNORED' })).toBeUndefined();
    });

    it('Fail-Fast: 当 payload.orders 包含多笔订单时，立即抛出明确异常拒绝隐式截断', () => {
      const task = createBaseTask({ businessId: 'ORD-01' });
      const multiPayload = {
        orders: [{ otaOrderId: 'ORD-01' }, { otaOrderId: 'ORD-02' }],
      };
      expect(() => extractTaskOrderId(task, multiPayload)).toThrow(
        '单任务仅支持处理单笔订单，收到包含 2 笔订单的非法载荷'
      );
    });

    it('当 businessId 缺失或为空时，容错从 payload.orders[0] 提取', () => {
      const task = createBaseTask({ businessId: '' });
      const payloadFirst = {
        orders: [{ otaOrderId: 'ORD-FIRST-01', orderId: 'ORD-FIRST-02' }],
        otaOrderId: 'ORD-PAYLOAD-01',
      };
      expect(extractTaskOrderId(task, payloadFirst)).toBe('ORD-FIRST-01');

      const payloadFallback = {
        orders: [{ orderId: 'ORD-FALLBACK-01' }],
      };
      expect(extractTaskOrderId(task, payloadFallback)).toBe('ORD-FALLBACK-01');

      const payloadOrderNo = {
        orders: [{ orderNo: 'ORD-NO-01' }],
      };
      expect(extractTaskOrderId(task, payloadOrderNo)).toBe('ORD-NO-01');
    });

    it('当 businessId 缺失且 orders 数组不存在时，容错从顶层 payload 提取', () => {
      const task = createBaseTask({ businessId: '' });
      expect(extractTaskOrderId(task, { otaOrderId: 'ORD-TOP-01' })).toBe('ORD-TOP-01');
      expect(extractTaskOrderId(task, { orderId: 'ORD-TOP-02' })).toBe('ORD-TOP-02');
      expect(extractTaskOrderId(task, { orderNo: 'ORD-TOP-03' })).toBe('ORD-TOP-03');
    });

    it('支持纯数字类型的订单号鲁棒转换提取', () => {
      const taskNumericBiz = createBaseTask({ businessId: 99887766 as unknown as string });
      expect(extractTaskOrderId(taskNumericBiz)).toBe('99887766');

      const taskEmptyBiz = createBaseTask({ businessId: '' });
      expect(extractTaskOrderId(taskEmptyBiz, { otaOrderId: 11223344 })).toBe('11223344');
    });

    it('extractTaskOrderNo 作为兼容别名与 extractTaskOrderId 完全等价', () => {
      const task = createBaseTask({ businessId: 'ALIAS-TEST-01' });
      expect(extractTaskOrderNo(task)).toBe('ALIAS-TEST-01');
    });
  });

  describe('parseDutyTaskContext', () => {
    it('成功解析 Base64 编码的合规 JSON 对象并构建统一上下文，包含强类型 orderId', () => {
      const payloadObj = {
        otaChannelCode: 'CTRIP',
        otaOrderId: 'CTRIP-ORD-888',
        extUnitCode: 'HOTEL-101',
      };
      const task = createBaseTask({
        msgType: 'OTA_IMPORT_ORDER',
        businessId: 'CTRIP-ORD-888',
        data: Buffer.from(JSON.stringify(payloadObj), 'utf-8').toString('base64'),
      });

      const context = parseDutyTaskContext(task);
      expect(context.task).toBe(task);
      expect(context.channelCode).toBe('CTRIP');
      expect(context.orderId).toBe('CTRIP-ORD-888');
      expect(context.businessId).toBe('CTRIP-ORD-888');
      expect(context.payload).toEqual(payloadObj);
    });

    it('当遭遇多笔订单载荷时，parseDutyTaskContext 立即触发 Fail-Fast 异常', () => {
      const multiPayload = {
        orders: [{ otaOrderId: 'ORD-1' }, { otaOrderId: 'ORD-2' }],
      };
      const task = createBaseTask({
        msgType: 'OTA_IMPORT_ORDER',
        businessId: 'ORD-1',
        data: Buffer.from(JSON.stringify(multiPayload), 'utf-8').toString('base64'),
      });
      expect(() => parseDutyTaskContext(task)).toThrow('单任务仅支持处理单笔订单');
    });

    it('当 task.data 为空字符串或未定义时，提供空对象载荷而不崩溃，渠道为 undefined', () => {
      const task = createBaseTask({ data: '' });
      const context = parseDutyTaskContext(task);
      expect(context.payload).toEqual({});
      expect(context.channelCode).toBeUndefined();
    });

    it('当 task.data 解码后为 JSON 数组时，必须 Fail-Fast 抛出明确异常', () => {
      const task = createBaseTask({
        data: Buffer.from(JSON.stringify(['invalid_array']), 'utf-8').toString('base64'),
      });
      expect(() => parseDutyTaskContext(task)).toThrow('任务 data 解码后必须为非数组的 JSON 对象');
    });

    it('当 task.data 为非法 JSON 字符时，必须 Fail-Fast 抛出 SyntaxError', () => {
      const task = createBaseTask({
        data: Buffer.from('{ illegal_json: ', 'utf-8').toString('base64'),
      });
      expect(() => parseDutyTaskContext(task)).toThrow();
    });
  });
});
