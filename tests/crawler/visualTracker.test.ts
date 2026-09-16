import { describe, it, expect, vi } from 'vitest';
import type { Page, BrowserContext, Locator } from 'playwright';
import {
  installVisualTracker,
  updateVisualTrackerStatus,
  visualMoveMouse,
  visualClickLocator,
  visualScroll,
} from '../../src/crawler/visualTracker';

describe('visualTracker', () => {
  describe('installVisualTracker', () => {
    it('registers init script on BrowserContext without errors', async () => {
      const mockContext = {
        addInitScript: vi.fn().mockResolvedValue(undefined),
      } as unknown as BrowserContext;

      await installVisualTracker(mockContext);
      expect(mockContext.addInitScript).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateVisualTrackerStatus', () => {
    it('evaluates status script inside page context', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await updateVisualTrackerStatus(mockPage, '测试状态', 'action');
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
    });

    it('gracefully handles closed page without throwing', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(true),
        evaluate: vi.fn(),
      } as unknown as Page;

      await expect(
        updateVisualTrackerStatus(mockPage, '测试状态', 'info')
      ).resolves.toBeUndefined();
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });

    it('safely catches evaluate errors during page navigation', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockRejectedValue(new Error('Execution context was destroyed')),
      } as unknown as Page;

      await expect(
        updateVisualTrackerStatus(mockPage, '导航中断', 'warn')
      ).resolves.toBeUndefined();
    });
  });

  describe('visualMoveMouse', () => {
    it('calls evaluate with coordinates and waits for animation frame', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualMoveMouse(mockPage, 250, 400);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(180);
    });
  });

  describe('visualClickLocator', () => {
    it('scrolls, calculates bounding box, moves cursor, pulses and performs click', async () => {
      const mockLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 200, width: 80, height: 40 }),
        click: vi.fn().mockResolvedValue(undefined),
      } as unknown as Locator;

      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualClickLocator(mockPage, mockLocator, '点击目标按钮');
      expect(mockLocator.scrollIntoViewIfNeeded).toHaveBeenCalled();
      expect(mockLocator.boundingBox).toHaveBeenCalled();
      expect(mockLocator.click).toHaveBeenCalled();
    });

    it('falls back to direct click when bounding box is null', async () => {
      const mockLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue(null),
        click: vi.fn().mockResolvedValue(undefined),
      } as unknown as Locator;

      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualClickLocator(mockPage, mockLocator);
      expect(mockLocator.click).toHaveBeenCalledWith({ timeout: 4000 });
    });
  });

  describe('visualScroll', () => {
    it('dispatches wheel event and updates status without throwing', async () => {
      const mockPage = {
        isClosed: vi.fn().mockReturnValue(false),
        evaluate: vi.fn().mockResolvedValue(undefined),
        mouse: {
          wheel: vi.fn().mockResolvedValue(undefined),
        },
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await visualScroll(mockPage, 500, '向下滚动页面');
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, 500);
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(300);
    });
  });
});
