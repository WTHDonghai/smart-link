import { describe, it, expect } from 'vitest';
import { describeAutoMappingError } from '../../../src/utils/agent/autoMappingErrorMessages';

/**
 * 自动匹配错误文案人性化（AGENTS.md §3.4.5/§3.4.2）：
 * HTTP 状态码、供应商响应体、环境变量名等原始技术细节不得透出到操作员界面。
 */

describe('describeAutoMappingError 错误文案人性化', () => {
  it('模型配置缺失：不透出环境变量名，给出联系管理员的业务文案', () => {
    const output = describeAutoMappingError(
      'Agent 功能已开启但模型配置缺失: SMARTLINK_AGENT_MODEL_PROVIDER, SMARTLINK_AGENT_MODEL_BASE_URL。请在环境配置文件中补齐后重启应用。'
    );
    expect(output).toBe('智能匹配服务尚未完成配置，请联系管理员处理后再使用');
    expect(output).not.toContain('SMARTLINK_');
  });

  it('HTTP 错误：不透出状态码与供应商响应体', () => {
    const output = describeAutoMappingError(
      '第 2 批 模型调用失败: 模型服务返回 HTTP 503 {"error":{"message":"upstream overloaded","type":"server_error"}}'
    );
    expect(output).toBe('智能匹配服务暂时不可用，请稍后重试；若持续失败请联系管理员');
    expect(output).not.toContain('503');
    expect(output).not.toContain('upstream');
  });

  it('超时、传输失败与协议异常分别给出可行动文案', () => {
    expect(describeAutoMappingError('模型请求超时被中止: The operation was aborted')).toBe(
      '智能匹配服务响应超时，请检查网络后重试'
    );
    expect(describeAutoMappingError('模型请求传输失败: TypeError: fetch failed')).toBe(
      '无法连接智能匹配服务，请检查网络后重试'
    );
    expect(describeAutoMappingError('模型输出不是合法 JSON: {"partial":')).toBe(
      '智能匹配服务返回了异常结果，已停止本次匹配，请稍后重试'
    );
  });

  it('快照契约与追踪确认失败映射为业务文案', () => {
    expect(describeAutoMappingError('映射快照报文不符合契约')).toBe('匹配数据校验未通过，请重新采集产品后再试');
    expect(describeAutoMappingError('终态追踪确认失败: 等待超时')).toBe(
      '匹配结果记录确认失败，请查看处理记录后重新发起匹配'
    );
  });

  it('已知操作引导文案原样透传', () => {
    expect(describeAutoMappingError('请先选择已完成映射的渠道与酒店')).toBe('请先选择已完成映射的渠道与酒店');
    expect(describeAutoMappingError('PMS 房型字典为空或加载失败，自动匹配已停止，请人工核对字典后重试')).toBe(
      'PMS 房型字典为空或加载失败，自动匹配已停止，请人工核对字典后重试'
    );
    expect(describeAutoMappingError('映射总预算（时间）耗尽')).toBe('映射总预算（时间）耗尽');
  });

  it('未识别的原始错误收敛为通用文案，绝不原样透出', () => {
    const output = describeAutoMappingError('TypeError: Cannot read properties of undefined (reading "foo")');
    expect(output).toBe('自动匹配失败，详情请查看处理记录');
    expect(output).not.toContain('TypeError');
  });

  it('空原因返回空串，由调用方兜底', () => {
    expect(describeAutoMappingError(null)).toBe('');
    expect(describeAutoMappingError(undefined)).toBe('');
    expect(describeAutoMappingError('   ')).toBe('');
  });
});
