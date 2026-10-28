import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import type { DutyClaimedTask, SystemLogEntry } from '@/src/types';
import { logger } from '@/src/services/logger';
import { assertNoDouyinPageRisk, checkDouyinPageRisk } from '@/src/crawler/duty/channels/douyin/douyinRiskGuard';
import { DouyinDutyRunner } from '@/src/crawler/duty/channels/douyin/douyinDutyRunner';
import { waitForDouyinListResponse } from '@/src/crawler/duty/channels/douyin/douyinListCollector';
import { isDouyinBookOrderListUrl } from '@/src/crawler/duty/channels/douyin/douyinOrderParsers';
import { dispatchDutyTask } from '@/src/crawler/duty/dutyTaskDispatcher';
import { buildTaskResultPayload } from '@/src/crawler/duty/dutyOrchestrationEngine';

// HUD 更新属于浏览器副作用；风险探测的 evaluate 回调仍执行真实源码。
vi.mock('@/src/crawler/visualTracker', () => ({
  updateVisualTrackerStatus: vi.fn(),
}));

const PAGE_URL = 'https://life.douyin.com/p/workbench?token=private-token#private-hash';

interface PageFixtureOptions {
  title?: string;
  bodyText?: string;
  fallbackText?: string;
  elementVisible?: boolean;
  elementSrc?: string;
  frameUrl?: string;
}

function createPageFixture(options: PageFixtureOptions = {}): Page {
  const element = options.elementVisible === undefined ? null : {
    tagName: 'DIV',
    id: 'captcha-container',
    textContent: '请完成验证',
    matches: (selector: string): boolean => selector === '.captcha-verify-container',
    getAttribute: (name: string): string | null => {
      if (name === 'class') return 'captcha-verify-container';
      if (name === 'src') return options.elementSrc ?? null;
      return null;
    },
    getBoundingClientRect: () => ({ width: options.elementVisible ? 320 : 0, height: options.elementVisible ? 180 : 0 }),
  };
  vi.stubGlobal('document', {
    querySelector: () => element,
    title: options.title ?? '抖音订单工作台',
    body: { innerText: options.bodyText ?? '订单列表', textContent: options.fallbackText ?? '订单列表' },
  });
  vi.stubGlobal('location', { href: PAGE_URL });
  vi.stubGlobal('getComputedStyle', () => ({
    display: options.elementVisible ? 'block' : 'none',
    visibility: 'visible',
  }));

  // Playwright evaluate 会把第二个参数透传给页面回调；夹具同步转发，保证真实探测回调执行。
  const evaluate = vi.fn(async (probe: (arg?: unknown) => unknown, arg?: unknown) => probe(arg));
  return {
    url: () => PAGE_URL,
    frames: () => options.frameUrl ? [{ url: () => options.frameUrl, evaluate }] : [],
    evaluate,
  } as unknown as Page;
}

