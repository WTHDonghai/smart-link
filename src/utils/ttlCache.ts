/**
 * 通用内存级 TTL 缓存抽象类
 * 支持自动过期淘汰、精准主动失效、并发合并 Singleflight 防击穿
 */

interface CacheEntry<V> {
  data: V;
  expiresAt: number;
}

export class SimpleTtlCache<K, V> {
  private readonly cache = new Map<K, CacheEntry<V>>();
  private readonly inFlight = new Map<K, Promise<V>>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * 获取缓存数据，若已过期则自动清理并返回 undefined
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (performance.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  /**
   * 写入缓存，支持自定义 TTL（毫秒）
   */
  set(key: K, data: V, ttlMs?: number): void {
    const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    this.cache.set(key, {
      data,
      expiresAt: performance.now() + ttl,
    });
  }

  /**
   * 按 key 精准淘汰缓存与在途请求
   */
  invalidate(key: K): void {
    this.cache.delete(key);
    this.inFlight.delete(key);
  }

  /**
   * 清空全部缓存与在途请求
   */
  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * 检查指定 key 是否存在有效（未过期）缓存
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    if (performance.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 获取当前有效（未过期）缓存条目数量
   */
  size(): number {
    const now = performance.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
    return this.cache.size;
  }

  /**
   * 获取或异步拉取数据
   * 具备 Singleflight 并发请求合并能力，同一 key 的并发在途请求复用同一个 Promise 防击穿
   */
  async getOrFetch(
    key: K,
    fetcher: () => Promise<V>,
    ttlMs?: number
  ): Promise<V> {
    if (this.has(key)) {
      return this.get(key) as V;
    }

    const existingPromise = this.inFlight.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    let inFlightPromise: Promise<V> | null = null;
    const execute = async (): Promise<V> => {
      try {
        const data = await fetcher();
        // 关键并发防护：若拉取期间缓存被显式 invalidate 或 clear，则不将已失效的陈旧数据写入
        if (inFlightPromise && this.inFlight.get(key) === inFlightPromise) {
          this.set(key, data, ttlMs);
        }
        return data;
      } finally {
        if (inFlightPromise && this.inFlight.get(key) === inFlightPromise) {
          this.inFlight.delete(key);
        }
      }
    };

    inFlightPromise = execute();
    this.inFlight.set(key, inFlightPromise);
    return inFlightPromise;
  }
}
