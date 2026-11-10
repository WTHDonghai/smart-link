import { describe, it, expect } from 'vitest';
import {
  readAgentNotificationConfig,
  DEFAULT_AGENT_NOTIFY_TIMEOUT_MS,
} from '../../src/config/agentNotificationConfig';
import { PROCESS_ENV_KEYS } from '../../src/types/env';

/**
 * Agent 通知配置预留（最省事路径：群机器人 webhook + 环境变量手工配置）。
 */

function buildEnabledEnv(overrides?: Record<string, string>): Record<string, string | undefined> {
  return {
    [PROCESS_ENV_KEYS.agentNotifyEnabled]: 'true',
    [PROCESS_ENV_KEYS.agentNotifyWebhookType]: 'wecom',
    [PROCESS_ENV_KEYS.agentNotifyWebhookUrl]: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    ...overrides,
  };
}

describe('readAgentNotificationConfig 开关与默认值', () => {
  it('未配置时返回关闭态配置，不强制任何项', () => {
    const config = readAgentNotificationConfig({});
    expect(config.enabled).toBe(false);
    expect(config.webhookUrl).toBe('');
    expect(config.timeoutMs).toBe(DEFAULT_AGENT_NOTIFY_TIMEOUT_MS);
  });

  it('开关支持 1/true/yes/on，空串与 false 视为关闭', () => {
    expect(readAgentNotificationConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentNotifyEnabled]: '1' })).enabled).toBe(true);
    expect(readAgentNotificationConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentNotifyEnabled]: 'ON' })).enabled).toBe(true);
    expect(readAgentNotificationConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentNotifyEnabled]: 'false' })).enabled).toBe(false);
  });

  it('关闭状态下已提供的取值仍立即校验（配置错误不得静默沉睡）', () => {
    expect(() =>
      readAgentNotificationConfig({
        [PROCESS_ENV_KEYS.agentNotifyEnabled]: 'false',
        [PROCESS_ENV_KEYS.agentNotifyWebhookType]: 'sms',
      })
    ).toThrow('SMARTLINK_AGENT_NOTIFY_WEBHOOK_TYPE 必须为 wecom / dingtalk / feishu 之一');

    expect(() =>
      readAgentNotificationConfig({
        [PROCESS_ENV_KEYS.agentNotifyEnabled]: 'false',
        [PROCESS_ENV_KEYS.agentNotifyTimeoutMs]: '-5',
      })
    ).toThrow('SMARTLINK_AGENT_NOTIFY_TIMEOUT_MS 必须为正整数');
  });

  it('完整配置被精确解析（含钉钉加签密钥与自定义超时）', () => {
    const config = readAgentNotificationConfig(
      buildEnabledEnv({
        [PROCESS_ENV_KEYS.agentNotifyWebhookType]: 'dingtalk',
        [PROCESS_ENV_KEYS.agentNotifyWebhookUrl]: 'https://oapi.dingtalk.com/robot/send?access_token=tok',
        [PROCESS_ENV_KEYS.agentNotifyDingtalkSecret]: 'SECxxxx',
        [PROCESS_ENV_KEYS.agentNotifyTimeoutMs]: '5000',
      })
    );
    expect(config.enabled).toBe(true);
    expect(config.webhookType).toBe('dingtalk');
    expect(config.dingtalkSecret).toBe('SECxxxx');
    expect(config.timeoutMs).toBe(5000);
  });
});

describe('readAgentNotificationConfig Fail-Fast 校验', () => {
  it('开启但缺少类型或地址：逐项列明缺失键', () => {
    expect(() => readAgentNotificationConfig({ [PROCESS_ENV_KEYS.agentNotifyEnabled]: 'true' })).toThrow(
      'Agent 通知已开启但配置缺失: SMARTLINK_AGENT_NOTIFY_WEBHOOK_TYPE, SMARTLINK_AGENT_NOTIFY_WEBHOOK_URL。请在环境配置文件中补齐后重启应用。'
    );
  });

  it('webhook 地址必须为 https 且非法时报错不回显地址（含密钥）', () => {
    const secretUrl = 'http://intranet.example.com/hook?key=sk-secret-999';
    let errorMessage = '';
    try {
      readAgentNotificationConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentNotifyWebhookUrl]: secretUrl }));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    expect(errorMessage).toContain('必须为 https 地址');
    expect(errorMessage).not.toContain('sk-secret-999');

    expect(() =>
      readAgentNotificationConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentNotifyWebhookUrl]: 'not-a-url' }))
    ).toThrow('不是合法 URL');
  });

  it('空白字符串视为缺失', () => {
    expect(() =>
      readAgentNotificationConfig(buildEnabledEnv({ [PROCESS_ENV_KEYS.agentNotifyWebhookUrl]: '   ' }))
    ).toThrow('Agent 通知已开启但配置缺失: SMARTLINK_AGENT_NOTIFY_WEBHOOK_URL。');
  });
});
