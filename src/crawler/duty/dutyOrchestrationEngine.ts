import type {
  ChannelDutyInfo,
  ChannelDutyStatus,
  DutyCoordinatorStatus,
  StationIdentity,
  ActualStateReportPayload,
} from '../../types';
import type { ChannelDutyRunner } from './dutyContracts';
import { MeituanDutyRunner } from './meituanDutyRunner';
import { getOrRegisterStationIdentity } from './stationIdentity';
import {
  claimDutyTask,
  createDutyTasks,
  reportDutyActualState,
  submitDutyTaskResult,
} from '../../services/dutyRuntimeApi';

export class DutyOrchestrationEngine {
  private runners = new Map<string, ChannelDutyRunner>();
  private channelStates = new Map<string, ChannelDutyInfo>();
  private coordinatorStatus: DutyCoordinatorStatus = 'STOPPED';
  private stationIdentity: StationIdentity | null = null;
  private isClaimingLoopRunning = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopSignal = false;

  constructor() {
    // 注册内置渠道执行器（首期美团酒店）
    this.registerRunner(new MeituanDutyRunner());
  }

  public registerRunner(runner: ChannelDutyRunner): void {
    this.runners.set(runner.channelCode.toUpperCase(), runner);
    this.channelStates.set(runner.channelCode.toUpperCase(), {
      channelCode: runner.channelCode.toUpperCase(),
      status: 'STOPPED',
    });
  }

  public getCoordinatorStatus(): DutyCoordinatorStatus {
    return this.coordinatorStatus;
  }

  public getChannelDutyStatus(): Record<string, ChannelDutyInfo> {
    const result: Record<string, ChannelDutyInfo> = {};
    for (const [code, info] of this.channelStates.entries()) {
      result[code] = { ...info };
    }
    return result;
  }

  private async ensureStationIdentity(): Promise<StationIdentity> {
    if (!this.stationIdentity) {
      this.stationIdentity = await getOrRegisterStationIdentity('smart-link');
    }
    return this.stationIdentity;
  }

  private getActiveRunners(): ChannelDutyRunner[] {
    return Array.from(this.runners.values()).filter((r) => r.isRunning());
  }

  /**
   * 启动指定渠道值守
   */
  public async startDuty(channelCode: string): Promise<{ success: boolean; message: string }> {
    const code = (channelCode || '').trim().toUpperCase();
    const runner = this.runners.get(code);
    if (!runner) {
      throw new Error(`暂不支持渠道「${code}」自动化值守`);
    }

    if (runner.isRunning()) {
      return { success: true, message: `渠道「${code}」值守已在运行中` };
    }

    this.channelStates.set(code, {
      channelCode: code,
      status: 'STARTING' as ChannelDutyStatus,
      lastStartedAt: Date.now(),
    });

    try {
      // 1. 确保工位身份已建立
      const identity = await this.ensureStationIdentity();

      // 2. 启动渠道专属自动化执行器 (唤起 Playwright / 导航)
      await runner.start();

      this.channelStates.set(code, {
        channelCode: code,
        status: 'RUNNING',
        lastStartedAt: Date.now(),
      });

      // 3. 上报中台实际状态
      await this.reportActualState(identity.stationId);

      // 4. 确保心跳定时器与长轮询任务认领循环启动
      this.ensureHeartbeat(identity.stationId);
      this.ensureClaimLoop();

      return {
        success: true,
        message: `渠道「${code}」订单自动化值守已成功激活`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.channelStates.set(code, {
        channelCode: code,
        status: 'DEGRADED',
        error: msg,
      });
      throw err;
    }
  }

  /**
   * 停止指定渠道值守
   */
  public async stopDuty(channelCode: string): Promise<{ success: boolean; message: string }> {
    const code = (channelCode || '').trim().toUpperCase();
    const runner = this.runners.get(code);
    if (!runner) {
      throw new Error(`未知渠道「${code}」`);
    }

    await runner.stop();

    this.channelStates.set(code, {
      channelCode: code,
      status: 'STOPPED',
    });

    const active = this.getActiveRunners();
    if (active.length === 0) {
      this.coordinatorStatus = 'STOPPED';
      this.stopSignal = true;
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.stationIdentity) {
        await this.reportActualState(this.stationIdentity.stationId, true);
      }
    } else if (this.stationIdentity) {
      await this.reportActualState(this.stationIdentity.stationId);
    }

    return {
      success: true,
      message: `渠道「${code}」值守已安全终止`,
    };
  }

