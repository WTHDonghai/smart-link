import { describe, expect, it } from 'vitest';
import { OTA_RISK_TEXT_PATTERN } from '@/src/utils/otaRiskPatterns';

describe('OTA 风控文本特征契约', () => {
  it.each([
    '安全验证',
    '为确认是你本人，请完成安全验证',
    '登录验证',
    '人机验证',
    '请完成人机验证',
    '人工验证',
    '请输入验证码',
    '拖动滑块完成拼图',
    '滑动验证',
    '请完成验证后继续',
    '验证一下，确保是你本人操作',
    '访问频繁',
    '操作频繁，请稍后再试',
    'secsdk captcha',
    'yoda challenge',
  ])('真实验证/风控提示命中：%s', (text) => {
    expect(OTA_RISK_TEXT_PATTERN.test(text)).toBe(true);
  });

  it.each([
    // 客户环境真实备注：「无人机」包含「人机」，曾整页误报人工校验告警
    '不要角落房；要看到无人机表演和烟花的房间，谢谢',
    '无人机表演',
    '无人机',
    // 其他业务文本中的裸短词
    '需要验证码入住',
    '凭验证码入住',
    '验证码后四位见短信',
    '人机工程学床垫',
    '新订待确认',
    '买家申请取消/退款',
    '',
  ])('顾客备注等业务文本不命中：%s', (text) => {
    expect(OTA_RISK_TEXT_PATTERN.test(text)).toBe(false);
  });
});
