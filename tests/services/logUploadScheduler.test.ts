import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  msUntilNextSchedule,
  startLogUploadScheduler,
  stopLogUploadScheduler,
  startupCatchUpUpload,
  setLastUploadedDateKeyForTest,
} from '../../src/services/logUploadScheduler';
import { saveTokensToStorage, clearTokensFromStorage } from '../../src/services/platformAuth';
import { logger } from '../../src/services/logger';
import { loadTokensFromStorage } from '../../src/services/platformAuth';
import { PlatformAuthTokens } from '../../src/types';

const hostWindow = window as unknown as { host?: unknown };

function makeTokens(tenantId: string): PlatformAuthTokens {
  return {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3600 * 1000,
    tokenType: 'bearer',
    platformBaseUrl: 'https://pms.example.com',
    tenantId,
    authenticatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function installSuccessBridge(): { putCount: { n: number } } {
  const putCount = { n: 0 };
  hostWindow.host = {
    platform: {
      request: async (req: { url: string }) => {
        if (req.url.includes('/file/upload/sign')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              code: 200,
              success: true,
              data: { url: 'https://oss.example.com/t?sig=1', method: 'PUT' },
              msg: '',
            }),
          };
        }
        putCount.n += 1;
        return { ok: true, status: 200, statusText: 'OK', headers: {}, body: '' };
      },
    },
  };
  return { putCount };
}

describe('logUploadScheduler - 凌晨定时排期', () => {
  describe('msUntilNextSchedule', () => {
    it('当天 02:00 未到时，排期到当天 02:00', () => {
      const now = new Date(2026, 10, 17, 0, 30, 0); // 本地 00:30
      const delay = msUntilNextSchedule(now);
      expect(delay).toBe(1.5 * 60 * 60 * 1000); // 距 02:00 恰好 1.5 小时
    });

    it('已过当天 02:00 时，排期到次日 02:00', () => {
      const now = new Date(2026, 10, 17, 3, 0, 0); // 本地 03:00
      const delay = msUntilNextSchedule(now);
      expect(delay).toBe(23 * 60 * 60 * 1000); // 距次日 02:00 恰好 23 小时
    });

    it('恰在 02:00 整点时，排期到次日（不重复触发）', () => {
      const now = new Date(2026, 10, 17, 2, 0, 0);
      const delay = msUntilNextSchedule(now);
      expect(delay).toBe(24 * 60 * 60 * 1000);
    });

    it('临近午夜时排期到次日 02:00', () => {
      const now = new Date(2026, 10, 17, 23, 59, 59);
      const delay = msUntilNextSchedule(now);
      expect(delay).toBe(2 * 60 * 60 * 1000 + 1000);
    });
  });

  describe('startLogUploadScheduler / stopLogUploadScheduler', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      clearTokensFromStorage();
      setLastUploadedDateKeyForTest(null);
    });

    afterEach(() => {
      stopLogUploadScheduler();
      vi.useRealTimers();
      delete hostWindow.host;
    });

    it('到达凌晨 02:00 时触发昨日日志上传', async () => {
      saveTokensToStorage(makeTokens('XR-01'));
      const { putCount } = installSuccessBridge();
      vi.spyOn(logger, 'queryLogs').mockResolvedValue({
        items: [{
          id: 'log-1',
          timestamp: 'x',
          createdAt: Date.now(),
          level: 'INFO',
          message: '昨日日志',
        }],
        hasMore: false,
        totalScanned: 1,
      });

      // 假设当前时间为本地 01:00，2 小时后到达 03:00——为让「02:00 触发」可测，
      // 直接把当前时间定在 01:59:59，推进 1 秒即到 02:00
      vi.setSystemTime(new Date(2026, 10, 17, 1, 59, 59));
      startLogUploadScheduler();

      await vi.advanceTimersByTimeAsync(1000);
      // 定时上传为 fire-and-forget，等待微任务排空
      await vi.waitFor(() => {
        expect(putCount.n).toBe(1);
      });
    });

    it('同日已上传过后，启动补传跳过（不重复上传）', async () => {
      saveTokensToStorage(makeTokens('XR-01'));
      const { putCount } = installSuccessBridge();
      vi.spyOn(logger, 'queryLogs').mockResolvedValue({
        items: [{ id: 'log-1', timestamp: 'x', createdAt: Date.now(), level: 'INFO', message: 'x' }],
        hasMore: false,
        totalScanned: 1,
      });

      const yesterdayKey = (() => {
        const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();
      setLastUploadedDateKeyForTest(yesterdayKey);

      await startupCatchUpUpload();
      expect(putCount.n).toBe(0);
    });

    it('未登录时启动补传不发起请求', async () => {
      const { putCount } = installSuccessBridge();

      await startupCatchUpUpload();
      expect(putCount.n).toBe(0);
    });

    it('重复调用 startLogUploadScheduler 幂等（不叠加定时器）', () => {
      startLogUploadScheduler();
      const firstTimerCount = vi.getTimerCount();
      startLogUploadScheduler();
      expect(vi.getTimerCount()).toBe(firstTimerCount);
    });

    it('stopLogUploadScheduler 清空全部定时器', () => {
      startLogUploadScheduler();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      stopLogUploadScheduler();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('冒烟：loadTokensFromStorage 与调度器共享同一令牌源', () => {
    saveTokensToStorage(makeTokens('XR-01'));
    expect(loadTokensFromStorage()?.tenantId).toBe('XR-01');
  });
});
