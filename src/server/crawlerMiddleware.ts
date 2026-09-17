import type { IncomingMessage, ServerResponse } from 'node:http';
import { hotelCollectionEngine } from '../crawler/engine';
import { hotelCollectorRegistry } from '../crawler/registry';
import { syncChromeProfile } from '../crawler/profileSync';
import type { HotelCrawlRequest, CollectorLogPayload } from '../crawler/types';

/**
 * 辅助函数：从 IncomingMessage 读取 JSON 请求体
 */
async function parseJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed as T);
      } catch (e) {
        reject(new Error(`无效的 JSON 请求体: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

/**
 * 辅助函数：发送 JSON 响应
 */
function sendJsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/**
 * Vite 中间件分发器：处理 /api/crawler/* 路由
 */
export function createCrawlerApiMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = req.url || '';

    // 1. GET /api/crawler/channels：获取支持采集的渠道与默认配置
    if (req.method === 'GET' && url.startsWith('/api/crawler/channels')) {
      const channelCodes = hotelCollectorRegistry.getSupportedChannelCodes();
      const channels = channelCodes.map((code) => {
        const collector = hotelCollectorRegistry.get(code);
        return {
          channelCode: code.toUpperCase(),
          defaultTargetUrl: collector?.defaultTargetUrl || '',
        };
      });
      return sendJsonResponse(res, 200, { success: true, data: channels });
    }

    // 2. POST /api/crawler/hotels/collect：执行指定渠道的门店采集
    if (req.method === 'POST' && url.startsWith('/api/crawler/hotels/collect')) {
      try {
        const body = await parseJsonBody<HotelCrawlRequest>(req);
        const channelCode = (body.channelCode || '').trim().toUpperCase();
        if (!channelCode) {
          return sendJsonResponse(res, 400, {
            success: false,
            error: '必须指定采集渠道 channelCode',
          });
        }

        const logs: CollectorLogPayload[] = [];
        const result = await hotelCollectionEngine.collectHotels(
          {
            ...body,
            channelCode,
          },
          (log) => {
            logs.push(log);
          }
        );

        return sendJsonResponse(res, result.success ? 200 : 500, {
          ...result,
          logs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendJsonResponse(res, 500, {
          success: false,
          error: message,
        });
      }
    }

    // 3. POST /api/crawler/profile/sync：从日常 Chrome 同步登录态
    if (req.method === 'POST' && url.startsWith('/api/crawler/profile/sync')) {
      try {
        const body = await parseJsonBody<{ channelCode?: string }>(req).catch(() => ({ channelCode: 'MEITUAN' }));
        const result = syncChromeProfile({ channelCode: (body.channelCode || 'MEITUAN').trim().toUpperCase() });
        return sendJsonResponse(res, 200, { success: true, data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sendJsonResponse(res, 500, {
          success: false,
          error: message,
        });
      }
    }

    // 非爬虫 API 路由交给下一个中间件
    next();
  };
}
