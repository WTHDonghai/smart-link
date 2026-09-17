import type {
  ChannelDutyInfo,
  ChannelDutyStatus,
  DutyCoordinatorStatus,
  StationIdentity,
  ActualStateReportPayload,
  SystemLogEntry,
} from '../../types';
import type { ChannelDutyRunner } from './dutyContracts';
import { MeituanDutyRunner } from './meituanDutyRunner';
import { stationIdentityManager, getOrRegisterStationIdentity } from './stationIdentity';
import { getPlatformBaseUrl } from '../../services/platformAuth';
import {
  claimDutyTask,
  createDutyTasks,
  reportDutyActualState,
  submitDutyTaskResult,
} from '../../services/dutyRuntimeApi';
import { registerApiLogListener } from '../../services/platformApi';
import { logger } from '../../services/logger';

export class DutyOrchestrationEngine {
  private runners = new Map<string, ChannelDutyRunner>();
  private channelStates = new Map<string, ChannelDutyInfo>();
  private coordinatorStatus: DutyCoordinatorStatus = 'STOPPED';
  private stationIdentity: StationIdentity | null = null;
  private isClaimingLoopRunning = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopSignal = false;
  private recentLogs: SystemLogEntry[] = [];
  private logListeners = new Set<(entry: SystemLogEntry) => void>();
  private readonly MAX_LOGS = 200;

  constructor() {
    // 注册内置渠道执行器（首期美团酒店）
    this.registerRunner(new MeituanDutyRunner());

    // 监听底层平台接口请求日志，同步注入到值守日志环形缓冲区供前端实时查看
    registerApiLogListener((entry) => {
      this.appendDutyLogDirect(entry);
    });
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

  public getStationIdentity(): StationIdentity | null {
    if (this.stationIdentity) return this.stationIdentity;
    return stationIdentityManager.getCurrentIdentity();
  }

  public subscribeLogs(listener: (entry: SystemLogEntry) => void): () => void {
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
    };
  }

  public getRecentDutyLogs(sinceTime = 0): SystemLogEntry[] {
    if (sinceTime <= 0) return [...this.recentLogs];
    return this.recentLogs.filter((l) => l.createdAt > sinceTime);
  }

  public appendDutyLogDirect(entry: SystemLogEntry): void {
    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.MAX_LOGS) {
      this.recentLogs.splice(0, this.recentLogs.length - this.MAX_LOGS);
    }

