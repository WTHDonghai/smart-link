import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Locator } from 'playwright';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  SYSTEM_TIMING,
  DEFAULT_DUTY_TIMING,
  getTimingScale,
  getScaledTimeout,
  getScaledDelayRange,
  isProbeVisible,
  isElementVisible,
  isModalVisible,
} from '../../../src/crawler/duty/dutyTimingConfig';

describe('dutyTimingConfig', () => {
  const originalScale = process.env.SMARTLINK_TIMING_SCALE;

  afterEach(() => {
    if (originalScale !== undefined) {
      process.env.SMARTLINK_TIMING_SCALE = originalScale;
    } else {
      delete process.env.SMARTLINK_TIMING_SCALE;
    }
  });

  describe('SLA 常量契约核对', () => {
    it('ACTION_TIMEOUT 应保持严格的分层阶梯数值', () => {
      expect(ACTION_TIMEOUT.FAST_PROBE).toBe(150);
      expect(ACTION_TIMEOUT.PROBE).toBe(500);
      expect(ACTION_TIMEOUT.SENSITIVE_FIELD).toBe(1000);
      expect(ACTION_TIMEOUT.ELEMENT).toBe(1500);
      expect(ACTION_TIMEOUT.QUICK_ACTION).toBe(2000);
      expect(ACTION_TIMEOUT.MODAL).toBe(2500);
      expect(ACTION_TIMEOUT.CLICK).toBe(5000);
      expect(ACTION_TIMEOUT.NETWORK).toBe(8000);
      expect(ACTION_TIMEOUT.PAGE_CONTAINER_READY).toBe(15000);
      expect(ACTION_TIMEOUT.PAGE_NAVIGATION).toBe(45000);
    });

    it('HUMAN_DELAY 应保持正确的拟人时延范围区间', () => {
      expect(HUMAN_DELAY.SHORT).toEqual([1000, 2000]);
      expect(HUMAN_DELAY.MEDIUM).toEqual([1500, 3000]);
      expect(HUMAN_DELAY.SENSITIVE_REVEAL).toEqual([1500, 2500]);
      expect(HUMAN_DELAY.SETTLING).toEqual([3000, 8000]);
    });

    it('SYSTEM_TIMING 应保持系统级时序基准', () => {
      expect(SYSTEM_TIMING.CLAIM_LONG_POLL).toBe(75000);
      expect(SYSTEM_TIMING.HEARTBEAT_INTERVAL).toBe(60000);
      expect(SYSTEM_TIMING.CLAIM_IDLE_JITTER_BASE).toBe(2000);
      expect(SYSTEM_TIMING.CLAIM_IDLE_JITTER_SPREAD).toBe(500);
      expect(SYSTEM_TIMING.CLAIM_BACKOFF).toBe(3000);
      expect(SYSTEM_TIMING.REFRESH_DEBOUNCE).toBe(3000);
      expect(SYSTEM_TIMING.TEMPLATE_CACHE_TTL).toBe(10 * 60 * 1000);
    });

    it('DEFAULT_DUTY_TIMING 应完整组装子系统策略', () => {
      expect(DEFAULT_DUTY_TIMING.action).toBe(ACTION_TIMEOUT);
      expect(DEFAULT_DUTY_TIMING.humanDelay).toBe(HUMAN_DELAY);
      expect(DEFAULT_DUTY_TIMING.system).toBe(SYSTEM_TIMING);

      expect(DEFAULT_DUTY_TIMING.action.NETWORK).toBe(8000);
      expect(DEFAULT_DUTY_TIMING.system.REFRESH_DEBOUNCE).toBe(3000);
    });
  });

  describe('缩放因子计算 (Scaling Logic)', () => {
    it('未设置环境变量时默认缩放系数为 1.0', () => {
      delete process.env.SMARTLINK_TIMING_SCALE;
      expect(getTimingScale()).toBe(1.0);
      expect(getScaledTimeout(1500)).toBe(1500);
      expect(getScaledDelayRange(1000, 2000)).toEqual([1000, 2000]);
    });

    it('设置有效环境变量时应按比例缩放', () => {
      process.env.SMARTLINK_TIMING_SCALE = '0.5';
      expect(getTimingScale()).toBe(0.5);
      expect(getScaledTimeout(1500)).toBe(750);
      expect(getScaledTimeout(8000)).toBe(4000);
      expect(getScaledDelayRange(1000, 2000)).toEqual([500, 1000]);

      process.env.SMARTLINK_TIMING_SCALE = '2.0';
      expect(getTimingScale()).toBe(2.0);
      expect(getScaledTimeout(1500)).toBe(3000);
      expect(getScaledDelayRange(1000, 2000)).toEqual([2000, 4000]);
    });

    it('非法或非正数环境变量应安全回退为 1.0', () => {
      process.env.SMARTLINK_TIMING_SCALE = 'invalid-scale';
      expect(getTimingScale()).toBe(1.0);

      process.env.SMARTLINK_TIMING_SCALE = '-1.5';
      expect(getTimingScale()).toBe(1.0);

      process.env.SMARTLINK_TIMING_SCALE = '0';
      expect(getTimingScale()).toBe(1.0);
    });

    it('缩放后超时时间应有最小 10ms 保障，非正数超时返回 0', () => {
      process.env.SMARTLINK_TIMING_SCALE = '0.001';
      expect(getScaledTimeout(500)).toBe(10);
      expect(getScaledTimeout(0)).toBe(0);
      expect(getScaledTimeout(-100)).toBe(0);
    });

    it('延时区间对 NaN 或非法数字输入具备边界防御保障', () => {
      expect(getScaledDelayRange(NaN, NaN)).toEqual([0, 0]);
      expect(getScaledDelayRange(NaN, 1000)).toEqual([0, 1000]);
    });
  });

  describe('Playwright 语义化操作算子 (Semantic Helpers)', () => {
    const createMockLocator = (options: {
      visibleResult?: boolean;
      visibleRejects?: boolean;
      clickRejects?: boolean;
    } = {}): Locator => {
      return {
        isVisible: vi.fn().mockImplementation(async () => {
          if (options.visibleRejects) {
            throw new Error('Element detached from DOM');
          }
          return options.visibleResult ?? true;
        }),
      } as unknown as Locator;
    };

    it('isProbeVisible 应使用 ACTION_TIMEOUT.PROBE (500ms) 并正确透传布尔值', async () => {
      delete process.env.SMARTLINK_TIMING_SCALE;
      const locator = createMockLocator({ visibleResult: true });
      const result = await isProbeVisible(locator);

      expect(result).toBe(true);
      expect(locator.isVisible).toHaveBeenCalledWith({ timeout: 500 });
    });

    it('isElementVisible 应使用 ACTION_TIMEOUT.ELEMENT (1500ms) 并在元素异常时安全返回 false', async () => {
      delete process.env.SMARTLINK_TIMING_SCALE;
      const locator = createMockLocator({ visibleRejects: true });
      const result = await isElementVisible(locator);

      expect(result).toBe(false);
      expect(locator.isVisible).toHaveBeenCalledWith({ timeout: 1500 });
    });

    it('isModalVisible 应使用 ACTION_TIMEOUT.MODAL (2500ms)', async () => {
      delete process.env.SMARTLINK_TIMING_SCALE;
      const locator = createMockLocator({ visibleResult: false });
      const result = await isModalVisible(locator);

      expect(result).toBe(false);
      expect(locator.isVisible).toHaveBeenCalledWith({ timeout: 2500 });
    });

    it('算子针对空值或非法 Locator 应安全防空', async () => {
      expect(await isProbeVisible(null as unknown as Locator)).toBe(false);
      expect(await isElementVisible(undefined as unknown as Locator)).toBe(false);
      expect(await isModalVisible({} as unknown as Locator)).toBe(false);
    });
  });
});
