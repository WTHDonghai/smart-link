import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parsePresignedUploadDescriptor,
  fetchLogUploadPresign,
  uploadTextViaPresign,
  uploadLogContent,
} from '../../src/services/logUploadApi';
import { uploadLogsForDay, uploadLogsManually } from '../../src/services/logUploadScheduler';
import { saveTokensToStorage, clearTokensFromStorage } from '../../src/services/platformAuth';
import { logger } from '../../src/services/logger';
import { PlatformAuthTokens, SystemLogEntry } from '../../src/types';

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

function makeEntry(partial: Partial<SystemLogEntry>): SystemLogEntry {
  return {
    id: 'log-1',
    timestamp: '2026-11-17 10:00:00.000',
    createdAt: new Date(2026, 10, 17, 10, 0, 0).getTime(),
    level: 'INFO',
    message: '测试日志',
    ...partial,
  };
}

describe('logUploadApi - 预签名解析与直传', () => {
  beforeEach(() => {
    hostWindow.host = {};
    clearTokensFromStorage();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete hostWindow.host;
  });

  describe('parsePresignedUploadDescriptor', () => {
    it('解析标准 url 字段并默认 PUT', () => {
      const d = parsePresignedUploadDescriptor({ url: 'https://oss.example.com/a?sig=1' });
      expect(d.url).toBe('https://oss.example.com/a?sig=1');
      expect(d.method).toBe('PUT');
      expect(d.headers).toEqual({});
    });

    it('兼容 uploadUrl / presignedUrl / host 命名', () => {
      expect(parsePresignedUploadDescriptor({ uploadUrl: 'https://a/1' }).url).toBe('https://a/1');
      expect(parsePresignedUploadDescriptor({ presignedUrl: 'https://a/2' }).url).toBe('https://a/2');
      expect(parsePresignedUploadDescriptor({ host: 'https://a/3' }).url).toBe('https://a/3');
    });

    it('解析 method 与 headers 附加头', () => {
      const d = parsePresignedUploadDescriptor({
        url: 'https://oss.example.com/a',
        method: 'put',
        headers: { 'Content-Type': 'text/plain', 'x-oss-meta': 'log' },
      });
      expect(d.method).toBe('PUT');
      expect(d.headers['Content-Type']).toBe('text/plain');
      expect(d.headers['x-oss-meta']).toBe('log');
    });

    it('url 缺失时抛出明确错误', () => {
      expect(() => parsePresignedUploadDescriptor({})).toThrow('缺少 url 字段');
      expect(() => parsePresignedUploadDescriptor(null)).toThrow('缺少 data 对象');
      expect(() => parsePresignedUploadDescriptor('not-object')).toThrow('缺少 data 对象');
    });
  });

  describe('fetchLogUploadPresign', () => {
    it('解包 R 结构 data 并解析预签名，请求携带 module 与 path 参数', async () => {
      saveTokensToStorage(makeTokens('XR-01'));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            code: 200,
            success: true,
            data: { url: 'https://oss.example.com/log?sig=abc', method: 'PUT' },
            msg: '',
          }),
      } as unknown as Response);

      const d = await fetchLogUploadPresign('smart-link/XR-01/20261117/a.log');
      expect(d.url).toBe('https://oss.example.com/log?sig=abc');
      expect(d.method).toBe('PUT');

      const calledUrl = String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]);
      expect(calledUrl).toContain('/configuration/file/upload/sign?');
      expect(calledUrl).toContain('module=smart-link');
      expect(calledUrl).toContain(`path=${encodeURIComponent('smart-link/XR-01/20261117/a.log')}`);
    });

    it('业务失败（success=false）时抛出业务错误', async () => {
      saveTokensToStorage(makeTokens('XR-01'));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ code: 500, success: false, data: null, msg: '签名服务不可用' }),
      } as unknown as Response);

      await expect(fetchLogUploadPresign('smart-link/XR-01/20261117/a.log')).rejects.toThrow(
        '日志上传预签名失败：签名服务不可用'
      );
    });

    it('data 中缺少 url 时抛错', async () => {
      saveTokensToStorage(makeTokens('XR-01'));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ code: 200, success: true, data: {}, msg: '' }),
      } as unknown as Response);

      await expect(fetchLogUploadPresign('smart-link/XR-01/20261117/a.log')).rejects.toThrow(
        '缺少 url 字段'
      );
    });

    it('objectKey 为空时直接拒绝且不发起任何请求', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(fetchLogUploadPresign('///')).rejects.toThrow('缺少对象键');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('uploadTextViaPresign', () => {
    it('经 Electron 主进程桥直传并携带文本体', async () => {
      const captured: Partial<{ url: string; method: string; headers: Record<string, string>; body: string }> = {};
      hostWindow.host = {
        platform: {
          request: async (options: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
            Object.assign(captured, options);
            return { ok: true, status: 200, statusText: 'OK', headers: {}, body: '' };
          },
        },
      };

      await uploadTextViaPresign(
        { url: 'https://oss.example.com/log?sig=1', method: 'PUT', headers: {} },
        '日志内容ABC'
      );

      expect(captured.url).toBe('https://oss.example.com/log?sig=1');
      expect(captured.method).toBe('PUT');
      expect(captured.body).toBe('日志内容ABC');
      expect(captured.headers?.['Content-Type']).toBe('text/plain;charset=utf-8');
    });

    it('直传 HTTP 失败时抛出状态码错误', async () => {
      hostWindow.host = {
        platform: {
          request: async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            headers: {},
            body: 'SignatureDoesNotMatch',
          }),
        },
      };

      await expect(
        uploadTextViaPresign(
          { url: 'https://oss.example.com/log?sig=bad', method: 'PUT', headers: {} },
          '内容'
        )
      ).rejects.toThrow('HTTP 403');
    });
  });

  describe('uploadLogContent', () => {
    it('完成签名+直传全链路并返回上传统计', async () => {
      saveTokensToStorage(makeTokens('XR-01'));
      const putUrls: string[] = [];
      // 桥按 URL 路由：sign 返回 R 结构预签名 JSON，其余承接 PUT 直传
      hostWindow.host = {
        platform: {
          request: async (options: { url: string; method?: string; body?: string }) => {
            if (options.url.includes('/file/upload/sign')) {
              return {
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  code: 200,
                  success: true,
                  data: { url: 'https://oss.example.com/log?sig=ok', method: 'PUT' },
                  msg: '',
                }),
              };
            }
            putUrls.push(options.url);
            return { ok: true, status: 200, statusText: 'OK', headers: {}, body: '' };
          },
        },
      };

      const result = await uploadLogContent({
        objectKey: 'smart-link/XR-01/20261117/a.log',
        fileName: 'a.log',
        content: '日志行1\n日志行2',
        entryCount: 2,
      });

      expect(result.byteSize).toBe(new TextEncoder().encode('日志行1\n日志行2').length);
      expect(result.entryCount).toBe(2);
      expect(putUrls).toEqual(['https://oss.example.com/log?sig=ok']);
    });
  });
});

