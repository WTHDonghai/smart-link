import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard, readFromClipboard } from '../../src/utils/clipboard';

describe('clipboard utils - Electron-Only 原生剪贴板工具', () => {
  const originalHost = window.host;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.host = originalHost;
  });

  describe('copyToClipboard', () => {
    it('当输入为空字符串或非字符串时立即返回 false', async () => {
      expect(await copyToClipboard('')).toBe(false);
      expect(await copyToClipboard(null as unknown as string)).toBe(false);
      expect(await copyToClipboard(undefined as unknown as string)).toBe(false);
    });

    it('必须使用 Electron 桌面原生通道 window.host.clipboard.writeText', async () => {
      const mockHostWrite = vi.fn().mockResolvedValue(true);

      window.host = {
        ...window.host,
        clipboard: {
          writeText: mockHostWrite,
          readText: vi.fn(),
        },
      } as unknown as typeof window.host;

      const result = await copyToClipboard('MT-20261001-999');

      expect(result).toBe(true);
      expect(mockHostWrite).toHaveBeenCalledWith('MT-20261001-999');
    });

    it('当缺失 window.host.clipboard 时严格抛错 Fail-Fast，绝不回退 navigator.clipboard', async () => {
      window.host = undefined;

      await expect(copyToClipboard('MT-FAIL-FAST')).rejects.toThrow(
        '缺失 Electron 原生剪贴板通道，严禁 Web API 降级'
      );
    });

    it('当 Electron 原生通道抛错时，如实暴露异常，不隐式降级吞没', async () => {
      const mockHostWrite = vi.fn().mockRejectedValue(new Error('IPC Disconnected'));

      window.host = {
        ...window.host,
        clipboard: {
          writeText: mockHostWrite,
          readText: vi.fn(),
        },
      } as unknown as typeof window.host;

      await expect(copyToClipboard('MT-IPC-ERROR')).rejects.toThrow('IPC Disconnected');
      expect(mockHostWrite).toHaveBeenCalledWith('MT-IPC-ERROR');
    });
  });

  describe('readFromClipboard', () => {
    it('必须使用 Electron 桌面原生通道 window.host.clipboard.readText 读取文本', async () => {
      const mockHostRead = vi.fn().mockResolvedValue('HOST-CLIPBOARD-TEXT');

      window.host = {
        ...window.host,
        clipboard: {
          writeText: vi.fn(),
          readText: mockHostRead,
        },
      } as unknown as typeof window.host;

      const text = await readFromClipboard();
      expect(text).toBe('HOST-CLIPBOARD-TEXT');
      expect(mockHostRead).toHaveBeenCalledTimes(1);
    });

    it('当缺失 window.host.clipboard 时严格抛错 Fail-Fast，绝不回退 navigator.clipboard', async () => {
      window.host = undefined;

      await expect(readFromClipboard()).rejects.toThrow(
        '缺失 Electron 原生剪贴板通道，严禁 Web API 降级'
      );
    });

    it('当原生通道抛错时如实暴露异常', async () => {
      const mockHostRead = vi.fn().mockRejectedValue(new Error('System Pasteboard Locked'));

      window.host = {
        ...window.host,
        clipboard: {
          writeText: vi.fn(),
          readText: mockHostRead,
        },
      } as unknown as typeof window.host;

      await expect(readFromClipboard()).rejects.toThrow('System Pasteboard Locked');
    });
  });
});
