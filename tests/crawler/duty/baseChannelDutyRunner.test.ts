import { describe, it, expect } from 'vitest';
import {
  BaseChannelDutyRunner,
  SUPPORTED_DUTY_TASK_TYPES,
  type DutyUnhandledOrderSummary,
} from '@/src/crawler/duty/dutyContracts';
import { MeituanDutyRunner } from '@/src/crawler/duty/channels/meituan/meituanDutyRunner';
import { DouyinDutyRunner } from '@/src/crawler/duty/channels/douyin/douyinDutyRunner';

class MinimalChannelRunner extends BaseChannelDutyRunner {
  public readonly channelCode: string;

  constructor(channelCode: string = 'TEST_CHANNEL') {
    super();
    this.channelCode = channelCode;
  }

  public async start(): Promise<void> {
    this.running = true;
  }

  public async stop(): Promise<void> {
    this.running = false;
  }

  public async collectUnhandledOrders(): Promise<DutyUnhandledOrderSummary[]> {
    return [];
  }

  public async inspectOrderDetail(): Promise<Record<string, unknown>> {
    return {};
  }

  public exposeGetActivePage(operation: string) {
    return this.getActivePage(operation);
  }

  public setMockSession(session: import('@/src/crawler/browserManager').BrowserSession | null) {
    this.session = session;
  }
}

describe('BaseChannelDutyRunner 抽象基类与能力矩阵', () => {
  it('默认提供系统标准的全量值守任务白名单 (SUPPORTED_DUTY_TASK_TYPES)', () => {
    const runner = new MinimalChannelRunner();
    expect(runner.supportedTaskTypes).toEqual(SUPPORTED_DUTY_TASK_TYPES);
    expect(runner.supportedTaskTypes).toEqual([
      'OTA_COLLECT_ORDER',
      'OTA_IMPORT_ORDER',
      'OTA_CONFIRM_IMPORT',
      'OTA_CONFIRM_CANCEL',
    ]);
  });

  it('初始运行状态 isRunning() 默认为 false，调用 start/stop 可正确切换', async () => {
    const runner = new MinimalChannelRunner();
    expect(runner.isRunning()).toBe(false);

    await runner.start();
    expect(runner.isRunning()).toBe(true);

    await runner.stop();
    expect(runner.isRunning()).toBe(false);
  });

  it('confirmImportEnabled 默认为 true，setConfirmImportEnabled 可正确切换', () => {
    const runner = new MinimalChannelRunner();
    expect(runner.confirmImportEnabled).toBe(true);

    runner.setConfirmImportEnabled(false);
    expect(runner.confirmImportEnabled).toBe(false);

    runner.setConfirmImportEnabled(true);
    expect(runner.confirmImportEnabled).toBe(true);
  });

  it('MeituanDutyRunner 应继承 BaseChannelDutyRunner，且默认拥有全量任务白名单并正确解析渠道名', () => {
    const meituanRunner = new MeituanDutyRunner();
    expect(meituanRunner).toBeInstanceOf(BaseChannelDutyRunner);
    expect(meituanRunner.channelCode).toBe('MEITUAN');
    expect(meituanRunner.channelName).toBe('美团');
    expect(meituanRunner.supportedTaskTypes).toEqual(SUPPORTED_DUTY_TASK_TYPES);
    expect(meituanRunner.isRunning()).toBe(false);
    expect(meituanRunner.confirmImportEnabled).toBe(true);
  });

  it('DouyinDutyRunner 应继承 BaseChannelDutyRunner，且重构对标后具备全量任务白名单并正确解析渠道名', () => {
    const douyinRunner = new DouyinDutyRunner();
    expect(douyinRunner).toBeInstanceOf(BaseChannelDutyRunner);
    expect(douyinRunner.channelCode).toBe('DOUYIN');
    expect(douyinRunner.channelName).toBe('抖音');
    expect(douyinRunner.supportedTaskTypes).toEqual(SUPPORTED_DUTY_TASK_TYPES);
    expect(douyinRunner.isRunning()).toBe(false);
    expect(douyinRunner.confirmImportEnabled).toBe(true);
  });

  describe('channelName 动态解析与 getActivePage 异常门禁', () => {
    it('channelName 应通过 channelMeta 精准根据 channelCode 解析中文名', () => {
      expect(new MinimalChannelRunner('MEITUAN').channelName).toBe('美团');
      expect(new MinimalChannelRunner('DOUYIN').channelName).toBe('抖音');
      expect(new MinimalChannelRunner('CTRIP').channelName).toBe('携程旅行');
      expect(new MinimalChannelRunner('FLIGGY').channelName).toBe('飞猪旅行');
      expect(new MinimalChannelRunner('UNKNOWN_CODE').channelName).toBe('UNKNOWN_CODE');
    });

    it('当执行器未运行或 session 缺失时，getActivePage 应抛出带对应渠道中文名的 DutyExecutionError', () => {
      const runner = new MinimalChannelRunner('MEITUAN');
      expect(() => runner.exposeGetActivePage('刷新列表')).toThrowError(
        '美团值守执行器未运行，无法刷新列表'
      );
    });

    it('当 session.page 已关闭时，getActivePage 应抛出带对应渠道中文名的 TARGET_PAGE_NOT_READY 异常', () => {
      const runner = new MinimalChannelRunner('DOUYIN');
      (runner as unknown as { running: boolean }).running = true;
      runner.setMockSession({
        page: { isClosed: () => true } as unknown as import('playwright').Page,
        context: {} as unknown as import('playwright').BrowserContext,
        close: async () => {},
      });

      expect(() => runner.exposeGetActivePage('确认取消')).toThrowError(
        '抖音浏览器页面已关闭，无法确认取消'
      );
    });
  });

  describe('executeTask 统一任务执行入口', () => {
    it('当执行器未处于运行状态时，executeTask 应直接 Fail-Fast 报错 RUNNER_NOT_RUNNING', async () => {
      const runner = new MinimalChannelRunner();
      expect(runner.isRunning()).toBe(false);

      const result = await runner.executeTask({
        id: 'task-not-running',
        businessId: 'ORD-123',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify({})).toString('base64'),
      });

      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('RUNNER_NOT_RUNNING');
      expect(result.errorMessage).toContain('TEST_CHANNEL');
    });

    it('当执行器处于运行状态时，executeTask 应委托给 dispatchDutyTask 并返回执行结果', async () => {
      const runner = new MinimalChannelRunner();
      await runner.start();
      expect(runner.isRunning()).toBe(true);

      const result = await runner.executeTask({
        id: 'task-collect',
        businessId: 'ORD-COLLECT',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-1',
        leaseToken: 'lt-1',
        data: Buffer.from(JSON.stringify({})).toString('base64'),
      });

      expect(result.status).toBe('SUCCEEDED');
      expect(result.result).toEqual({
        otaChannelCode: 'TEST_CHANNEL',
        recordCount: 0,
        orders: [],
      });
    });
  });

  describe('waitForBrowserClose 调试等待短路保护', () => {
    it('当 session 为 null 或 session.page 已处于关闭状态时应立即返回，杜绝死等挂起', async () => {
      const runner = new MinimalChannelRunner();
      // 1. session 为 null 时直接返回
      await expect(runner.waitForBrowserClose()).resolves.toBeUndefined();

      // 2. session 存在但 page 已被用户关闭时直接返回
      (runner as unknown as { session: unknown }).session = {
        page: { isClosed: () => true },
        context: {},
      };
      await expect(runner.waitForBrowserClose()).resolves.toBeUndefined();
    });
  });
});

