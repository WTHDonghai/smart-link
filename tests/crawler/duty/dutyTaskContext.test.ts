import { describe, it, expect } from 'vitest';
import {
  parseDutyTaskContext,
  extractTaskChannelCode,
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

  describe('extractTaskChannelCode', () => {
    it('OTA_COLLECT_ORDER 应优先从 otaChannelCode 提取渠道并转为大写', () => {
      const task = createBaseTask({ msgType: 'OTA_COLLECT_ORDER' });
      const channel = extractTaskChannelCode(task, { otaChannelCode: 'ctrip' });
      expect(channel).toBe('CTRIP');
    });

    it('OTA_CONFIRM_IMPORT 应从 channelCode 提取渠道', () => {
      const task = createBaseTask({ msgType: 'OTA_CONFIRM_IMPORT' });
      const channel = extractTaskChannelCode(task, { channelCode: 'douyin' });
      expect(channel).toBe('DOUYIN');
    });

    it('OTA_CONFIRM_CANCEL 应从 channelCode 提取渠道', () => {
      const task = createBaseTask({ msgType: 'OTA_CONFIRM_CANCEL' });
      const channel = extractTaskChannelCode(task, { channelCode: 'meituan' });
      expect(channel).toBe('MEITUAN');
    });

    it('OTA_IMPORT_ORDER 应支持 channel, otaChannelCode 与 orders[0].otaChannel 提取', () => {
      const task = createBaseTask({ msgType: 'OTA_IMPORT_ORDER' });
      expect(extractTaskChannelCode(task, { channel: 'fliggy' })).toBe('FLIGGY');
      expect(extractTaskChannelCode(task, { otaChannelCode: 'ctrip' })).toBe('CTRIP');
      expect(extractTaskChannelCode(task, { orders: [{ otaChannel: 'meituan' }] })).toBe('MEITUAN');
    });

    it('未提供任何渠道标识或仅提供空白字符时，应收敛默认渠道为 MEITUAN', () => {
      const task = createBaseTask({ msgType: 'OTA_COLLECT_ORDER' });
      expect(extractTaskChannelCode(task, {})).toBe('MEITUAN');
      expect(extractTaskChannelCode(task, { channelCode: '   ' })).toBe('MEITUAN');
      expect(extractTaskChannelCode(task, { otaChannelCode: ' ' })).toBe('MEITUAN');
      expect(extractTaskChannelCode(task, { channel: '' })).toBe('MEITUAN');
    });
  });

  describe('extractTaskOrderNo', () => {
    it('优先提取 orders[0].otaOrderId', () => {
      const task = createBaseTask();
      const payload = {
        orders: [{ otaOrderId: 'ORD-FIRST-01', orderId: 'ORD-FIRST-02' }],
        otaOrderId: 'ORD-PAYLOAD-01',
      };
      expect(extractTaskOrderNo(task, payload)).toBe('ORD-FIRST-01');
    });

    it('当 orders[0].otaOrderId 不存在时，提取 orders[0].orderId', () => {
      const task = createBaseTask();
      const payload = {
        orders: [{ orderId: 'ORD-FALLBACK-01' }],
        otaOrderId: 'ORD-PAYLOAD-01',
      };
      expect(extractTaskOrderNo(task, payload)).toBe('ORD-FALLBACK-01');
    });

    it('当 orders 数组不存在时，提取 payload.otaOrderId', () => {
      const task = createBaseTask();
      const payload = { otaOrderId: 'ORD-TOP-01' };
      expect(extractTaskOrderNo(task, payload)).toBe('ORD-TOP-01');
    });

    it('当 payload.otaOrderId 不存在时，提取 payload.orderId', () => {
      const task = createBaseTask();
      const payload = { orderId: 'ORD-TOP-02' };
      expect(extractTaskOrderNo(task, payload)).toBe('ORD-TOP-02');
    });

    it('非采集任务且 payload 均无单号时，回退提取 task.businessId', () => {
      const task = createBaseTask({ msgType: 'OTA_IMPORT_ORDER', businessId: 'BIZ-FALLBACK-999' });
      expect(extractTaskOrderNo(task, {})).toBe('BIZ-FALLBACK-999');
    });

    it('支持纯数字类型的订单号鲁棒转换提取', () => {
      const task = createBaseTask();
      const payloadWithNumeric = {
        orders: [{ otaOrderId: 99887766 }],
      };
      expect(extractTaskOrderNo(task, payloadWithNumeric)).toBe('99887766');

      const payloadDirectNumeric = {
        otaOrderId: 11223344,
      };
      expect(extractTaskOrderNo(task, payloadDirectNumeric)).toBe('11223344');
    });

    it('支持提取 orders[0].orderNo 与 payload.orderNo', () => {
      const task = createBaseTask();
      expect(extractTaskOrderNo(task, { orders: [{ orderNo: 'ORD-NO-01' }] })).toBe('ORD-NO-01');
      expect(extractTaskOrderNo(task, { orderNo: 'ORD-NO-02' })).toBe('ORD-NO-02');
    });

    it('采集任务 (OTA_COLLECT_ORDER) 不应回退 businessId 作为订单号', () => {
      const task = createBaseTask({ msgType: 'OTA_COLLECT_ORDER', businessId: 'BIZ-COLLECT-SESSION' });
      expect(extractTaskOrderNo(task, {})).toBeUndefined();
    });
  });

  describe('parseDutyTaskContext', () => {
    it('成功解析 Base64 编码的合规 JSON 对象并构建统一上下文', () => {
      const payloadObj = {
        otaChannelCode: 'CTRIP',
        otaOrderId: 'CTRIP-ORD-888',
        extUnitCode: 'HOTEL-101',
      };
      const task = createBaseTask({
        msgType: 'OTA_IMPORT_ORDER',
        businessId: 'BIZ-MAIN-001',
        data: Buffer.from(JSON.stringify(payloadObj), 'utf-8').toString('base64'),
      });

      const context = parseDutyTaskContext(task);
      expect(context.task).toBe(task);
      expect(context.channelCode).toBe('CTRIP');
      expect(context.orderNo).toBe('CTRIP-ORD-888');
      expect(context.businessId).toBe('BIZ-MAIN-001');
      expect(context.payload).toEqual(payloadObj);
    });

    it('当 task.data 为空字符串或未定义时，提供空对象载荷而不崩溃', () => {
      const task = createBaseTask({ data: '' });
      const context = parseDutyTaskContext(task);
      expect(context.payload).toEqual({});
      expect(context.channelCode).toBe('MEITUAN');
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