describe('logUploadScheduler - 按日上传调度', () => {
  /**
   * 统一桥接处理器：按 URL 路由
   *  - /file/upload/sign → 返回 R 结构预签名 JSON
   *  - 其它（PUT 直传）→ 按 uploadOk 决定成败
   */
  function installBridge(options: { uploadOk: boolean; uploadStatus?: number }): {
    putBodies: string[];
    presignUrls: string[];
  } {
    const putBodies: string[] = [];
    const presignUrls: string[] = [];
    hostWindow.host = {
      platform: {
        request: async (req: { url: string; method?: string; body?: string }) => {
          if (req.url.includes('/file/upload/sign')) {
            presignUrls.push(req.url);
            return {
              ok: true,
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                code: 200,
                success: true,
                data: { url: 'https://oss.example.com/target?sig=1', method: 'PUT' },
                msg: '',
              }),
            };
          }
          putBodies.push(req.body || '');
          return {
            ok: options.uploadOk,
            status: options.uploadOk ? 200 : options.uploadStatus ?? 500,
            statusText: options.uploadOk ? 'OK' : 'Internal Error',
            headers: {},
            body: options.uploadOk ? '' : 'boom',
          };
        },
      },
    };
    return { putBodies, presignUrls };
  }

  beforeEach(() => {
    clearTokensFromStorage();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete hostWindow.host;
  });

  it('未登录（无 tenantId）时跳过并返回 no-auth', async () => {
    const result = await uploadLogsForDay(new Date(2026, 10, 17));
    expect(result).toBe('no-auth');
  });

  it('当天无日志时跳过并返回 empty', async () => {
    saveTokensToStorage(makeTokens('XR-01'));
    vi.spyOn(logger, 'queryLogs').mockResolvedValue({
      items: [],
      hasMore: false,
      totalScanned: 0,
    });

    const result = await uploadLogsForDay(new Date(2026, 10, 17));
    expect(result).toBe('empty');
  });

  it('上传当天全部日志：签名请求的对象键含租户与日期目录，直传内容含日志行', async () => {
    saveTokensToStorage(makeTokens('XR-01'));
    vi.spyOn(logger, 'queryLogs').mockResolvedValue({
      items: [makeEntry({ id: 'log-1', message: '日志A' }), makeEntry({ id: 'log-2', message: '日志B' })],
      hasMore: false,
      totalScanned: 2,
    });
    const { putBodies, presignUrls } = installBridge({ uploadOk: true });

    const result = await uploadLogsForDay(new Date(2026, 10, 17));

    expect(result).toBe('uploaded');
    expect(presignUrls.length).toBe(1);
    expect(decodeURIComponent(presignUrls[0])).toContain('path=smart-link/XR-01/20261117/');
    expect(putBodies[0]).toContain('日志A');
    expect(putBodies[0]).toContain('日志B');
  });

  it('分页游标循环聚合多页日志后一次性上传', async () => {
    saveTokensToStorage(makeTokens('XR-01'));
    let callCount = 0;
    const querySpy = vi.spyOn(logger, 'queryLogs').mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return { items: [makeEntry({ id: 'log-1', message: '第一页' })], hasMore: true, nextCursor: { createdAt: 1, id: 'log-1' }, totalScanned: 2 };
      }
      return { items: [makeEntry({ id: 'log-2', message: '第二页' })], hasMore: false, totalScanned: 2 };
    });
    const { putBodies } = installBridge({ uploadOk: true });

    const result = await uploadLogsForDay(new Date(2026, 10, 17));

    expect(result).toBe('uploaded');
    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(putBodies[0]).toContain('第一页');
    expect(putBodies[0]).toContain('第二页');
  });

  it('直传失败时向上抛出错误（调度层负责捕获）', async () => {
    saveTokensToStorage(makeTokens('XR-01'));
    vi.spyOn(logger, 'queryLogs').mockResolvedValue({
      items: [makeEntry({})],
      hasMore: false,
      totalScanned: 1,
    });
    installBridge({ uploadOk: false, uploadStatus: 500 });

    await expect(uploadLogsForDay(new Date(2026, 10, 17))).rejects.toThrow('HTTP 500');
  });
});

