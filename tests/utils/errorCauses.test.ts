import { describe, it, expect } from 'vitest';
import { describeErrorCauses, describeErrorMessage } from '../../src/utils/errorCauses';

/** 构造带 Node 系统错误码的异常 (模拟 socket 层错误，如 ECONNRESET / ETIMEDOUT) */
function createSystemError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('errorCauses - 异常 cause 链诊断展平工具', () => {
  it('非异常输入应返回空字符串', () => {
    expect(describeErrorCauses('fetch failed')).toBe('');
    expect(describeErrorCauses(undefined)).toBe('');
    expect(describeErrorCauses(null)).toBe('');
    expect(describeErrorCauses({ message: 'not an error' })).toBe('');
  });

  it('无 cause 的普通异常应返回空字符串', () => {
    expect(describeErrorCauses(new Error('fetch failed'))).toBe('');
    expect(describeErrorCauses(new TypeError('boom'))).toBe('');
  });

  it('应当展平线上真实样本: TypeError: fetch failed + ECONNRESET cause', () => {
    const cause = createSystemError('ECONNRESET', 'socket hang up');
    const error = new TypeError('fetch failed', { cause });

    expect(describeErrorCauses(error)).toBe(' [cause] [ECONNRESET] socket hang up');
  });

  it('应当保留非通用异常类型名称并标注 DNS 解析失败码', () => {
    const cause = createSystemError('ENOTFOUND', 'getaddrinfo ENOTFOUND bridgex-api.wop.foxhis.com');
    const error = new TypeError('fetch failed', { cause });

    expect(describeErrorCauses(error)).toBe(
      ' [cause] [ENOTFOUND] getaddrinfo ENOTFOUND bridgex-api.wop.foxhis.com'
    );
  });

  it('cause 为自定义异常类型 (无 code) 时应输出类型名称与消息', () => {
    const error = new Error('fetch failed', { cause: new TypeError('invalid URL') });

    expect(describeErrorCauses(error)).toBe(' [cause] TypeError: invalid URL');
  });

  it('多级 cause 链应按层级以 " <- " 连接展平', () => {
    const root = createSystemError('CERT_HAS_EXPIRED', 'certificate has expired');
    const middle = new Error('unable to verify the first certificate', { cause: root });
    const top = new TypeError('fetch failed', { cause: middle });

    expect(describeErrorCauses(top)).toBe(
      ' [cause] unable to verify the first certificate <- [CERT_HAS_EXPIRED] certificate has expired'
    );
  });

  it('超过 maxDepth 的深层链路应被截断到指定深度', () => {
    const l4 = new Error('level-4');
    const l3 = new Error('level-3', { cause: l4 });
    const l2 = new Error('level-2', { cause: l3 });
    const l1 = new Error('level-1', { cause: l2 });
    const top = new Error('top', { cause: l1 });

    expect(describeErrorCauses(top)).toBe(' [cause] level-1 <- level-2 <- level-3');
    expect(describeErrorCauses(top, 2)).toBe(' [cause] level-1 <- level-2');
  });

  it('环状 cause 引用应依靠深度上限安全终止而不死循环', () => {
    const a = new Error('node-a');
    const b = new Error('node-b', { cause: a });
    a.cause = b;

    expect(describeErrorCauses(a)).toBe(' [cause] node-b <- node-a <- node-b');
  });

  it('AggregateError (Happy Eyeballs 双栈连接失败) 应逐项列出聚合明细', () => {
    const cause = new AggregateError(
      [
        createSystemError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:443'),
        createSystemError('ETIMEDOUT', 'connect ETIMEDOUT 10.0.0.2:443'),
      ],
      'Connect Timeout Error'
    );
    const error = new TypeError('fetch failed', { cause });

    expect(describeErrorCauses(error)).toBe(
      ' [cause] AggregateError: Connect Timeout Error ' +
        '(errors: [ECONNREFUSED] connect ECONNREFUSED 10.0.0.1:443; [ETIMEDOUT] connect ETIMEDOUT 10.0.0.2:443)'
    );
  });

  it('cause 为字符串时应原样输出', () => {
    const error = new Error('fetch failed', { cause: 'proxy unreachable' });

    expect(describeErrorCauses(error)).toBe(' [cause] proxy unreachable');
  });

  it('cause 为普通对象时应输出 JSON 序列化形式', () => {
    const error = new Error('fetch failed', { cause: { errno: -3008, syscall: 'getaddrinfo' } });

    expect(describeErrorCauses(error)).toBe(' [cause] {"errno":-3008,"syscall":"getaddrinfo"}');
  });

  it('超长 cause 链应截断到上限长度并以省略号结尾', () => {
    const longMessage = 'x'.repeat(2000);
    const error = new TypeError('fetch failed', {
      cause: createSystemError('ECONNRESET', longMessage),
    });

    const result = describeErrorCauses(error);

    expect(result).toHaveLength(800);
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith(' [cause] [ECONNRESET] xxx')).toBe(true);
  });
});

describe('describeErrorMessage - 统一「错误消息 + cause 链」日志文案', () => {
  it('无 cause 的异常应仅输出 message 本身 (无尾随空格)', () => {
    expect(describeErrorMessage(new TypeError('fetch failed'))).toBe('fetch failed');
  });

  it('非异常输入应输出 String() 形式', () => {
    expect(describeErrorMessage('网络中断')).toBe('网络中断');
    expect(describeErrorMessage(408)).toBe('408');
  });

  it('线上真实样本应以空格分隔 message 与 cause 链', () => {
    const cause = createSystemError('ECONNRESET', 'socket hang up');
    const error = new TypeError('fetch failed', { cause });

    expect(describeErrorMessage(error)).toBe('fetch failed [cause] [ECONNRESET] socket hang up');
  });
});
