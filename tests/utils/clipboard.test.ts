import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard, readFromClipboard } from '../../src/utils/clipboard';

describe('clipboard utils - 跨宿主剪贴板工具', () => {
  const originalHost = window.host;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.host = originalHost;
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
  });

  describe('copyToClipboard', () => {
    it('当输入为空字符串或非字符串时立即返回 false', async () => {
      expect(await copyToClipboard('')).toBe(false);
      expect(await copyToClipboard(null as unknown as string)).toBe(false);
      expect(await copyToClipboard(undefined as unknown as string)).toBe(false);
    });

    it('第一优先级：当存在 Electron 桌面原生通道时，优先调用 window.host.clipboard.writeText', async () => {
      const mockHostWrite = vi.fn().mockResolvedValue(true);
      const mockNavWrite = vi.fn().mockResolvedValue(undefined);

      window.host = {
        ...window.host,
        clipboard: {
          writeText: mockHostWrite,
          readText: vi.fn(),
        },
      } as unknown as typeof window.host;

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockNavWrite },
        configurable: true,
        writable: true,
      });

      const result = await copyToClipboard('MT-20261001-999');

      expect(result).toBe(true);
      expect(mockHostWrite).toHaveBeenCalledWith('MT-20261001-999');
      expect(mockNavWrite).not.toHaveBeenCalled();
    });

    it('当 Electron 原生通道抛错时，平滑降级至 navigator.clipboard.writeText', async () => {
      const mockHostWrite = vi.fn().mockRejectedValue(new Error('IPC Disconnected'));
      const mockNavWrite = vi.fn().mockResolvedValue(undefined);

      window.host = {
        ...window.host,
        clipboard: {
          writeText: mockHostWrite,
          readText: vi.fn(),
        },
      } as unknown as typeof window.host;

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockNavWrite },
        configurable: true,
        writable: true,
      });

      const result = await copyToClipboard('MT-FALLBACK-1');

      expect(result).toBe(true);
      expect(mockHostWrite).toHaveBeenCalledWith('MT-FALLBACK-1');
      expect(mockNavWrite).toHaveBeenCalledWith('MT-FALLBACK-1');
    });

    it('当 Electron 原生通道返回 false 时，平滑降级至 navigator.clipboard.writeText', async () => {
      const mockHostWrite = vi.fn().mockResolvedValue(false);
      const mockNavWrite = vi.fn().mockResolvedValue(undefined);

      window.host = {
        ...window.host,
        clipboard: {
          writeText: mockHostWrite,
          readText: vi.fn(),
        },
      } as unknown as typeof window.host;

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockNavWrite },
        configurable: true,
        writable: true,
      });

      const result = await copyToClipboard('MT-HOST-FALSE-FALLBACK');

      expect(result).toBe(true);
      expect(mockHostWrite).toHaveBeenCalledWith('MT-HOST-FALSE-FALLBACK');
      expect(mockNavWrite).toHaveBeenCalledWith('MT-HOST-FALSE-FALLBACK');
    });

    it('当无 window.host 时，使用 navigator.clipboard.writeText 成功写入', async () => {
      window.host = undefined;
      const mockNavWrite = vi.fn().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockNavWrite },
        configurable: true,
        writable: true,
      });

      const result = await copyToClipboard('MT-NAV-OK');

      expect(result).toBe(true);
      expect(mockNavWrite).toHaveBeenCalledWith('MT-NAV-OK');
    });

    it('当所有通道均不可用或抛错时返回 false', async () => {
      window.host = undefined;
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        configurable: true,
        writable: true,
      });

      const result = await copyToClipboard('MT-FAIL');
      expect(result).toBe(false);
    });
  });

  describe('readFromClipboard', () => {
    it('第一优先级：当存在 Electron 桌面原生通道时，优先调用 window.host.clipboard.readText', async () => {
      const mockHostRead = vi.fn().mockResolvedValue('HOST-CLIPBOARD-TEXT');
      const mockNavRead = vi.fn().mockResolvedValue('NAV-CLIPBOARD-TEXT');

      window.host = {
        ...window.host,
        clipboard: {
          writeText: vi.fn(),
          readText: mockHostRead,
        },
      } as unknown as typeof window.host;

      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: mockNavRead },
        configurable: true,
        writable: true,
      });

      const text = await readFromClipboard();
      expect(text).toBe('HOST-CLIPBOARD-TEXT');
      expect(mockHostRead).toHaveBeenCalled();
      expect(mockNavRead).not.toHaveBeenCalled();
    });

    it('当 Electron 原生通道抛错时，平滑降级至 navigator.clipboard.readText', async () => {
      const mockHostRead = vi.fn().mockRejectedValue(new Error('IPC error'));
      const mockNavRead = vi.fn().mockResolvedValue('FALLBACK-NAV-TEXT');

      window.host = {
        ...window.host,
        clipboard: {
          writeText: vi.fn(),
          readText: mockHostRead,
        },
      } as unknown as typeof window.host;

      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: mockNavRead },
        configurable: true,
        writable: true,
      });

      const text = await readFromClipboard();
      expect(text).toBe('FALLBACK-NAV-TEXT');
      expect(mockHostRead).toHaveBeenCalled();
      expect(mockNavRead).toHaveBeenCalled();
    });

    it('当无 window.host 时，使用 navigator.clipboard.readText 读取成功', async () => {
      window.host = undefined;
      const mockNavRead = vi.fn().mockResolvedValue('WEB-STANDALONE-TEXT');

      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: mockNavRead },
        configurable: true,
        writable: true,
      });

      const text = await readFromClipboard();
      expect(text).toBe('WEB-STANDALONE-TEXT');
      expect(mockNavRead).toHaveBeenCalled();
    });

    it('当所有通道均失败或抛错时安全返回空字符串', async () => {
      window.host = undefined;
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          readText: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
        configurable: true,
        writable: true,
      });

      const text = await readFromClipboard();
      expect(text).toBe('');
    });
  });
});
