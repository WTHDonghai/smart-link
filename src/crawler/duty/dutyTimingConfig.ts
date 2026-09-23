import type { Locator } from 'playwright';
import { SYSTEM_TIMING } from '../../config/timing';

/**
 * 自动化操作与控件交互 SLA 超时阶梯 (毫秒)
 */
export const ACTION_TIMEOUT = {
  /** 1. 瞬时微探测级 (Fast Probe): 150ms，用于弹窗轮询等密集且免阻塞的极速探查 */
  FAST_PROBE: 150,

  /** 2. 极速探查级 (Probe / Fast Check): 500ms，用于当前 DOM 状态核验、无动画静态元素快速判定 */
  PROBE: 500,

  /** 2. 轻量脱敏字段级 (Sensitive Field Reveal): 1,000ms，用于姓名/手机号脱敏查看按钮快速探查 */
  SENSITIVE_FIELD: 1_000,

  /** 3. 交互控件级 (Element / Micro Action): 1,500ms，用于输入框、按钮、关闭图标可见性检测 */
  ELEMENT: 1_500,

  /** 4. 快捷操作级 (Quick Action / Card Check): 2,000ms，用于列表订单卡片快速判定与就绪 */
  QUICK_ACTION: 2_000,

  /** 5. 模态与动效级 (Modal / Animation): 2,500ms，用于带动画过渡的弹窗、气泡提示或抽屉就绪 */
  MODAL: 2_500,

  /** 6. 关键交互/Tab 切换级 (Interactive Click): 5,000ms，用于列表 Tab 切换点击操作 */
  CLICK: 5_000,

  /** 7. 网络拦截与数据源级 (Network Interception): 8,000ms，用于 Playwright waitForResponse 等待接口响应 */
  NETWORK: 8_000,

  /** 8. 页面骨架挂载级 (Page Container Ready): 15,000ms，等待主应用容器或 iframe 骨架载入就绪 */
  PAGE_CONTAINER_READY: 15_000,

  /** 9. 页面冷启动导航级 (Page Navigation): 45,000ms，用于初始 page.goto 页面载入 */
  PAGE_NAVIGATION: 45_000,
} as const;

/**
 * 拟人化操作延迟区间 (毫秒元组 [minMs, maxMs])，用于模拟真人操作习惯，规避风控拦截
 */
export const HUMAN_DELAY = {
  /** 微步与动效间歇 (点击后缓冲、DOM 刷新缓冲): 1.0s ~ 2.0s */
  SHORT: [1_000, 2_000] as const,

  /** 关键交互与脱敏查看间隙 (如姓名/电话脱敏查看、弹窗确认后缓冲): 1.5s ~ 3.0s */
  MEDIUM: [1_500, 3_000] as const,

  /** 敏感解密单项缓冲 (查看电话/姓名后细粒度等待): 1.5s ~ 2.5s */
  SENSITIVE_REVEAL: [1_500, 2_500] as const,

  /** 页面冷启动沉淀缓冲 (Vue/React 状态机与事件绑定稳定): 3.0s ~ 8.0s */
  SETTLING: [3_000, 8_000] as const,
} as const;

export { SYSTEM_TIMING };

/**
 * 渠道值守时序策略规范契约
 */
export interface ChannelDutyTimingPolicy {
  readonly action: typeof ACTION_TIMEOUT;
  readonly humanDelay: typeof HUMAN_DELAY;
  readonly system: typeof SYSTEM_TIMING;
}

export const DEFAULT_DUTY_TIMING: ChannelDutyTimingPolicy = {
  action: ACTION_TIMEOUT,
  humanDelay: HUMAN_DELAY,
  system: SYSTEM_TIMING,
};

/**
 * 获取当前生效的延时缩放系数 (默认为 1.0)
 * 可通过 process.env.SMARTLINK_TIMING_SCALE 进行全局调优 (例如弱网模式 1.5，极速单测模式 0.1)
 */
export function getTimingScale(): number {
  const raw = typeof process !== 'undefined' ? process.env?.SMARTLINK_TIMING_SCALE : undefined;
  if (!raw) return 1.0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1.0;
  return parsed;
}

/**
 * 计算按比例缩放后的超时毫秒数 (向上取整并保障最小 10ms)
 */
export function getScaledTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 0;
  const scale = getTimingScale();
  return Math.max(10, Math.round(timeoutMs * scale));
}

/**
 * 计算按比例缩放后的拟人延时范围
 */
export function getScaledDelayRange(minMs: number, maxMs: number): [number, number] {
  const safeMin = Number.isFinite(minMs) ? minMs : 0;
  const safeMax = Number.isFinite(maxMs) ? maxMs : safeMin;
  const scale = getTimingScale();
  const scaledMin = Math.max(0, Math.round(safeMin * scale));
  const scaledMax = Math.max(scaledMin, Math.round(safeMax * scale));
  return [scaledMin, scaledMax];
}

/**
 * 语义化 Playwright 操作算子 (Playwright Semantic Helpers)
 * 彻底消除业务代码中的 { timeout: ... } 和 .catch(() => false)
 */

/** 快速探查目标 Locator 在页面中是否可见 (默认 SLA 500ms) */
export async function isProbeVisible(
  locator: Locator,
  timeout: number = ACTION_TIMEOUT.PROBE
): Promise<boolean> {
  if (!locator || typeof locator.isVisible !== 'function') return false;
  return locator.isVisible({ timeout: getScaledTimeout(timeout) }).catch(() => false);
}

/** 探查常规控件或输入框在页面中是否可见 (默认 SLA 1500ms) */
export async function isElementVisible(
  locator: Locator,
  timeout: number = ACTION_TIMEOUT.ELEMENT
): Promise<boolean> {
  if (!locator || typeof locator.isVisible !== 'function') return false;
  return locator.isVisible({ timeout: getScaledTimeout(timeout) }).catch(() => false);
}

/** 探查模态弹窗或动画容器在页面中是否可见 (默认 SLA 2500ms) */
export async function isModalVisible(
  locator: Locator,
  timeout: number = ACTION_TIMEOUT.MODAL
): Promise<boolean> {
  if (!locator || typeof locator.isVisible !== 'function') return false;
  return locator.isVisible({ timeout: getScaledTimeout(timeout) }).catch(() => false);
}
