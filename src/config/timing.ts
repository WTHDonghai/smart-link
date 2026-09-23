/**
 * 系统级通信、调度与生命周期时限基准配置 (System Timing & Lifecycle Benchmark)
 * 供服务层 (src/services/) 与自动化引擎层 (src/crawler/) 共同遵循
 */
export const SYSTEM_TIMING = {
  /** 中台任务认领长轮询超时 (POST /toolkit/toolbox/task-claims): 75s */
  CLAIM_LONG_POLL: 75_000,

  /** 工位状态心跳上报周期 (POST /toolkit/toolbox/actual-state/report): 60s */
  HEARTBEAT_INTERVAL: 60_000,

  /** 任务空闲轮询随机抖动基础值: 2,000ms */
  CLAIM_IDLE_JITTER_BASE: 2_000,
  /** 任务空闲轮询随机抖动浮动量: 500ms */
  CLAIM_IDLE_JITTER_SPREAD: 500,

  /** 调度器异常退避等待重试时延: 3,000ms */
  CLAIM_BACKOFF: 3_000,

  /** 列表刷新防抖安全时间间隔: 3,000ms */
  REFRESH_DEBOUNCE: 3_000,

  /** 渠道备注模板内存级 TTL 缓存有效期: 10 分钟 */
  TEMPLATE_CACHE_TTL: 10 * 60 * 1000,
} as const;