    // 广播给本地订阅者 (Electron IPC / 渲染层)
    for (const listener of this.logListeners) {
      try {
        listener(entry);
      } catch {
        // 隔离异常
      }
    }
  }

  public appendDutyLog(
    entryPartial: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>
  ): SystemLogEntry {
    const now = Date.now();
    const entry: SystemLogEntry = {
      id: `duty-log-${now}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date(now).toISOString().slice(11, 19),
      createdAt: now,
      ...entryPartial,
    };

    this.appendDutyLogDirect(entry);

    // 广播到统一系统日志服务
    try {
      logger.track(entry.event || 'DUTY_LOG', {
        level: entry.level,
        module: entry.module || 'DUTY_TASK',
        message: entry.message,
        details: entry.details,
        channelId: entry.channelId,
        orderNo: entry.orderNo,
        durationMs: entry.durationMs,
        meta: entry.meta,
        taskId: entry.taskId,
        msgType: entry.msgType,
        taskActionStage: entry.taskActionStage,
        taskStatus: entry.taskStatus,
        taskResult: entry.taskResult,
        apiUrl: entry.apiUrl,
        apiMethod: entry.apiMethod,
        apiParams: entry.apiParams,
        apiResponse: entry.apiResponse,
        httpStatus: entry.httpStatus,
      });
    } catch {
      // 容错
    }

    return entry;
  }

  private async ensureStationIdentity(): Promise<StationIdentity> {
    const currentBaseUrl = getPlatformBaseUrl();
    this.stationIdentity = await getOrRegisterStationIdentity('smart-link', undefined, currentBaseUrl);
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
      // 1. 优先启动渠道自动化执行器 (唤起前台 Playwright 窗口 / 导航)
      await runner.start();

      this.channelStates.set(code, {
        channelCode: code,
        status: 'RUNNING',
        lastStartedAt: Date.now(),
      });

      this.appendDutyLog({
        level: 'PLAYWRIGHT',
        module: 'DUTY_TASK',
        event: 'PLAYWRIGHT_WORKER_START',
        channelId: code,
        taskActionStage: 'EXECUTE',
        message: `[值守启动] 渠道「${code}」可视化前台浏览器窗口已唤起，进入订单自动化值守监听`,
        details: `渠道: ${code} | 状态: RUNNING | 监听目标: ${(runner as unknown as { targetUrl?: string })?.targetUrl || code}`,
      });

      // 2. 建立中台工位身份并启动心跳
      try {
        const identity = await this.ensureStationIdentity();
        await this.reportActualState(identity.stationId);
        this.ensureHeartbeat(identity.stationId);
      } catch (stationErr) {
        const msg = stationErr instanceof Error ? stationErr.message : String(stationErr);
        this.appendDutyLog({
          level: 'WARN',
          module: 'DUTY_TASK',
          event: 'DUTY_ACTUAL_STATE_REPORT',
          channelId: code,
          taskActionStage: 'REPORT',
          message: `[中台协同] 渠道「${code}」前台浏览器已启动，中台工位申请中: ${msg}`,
          details: `若未完成文旅平台登录授权，请在登录界面完成登录，工位将在后台自愈激活`,
        });
      }

      // 3. 激活认领调度循环 (具备自愈重试与工位后置绑定能力)
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
      this.appendDutyLog({
        level: 'ERROR',
        module: 'DUTY_TASK',
        event: 'DUTY_TASK_EXECUTE_FAILED',
        channelId: code,
        message: `[值守失败] 渠道「${code}」值守启动异常: ${msg}`,
        details: msg,
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

    this.appendDutyLog({
      level: 'INFO',
      module: 'DUTY_TASK',
      channelId: code,
      message: `[值守停止] 渠道「${code}」值守已安全终止`,
      details: `渠道: ${code} | 状态: STOPPED`,
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

  /**
   * 一键停止所有渠道值守与后台调度引擎，向中台发送工位离线报文，彻底释放所有资源
   */
  public async stopAllDuty(): Promise<{ success: boolean; message: string }> {
    // 1. 设置 stopSignal = true 阻断长轮询任务认领
    this.stopSignal = true;

    // 2. 清除心跳定时器 heartbeatTimer
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 3. 安全停止所有当前激活的渠道 Runner
    const activeRunners = this.getActiveRunners();
    await Promise.allSettled(
      activeRunners.map(async (runner) => {
        const code = runner.channelCode.toUpperCase();
        try {
          await runner.stop();
        } catch (err) {
          console.warn(`[DutyOrchestrationEngine] 停止渠道「${code}」值守异常:`, err);
        } finally {
          this.channelStates.set(code, {
            channelCode: code,
            status: 'STOPPED',
          });
        }
      })
    );

    // 确保所有注册渠道状态均确认为 STOPPED
    for (const [code] of this.runners) {
      this.channelStates.set(code, {
        channelCode: code,
        status: 'STOPPED',
      });
    }

    // 4. 确切将 coordinatorStatus 置为 'STOPPED'
    this.coordinatorStatus = 'STOPPED';

    // 5. 向中台发送工位离线报文 (status: 'STOP', otaCollectionTargets: [])
    const station = this.getStationIdentity();
    if (station?.stationId) {
      try {
        await this.reportActualState(station.stationId, true);
      } catch (reportErr) {
        console.warn('[DutyOrchestrationEngine] 离线状态上报异常:', reportErr);
      }
    }

    // 6. 记录结构化系统停止日志
    this.appendDutyLog({
      level: 'INFO',
      module: 'DUTY_TASK',
      event: 'DUTY_STOP_ALL',
      taskActionStage: 'EXECUTE',
      message: '[值守终止] 全局值守已安全终止，所有渠道自动化监听与心跳均已清退',
      details: `停止渠道数: ${activeRunners.length} | 工位: ${station?.stationId || '未分配'} | 状态: STOPPED`,
    });

    return {
      success: true,
      message: '所有自动化值守及调度任务已安全停止',
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
        let identity: StationIdentity;
        try {
          identity = await this.ensureStationIdentity();
          // 若工位刚刚建立且心跳未开启，自动补全首轮状态上报与周期心跳
          if (!this.heartbeatTimer) {
            void this.reportActualState(identity.stationId);
            this.ensureHeartbeat(identity.stationId);
          }
        } catch (stationErr) {
          this.coordinatorStatus = 'CLAIM_BACKOFF';
          if (this.stopSignal || this.getActiveRunners().length === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }

        this.coordinatorStatus = 'CLAIMING';

        const task = await claimDutyTask({
          stationId: identity.stationId,
          appId: identity.appId,
          direction: 'INBOUND',
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

        // 1. 任务认领日志 (CLAIM)
        this.appendDutyLog({
          level: 'INFO',
          module: 'DUTY_TASK',
          event: 'DUTY_TASK_CLAIM',
          taskActionStage: 'CLAIM',
          msgType: task.msgType,
          taskId: task.id,
          taskStatus: 'PROCESSING',
          channelId: targetChannel,
          apiUrl: '/toolkit/toolbox/task-claims',
          apiMethod: 'POST',
          apiParams: {
            stationId: identity.stationId,
            appId: identity.appId,
            direction: 'FORWARD',
          },
          apiResponse: task,
          httpStatus: 200,
          message: `[任务认领 CLAIM] 任务类型: ${task.msgType} (ID: ${task.id})`,
          details: `业务标识: ${task.businessId || '-'} | 所属渠道: ${targetChannel} | 工位: ${identity.stationId}`,
        });

        const runner = this.runners.get(targetChannel);
        if (!runner || !runner.isRunning()) {
          const failureMsg = `渠道「${targetChannel}」当前未在运行状态`;
          this.appendDutyLog({
            level: 'ERROR',
            module: 'DUTY_TASK',
            event: 'DUTY_TASK_EXECUTE_FAILED',
            taskActionStage: 'RESULT',
            msgType: task.msgType,
            taskId: task.id,
            taskStatus: 'FAILED',
            channelId: targetChannel,
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: {
              taskId: task.id,
              status: 'FAILED',
              errorCode: 'CHANNEL_RUNNER_UNAVAILABLE',
              errorMessage: failureMsg,
            },
            apiResponse: { success: false, error: failureMsg },
            message: `[任务结果 RESULT] 任务 ${task.msgType} 执行失败: ${failureMsg} (ID: ${task.id})`,
            details: failureMsg,
          });

          await submitDutyTaskResult(task.id, {
            taskId: task.id,
            status: 'FAILED',
            errorCode: 'CHANNEL_RUNNER_UNAVAILABLE',
            errorMessage: failureMsg,
          });
          continue;
        }

        this.coordinatorStatus = 'EXECUTING';

        // 2. 任务执行开始日志 (EXECUTE)
        this.appendDutyLog({
          level: 'PLAYWRIGHT',
          module: 'DUTY_TASK',
          event: 'DUTY_TASK_EXECUTE_START',
          taskActionStage: 'EXECUTE',
          msgType: task.msgType,
          taskId: task.id,
          taskStatus: 'PROCESSING',
          channelId: targetChannel,
          message: `[任务执行 EXECUTE] 正在执行 ${task.msgType} (ID: ${task.id})`,
          details: `执行渠道: ${targetChannel} | 业务主键: ${task.businessId || '-'}`,
        });

        const startTime = Date.now();
        const execRes = await runner.executeTask(task);
        const durationMs = Date.now() - startTime;

        // 3. 任务执行完成与结果日志 (RESULT)
        const isSuccess = execRes.status === 'SUCCEEDED';
        this.appendDutyLog({
          level: isSuccess ? 'SUCCESS' : 'ERROR',
          module: 'DUTY_TASK',
          event: isSuccess ? 'DUTY_TASK_EXECUTE_SUCCESS' : 'DUTY_TASK_EXECUTE_FAILED',
          taskActionStage: 'RESULT',
          msgType: task.msgType,
          taskId: task.id,
          taskStatus: execRes.status,
          taskResult: execRes.result,
          channelId: targetChannel,
          durationMs,
          apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
          apiMethod: 'PUT',
          apiParams: {
            taskId: task.id,
            status: execRes.status,
            result: execRes.result,
            errorCode: execRes.errorCode,
            errorMessage: execRes.errorMessage,
          },
          apiResponse: execRes.result,
          message: `[任务结果 RESULT] 任务 ${task.msgType} 执行${isSuccess ? '成功' : '失败'} (ID: ${task.id})`,
          details: isSuccess
            ? `耗时: ${durationMs}ms | 状态: SUCCEEDED${execRes.result ? ` | 结果: ${JSON.stringify(execRes.result)}` : ''}`
            : `状态: FAILED | 错误代码: ${execRes.errorCode || '-'} | 错误信息: ${execRes.errorMessage || '未知异常'}`,
        });

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

              this.appendDutyLog({
                level: 'INFO',
                module: 'DUTY_TASK',
                event: 'DUTY_TASK_CREATE_DOWNSTREAM',
                taskActionStage: 'EXECUTE',
                msgType: task.msgType,
                taskId: task.id,
                channelId: targetChannel,
                apiUrl: '/toolkit/toolbox/tasks',
                apiMethod: 'POST',
                apiParams: {
                  stationId: identity.stationId,
                  appId: identity.appId,
                  items: orders.map((o) => ({
                    msgType: o.cancelOrder ? 'OTA_CANCEL_ORDER' : 'OTA_IMPORT_ORDER',
                    businessId: o.orderId,
                    unitId: o.hotelId,
                    channel: targetChannel,
                  })),
                },
                apiResponse: { success: true, count: orders.length },
                message: `[下游派发] 发现 ${orders.length} 个订单，已批量创建下游中台处理任务`,
                details: `订单列表: ${orders.map((o) => `${o.orderId}(${o.cancelOrder ? '退单' : '入单'})`).join(', ')}`,
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.warn('[DutyOrchestrationEngine] 自动创建下游订单任务异常:', err);
              this.appendDutyLog({
                level: 'ERROR',
                module: 'DUTY_TASK',
                event: 'DUTY_TASK_CREATE_DOWNSTREAM',
                taskActionStage: 'EXECUTE',
                msgType: task.msgType,
                taskId: task.id,
                channelId: targetChannel,
                apiUrl: '/toolkit/toolbox/tasks',
                apiMethod: 'POST',
                apiParams: {
                  stationId: identity.stationId,
                  appId: identity.appId,
                  count: orders.length,
                },
                apiResponse: { error: errMsg },
                message: `[下游派发失败] 创建下游订单处理任务异常: ${errMsg}`,
                details: errMsg,
              });
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

        this.appendDutyLog({
          level: 'INFO',
          module: 'DUTY_TASK',
          event: 'DUTY_TASK_RESULT_SUBMIT',
          taskActionStage: 'RESULT',
          msgType: task.msgType,
          taskId: task.id,
          taskStatus: execRes.status,
          channelId: targetChannel,
          apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
          apiMethod: 'PUT',
          apiParams: {
            taskId: task.id,
            status: execRes.status,
            result: execRes.result,
            errorCode: execRes.errorCode,
            errorMessage: execRes.errorMessage,
          },
          apiResponse: { success: true },
          httpStatus: 200,
          message: `[回执提交] 任务 ${task.msgType} 执行结果已成功回执中台 (ID: ${task.id})`,
          details: `回执状态: ${execRes.status}`,
        });

        this.coordinatorStatus = 'IDLE';
      } catch (err) {
        if (!this.stopSignal && this.getActiveRunners().length > 0) {
          this.coordinatorStatus = 'CLAIM_BACKOFF';
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('[DutyOrchestrationEngine] 任务认领循环异常:', err);
        this.appendDutyLog({
          level: 'WARN',
          module: 'DUTY_TASK',
          event: 'DUTY_ACTUAL_STATE_REPORT',
          taskActionStage: 'CLAIM',
          message: `[任务认领 CLAIM] 轮询认领中台任务异常: ${errMsg}`,
          details: `将在 3 秒后重试`,
        });
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