  private async reportActualState(stationId: string, forceStop = false): Promise<void> {
    const active = this.getActiveRunners();
    const isRunning = !forceStop && active.length > 0;

    const payload: ActualStateReportPayload = {
      stationId,
      apps: [
        {
          appId: 'smart-link',
          actualVersion: '1.0.0',
          status: isRunning ? 'RUNNING' : 'STOP',
          lastStartedAt: Date.now(),
          reportedAt: Date.now(),
          otaCollectionTargets: isRunning
            ? active.map((r) => ({ otaChannelCode: r.channelCode }))
            : [],
        },
      ],
    };

    try {
      await reportDutyActualState(payload);
    } catch (e) {
      console.warn('[DutyOrchestrationEngine] actual-state/report 上报异常:', e);
    }
  }

  private ensureHeartbeat(stationId: string): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      void this.reportActualState(stationId);
    }, 60000);
  }

  private ensureClaimLoop(): void {
    if (this.isClaimingLoopRunning) return;
    this.isClaimingLoopRunning = true;
    this.stopSignal = false;
    void this.runClaimLoop();
  }

  private async runClaimLoop(): Promise<void> {
    while (!this.stopSignal && this.getActiveRunners().length > 0) {
      try {
        const identity = await this.ensureStationIdentity();
        this.coordinatorStatus = 'CLAIMING';

        const task = await claimDutyTask({
          stationId: identity.stationId,
          appId: identity.appId,
          direction: 'FORWARD',
        });

        if (!task) {
          this.coordinatorStatus = 'IDLE';
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        // 获得任务，解析目标渠道
        let targetChannel = 'MEITUAN';
        try {
          const rawDecoded = Buffer.from(task.data, 'base64').toString('utf-8');
          const parsed = JSON.parse(rawDecoded) as Record<string, unknown>;
          if (parsed.otaChannelCode) {
            targetChannel = String(parsed.otaChannelCode).trim().toUpperCase();
          } else if (parsed.channel) {
            targetChannel = String(parsed.channel).trim().toUpperCase();
          }
        } catch {
          // 容错默认当前首选渠道
        }

        const runner = this.runners.get(targetChannel);
        if (!runner || !runner.isRunning()) {
          await submitDutyTaskResult(task.id, {
            taskId: task.id,
            status: 'FAILED',
            errorCode: 'CHANNEL_RUNNER_UNAVAILABLE',
            errorMessage: `渠道「${targetChannel}」当前未在运行状态`,
          });
          continue;
        }

        this.coordinatorStatus = 'EXECUTING';
        const execRes = await runner.executeTask(task);

        // 如果是采集任务且有发现订单，批量创建下游任务
        if (task.msgType === 'OTA_COLLECT_ORDER' && execRes.status === 'SUCCEEDED' && execRes.result?.orders) {
          const orders = execRes.result.orders as Array<{ orderId: string; hotelId?: string; cancelOrder?: boolean }>;
          if (orders.length > 0) {
            try {
              await createDutyTasks({
                stationId: identity.stationId,
                appId: identity.appId,
                items: orders.map((o) => ({
                  msgType: o.cancelOrder ? 'OTA_CANCEL_ORDER' : 'OTA_IMPORT_ORDER',
                  businessId: o.orderId,
                  unitId: o.hotelId,
                  data: {
                    channel: targetChannel,
                    otaOrderId: o.orderId,
                    extUnitCode: o.hotelId,
                  },
                })),
              });
            } catch (err) {
              console.warn('[DutyOrchestrationEngine] 自动创建下游订单任务异常:', err);
            }
          }
        }

        this.coordinatorStatus = 'REPORTING';
        await submitDutyTaskResult(task.id, {
          taskId: task.id,
          status: execRes.status,
          result: execRes.result,
          errorCode: execRes.errorCode,
          errorMessage: execRes.errorMessage,
        });

        this.coordinatorStatus = 'IDLE';
      } catch (err) {
        if (!this.stopSignal && this.getActiveRunners().length > 0) {
          this.coordinatorStatus = 'CLAIM_BACKOFF';
        }
        console.warn('[DutyOrchestrationEngine] 任务认领循环异常:', err);
        if (this.stopSignal || this.getActiveRunners().length === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    this.isClaimingLoopRunning = false;
    if (this.getActiveRunners().length === 0 || this.stopSignal) {
      this.coordinatorStatus = 'STOPPED';
    } else {
      this.coordinatorStatus = 'IDLE';
    }
  }
}

export const dutyOrchestrationEngine = new DutyOrchestrationEngine();
