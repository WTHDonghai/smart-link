import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, Response } from 'playwright';
import type { DutyClaimedTask, SystemLogEntry } from '@/src/types';
import { logger } from '@/src/services/logger';
import { formatLogsForExport } from '@/src/utils/logExport';
import { DouyinDutyRunner } from '@/src/crawler/duty/channels/douyin/douyinDutyRunner';
import { DouyinListCollector, waitForDouyinListResponse } from '@/src/crawler/duty/channels/douyin/douyinListCollector';
import { DouyinDetailInspector } from '@/src/crawler/duty/channels/douyin/douyinDetailInspector';
import { DutyOrderStatus } from '@/src/crawler/duty/dutyTaskContext';
import { dispatchDutyTask } from '@/src/crawler/duty/dutyTaskDispatcher';
import {
  DOUYIN_BOOK_ORDER_LIST_PATH, DOUYIN_BOOK_ORDER_DETAIL_PATH, DOUYIN_SECRET_NUM_PATH,
  isDouyinBookOrderListUrl,
} from '@/src/crawler/duty/channels/douyin/douyinOrderParsers';

vi.mock('@/src/crawler/visualTracker', () => ({
  updateVisualTrackerStatus: vi.fn(), visualClickLocator: vi.fn(),
}));

const ORDER_ID = 'dy-risk-order';

function responseFixture(path: string, body: unknown, status = 200): Response {
  return {
    url: () => `https://life.douyin.com${path}?token=private-token`,
    status: () => status,
    request: () => ({ method: () => 'POST' }),
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  } as unknown as Response;
}

function pageFixture(detail?: Response, secret?: Response): Page {
  return {
    url: () => 'https://life.douyin.com/p/workbench',
    frames: () => [],
    evaluate: vi.fn().mockResolvedValue(null),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    locator: (selector: string) => ({
      count: async () => 0,
      first: () => ({
        isVisible: async () => !selector.includes('.byted-modal') && (!selector.includes('一键复制') || Boolean(secret)),
        scrollIntoViewIfNeeded: async () => undefined,
      }),
    }),
    waitForResponse: async (predicate: (response: Response) => boolean) => {
      if (detail && predicate(detail)) return detail;
      if (secret && predicate(secret)) return secret;
      throw new Error('测试中没有匹配的接口响应');
    },
  } as unknown as Page;
}

const task: DutyClaimedTask = {
  id: 'douyin-api-risk', stationId: 'station-test', businessType: 'OTA_MIGRATION',
  businessId: 'COLLECT:station-test:DOUYIN_NEW', msgType: 'OTA_COLLECT_ORDER', leaseToken: 'test', data: '',
};

