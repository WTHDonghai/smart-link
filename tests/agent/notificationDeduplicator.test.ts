import { describe, it, expect } from 'vitest';
import { NotificationDeduplicator } from '../../src/agent/notificationDeduplicator';

describe('NotificationDeduplicator 聚合去重', () => {
  it('窗口内同键重复失败被抑制并返回窗口截止时间', () => {
    const deduplicator = new NotificationDeduplicator(30 * 60 * 1000);
    const key = { channelCode: 'MEITUAN', orderNo: 'ORD-1', errorCode: 'RISK_VERIFICATION_REQUIRED' };

    expect(deduplicator.shouldNotify(key, 1000)).toEqual({ notify: true });

    deduplicator.record(key, 1000);

    const suppressed = deduplicator.shouldNotify(key, 2000);
    expect(suppressed.notify).toBe(false);
    expect(suppressed.suppressedUntil).toBe(1000 + 30 * 60 * 1000);
  });

  it('不同订单或不同错误码互不抑制', () => {
    const deduplicator = new NotificationDeduplicator();
    deduplicator.record({ channelCode: 'MEITUAN', orderNo: 'ORD-1', errorCode: 'A' }, 1000);

    expect(deduplicator.shouldNotify({ channelCode: 'MEITUAN', orderNo: 'ORD-2', errorCode: 'A' }, 2000).notify).toBe(true);
    expect(deduplicator.shouldNotify({ channelCode: 'MEITUAN', orderNo: 'ORD-1', errorCode: 'B' }, 2000).notify).toBe(true);
    expect(deduplicator.shouldNotify({ channelCode: 'DOUYIN', orderNo: 'ORD-1', errorCode: 'A' }, 2000).notify).toBe(true);
  });

  it('窗口过期后可再次通知', () => {
    const deduplicator = new NotificationDeduplicator(1000);
    const key = { channelCode: 'MEITUAN', orderNo: 'ORD-1', errorCode: 'A' };
    deduplicator.record(key, 1000);

    expect(deduplicator.shouldNotify(key, 1500).notify).toBe(false);
    expect(deduplicator.shouldNotify(key, 1001 + 1000).notify).toBe(true);
  });

  it('release 主动解除抑制（人工处理后允许再次提醒）', () => {
    const deduplicator = new NotificationDeduplicator();
    const key = { channelCode: 'MEITUAN', orderNo: 'ORD-1', errorCode: 'A' };
    deduplicator.record(key, 1000);
    deduplicator.release(key);
    expect(deduplicator.shouldNotify(key, 1100).notify).toBe(true);
  });

  it('容量上限淘汰最早项', () => {
    const deduplicator = new NotificationDeduplicator(60_000, 2);
    deduplicator.record({ channelCode: 'C', orderNo: '1', errorCode: 'A' }, 1000);
    deduplicator.record({ channelCode: 'C', orderNo: '2', errorCode: 'A' }, 1000);
    deduplicator.record({ channelCode: 'C', orderNo: '3', errorCode: 'A' }, 1000);

    expect(deduplicator.shouldNotify({ channelCode: 'C', orderNo: '1', errorCode: 'A' }, 2000).notify).toBe(true);
    expect(deduplicator.shouldNotify({ channelCode: 'C', orderNo: '3', errorCode: 'A' }, 2000).notify).toBe(false);
  });
});
