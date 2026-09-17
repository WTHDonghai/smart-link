import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChannelDutyInfo, DutyCoordinatorStatus } from '../types';

interface DutyServerState {
  channels: Record<string, ChannelDutyInfo>;
  coordinatorStatus: DutyCoordinatorStatus;
}

const state: DutyServerState = {
  channels: {},
  coordinatorStatus: 'STOPPED',
};

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

        state.channels[channelCode] = {
          channelCode,
          status: 'RUNNING',
          lastStartedAt: Date.now(),
        };
        state.coordinatorStatus = 'CLAIMING';

        return sendJsonResponse(res, 200, {
          success: true,
          message: `渠道「${channelCode}」值守已启动`,
        });
      } catch (error) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 2. POST /api/duty/stop：停止某渠道值守
    if (req.method === 'POST' && url.startsWith('/api/duty/stop')) {
      try {
        const body = await parseJsonBody<{ channelCode?: string }>(req);
        const channelCode = (body.channelCode || '').trim().toUpperCase();
        if (!channelCode) {
          return sendJsonResponse(res, 400, { success: false, error: '必须指定 channelCode' });
        }

        if (state.channels[channelCode]) {
          state.channels[channelCode] = {
            channelCode,
            status: 'STOPPED',
          };
        }

        const hasRunning = Object.values(state.channels).some((c) => c.status === 'RUNNING');
        if (!hasRunning) {
          state.coordinatorStatus = 'STOPPED';
        }

        return sendJsonResponse(res, 200, {
          success: true,
          message: `渠道「${channelCode}」值守已停止`,
        });
      } catch (error) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 3. GET /api/duty/status：查询当前值守状态
    if (req.method === 'GET' && url.startsWith('/api/duty/status')) {
      return sendJsonResponse(res, 200, state);
    }

    next();
  };
}