describe('抖音接口与异常归类的具体命中证据', () => {
  let entries: SystemLogEntry[];
  let unsubscribe: () => void;
  beforeEach(() => {
    entries = [];
    unsubscribe = logger.subscribe((entry) => entries.push(entry));
  });
  afterEach(() => unsubscribe());

  it('列表业务错误：页面无验证时，记录接口、业务码、status_msg 和实际命中词', async () => {
    const page = pageFixture();
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, { status_code: 10001, status_msg: '操作频繁，请稍后再试' });
    const collector = new DouyinListCollector();
    class Runner extends DouyinDutyRunner {
      public isRunning(): boolean { return true; }
      public async collectUnhandledOrders() {
        return collector.collectUnhandledOrders(page, DutyOrderStatus.NEW, async (action) => action(), async () => response);
      }
    }
    const result = await dispatchDutyTask(task, new Runner());

    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'RISK_VERIFICATION_REQUIRED', retryable: false });
    expect(result.errorMessage).toContain('接口响应特征');
    expect(result.errorMessage).toContain('操作频繁，请稍后再试');
    const risk = entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED');
    expect(risk?.meta?.riskEvidence).toMatchObject({
      origin: 'api-response', apiUrl: `https://life.douyin.com${DOUYIN_BOOK_ORDER_LIST_PATH}?redacted`,
      httpStatus: 200, businessCode: 10001,
      match: { source: 'response-body', fieldPath: '$.status_msg', matched: '操作频繁', snippet: '操作频繁，请稍后再试' },
    });
    expect(JSON.stringify(risk)).not.toContain('private-token');
  });

  it('接口命中日志保存完整原始响应，不把 160 字摘要冒充原始报文', async () => {
    const body = `{\n  "status_code": 10001,\n  "status_msg": "操作频繁 ${'详细错误上下文'.repeat(80)}",\n  "request_id": "trace-original-001"\n}`;
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, body);
    await expect(new DouyinListCollector().collectUnhandledOrders(
      pageFixture(), DutyOrderStatus.NEW, async (action) => action(), async () => response
    )).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    const risk = entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED');
    expect(risk?.apiResponse).toBe(body);
    expect(risk?.httpStatus).toBe(200);
    expect(risk?.apiMethod).toBe('POST');
    expect(formatLogsForExport(entries)).toContain(JSON.stringify(body));
    expect(risk?.apiUrl).toBe(`https://life.douyin.com${DOUYIN_BOOK_ORDER_LIST_PATH}?redacted`);
  });

  it('完整原始响应只进入诊断日志，不塞入摘要回执或泄露凭据', async () => {
    const body = JSON.stringify({ status_code: 10001, status_msg: '安全验证', token: 'private-token', request_id: 'trace-original-end' });
    const page = pageFixture();
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, body);
    class Runner extends DouyinDutyRunner {
      public isRunning(): boolean { return true; }
      public async collectUnhandledOrders() {
        return new DouyinListCollector().collectUnhandledOrders(page, DutyOrderStatus.NEW, async (action) => action(), async () => response);
      }
    }
    const result = await dispatchDutyTask(task, new Runner());
    expect(result.errorMessage).not.toContain('trace-original-end');
    const risk = entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED');
    expect(risk?.apiResponse).toBe(JSON.stringify({ status_code: 10001, status_msg: '安全验证', token: '[REDACTED]', request_id: 'trace-original-end' }));
    expect(JSON.stringify(entries)).not.toContain('private-token');
  });

  it('页面风控覆盖网络异常时仍保存原异常 message、stack 和 cause', async () => {
    const cause = new Error('底层连接 ECONNRESET');
    const original = new Error(`Timeout 15000ms\n${'原始调用日志'.repeat(80)}`, { cause });
    const page = pageFixture();
    page.url = () => 'https://verify.douyin.com/verify';
    page.waitForResponse = vi.fn().mockRejectedValue(original);
    await expect(waitForDouyinListResponse(page, isDouyinBookOrderListUrl, '新订/变更'))
      .rejects.toMatchObject({ errorCode: 'RISK_VERIFICATION_REQUIRED', cause: original });
    expect(formatLogsForExport(entries)).toContain('底层连接 ECONNRESET');
    expect(entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED')?.meta?.originalError).toEqual({
      name: 'Error', message: original.message, stack: original.stack,
      cause: { name: 'Error', message: cause.message, stack: cause.stack },
    });
  });

  it('非风控错误经业务包装后仍可在任务日志查看完整原始异常', async () => {
    const cause = new Error('socket hang up');
    const original = new Error('Timeout 15000ms at original-network-boundary', { cause });
    const page = pageFixture();
    page.waitForResponse = vi.fn().mockRejectedValue(original);
    class Runner extends DouyinDutyRunner {
      public isRunning(): boolean { return true; }
      public async collectUnhandledOrders(): Promise<never> {
        await waitForDouyinListResponse(page, isDouyinBookOrderListUrl, '新订/变更');
        throw new Error('测试不应走到此处');
      }
    }
    const result = await dispatchDutyTask(task, new Runner());
    expect(result.errorCode).toBe('LIST_RESPONSE_TIMEOUT');
    const failure = entries.find((entry) => entry.event === 'DOUYIN_TASK_EXECUTION_ERROR');
    expect(failure?.taskId).toBe(task.id);
    expect(failure?.meta?.originalError).toMatchObject({
      errorCode: 'LIST_RESPONSE_TIMEOUT',
      cause: { message: original.message, stack: original.stack, cause: { message: cause.message, stack: cause.stack } },
    });
  });

  it('详情报文中普通订单备注命中，也必须明确是接口业务字段而非页面提示', async () => {
    const response = responseFixture(DOUYIN_BOOK_ORDER_DETAIL_PATH, {
      status_code: 0, data: { data: JSON.stringify({ order_id: ORDER_ID, remark: '客人备注：需要验证码入住' }) },
    });
    const inspector = new DouyinDetailInspector();
    await expect(inspector.inspectOrderDetail(pageFixture(response), ORDER_ID, { refreshOrderList: vi.fn() }))
      .rejects.toThrow('接口响应特征');

    const risk = entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED');
    expect(risk?.meta?.riskEvidence).toMatchObject({
      origin: 'api-response', httpStatus: 200, businessCode: 0,
      match: { fieldPath: '$.data.data(JSON).remark', matched: '验证码', snippet: '客人备注：需要验证码入住' },
    });
  });

  it('列表非 JSON 验证页记录实际响应片段，而不是只报 JSON 解析失败', async () => {
    const page = pageFixture();
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, '<html><body>请完成验证后继续</body></html>');
    await expect(new DouyinListCollector().collectUnhandledOrders(
      page, DutyOrderStatus.NEW, async (action) => action(), async () => response
    )).rejects.toThrow('接口响应特征');
    const risk = entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED');
    expect(risk?.meta?.riskEvidence).toMatchObject({
      origin: 'api-response', match: { fieldPath: '$raw', matched: '请完成验证', snippet: '<html><body>请完成验证后继续</body></html>' },
    });
  });

  it('HTTP 错误中的验证响应记录状态码和正文，而不是将 HTTP 状态本身当作风控证据', async () => {
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, '安全验证：请拖动滑块', 403);
    const page = pageFixture(response);
    await expect(waitForDouyinListResponse(page, isDouyinBookOrderListUrl, '新订/变更'))
      .rejects.toThrow('接口响应特征');
    expect(entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED')?.meta?.riskEvidence)
      .toMatchObject({ origin: 'api-response', httpStatus: 403, match: { fieldPath: '$raw', matched: '安全验证' } });
  });

  it('HTTP 非 200 但没有风控特征时不伪造风控原因', async () => {
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, 'Service Unavailable', 503);
    await expect(waitForDouyinListResponse(pageFixture(response), isDouyinBookOrderListUrl, '新订/变更'))
      .rejects.toMatchObject({ errorCode: 'LIST_HTTP_ERROR', retryable: false });
    expect(entries.filter((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED')).toEqual([]);
  });

  it('真实手机号接口（get_secret_num）命中风控时保留实际提示并阻断，不再无诊断地返回原始详情', async () => {
    const response = responseFixture(DOUYIN_BOOK_ORDER_DETAIL_PATH, { status_code: 0, data: { order_id: ORDER_ID } });
    const secret = responseFixture(DOUYIN_SECRET_NUM_PATH, { status_code: 9001, status_msg: '访问频繁，请完成验证' });
    await expect(new DouyinDetailInspector().inspectOrderDetail(pageFixture(response, secret), ORDER_ID, { refreshOrderList: vi.fn() }))
      .rejects.toThrow('接口响应特征');
    expect(entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED')?.meta?.riskEvidence)
      .toMatchObject({ origin: 'api-response', businessCode: 9001, match: { fieldPath: '$.status_msg', matched: '访问频繁' } });
  });

  it('正常列表响应的订单备注不因诊断新增拦截', async () => {
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, {
      status_code: 0, data: { data: [JSON.stringify({
        order_base_info: { order_id: ORDER_ID }, remark: '无需验证码入住',
      })] },
    });
    const orders = await new DouyinListCollector().collectUnhandledOrders(
      pageFixture(), DutyOrderStatus.NEW, async (action) => action(), async () => response
    );
    expect(orders.map((order) => order.orderId)).toEqual([ORDER_ID]);
    expect(entries.filter((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED')).toEqual([]);
  });

  it('列表失败原因没有特征时，不以响应其他字段中的词伪造风控', async () => {
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, {
      status_code: 100, status_msg: '订单无效', data: { remark: '验证码入住' },
    });
    await expect(new DouyinListCollector().collectUnhandledOrders(
      pageFixture(), DutyOrderStatus.NEW, async (action) => action(), async () => response
    )).rejects.toMatchObject({ errorCode: 'LIST_BUSINESS_FAILED' });
    expect(entries.filter((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED')).toEqual([]);
  });

  it('非目标订单详情中的关键词不污染当前订单的风控判定', async () => {
    const other = responseFixture(DOUYIN_BOOK_ORDER_DETAIL_PATH, {
      status_code: 0, data: { order_id: 'another-order', remark: '验证码入住' },
    });
    const target = responseFixture(DOUYIN_BOOK_ORDER_DETAIL_PATH, {
      status_code: 0, data: { order_id: ORDER_ID, remark: '正常订单' },
    });
    const page = pageFixture();
    page.waitForResponse = vi.fn().mockResolvedValueOnce(other).mockResolvedValueOnce(target);
    const result = await new DouyinDetailInspector().inspectOrderDetail(page, ORDER_ID, { refreshOrderList: vi.fn() });
    expect(result).toEqual({ status_code: 0, data: { order_id: ORDER_ID, remark: '正常订单' } });
    expect(entries.filter((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED')).toEqual([]);
  });

  it('普通 HTTP 失败记录原始响应，开发不必依靠风控摘要排查', async () => {
    const body = 'Service Unavailable\nupstream request_id=trace-http-original';
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, body, 503);
    await expect(waitForDouyinListResponse(pageFixture(response), isDouyinBookOrderListUrl, '新订/变更'))
      .rejects.toMatchObject({ errorCode: 'LIST_HTTP_ERROR' });
    expect(entries.find((entry) => entry.event === 'DOUYIN_API_RESPONSE_FAILED')).toMatchObject({
      httpStatus: 503, apiResponse: body, apiMethod: 'POST',
    });
  });

  it('列表 HTTP 响应体读取失败不误报为超时或风控', async () => {
    const response = responseFixture(DOUYIN_BOOK_ORDER_LIST_PATH, '', 503);
    response.text = vi.fn().mockRejectedValue(new Error('连接关闭'));
    await expect(waitForDouyinListResponse(pageFixture(response), isDouyinBookOrderListUrl, '新订/变更'))
      .rejects.toMatchObject({ errorCode: 'LIST_HTTP_ERROR', retryable: false });
    expect(entries.filter((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED')).toEqual([]);
  });

  it('仅异常文字触发归类：明确来源未确认，记录原错误字段及命中内容', async () => {
    class Runner extends DouyinDutyRunner {
      public isRunning(): boolean { return true; }
      public async collectUnhandledOrders(): Promise<never> { throw new Error('目标元素点击失败，页面提示稍后再试'); }
    }
    const result = await dispatchDutyTask(task, new Runner());
    expect(result.errorCode).toBe('RISK_VERIFICATION_REQUIRED');
    expect(result.errorMessage).toContain('异常文本归类，未确认页面或接口来源');
    const risk = entries.find((entry) => entry.event === 'DOUYIN_RISK_CONTROL_MATCHED');
    expect(risk).toMatchObject({ taskId: task.id, msgType: 'OTA_COLLECT_ORDER' });
    expect(risk?.meta?.riskEvidence).toMatchObject({
      origin: 'exception', match: { source: 'exception-text', fieldPath: 'message', matched: '稍后再试', snippet: '目标元素点击失败，页面提示稍后再试' },
    });
    expect(risk?.meta?.originalError).toMatchObject({ name: 'Error', message: '目标元素点击失败，页面提示稍后再试', stack: expect.stringContaining('collectUnhandledOrders') });
  });
});
