import type { IncomingMessage, ServerResponse } from 'node:http';
import { dutyOrchestrationEngine } from '../crawler/duty/dutyOrchestrationEngine';
import {
  initNodePlatformTokens,
  savePlatformTokenFile,
  clearPlatformTokenFile,
} from '../crawler/duty/platformTokenStore';
import { saveTokensToStorage, clearTokensFromStorage } from '../services/platformAuth';
import type { PlatformAuthTokens } from '../types';

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

function sendJsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/**
 * Vite 中间件分发器：处理 /api/duty/* 路由
 */
export function createDutyApiMiddleware() {
  initNodePlatformTokens();
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = req.url || '';

    // 1. POST /api/duty/start：启动某渠道值守
    if (req.method === 'POST' && url.startsWith('/api/duty/start')) {
      try {
        const body = await parseJsonBody<{ channelCode?: string }>(req);
        const channelCode = (body.channelCode || '').trim().toUpperCase();
        if (!channelCode) {
          return sendJsonResponse(res, 400, { success: false, error: '必须指定 channelCode' });
        }

        const result = await dutyOrchestrationEngine.startDuty(channelCode);
        return sendJsonResponse(res, 200, result);
      } catch (error) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 2. POST /api/duty/stop-all：一键停止所有渠道值守
    if (req.method === 'POST' && url.startsWith('/api/duty/stop-all')) {
      try {
        const result = await dutyOrchestrationEngine.stopAllDuty();
        return sendJsonResponse(res, 200, result);
      } catch (error) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 3. POST /api/duty/stop：停止某渠道值守
    if (req.method === 'POST' && url.startsWith('/api/duty/stop')) {
      try {
        const body = await parseJsonBody<{ channelCode?: string }>(req);
        const channelCode = (body.channelCode || '').trim().toUpperCase();
        if (!channelCode) {
          return sendJsonResponse(res, 400, { success: false, error: '必须指定 channelCode' });
        }

        const result = await dutyOrchestrationEngine.stopDuty(channelCode);
        return sendJsonResponse(res, 200, result);
      } catch (error) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 3. GET /api/duty/status：查询当前值守状态
    if (req.method === 'GET' && url.startsWith('/api/duty/status')) {
      const urlObj = new URL(url, 'http://localhost');
      const since = Number(urlObj.searchParams.get('since') || 0);
      return sendJsonResponse(res, 200, {
        channels: dutyOrchestrationEngine.getChannelDutyStatus(),
        coordinatorStatus: dutyOrchestrationEngine.getCoordinatorStatus(),
        station: dutyOrchestrationEngine.getStationIdentity(),
        logs: dutyOrchestrationEngine.getRecentDutyLogs(since),
      });
    }

    // 4. POST /api/duty/tokens：同步平台授权 Token 至 Node 宿主
    if (req.method === 'POST' && url.startsWith('/api/duty/tokens')) {
      try {
        const tokens = await parseJsonBody<PlatformAuthTokens>(req);
        if (!tokens || !tokens.accessToken) {
          return sendJsonResponse(res, 400, { success: false, error: '无效的 Token 载荷' });
        }
        saveTokensToStorage(tokens);
        savePlatformTokenFile(tokens);
        return sendJsonResponse(res, 200, { success: true });
      } catch (error) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 5. DELETE /api/duty/tokens：清除 Node 宿主中的平台授权 Token
    if (req.method === 'DELETE' && url.startsWith('/api/duty/tokens')) {
      try {
        clearTokensFromStorage();
        clearPlatformTokenFile();
        return sendJsonResponse(res, 200, { success: true });
      } catch (error) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    next();
  };
}
