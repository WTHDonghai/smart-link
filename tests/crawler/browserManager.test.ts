import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { createPersistentBrowserSession } from '../../src/crawler/browserManager';
import { chromium } from 'playwright';

vi.mock('playwright', () => {
  return {
    chromium: {
      launchPersistentContext: vi.fn(),
    },
  };
});

describe('browserManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should launch persistent context with ignoreDefaultArgs including --use-mock-keychain to preserve Keychain cookies', async () => {
    const mockContext = {
      addInitScript: vi.fn().mockResolvedValue(undefined),
      pages: vi.fn().mockReturnValue([]),
      newPage: vi.fn().mockResolvedValue({
        bringToFront: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as unknown as never);

    const session = await createPersistentBrowserSession({
      channelId: 'meituan',
      headless: true,
    });

    expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);

    const [calledProfileDir, calledOptions] = vi.mocked(chromium.launchPersistentContext).mock.calls[0];
    expect(calledProfileDir).toBe(path.resolve(process.cwd(), '.chrome-profile', 'meituan'));
    expect(calledOptions?.channel).toBe('chrome');
    expect(calledOptions?.headless).toBe(true);

    // 核心断言：必须声明忽略 --use-mock-keychain 与 --password-store=basic
    expect(calledOptions?.ignoreDefaultArgs).toEqual(
      expect.arrayContaining(['--use-mock-keychain', '--password-store=basic'])
    );

    await session.close();
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });
});