describe('抖音风控命中证据（执行真实页面探测回调）', () => {
  let entries: SystemLogEntry[];
  let unsubscribe: () => void;

  beforeEach(() => {
    entries = [];
    unsubscribe = logger.subscribe((entry) => entries.push(entry));
  });

  afterEach(() => {
    unsubscribe();
  });

  it.each([false, true])('记录 DOM 命中选择器、元素信息及可见性 visible=%s，不改变拦截规则', async (visible) => {
    const page = createPageFixture({ elementVisible: visible });

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');

    expect(entries).toContainEqual(expect.objectContaining({
      event: 'DOUYIN_RISK_CONTROL_MATCHED',
      level: 'ERROR',
      channelId: 'DOUYIN',
      meta: expect.objectContaining({
        riskEvidence: expect.objectContaining({
          match: {
            source: 'dom',
            selector: '.captcha-verify-container',
            tagName: 'DIV',
            elementId: 'captcha-container',
            className: 'captcha-verify-container',
            src: null,
            visible,
            snippet: '请完成验证',
          },
        }),
      }),
    }));
  });

  it.each([
    { title: '系统提示：稍后再试', source: 'title', matched: '稍后再试', snippet: '系统提示：稍后再试' },
    { bodyText: '系统提示：请完成安全验证', source: 'body', matched: '安全验证', snippet: '系统提示：请完成安全验证' },
  ])('记录 $source 中实际命中的词和上下文，而非只返回 true', async ({ source, matched, snippet, ...options }) => {
    const page = createPageFixture(options);

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    expect(entries[0].meta?.riskEvidence).toMatchObject({ match: { source, matched, snippet } });
  });

  it('正文回退到 textContent 时记录来源，便于识别不可见文本误命中', async () => {
    const page = createPageFixture({ bodyText: '', fallbackText: '操作频繁，请稍后再试' });

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    expect(entries[0].meta?.riskEvidence).toMatchObject({
      match: { source: 'body', textSource: 'textContent', matched: '操作频繁' },
    });
  });

  it('记录子 Frame URL 命中来源和序号，隐藏 URL 查询参数与片段', async () => {
    const page = {
      url: () => PAGE_URL,
      frames: () => [{ url: () => 'https://captcha.douyin.com/verify?ticket=private-ticket#private-fragment' }],
    } as unknown as Page;

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    expect(entries[0].meta?.riskEvidence).toMatchObject({
      pageUrl: 'https://life.douyin.com/p/workbench?redacted#redacted',
      frameUrl: 'https://captcha.douyin.com/verify?redacted#redacted',
      frameIndex: 0,
      match: { source: 'frame-url', matched: 'captcha.douyin.com' },
    });
    expect(JSON.stringify(entries)).not.toMatch(/private-token|private-hash|private-ticket|private-fragment/);
  });

  it('主页面 URL 命中也记录具体规则，不暴露 URL 中的凭据', async () => {
    const page = {
      url: () => 'https://verify.douyin.com/check?token=private-token',
    } as unknown as Page;

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    expect(entries[0].meta?.riskEvidence).toEqual({
      origin: 'page',
      pageUrl: 'https://verify.douyin.com/check?redacted',
      frameUrl: 'https://verify.douyin.com/check?redacted',
      frameIndex: null,
      match: { source: 'page-url', matched: 'verify.douyin.com' },
    });
  });

  it('子 Frame 正文命中保留实际 Frame URL', async () => {
    const page = createPageFixture({ bodyText: '登录验证', frameUrl: 'https://life.douyin.com/frame/orders' });

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    expect(entries[0].meta?.riskEvidence).toMatchObject({
      frameUrl: 'https://life.douyin.com/frame/orders', frameIndex: 0,
      match: { source: 'body', matched: '登录验证' },
    });
  });

  it('DOM 命中的 src 隐去查询参数和片段', async () => {
    const page = createPageFixture({
      elementVisible: false, elementSrc: 'https://captcha.douyin.com/frame?ticket=private-ticket#private-fragment',
    });

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    expect(entries[0].meta?.riskEvidence).toMatchObject({
      match: { source: 'dom', src: 'https://captcha.douyin.com/frame?redacted#redacted', visible: false },
    });
    expect(JSON.stringify(entries)).not.toMatch(/private-ticket|private-fragment/);
  });

  it('URL 查询参数中的关键词仍可命中，但证据只记录词而非参数值', async () => {
    const page = createPageFixture();
    vi.stubGlobal('location', { href: 'https://life.douyin.com/frame?message=操作频繁&token=private-token' });

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    expect(entries[0].meta?.riskEvidence).toMatchObject({ match: { source: 'url', matched: '操作频繁' } });
    expect(JSON.stringify(entries)).not.toContain('private-token');
  });

  it('只记录命中词附近的短文本，并隐藏连续长数字', async () => {
    const page = createPageFixture({ bodyText: `${'普通内容'.repeat(50)} 操作频繁 13812345678 ${'更多内容'.repeat(80)}` });

    await expect(assertNoDouyinPageRisk(page)).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
    const evidence = entries[0].meta?.riskEvidence as { match: { snippet: string } };
    expect(evidence.match.snippet).toHaveLength(160);
    expect(evidence.match.snippet).toContain('操作频繁 [数字已隐藏]');
    expect(JSON.stringify(entries)).not.toContain('13812345678');
  });

  it('正文 3000 字符之外的关键词不会新增拦截', async () => {
    const page = createPageFixture({ bodyText: `${'正'.repeat(3000)}安全验证` });
    expect(await checkDouyinPageRisk(page)).toBe(false);
    expect(entries).toEqual([]);
  });

  it('顾客备注中的「无人机表演」不触发人工校验告警（客户环境回归）', async () => {
    const page = createPageFixture({
      bodyText: '订单信息 顾客备注 不要角落房；要看到无人机表演和烟花的房间，谢谢 商家备注 暂无备注 客服备注 - 商品名称 周末、秋假不加价｜豪华房1晚含早',
    });

    expect(await checkDouyinPageRisk(page)).toBe(false);
    await expect(assertNoDouyinPageRisk(page)).resolves.toBeUndefined();
    expect(entries).toEqual([]);
  });

  it('无风控页面不产生风控命中日志', async () => {
    const page = createPageFixture();
    expect(await checkDouyinPageRisk(page)).toBe(false);
    await expect(assertNoDouyinPageRisk(page)).resolves.toBeUndefined();
    expect(entries).toEqual([]);
  });

  it('列表接口等待失败后的命中明确标记检查节点', async () => {
    const page = createPageFixture({ bodyText: '操作频繁' });
    page.waitForResponse = vi.fn().mockRejectedValue(new Error('Timeout 15000ms'));

    await expect(waitForDouyinListResponse(page, isDouyinBookOrderListUrl, '新订/变更'))
      .rejects.toThrow('列表响应等待失败：新订/变更');
    expect(entries[0].meta?.checkpoint).toBe('列表响应等待失败：新订/变更');
  });

  it('真实采集、调度与回执链路保留检查节点和证据，ackData 仍只含错误码', async () => {
    const page = createPageFixture({ bodyText: '系统提示：操作频繁，请稍后再试' });
    // 只替换浏览器会话边界；采集器、调度器和回执序列化全部使用真实实现。
    class FixtureRunner extends DouyinDutyRunner {
      public isRunning(): boolean { return true; }
      protected getActivePage(_operation: string): Page { return page; }
    }
    const task: DutyClaimedTask = {
      id: 'douyin-risk-evidence-task',
      stationId: 'station-test',
      businessType: 'OTA_MIGRATION',
      businessId: 'COLLECT:station-test:smart-link:DOUYIN_NEW:DOUYIN:2026-10-20T10:45',
      msgType: 'OTA_COLLECT_ORDER',
      leaseToken: 'test-lease',
      data: '',
    };

    const result = await dispatchDutyTask(task, new FixtureRunner());
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'RISK_VERIFICATION_REQUIRED', retryable: false });
    expect(result.errorMessage).toContain('采集入口：NEW');
    expect(result.errorMessage).toContain('"source":"body"');
    expect(result.errorMessage).toContain('操作频繁');
    expect(result.errorMessage).not.toContain('private-token');
    expect(entries[0].meta?.checkpoint).toBe('采集入口：NEW');

    const payload = buildTaskResultPayload(task, task.stationId, {
      status: 'FAIL', errorCode: result.errorCode, errorMessage: result.errorMessage, retryable: result.retryable,
    });
    expect(payload.errorMessage).toBe(result.errorMessage);
    expect(payload.retryable).toBe(false);
    expect(payload.details[0].ackData).toBe(
      Buffer.from(JSON.stringify({ errorCode: 'RISK_VERIFICATION_REQUIRED' })).toString('base64')
    );
  });
});
