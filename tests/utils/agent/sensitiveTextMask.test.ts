import { describe, it, expect } from 'vitest';
import { maskSensitiveText } from '../../../src/utils/agent/sensitiveTextMask';

/**
 * 证据脱敏（设计 7.1/9.8）：手机号、身份证形态与长数字串在进入模型与通知前必须掩码。
 */

describe('maskSensitiveText 证据脱敏', () => {
  it('手机号、身份证与长数字串被掩码，普通文本不受影响', () => {
    expect(maskSensitiveText('联系 13812345678 确认')).toBe('联系 138****5678 确认');
    expect(maskSensitiveText('证件 11010119900307867X')).toBe('证件 1101************7X');
    expect(maskSensitiveText('单号 202611031234567')).toBe('单号 202****67');
    expect(maskSensitiveText('订单 ORD-1001 已导入')).toBe('订单 ORD-1001 已导入');
  });

  it('错误信息中的连续敏感片段同样掩码（诊断输入脱敏场景）', () => {
    expect(maskSensitiveText('入住人 13998887777 下单失败')).toBe('入住人 139****7777 下单失败');
  });
});
