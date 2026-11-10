/**
 * 值守异常通知去重器（设计 8.2：避免消息轰炸）。
 *
 * 两条去重规则：
 * - 同一 incident 的通知动作只发一次（由工作流保证，单 incident 单次调用）；
 * - 跨重复任务按「渠道 + 订单 + 错误码 + 时间窗口」聚合：窗口内同键重复失败不再重复打扰。
 *
 * 纯内存实现，应用重启后清零（通知去重是体验优化，不是审计数据源）。
 */

export interface IncidentDedupKey {
  channelCode: string;
  orderNo: string;
  errorCode: string;
}

export interface DedupDecision {
  notify: boolean;
  /** notify=false 时的抑制来源与窗口截止时间 */ 
  suppressedUntil?: number;
}

export const DEFAULT_NOTIFY_DEDUP_WINDOW_MS = 30 * 60 * 1000;
const MAX_DEDUP_ENTRIES = 500;

interface DedupEntry {
  key: string;
  expiresAt: number;
}

export class NotificationDeduplicator {
  private entries = new Map<string, DedupEntry>();

  constructor(
    private readonly windowMs: number = DEFAULT_NOTIFY_DEDUP_WINDOW_MS,
    private readonly maxEntries: number = MAX_DEDUP_ENTRIES
  ) {}

  private buildKey(key: IncidentDedupKey): string {
    return `${key.channelCode}|${key.orderNo}|${key.errorCode}`;
  }

  private evictExpired(now: number): void {
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(entryKey);
      }
    }
  }

  /** 判断该键是否应发送通知；应发送时必须随后调用 record 以登记窗口 */ 
  shouldNotify(key: IncidentDedupKey, now: number = Date.now()): DedupDecision {
    this.evictExpired(now);
    const entry = this.entries.get(this.buildKey(key));
    if (entry && entry.expiresAt > now) {
      return { notify: false, suppressedUntil: entry.expiresAt };
    }
    return { notify: true };
  }

  /** 登记已发送的通知，开启聚合时间窗口（容量上限淘汰最早项） */ 
  record(key: IncidentDedupKey, now: number = Date.now()): void {
    const dedupKey = this.buildKey(key);
    this.entries.delete(dedupKey);
    this.entries.set(dedupKey, { key: dedupKey, expiresAt: now + this.windowMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** 主动清除指定键（如人工确认处理后允许再次提醒） */ 
  release(key: IncidentDedupKey): void {
    this.entries.delete(this.buildKey(key));
  }
}
