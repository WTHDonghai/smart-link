import type { StationIdentity, SystemLogEntry, ActualStateReportPayload } from '../../types';
import { reportDutyActualState } from '../../services/dutyRuntimeApi';
import { getOrRegisterStationIdentity, stationIdentityManager } from './stationIdentity';
import { getPlatformBaseUrl } from '../../services/platformAuth';
import { SYSTEM_TIMING } from './dutyTimingConfig';

export type StationLogCallback = (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => void;

export interface StationCoordinatorOptions {
  onLog?: StationLogCallback;
}

/**
 * 中台工位协同调度器 (Station Coordinator)
 * 单一职责：
 * 1. 管理工位身份（StationIdentity）的注册、获取与本地缓存；
 * 2. 调度维持与中台的心跳定时器 (Heartbeat)；
 * 3. 构造并上报工位与应用实际运行状态 (actual-state/report)。
 */
export class StationCoordinator {
  private stationIdentity: StationIdentity | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private onLog?: StationLogCallback;
  private lastReportFailed = false;

  constructor(options?: StationCoordinatorOptions) {
    this.onLog = options?.onLog;
  }

  public setLogCallback(callback?: StationLogCallback): void {
    this.onLog = callback;
  }

  public getIdentity(): StationIdentity | null {
    if (this.stationIdentity) {
      return this.stationIdentity;
    }
    return stationIdentityManager.getCurrentIdentity();
  }

  public async ensureIdentity(): Promise<StationIdentity> {
    const currentBaseUrl = getPlatformBaseUrl();
    this.stationIdentity = await getOrRegisterStationIdentity('smart-link', undefined, currentBaseUrl);
    return this.stationIdentity;
  }

  public isHeartbeatActive(): boolean {
    return this.heartbeatTimer !== null;
  }

  public async reportActualState(activeChannelCodes: string[], forceStop = false): Promise<void> {
    const identity = this.getIdentity();
    if (!identity?.stationId) {
      return;
    }

    const isRunning = !forceStop && activeChannelCodes.length > 0;
    const payload: ActualStateReportPayload = {
      stationId: identity.stationId,
      apps: [
        {
          appId: 'smart-link',
          actualVersion: '1.0.0',
          status: isRunning ? 'RUNNING' : 'STOP',
          lastStartedAt: Date.now(),
          reportedAt: Date.now(),
          otaCollectionTargets: isRunning
            ? activeChannelCodes.map((code) => ({ otaChannelCode: code }))
            : [],
        },
      ],
    };

    try {
      await reportDutyActualState(payload);
      if (this.lastReportFailed) {
        this.lastReportFailed = false;
        if (this.onLog) {
          this.onLog({
            level: 'INFO',
            event: 'DUTY_ACTUAL_STATE_REPORT_RECOVERED',
            taskActionStage: 'report',
            message: '[值守心跳] 网络恢复，工位状态上报恢复正常',
          });
        }
      }
    } catch (e) {
      this.lastReportFailed = true;
      const errMsg = e instanceof Error ? e.message : String(e);
      if (this.onLog) {
        this.onLog({
          level: 'WARN',
          event: 'DUTY_ACTUAL_STATE_REPORT_FAILED',
          taskActionStage: 'report',
          message: `[值守心跳] actual-state/report 上报异常: ${errMsg}`,
          details: e instanceof Error ? e.stack : errMsg,
        });
      }
    }
  }

  public startHeartbeat(getActiveChannelCodes: () => string[]): void {
    if (this.heartbeatTimer) {
      return;
    }
    if (this.onLog) {
      this.onLog({
        level: 'INFO',
        event: 'DUTY_HEARTBEAT_STARTED',
        taskActionStage: 'report',
        message: `[值守心跳] 心跳服务已启动，维持 ${Math.round(SYSTEM_TIMING.HEARTBEAT_INTERVAL / 1000)}s 周期上报`,
      });
    }
    this.heartbeatTimer = setInterval(() => {
      void this.reportActualState(getActiveChannelCodes());
    }, SYSTEM_TIMING.HEARTBEAT_INTERVAL);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      if (this.onLog) {
        this.onLog({
          level: 'INFO',
          event: 'DUTY_HEARTBEAT_STOPPED',
          taskActionStage: 'report',
          message: '[值守心跳] 心跳服务已停止',
        });
      }
    }
  }

  public dispose(): void {
    this.stopHeartbeat();
  }
}
