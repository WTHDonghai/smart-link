import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { runDutyStepWithDialogRecovery } from '../../../src/crawler/duty/dutyDialogRecovery';
import { observeDutyPage } from '../../../src/crawler/duty/dutyPageObserver';
import { agentTraceLedger } from '../../../src/agent/agentTraceLedger';
import { logger } from '../../../src/services/logger';
import type { AgentLogPersistedAck } from '../../../src/types/agent';
import type { LogEventType } from '../../../src/types';
import type { TrackOptions } from '../../../src/services/logger';
import type { SystemLogEntry } from '../../../src/types';
import {
  startDutyDialogFixtureServer,
  type DutyDialogFixture,
} from './fixture/dutyDialogFixtureServer';

/**
 * P4 弹窗处置验收(设计 7.2/7.3/7.4/9.5):
 * 真实系统 Chrome + 真实观察/决策/关闭/验证链路,仅注入外部 I/O
 * (日志落库与提交确认回执,与 P3 诊断测试同一模式)。
 * 验收红线:风控类零页面动作、同一弹窗仅处置一次、验证失败不重试不伪造、
 * 动作意图先落库确认再执行。
 */

describe('P4 弹窗处置验收', () => {
  let fixture: DutyDialogFixture;
  let browser: Browser;
  let page: Page;
  let trackSpy: MockInstance<(event: LogEventType | string, options?: TrackOptions) => SystemLogEntry>;
  let ackSpy: MockInstance<
    (entryId: string, options?: { timeoutMs?: number }) => Promise<AgentLogPersistedAck>
  >;

  /** 仿真页面步骤:点击订单卡片(被弹窗遮罩拦截时真实超时失败),返回标记值验证结果透传 */
  const clickOrderStep = (): Promise<string> =>
    page.locator('li[data-order="ORD-1001"]').click({ timeout: 1200 }).then(() => 'ORDER_CARD_OPENED');

  beforeAll(async () => {
    fixture = await startDutyDialogFixtureServer();
    // 与生产运行时一致使用系统 Chrome(channel),不依赖 playwright 下载的 headless-shell
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
    await fixture.close();
  });

  beforeEach(async () => {
    let entryId = 0;
    trackSpy = vi.spyOn(logger, 'track').mockImplementation(() => {
      entryId += 1;
      return { id: `log-${entryId}` } as SystemLogEntry;
    });
    ackSpy = vi
      .spyOn(agentTraceLedger, 'waitForLogCommitAck')
      .mockResolvedValue({ entryId: 'log-1', runId: 'r', sequence: 1, status: 'committed' });
  });

  afterEach(() => {
    trackSpy.mockRestore();
    ackSpy.mockRestore();
  });

  const emittedEventNames = (): string[] => trackSpy.mock.calls.map((call) => call[0]);

  it('用例1:广告弹窗 → 关闭 → 验证 → 仅重试步骤一次 → 流程继续(设计 7.2)', async () => {
    await page.goto(fixture.urlFor('ad'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800); // 弹窗与遮罩出现

    const outcome = await runDutyStepWithDialogRecovery(page, clickOrderStep, {
      stepName: 'inspect-order-detail',
      orderId: 'ORD-1001',
    });

    expect(outcome.stepSucceeded).toBe(true);
    expect(outcome.finalStatus).toBe('SUCCEEDED');
    expect(outcome.action).toBe('close_dialog');
    expect(outcome.pageActionsPerformed).toBe(1);
    expect(outcome.closed).toBe(true);
    expect(outcome.verified).toBe(true);
    expect(outcome.stepRetryCount).toBe(1);
    expect(outcome.result).toBe('ORDER_CARD_OPENED'); // 步骤返回值经重试路径如实透传

    // 追踪链六段齐备:触发(run)→观察(snapshot)→决策→动作→验证→结果
    const events = emittedEventNames();
    expect(events).toContain('AGENT_RUN_STARTED');
    expect(events).toContain('AGENT_SNAPSHOT_COMPLETED');
    expect(events).toContain('AGENT_DECISION_COMPLETED');
    expect(events).toContain('AGENT_TOOL_STARTED');
    expect(events).toContain('AGENT_TOOL_COMPLETED');
    expect(events).toContain('AGENT_VALIDATION_COMPLETED');
    expect(events).toContain('AGENT_RUN_COMPLETED');
  });

  it('用例2:验证码弹窗 → 零页面动作 → MANUAL_REVIEW(越界红线,设计 7.1)', async () => {
    await page.goto(fixture.urlFor('captcha'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const outcome = await runDutyStepWithDialogRecovery(page, clickOrderStep, {
      stepName: 'inspect-order-detail',
      orderId: 'ORD-1001',
    });

    expect(outcome.finalStatus).toBe('MANUAL_REVIEW');
    expect(outcome.action).toBe('notify_only');
    expect(outcome.pageActionsPerformed).toBe(0); // 硬红线:零页面动作
    expect(outcome.stepRetryCount).toBe(0);
    expect(outcome.failureReason).toContain('安全验证');
    // 不得产生任何工具动作意图事件
    expect(emittedEventNames()).not.toContain('AGENT_TOOL_STARTED');
    // 弹窗原样保留(未被触碰)
    expect((await observeDutyPage(page)).dialogs).toHaveLength(1);
  });

  it('用例3:关闭后再弹 → 不二次处置 → MANUAL_REVIEW(设计 7.4 不循环)', async () => {
    await page.goto(fixture.urlFor('ad-retry'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const outcome = await runDutyStepWithDialogRecovery(page, clickOrderStep, {
      stepName: 'inspect-order-detail',
    });

    expect(outcome.finalStatus).toBe('MANUAL_REVIEW');
    expect(outcome.closed).toBe(true); // 首次关闭已执行
    expect(outcome.verified).toBe(false); // 稳定窗口内弹窗重现
    expect(outcome.stepRetryCount).toBe(0); // 验证失败不重试步骤
    expect(outcome.pageActionsPerformed).toBe(1); // 仅处置一次
    expect(outcome.failureReason).toContain('再次出现');
  });

  it('用例4:关不掉的弹窗 → verify 失败 → 不重试、不伪造成功(设计 7.5/Fail-Fast)', async () => {
    await page.goto(fixture.urlFor('persistent'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const outcome = await runDutyStepWithDialogRecovery(page, clickOrderStep, {
      stepName: 'inspect-order-detail',
    });

    expect(outcome.finalStatus).toBe('MANUAL_REVIEW');
    expect(outcome.closed).toBe(true); // 点击执行了
    expect(outcome.verified).toBe(false); // 弹窗仍在
    expect(outcome.stepRetryCount).toBe(0);
    expect(outcome.failureReason).toContain('仍存在');
    // 弹窗未被移除的事实可从 outcome.observation 复核
    expect(outcome.observation?.dialogs.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('用例5:步骤失败但弹窗已消失(人工接管现场)→ 取消处置、零动作(设计 7.2 页面所有权)', async () => {
    await page.goto(fixture.urlFor('ad'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // 模拟人工在步骤失败瞬间处置了弹窗:步骤自身失败且弹窗已不在现场
    const stepWithTakeover = async (): Promise<void> => {
      await page.evaluate(() => {
        document.getElementById('dialog')?.remove();
        document.getElementById('overlay')?.remove();
      });
      throw new Error('定位订单卡片超时');
    };

    const outcome = await runDutyStepWithDialogRecovery(page, stepWithTakeover, {
      stepName: 'inspect-order-detail',
    });

    expect(outcome.finalStatus).toBe('CANCELLED');
    expect(outcome.action).toBe('observe_only');
    expect(outcome.pageActionsPerformed).toBe(0);
    expect(outcome.failureReason).toContain('现场已变化');
    expect(outcome.failureReason).toContain('人工接管');
    expect(emittedEventNames()).not.toContain('AGENT_TOOL_STARTED');
  });

  it('用例6:动作意图确认失败 → close_dialog 不执行(设计 9.5 提交确认闸门)', async () => {
    await page.goto(fixture.urlFor('ad'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    ackSpy.mockRejectedValueOnce(new Error('等待 Agent 日志提交确认超时'));

    const outcome = await runDutyStepWithDialogRecovery(page, clickOrderStep, {
      stepName: 'inspect-order-detail',
    });

    expect(outcome.finalStatus).toBe('MANUAL_REVIEW');
    expect(outcome.pageActionsPerformed).toBe(0); // 先落库确认、后动作
    expect(outcome.closed).toBe(false);
    expect(outcome.failureReason).toContain('持久化确认失败');
    // 弹窗原样保留:证明动作确实未执行
    expect((await observeDutyPage(page)).dialogs).toHaveLength(1);
    expect(emittedEventNames()).toContain('AGENT_TOOL_STARTED'); // 意图已发出
    expect(emittedEventNames()).not.toContain('AGENT_TOOL_COMPLETED'); // 动作未执行
  });
});
