import type { IncomingMessage, ServerResponse } from 'node:http';
import { hotelCollectionEngine } from '../crawler/engine';
import { hotelCollectorRegistry } from '../crawler/registry';
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
      const channelIds = hotelCollectorRegistry.getSupportedChannelIds();
      const channels = channelIds.map((id) => {
        const collector = hotelCollectorRegistry.get(id);
        return {
          channelId: id,
          channelCode: collector?.channelCode || id.toUpperCase(),
          defaultTargetUrl: collector?.defaultTargetUrl || '',
        };
      });
      return sendJsonResponse(res, 200, { success: true, data: channels });
    }

    // 2. POST /api/crawler/hotels/collect：执行指定渠道的门店采集
    if (req.method === 'POST' && url.startsWith('/api/crawler/hotels/collect')) {
      try {
        const body = await parseJsonBody<HotelCrawlRequest>(req);
        if (!body.channelId) {
          return sendJsonResponse(res, 400, {
            success: false,
            error: '必须指定采集渠道 channelId',
          });
        }

        const logs: CollectorLogPayload[] = [];
        const result = await hotelCollectionEngine.collectHotels(body, (log) => {
          logs.push(log);
        });

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

    // 非爬虫 API 路由交给下一个中间件
    next();
  };
}