describe('uploadLogsManually - 手工触发上传', () => {
  beforeEach(() => {
    clearTokensFromStorage();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete hostWindow.host;
  });

  it('未登录时返回 skippedNoAuth 且不发起上传', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const summary = await uploadLogsManually();

    expect(summary.skippedNoAuth).toBe(true);
    expect(summary.uploadedDates).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('两天都有日志时全部上传并汇总日期', async () => {
    saveTokensToStorage(makeTokens('XR-01'));
    vi.spyOn(logger, 'queryLogs').mockResolvedValue({
      items: [makeEntry({})],
      hasMore: false,
      totalScanned: 1,
    });
    const putCount: { n: number } = { n: 0 };
    hostWindow.host = {
      platform: {
        request: async (req: { url: string; method?: string; body?: string }) => {
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

    const summary = await uploadLogsManually();

    expect(summary.uploadedDates.length).toBe(2);
    expect(summary.skippedNoAuth).toBe(false);
    expect(putCount.n).toBe(2);
    expect(summary.items.every((item) => item.result === 'uploaded')).toBe(true);
  });

  it('第一天失败仍尝试第二天，并抛出首个错误', async () => {
    saveTokensToStorage(makeTokens('XR-01'));
    let queryCount = 0;
    vi.spyOn(logger, 'queryLogs').mockImplementation(async () => {
      queryCount += 1;
      return {
        items: [makeEntry({ id: `log-${queryCount}` })],
        hasMore: false,
        totalScanned: 1,
      };
    });
    let putCount = 0;
    hostWindow.host = {
      platform: {
        request: async (req: { url: string; method?: string; body?: string }) => {
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
          putCount += 1;
          // 第一次直传（今天）失败，第二次（昨天）成功
          return putCount === 1
            ? { ok: false, status: 500, statusText: 'ISE', headers: {}, body: 'boom' }
            : { ok: true, status: 200, statusText: 'OK', headers: {}, body: '' };
        },
      },
    };

    await expect(uploadLogsManually()).rejects.toThrow('HTTP 500');
    expect(putCount).toBe(2);
  });

  it('两天都无日志时返回空结果（非 no-auth）', async () => {
    saveTokensToStorage(makeTokens('XR-01'));
    vi.spyOn(logger, 'queryLogs').mockResolvedValue({
      items: [],
      hasMore: false,
      totalScanned: 0,
    });

    const summary = await uploadLogsManually();

    expect(summary.uploadedDates).toEqual([]);
    expect(summary.skippedNoAuth).toBe(false);
    expect(summary.items.every((item) => item.result === 'empty')).toBe(true);
  });
});
