import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimpleTtlCache } from '../../src/utils/ttlCache';

describe('SimpleTtlCache (Generic TTL Cache with Singleflight Stampede Protection)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('1. 基础存取与状态检查 (Basic Operations)', () => {
    it('initializes empty and correctly reports size and has', () => {
      const cache = new SimpleTtlCache<string, string>();
      expect(cache.size()).toBe(0);
      expect(cache.has('k1')).toBe(false);
      expect(cache.get('k1')).toBeUndefined();
    });

    it('sets and retrieves items within TTL', () => {
      const cache = new SimpleTtlCache<string, number>(5000);
      cache.set('count', 42);

      expect(cache.has('count')).toBe(true);
      expect(cache.get('count')).toBe(42);
      expect(cache.size()).toBe(1);
    });

    it('supports caching null values correctly without treating as missing', () => {
      const cache = new SimpleTtlCache<string, string | null>(5000);
      cache.set('template', null);

      expect(cache.has('template')).toBe(true);
      expect(cache.get('template')).toBeNull();
      expect(cache.size()).toBe(1);
    });

    it('overwrites existing keys with new data and refreshed TTL', () => {
      const cache = new SimpleTtlCache<string, string>(10_000);
      cache.set('key1', 'val1');
      expect(cache.get('key1')).toBe('val1');

      cache.set('key1', 'val2');
      expect(cache.get('key1')).toBe('val2');
      expect(cache.size()).toBe(1);
    });
  });

  describe('2. TTL 到期淘汰 (TTL Expiration Eviction)', () => {
    it('expires and evicts data after TTL passes using fake timers', () => {
      vi.useFakeTimers();
      const cache = new SimpleTtlCache<string, string>(1000);
      cache.set('session', 'active', 500);

      expect(cache.has('session')).toBe(true);
      expect(cache.get('session')).toBe('active');
      expect(cache.size()).toBe(1);

      // 前进 499ms，依然有效
      vi.advanceTimersByTime(499);
      expect(cache.has('session')).toBe(true);
      expect(cache.get('session')).toBe('active');

      // 前进到 501ms，已过期
      vi.advanceTimersByTime(2);
      expect(cache.has('session')).toBe(false);
      expect(cache.get('session')).toBeUndefined();
      expect(cache.size()).toBe(0);
    });

    it('cleans up expired entries during size() calculation', () => {
      vi.useFakeTimers();
      const cache = new SimpleTtlCache<string, string>();
      cache.set('a', 'valA', 100);
      cache.set('b', 'valB', 300);

      expect(cache.size()).toBe(2);

      vi.advanceTimersByTime(150);
      // a 已过期，b 依然有效
      expect(cache.size()).toBe(1);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
    });
  });

  describe('3. 主动精准失效与全量清空 (Invalidation & Clear)', () => {
    it('invalidates specific key without affecting other keys', () => {
      const cache = new SimpleTtlCache<string, string>();
      cache.set('channel:MEITUAN', 'tmpl-meituan');
      cache.set('channel:CTRIP', 'tmpl-ctrip');

      expect(cache.size()).toBe(2);

      cache.invalidate('channel:MEITUAN');

      expect(cache.has('channel:MEITUAN')).toBe(false);
      expect(cache.get('channel:MEITUAN')).toBeUndefined();
      expect(cache.has('channel:CTRIP')).toBe(true);
      expect(cache.get('channel:CTRIP')).toBe('tmpl-ctrip');
      expect(cache.size()).toBe(1);
    });

    it('clears all cached items and in-flight promises', () => {
      const cache = new SimpleTtlCache<string, string>();
      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      cache.set('k3', 'v3');

      expect(cache.size()).toBe(3);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has('k1')).toBe(false);
      expect(cache.has('k2')).toBe(false);
      expect(cache.has('k3')).toBe(false);
    });
  });

  describe('4. 并发合并 Singleflight 防击穿 (getOrFetch)', () => {
    it('returns cached value immediately without invoking fetcher when available', async () => {
      const cache = new SimpleTtlCache<string, string>();
      cache.set('hotel:100', 'Hilton');

      const fetcher = vi.fn().mockResolvedValue('Sheraton');
      const result = await cache.getOrFetch('hotel:100', fetcher);

      expect(result).toBe('Hilton');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('invokes fetcher on cache miss and caches the result', async () => {
      const cache = new SimpleTtlCache<string, string>();
      const fetcher = vi.fn().mockResolvedValue('Fetched Value');

      const result = await cache.getOrFetch('k1', fetcher, 5000);

      expect(result).toBe('Fetched Value');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cache.get('k1')).toBe('Fetched Value');

      // 第二次调用直接命中缓存
      const cachedResult = await cache.getOrFetch('k1', fetcher);
      expect(cachedResult).toBe('Fetched Value');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('merges multiple concurrent in-flight requests into a single promise (Singleflight)', async () => {
      const cache = new SimpleTtlCache<string, string>();
      let resolveFetcher: (val: string) => void;
      const fetcherPromise = new Promise<string>((resolve) => {
        resolveFetcher = resolve;
      });
      const fetcher = vi.fn(() => fetcherPromise);

      // 同时发起 3 个并发调用
      const p1 = cache.getOrFetch('shared_key', fetcher);
      const p2 = cache.getOrFetch('shared_key', fetcher);
      const p3 = cache.getOrFetch('shared_key', fetcher);

      // fetcher 仅应被触发一次
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 释放 fetcher 结果
      resolveFetcher!('Resolved Singleflight Result');

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1).toBe('Resolved Singleflight Result');
      expect(r2).toBe('Resolved Singleflight Result');
      expect(r3).toBe('Resolved Singleflight Result');

      // 后续请求直接读缓存
      expect(cache.get('shared_key')).toBe('Resolved Singleflight Result');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('cleans up inFlight state on fetcher failure and allows subsequent retries', async () => {
      const cache = new SimpleTtlCache<string, string>();
      let attempt = 0;
      const failingFetcher = vi.fn(async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error('Network fetch failed');
        }
        return 'Retry Success';
      });

      // 第一次请求失败
      await expect(cache.getOrFetch('fail_key', failingFetcher)).rejects.toThrow('Network fetch failed');
      expect(failingFetcher).toHaveBeenCalledTimes(1);

      // 验证 inFlight 已被清理且缓存未被污染
      expect(cache.has('fail_key')).toBe(false);

      // 第二次请求应当能重新发起并成功
      const retryResult = await cache.getOrFetch('fail_key', failingFetcher);
      expect(retryResult).toBe('Retry Success');
      expect(failingFetcher).toHaveBeenCalledTimes(2);
      expect(cache.get('fail_key')).toBe('Retry Success');
    });

    it('handles invalidate while fetcher is in-flight properly', async () => {
      const cache = new SimpleTtlCache<string, string>();
      let resolveFetcher: (val: string) => void;
      const p = new Promise<string>((resolve) => {
        resolveFetcher = resolve;
      });
      const fetcher = vi.fn(() => p);

      const inflight = cache.getOrFetch('key_inv', fetcher);
      cache.invalidate('key_inv');

      resolveFetcher!('Done');
      const res = await inflight;
      expect(res).toBe('Done');
      // 验证已失效的键不会被在途结果复活写入缓存
      expect(cache.has('key_inv')).toBe(false);
      expect(cache.get('key_inv')).toBeUndefined();
    });
  });
});
