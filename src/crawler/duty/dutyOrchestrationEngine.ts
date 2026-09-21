import type {
  ChannelDutyInfo,
  ChannelDutyStatus,
  DutyCoordinatorStatus,
  StationIdentity,
  ActualStateReportPayload,
  SystemLogEntry,
  DutyClaimedTask,
  DutyTaskResultDetail,
  DutyTaskResultPayload,
  DutyTaskWireStatus,
  DutyTaskCreationBatch,
  DesktopOperationResult,
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
import { formatLogTimestamp } from '../../services/logStorage';
import { dispatchDutyTask } from './dutyTaskDispatcher';
import { parseDutyTaskContext, type ParsedDutyTaskContext } from './dutyTaskContext';
import { createTaskLogger } from './dutyTaskLogger';

export { dispatchDutyTask };

export interface TaskResultPayloadOptions {
  status: DutyTaskWireStatus;
  confirmationNo?: string;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
}

/**
 * 依据文旅中台线缆契约与标准 DTO 组装任务回执载荷 (PUT /toolkit/toolbox/tasks/:id/result)
 * 1. ackData 严格按照 Base64 编码的 JSON 对象封装：
 *    - 成功时包裹 { result: ... }；
 *    - 失败时严格仅包含 { errorCode: ... }，严禁将 errorMessage 混入 ackData（errorMessage 位于顶层 DTO）；
 * 2. 顶层 DTO 条件序列化：透传 msgId、retryable、严格按有效值输出 unitId / unitType / direction / delaySendTime，杜绝非法空串；
 * 3. station 优先取自任务实体携带的 stationId，若缺失回退当前注册工位。
 */
export function buildTaskResultPayload(
  task: DutyClaimedTask,
  fallbackStationId: string,
  options: TaskResultPayloadOptions
): DutyTaskResultPayload {
  const isSuccess = options.status === 'SUCCESS';
  const confirmationNo = String(options.confirmationNo || '').trim();
  const businessId = String(task.businessId || '').trim();

  const completionData: Record<string, unknown> = isSuccess
    ? { result: options.result || {} }
    : {
        errorCode: options.errorCode || 'TASK_EXECUTION_FAILED',
        ...(options.result ? { result: options.result } : {}),
      };

  const ackData = Buffer.from(JSON.stringify(completionData), 'utf-8').toString('base64');

  const detail: DutyTaskResultDetail = {
    confirmNo: confirmationNo,
    businessId,
    status: options.status,
    ackData,
  };

  const station = String(task.stationId || fallbackStationId || '').trim();
  const leaseToken = String(task.leaseToken || '').trim();

  const payload: DutyTaskResultPayload = {
    station,
    leaseToken,
    businessType: 'OTA_MIGRATION',
    businessId,
    scope: 'INTERFACE',
    status: options.status,
    ...(task.msgId && task.msgId.trim() ? { msgId: task.msgId.trim() } : {}),
    ...(task.msgType ? { msgType: task.msgType } : {}),
    ...(task.unitId && task.unitId.trim() ? { unitId: task.unitId.trim() } : {}),
    ...(task.unitType && task.unitType.trim() ? { unitType: task.unitType.trim() } : {}),
    ...(task.direction && task.direction.trim() ? { direction: task.direction.trim() } : {}),
    ...(task.createdTime && task.createdTime.trim() ? { createdTime: task.createdTime.trim() } : {}),
    ...(typeof task.delaySendTime === 'number' ? { delaySendTime: task.delaySendTime } : {}),
    details: [detail],
    ...(!isSuccess && options.errorMessage ? { errorMessage: options.errorMessage } : {}),
    ...(typeof options.retryable === 'boolean' ? { retryable: options.retryable } : {}),
  };

  return payload;
}

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
      timestamp: formatLogTimestamp(new Date(now)),
      createdAt: now,
      ...entryPartial,
    };

    this.appendDutyLogDirect(entry);

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
  public async startDuty(channelCode: string): Promise<DesktopOperationResult> {
    const code = (channelCode || '').trim().toUpperCase();
    const runner = this.runners.get(code);
    if (!runner) {
      throw new Error(`暂不支持渠道「${code}」自动化值守`);
    }

    if (runner.isRunning()) {
      return { success: true };
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
        taskActionStage: "execute",
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
          taskActionStage: "report",
          message: `[中台协同] 渠道「${code}」前台浏览器已启动，中台工位申请中: ${msg}`,
          details: `若未完成文旅平台登录授权，请在登录界面完成登录，工位将在后台自愈激活`,
        });
      }

      // 3. 激活认领调度循环 (具备自愈重试与工位后置绑定能力)
      this.ensureClaimLoop();

      return { success: true };
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
  public async stopDuty(channelCode: string): Promise<DesktopOperationResult> {
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

    return { success: true };
  }

  /**
   * 一键停止所有渠道值守与后台调度引擎，向中台发送工位离线报文，彻底释放所有资源
   */
  public async stopAllDuty(): Promise<DesktopOperationResult> {
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
          const errMsg = err instanceof Error ? err.message : String(err);
          this.appendDutyLog({
            level: 'WARN',
            event: 'DUTY_RUNNER_STOP_FAILED',
            taskActionStage: 'execute',
            channelId: code,
            message: `[值守调度] 停止渠道「${code}」值守异常: ${errMsg}`,
            details: err instanceof Error ? err.stack : errMsg,
          });
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
        const errMsg = reportErr instanceof Error ? reportErr.message : String(reportErr);
        this.appendDutyLog({
          level: 'WARN',
          event: 'DUTY_ACTUAL_STATE_REPORT_FAILED',
          taskActionStage: 'report',
          message: `[值守调度] 离线状态上报异常: ${errMsg}`,
          details: reportErr instanceof Error ? reportErr.stack : errMsg,
        });
      }
    }

    // 6. 记录结构化系统停止日志
    this.appendDutyLog({
      level: 'INFO',
      module: 'DUTY_TASK',
      event: 'DUTY_STOP_ALL',
      taskActionStage: "execute",
      message: '[值守终止] 全局值守已安全终止，所有渠道自动化监听与心跳均已清退',
      details: `停止渠道数: ${activeRunners.length} | 工位: ${station?.stationId || '未分配'} | 状态: STOPPED`,
    });

    return { success: true };
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
      const errMsg = e instanceof Error ? e.message : String(e);
      this.appendDutyLog({
        level: 'WARN',
        event: 'DUTY_ACTUAL_STATE_REPORT_FAILED',
        taskActionStage: 'report',
        message: `[值守心跳] actual-state/report 上报异常: ${errMsg}`,
        details: e instanceof Error ? e.stack : errMsg,
      });
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

        // 1. 基础报文结构合规性校验 (Fail-Fast 阻断，向中台如实报告协议违规)
        if (task.businessType !== 'OTA_MIGRATION') {
          const failureMsg = `中台任务 businessType 必须为 OTA_MIGRATION (实际: ${task.businessType || '-'})`;
          const rejectPayload = buildTaskResultPayload(task, identity.stationId, {
            status: 'FAIL',
            errorCode: 'TASK_PAYLOAD_INVALID',
            errorMessage: failureMsg,
            retryable: false,
          });
          this.appendDutyLog({
            level: 'ERROR',
            module: 'DUTY_TASK',
            event: 'DUTY_TASK_EXECUTE_FAILED',
            taskActionStage: "result",
            msgType: task.msgType,
            taskId: task.id,
            taskStatus: 'FAILED',
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: rejectPayload,
            message: `[任务协议校验失败] ${failureMsg} (ID: ${task.id})`,
            details: failureMsg,
          });
          await submitDutyTaskResult(task.id, rejectPayload);
          continue;
        }

        if (!task.businessId || !String(task.businessId).trim()) {
          const failureMsg = '中台任务缺失有效的 businessId 业务标识';
          const rejectPayload = buildTaskResultPayload(task, identity.stationId, {
            status: 'FAIL',
            errorCode: 'TASK_PAYLOAD_INVALID',
            errorMessage: failureMsg,
            retryable: false,
          });
          this.appendDutyLog({
            level: 'ERROR',
            module: 'DUTY_TASK',
            event: 'DUTY_TASK_EXECUTE_FAILED',
            taskActionStage: "result",
            msgType: task.msgType,
            taskId: task.id,
            taskStatus: 'FAILED',
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: rejectPayload,
            message: `[任务协议校验失败] ${failureMsg} (ID: ${task.id})`,
            details: failureMsg,
          });
          await submitDutyTaskResult(task.id, rejectPayload);
          continue;
        }

        // OTA_CANCEL_ORDER 为取消事实上报消息，文旅中台不应向客户端下发消费
        if (task.msgType === 'OTA_CANCEL_ORDER') {
          const failureMsg = '文旅中台不应向客户端下发 OTA_CANCEL_ORDER 任务';
          const rejectPayload = buildTaskResultPayload(task, identity.stationId, {
            status: 'FAIL',
            errorCode: 'TASK_TYPE_UNSUPPORTED',
            errorMessage: failureMsg,
            retryable: false,
          });
          this.appendDutyLog({
            level: 'ERROR',
            module: 'DUTY_TASK',
            event: 'DUTY_TASK_EXECUTE_FAILED',
            taskActionStage: "result",
            msgType: task.msgType,
            taskId: task.id,
            taskStatus: 'FAILED',
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: rejectPayload,
            message: `[不支持的任务类型] ${failureMsg} (ID: ${task.id})`,
            details: failureMsg,
          });
          await submitDutyTaskResult(task.id, rejectPayload);
          continue;
        }

        // 解码与校验中台下发任务的上下文载荷
        let parsedContext: ParsedDutyTaskContext;
        try {
          parsedContext = parseDutyTaskContext(task);
        } catch (decodeErr) {
          const failureMsg = `任务 data 解码校验失败: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`;
          const rejectPayload = buildTaskResultPayload(task, identity.stationId, {
            status: 'FAIL',
            errorCode: 'TASK_PAYLOAD_INVALID',
            errorMessage: failureMsg,
            retryable: false,
          });
          this.appendDutyLog({
            level: 'ERROR',
            module: 'DUTY_TASK',
            event: 'DUTY_TASK_EXECUTE_FAILED',
            taskActionStage: "result",
            msgType: task.msgType,
            taskId: task.id,
            taskStatus: 'FAILED',
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: rejectPayload,
            message: `[任务载荷解析失败] ${failureMsg} (ID: ${task.id})`,
            details: failureMsg,
          });
          await submitDutyTaskResult(task.id, rejectPayload);
          continue;
        }

        // 校验任务消息类型是否在客户端执行器支持范围内
        const supportedTypes = ['OTA_COLLECT_ORDER', 'OTA_IMPORT_ORDER', 'OTA_CONFIRM_IMPORT', 'OTA_CONFIRM_CANCEL'];
        if (!supportedTypes.includes(task.msgType)) {
          const failureMsg = `不支持的任务消息类型: ${task.msgType}`;
          const rejectPayload = buildTaskResultPayload(task, identity.stationId, {
            status: 'FAIL',
            errorCode: 'TASK_TYPE_UNSUPPORTED',
            errorMessage: failureMsg,
            retryable: false,
          });
          this.appendDutyLog({
            level: 'ERROR',
            module: 'DUTY_TASK',
            event: 'DUTY_TASK_EXECUTE_FAILED',
            taskActionStage: 'result',
            msgType: task.msgType,
            taskId: task.id,
            taskStatus: 'FAILED',
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: rejectPayload,
            message: `[不支持的任务类型] ${failureMsg} (ID: ${task.id})`,
            details: failureMsg,
          });
          await submitDutyTaskResult(task.id, rejectPayload);
          continue;
        }

        const targetChannel = parsedContext.channelCode;
        const taskOrderNo = parsedContext.orderNo;
        const taskLogger = createTaskLogger(
          task,
          { channelCode: targetChannel, orderNo: taskOrderNo },
          (entry) => this.appendDutyLog(entry)
        );

        // 1. 任务认领日志 (CLAIM)
        taskLogger.log({
          level: 'INFO',
          event: 'DUTY_TASK_CLAIM',
          taskActionStage: "claim",
          taskStatus: 'PROCESSING',
          apiUrl: '/toolkit/toolbox/task-claims',
          apiMethod: 'POST',
          apiParams: {
            stationId: identity.stationId,
            appId: identity.appId,
            direction: 'INBOUND',
          },
          apiResponse: task,
          httpStatus: 200,
          message: `[任务认领 claim] 任务类型: ${task.msgType} (ID: ${task.id})`,
          details: `业务标识: ${task.businessId || '-'} | 所属渠道: ${targetChannel} | 工位: ${identity.stationId}${
            taskOrderNo ? ` | 订单号: ${taskOrderNo}` : ''
          }`,
        });

        const runner = this.runners.get(targetChannel);
        if (!runner || !runner.isRunning()) {
          const failureMsg = `渠道「${targetChannel}」当前未在运行状态`;
          const isCollect = task.msgType === 'OTA_COLLECT_ORDER';
          const unavailResultPayload = buildTaskResultPayload(task, identity.stationId, {
            status: 'FAIL',
            errorCode: 'TASK_ROUTE_UNAVAILABLE',
            errorMessage: failureMsg,
            retryable: !isCollect,
          });

          taskLogger.log({
            level: 'ERROR',
            event: 'DUTY_TASK_EXECUTE_FAILED',
            taskActionStage: "result",
            taskStatus: 'FAILED',
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: unavailResultPayload,
            apiResponse: { success: false, error: failureMsg },
            message: `[任务结果 result] 任务 ${task.msgType} 执行失败: ${failureMsg} (ID: ${task.id})`,
            details: failureMsg,
          });

          try {
            await submitDutyTaskResult(task.id, unavailResultPayload);
          } catch (submitErr) {
            const submitErrMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
            taskLogger.log({
              level: 'ERROR',
              event: 'DUTY_TASK_RESULT_SUBMIT_FAILED',
              taskActionStage: "result",
              taskStatus: 'FAILED',
              apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
              apiMethod: 'PUT',
              apiParams: unavailResultPayload,
              apiResponse: { error: submitErrMsg },
              message: `[回执提交失败] 任务 ${task.msgType} 异常回执提交中台失败: ${submitErrMsg} (ID: ${task.id})`,
              details: submitErrMsg,
            });
            throw submitErr;
          }
          continue;
        }

        this.coordinatorStatus = 'EXECUTING';

        // 2. 任务执行开始日志 (EXECUTE)
        taskLogger.log({
          level: 'PLAYWRIGHT',
          event: 'DUTY_TASK_EXECUTE_START',
          taskActionStage: "execute",
          taskStatus: 'PROCESSING',
          message: `[任务执行 execute] 正在执行 ${task.msgType} (ID: ${task.id})`,
          details: `执行渠道: ${targetChannel} | 业务主键: ${task.businessId || '-'}${
            taskOrderNo ? ` | 订单号: ${taskOrderNo}` : ''
          }`,
        });

        const startTime = Date.now();
        const execRes =
          typeof runner.executeTask === 'function'
            ? await runner.executeTask(task, (entry) =>
                taskLogger.log(entry)
              )
            : await dispatchDutyTask(task, runner, (entry) =>
                taskLogger.log(entry)
              );
        const durationMs = Date.now() - startTime;

        // 3. 任务执行完成与结果日志 (RESULT)
        const isSuccess = execRes.status === 'SUCCEEDED';
        const isRiskIntercepted = execRes.errorCode === 'RISK_VERIFICATION_REQUIRED';
        const wireStatus: DutyTaskWireStatus = isSuccess ? 'SUCCESS' : 'FAIL';
        const confirmationNo =
          isSuccess && execRes.result
            ? String(
                execRes.result.confirmationNo ||
                  execRes.result.confirmNo ||
                  execRes.result.confirmationNumber ||
                  ''
              )
            : '';

        const resultPayload = buildTaskResultPayload(task, identity.stationId, {
          status: wireStatus,
          confirmationNo,
          result: execRes.result,
          errorCode: execRes.errorCode || (isSuccess ? undefined : 'TASK_EXECUTION_FAILED'),
          errorMessage: execRes.errorMessage,
          retryable: isSuccess
            ? undefined
            : (typeof execRes.retryable === 'boolean'
                ? execRes.retryable
                : (isRiskIntercepted ? false : true)),
        });

        if (isRiskIntercepted) {
          taskLogger.log({
            level: 'WARN',
            event: 'DUTY_TASK_RISK_CONTROL_INTERCEPTED',
            taskActionStage: "execute",
            message: `[风控拦截熔断] 页面遭遇美团安全验证/滑块/人机拦截，已自动熔断阻断机器重试`,
            details: `渠道: ${targetChannel} | 请人工在浏览器窗口中完成验证`,
          });
        }

        taskLogger.log({
          level: isSuccess ? 'SUCCESS' : 'ERROR',
          event: isSuccess ? 'DUTY_TASK_EXECUTE_SUCCESS' : 'DUTY_TASK_EXECUTE_FAILED',
          taskActionStage: "result",
          taskStatus: execRes.status,
          taskResult: execRes.result,
          durationMs,
          apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
          apiMethod: 'PUT',
          apiParams: resultPayload,
          apiResponse: execRes.result,
          message: `[任务结果 result] 任务 ${task.msgType} 执行${isSuccess ? '成功' : '失败'} (ID: ${task.id})`,
          details: isSuccess
            ? `耗时: ${durationMs}ms | 状态: SUCCESS${execRes.result ? ` | 结果: ${JSON.stringify(execRes.result)}` : ''}`
            : `状态: FAIL | 错误代码: ${execRes.errorCode || '-'} | 错误信息: ${execRes.errorMessage || '未知异常'}`,
        });

        // 如果是采集任务且有发现订单，批量创建下游任务
        if (task.msgType === 'OTA_COLLECT_ORDER' && execRes.status === 'SUCCEEDED' && execRes.result?.orders) {
          const orders = execRes.result.orders as Array<{ orderId: string; hotelId?: string; cancelOrder?: boolean }>;
          if (orders.length > 0) {
            try {
              const channelCode = targetChannel.toLowerCase();
              const creationItems: DutyTaskCreationBatch['items'] = orders.map((o) => {
                if (o.cancelOrder) {
                  return {
                    msgType: 'OTA_CANCEL_ORDER',
                    businessType: 'OTA_MIGRATION',
                    businessId: o.orderId,
                    data: {
                      channel: channelCode,
                      reason: '待处理取消订单',
                    },
                  };
                } else {
                  return {
                    msgType: 'OTA_IMPORT_ORDER',
                    businessType: 'OTA_MIGRATION',
                    businessId: o.orderId,
                    unitId: o.hotelId || undefined,
                    data: {
                      channel: channelCode,
                      extUnitCode: o.hotelId || '',
                      orders: [
                        {
                          otaOrderId: o.orderId,
                          otaChannel: targetChannel.toUpperCase(),
                        },
                      ],
                    },
                  };
                }
              });

              await createDutyTasks({
                stationId: identity.stationId,
                appId: identity.appId,
                items: creationItems,
              });

              taskLogger.log({
                level: 'INFO',
                event: 'DUTY_TASK_CREATE_DOWNSTREAM',
                taskActionStage: 'downstream-create',
                apiUrl: '/toolkit/toolbox/tasks',
                apiMethod: 'POST',
                apiParams: {
                  stationId: identity.stationId,
                  appId: identity.appId,
                  items: creationItems,
                },
                apiResponse: { success: true, count: orders.length },
                message: `[下游派发 downstream-create] 发现 ${orders.length} 个订单，已批量创建下游中台处理任务`,
                details: `订单列表: ${orders.map((o) => `${o.orderId}(${o.cancelOrder ? '退单' : '入单'})`).join(', ')}`,
              });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              taskLogger.log({
                level: 'ERROR',
                event: 'DUTY_TASK_CREATE_DOWNSTREAM',
                taskActionStage: 'downstream-create',
                apiUrl: '/toolkit/toolbox/tasks',
                apiMethod: 'POST',
                apiParams: {
                  stationId: identity.stationId,
                  appId: identity.appId,
                  count: orders.length,
                },
                apiResponse: { error: errMsg },
                message: `[下游派发失败 downstream-create] 创建下游订单处理任务异常: ${errMsg}`,
                details: errMsg,
              });
            }
          }
        }

        this.coordinatorStatus = 'REPORTING';
        try {
          await submitDutyTaskResult(task.id, resultPayload);
          taskLogger.log({
            level: 'INFO',
            event: 'DUTY_TASK_RESULT_SUBMIT',
            taskActionStage: "result",
            taskStatus: isSuccess ? 'SUCCEEDED' : 'FAILED',
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: resultPayload,
            apiResponse: { success: true },
            httpStatus: 200,
            message: `[回执提交 RESULT] 任务 ${task.msgType} 执行结果已成功回执中台 (ID: ${task.id})`,
            details: `回执状态: ${wireStatus}${taskOrderNo ? ` | 订单号: ${taskOrderNo}` : ''}`,
          });
        } catch (submitErr) {
          const submitErrMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
          taskLogger.log({
            level: 'ERROR',
            event: 'DUTY_TASK_RESULT_SUBMIT_FAILED',
            taskActionStage: "result",
            taskStatus: 'FAILED',
            apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
            apiMethod: 'PUT',
            apiParams: resultPayload,
            apiResponse: { error: submitErrMsg },
            message: `[回执提交失败 RESULT] 任务 ${task.msgType} 回执中台失败: ${submitErrMsg} (ID: ${task.id})`,
            details: submitErrMsg,
          });
          throw submitErr;
        }

        this.coordinatorStatus = 'IDLE';
      } catch (err) {
        if (!this.stopSignal && this.getActiveRunners().length > 0) {
          this.coordinatorStatus = 'CLAIM_BACKOFF';
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        this.appendDutyLog({
          level: 'ERROR',
          module: 'DUTY_TASK',
          event: 'DUTY_TASK_CLAIM_LOOP_ERROR',
          taskActionStage: "claim",
          message: `[任务调度异常] 任务调度认领与回执循环异常: ${errMsg}`,
          details: err instanceof Error ? err.stack : `调度器已进入退避状态，将在 3 秒后自动重试`,
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
