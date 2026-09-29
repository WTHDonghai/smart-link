import type {
  ChannelDutyInfo,
  ChannelDutyStatus,
  DutyCoordinatorStatus,
  StationIdentity,
  SystemLogEntry,
  DutyClaimedTask,
  DutyTaskResultDetail,
  DutyTaskResultPayload,
  DutyTaskWireStatus,
  DutyTaskCreationBatch,
  DesktopOperationResult,
} from '../../types';
import type { ChannelDutyRunner, DutyTaskExecutionResult } from './dutyContracts';
import { isSupportedDutyTaskType } from './dutyContracts';
import { MeituanDutyRunner } from './channels/meituan/meituanDutyRunner';
import { DouyinDutyRunner } from './channels/douyin/douyinDutyRunner';
import { SYSTEM_TIMING } from './dutyTimingConfig';
import { StationCoordinator } from './stationCoordinator';
import {
  claimDutyTask,
  createDutyTasks,
  submitDutyTaskResult,
} from '../../services/dutyRuntimeApi';
import { logger } from '../../services/logger';
import { parseDutyTaskContext, type ParsedDutyTaskContext } from './dutyTaskContext';
import { createTaskLogger, type DutyTaskLogger } from './dutyTaskLogger';
import { hotelCollectionEngine } from '../engine';
import { resolveChannelMeta } from '@/src/utils/channelMeta';

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
  private stationCoordinator = new StationCoordinator();
  private isClaimingLoopRunning = false;
  private stopSignal = false;
  private recentLogs: SystemLogEntry[] = [];
  private readonly MAX_LOGS = 200;
  private confirmImportEnabled = process.env.CONFIRM_IMPORT_ENABLED !== 'false';
  private unsubscribeLogger?: () => void;

  constructor() {
    // 注册内置渠道执行器（美团酒店、抖音生活服务）
    this.registerRunner(new MeituanDutyRunner());
    this.registerRunner(new DouyinDutyRunner());

    // 绑定工位调度器的日志回调至本地日志系统
    this.stationCoordinator.setLogCallback((entry) => {
      this.appendDutyLog(entry);
    });

    // 订阅系统统一日志中枢，将值守任务关联日志镜像保留至最近缓存供前端轮询补偿查询
    this.unsubscribeLogger = logger.subscribe((entry) => {
      if (entry.module === 'DUTY_TASK' || entry.taskId) {
        this.appendDutyLogDirect(entry);
      }
    });
  }

  public dispose(): void {
    if (this.unsubscribeLogger) {
      this.unsubscribeLogger();
      this.unsubscribeLogger = undefined;
    }
    this.stationCoordinator.dispose();
  }

  public setConfirmImportEnabled(enabled: boolean): void {
    this.confirmImportEnabled = Boolean(enabled);
    for (const runner of this.runners.values()) {
      if (typeof runner.setConfirmImportEnabled === 'function') {
        runner.setConfirmImportEnabled(this.confirmImportEnabled);
      }
    }
  }

  public isConfirmImportEnabled(): boolean {
    return this.confirmImportEnabled;
  }

  public registerRunner(runner: ChannelDutyRunner): void {
    if (typeof runner.setConfirmImportEnabled === 'function') {
      runner.setConfirmImportEnabled(this.confirmImportEnabled);
    }
    this.runners.set(runner.channelCode.toUpperCase(), runner);
    this.channelStates.set(runner.channelCode.toUpperCase(), {
      channelCode: runner.channelCode.toUpperCase(),
      status: 'STOPPED',
    });
  }

  public getCoordinatorStatus(): DutyCoordinatorStatus {
    return this.coordinatorStatus;
  }

  /**
   * 检查指定渠道是否正在执行自动化值守
   */
  public isChannelActive(channelCode: string): boolean {
    const code = (channelCode || '').trim().toUpperCase();
    const runner = this.runners.get(code);
    if (runner && runner.isRunning()) {
      return true;
    }
    const state = this.channelStates.get(code);
    return state?.status === 'RUNNING' || state?.status === 'STARTING';
  }

  public getChannelDutyStatus(): Record<string, ChannelDutyInfo> {
    const result: Record<string, ChannelDutyInfo> = {};
    for (const [code, info] of this.channelStates.entries()) {
      result[code] = { ...info };
    }
    return result;
  }

  public getStationIdentity(): StationIdentity | null {
    return this.stationCoordinator.getIdentity();
  }

  public getRecentDutyLogs(sinceTime = 0): SystemLogEntry[] {
    if (sinceTime <= 0) return [...this.recentLogs];
    return this.recentLogs.filter((l) => l.createdAt > sinceTime);
  }

  public appendDutyLogDirect(entry: SystemLogEntry): void {
    const existingIndex = this.recentLogs.findIndex((l) => l.id === entry.id);
    if (existingIndex >= 0) {
      this.recentLogs[existingIndex] = entry;
      return;
    }

    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.MAX_LOGS) {
      this.recentLogs.splice(0, this.recentLogs.length - this.MAX_LOGS);
    }
  }

  public appendDutyLog(
    entryPartial: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>
  ): SystemLogEntry {
    const entry = logger.track(entryPartial.event || 'DUTY_LOG', {
      module: entryPartial.module || 'DUTY_TASK',
      level: entryPartial.level,
      message: entryPartial.message,
      channelId: entryPartial.channelId,
      orderNo: entryPartial.orderNo,
      durationMs: entryPartial.durationMs,
      details: entryPartial.details,
      meta: entryPartial.meta,
      taskId: entryPartial.taskId,
      msgType: entryPartial.msgType,
      taskActionStage: entryPartial.taskActionStage,
      taskStatus: entryPartial.taskStatus,
      taskResult: entryPartial.taskResult,
      apiUrl: entryPartial.apiUrl,
      apiMethod: entryPartial.apiMethod,
      apiParams: entryPartial.apiParams,
      apiResponse: entryPartial.apiResponse,
      httpStatus: entryPartial.httpStatus,
    });

    return entry;
  }

  private getActiveRunners(): ChannelDutyRunner[] {
    return Array.from(this.runners.values()).filter((r) => r.isRunning());
  }

  private getActiveChannelCodes(): string[] {
    return this.getActiveRunners().map((r) => r.channelCode);
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

    if (hotelCollectionEngine.isChannelActive(channelCode)) {
      throw new Error(
        `渠道「${channelCode}」当前正在执行自动化采集作业（门店或产品采集），请等待采集完成后再开启值守。`
      );
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
        await this.stationCoordinator.ensureIdentity();
        await this.stationCoordinator.reportActualState(this.getActiveChannelCodes());
        this.stationCoordinator.startHeartbeat(() => this.getActiveChannelCodes());
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
      this.stationCoordinator.stopHeartbeat();
      if (this.stationCoordinator.getIdentity()) {
        await this.stationCoordinator.reportActualState([], true);
      }
    } else if (this.stationCoordinator.getIdentity()) {
      await this.stationCoordinator.reportActualState(this.getActiveChannelCodes());
    }

    return { success: true };
  }

  /**
   * 一键停止所有渠道值守与后台调度引擎，向中台发送工位离线报文，彻底释放所有资源
   */
  public async stopAllDuty(): Promise<DesktopOperationResult> {
    // 1. 设置 stopSignal = true 阻断长轮询任务认领
    this.stopSignal = true;

    // 2. 清除心跳定时器
    this.stationCoordinator.stopHeartbeat();

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
    const station = this.stationCoordinator.getIdentity();
    if (station?.stationId) {
      try {
        await this.stationCoordinator.reportActualState([], true);
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

  private ensureClaimLoop(): void {
    if (this.isClaimingLoopRunning) return;
    this.isClaimingLoopRunning = true;
    this.stopSignal = false;
    void this.runClaimLoop();
  }

  /**
   * 统一拒单辅助方法：构造标准失败回执、记录结构化审计日志并提交中台
   */
  public async rejectClaimedTask(
    task: DutyClaimedTask,
    stationId: string,
    errorCode: string,
    errorMessage: string,
    logTag: string,
    customStage: SystemLogEntry['taskActionStage'] = 'result',
    customRetryable = false,
    options?: {
      event?: SystemLogEntry['event'];
      level?: SystemLogEntry['level'];
      channelId?: string;
      orderId?: string;
      orderNo?: string;
    }
  ): Promise<DutyTaskResultPayload> {
    const isConfirmIntercept = errorCode === 'CONFIRM_IMPORT_DISABLED';
    const event =
      options?.event ?? (isConfirmIntercept ? 'DUTY_TASK_CONFIRM_IMPORT_INTERCEPTED' : 'DUTY_TASK_EXECUTE_FAILED');
    const level = options?.level ?? (isConfirmIntercept ? 'WARN' : 'ERROR');

    const rejectPayload = buildTaskResultPayload(task, stationId, {
      status: 'FAIL',
      errorCode,
      errorMessage,
      retryable: customRetryable,
    });

    const resolvedOrderNo = options?.orderId ?? options?.orderNo;

    this.appendDutyLog({
      level,
      module: 'DUTY_TASK',
      event,
      taskActionStage: customStage,
      msgType: task.msgType,
      taskId: task.id,
      taskStatus: 'FAILED',
      ...(options?.channelId ? { channelId: options.channelId } : {}),
      ...(resolvedOrderNo ? { orderNo: resolvedOrderNo } : {}),
      apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
      apiMethod: 'PUT',
      apiParams: rejectPayload,
      message: `[${logTag}] ${errorMessage} (ID: ${task.id})`,
      details: errorMessage,
    });

    try {
      await submitDutyTaskResult(task.id, rejectPayload);
    } catch (submitErr) {
      const submitErrMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
      this.appendDutyLog({
        level: 'ERROR',
        module: 'DUTY_TASK',
        event: 'DUTY_TASK_RESULT_SUBMIT_FAILED',
        taskActionStage: customStage,
        msgType: task.msgType,
        taskId: task.id,
        taskStatus: 'FAILED',
        ...(options?.channelId ? { channelId: options.channelId } : {}),
        ...(resolvedOrderNo ? { orderNo: resolvedOrderNo } : {}),
        apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
        apiMethod: 'PUT',
        apiParams: rejectPayload,
        apiResponse: { error: submitErrMsg },
        message: `[回执提交失败] 任务 ${task.msgType} 异常回执提交中台失败: ${submitErrMsg} (ID: ${task.id})`,
        details: submitErrMsg,
      });
      throw submitErr;
    }
    return rejectPayload;
  }

  /**
   * 任务前置协议校验与上下文解析逻辑：Fail-Fast 阻断非法报文并向中台如实报告
   */
  public async validateAndParseClaimedTask(
    task: DutyClaimedTask,
    stationId: string
  ): Promise<ParsedDutyTaskContext | null> {
    // 1. 基础报文结构合规性校验 (Fail-Fast 阻断，向中台如实报告协议违规)
    if (task.businessType !== 'OTA_MIGRATION') {
      const failureMsg = `中台任务 businessType 必须为 OTA_MIGRATION (实际: ${task.businessType || '-'})`;
      await this.rejectClaimedTask(task, stationId, 'TASK_PAYLOAD_INVALID', failureMsg, '任务协议校验失败');
      return null;
    }

    if (!task.businessId || !String(task.businessId).trim()) {
      const failureMsg = '中台任务缺失有效的 businessId 业务标识';
      await this.rejectClaimedTask(task, stationId, 'TASK_PAYLOAD_INVALID', failureMsg, '任务协议校验失败');
      return null;
    }

    // 校验任务消息类型是否在客户端执行器支持范围内（前置 Fail-Fast，避免进入无意义重试）
    if (!isSupportedDutyTaskType(task.msgType)) {
      const failureMsg = `不支持的任务消息类型: ${task.msgType}`;
      await this.rejectClaimedTask(task, stationId, 'TASK_TYPE_UNSUPPORTED', failureMsg, '不支持的任务类型');
      return null;
    }

    // 解码与校验中台下发任务的上下文载荷
    let parsedContext: ParsedDutyTaskContext;
    try {
      parsedContext = parseDutyTaskContext(task);
    } catch (decodeErr) {
      const failureMsg = `任务 data 解码校验失败: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`;
      await this.rejectClaimedTask(task, stationId, 'TASK_PAYLOAD_INVALID', failureMsg, '任务载荷解析失败');
      return null;
    }

    if (!parsedContext.channelCode) {
      const failureMsg = '任务载荷缺失目标渠道代号 (channelCode)';
      await this.rejectClaimedTask(task, stationId, 'MISSING_CHANNEL_CODE', failureMsg, '任务缺失渠道');
      return null;
    }

    return parsedContext;
  }

  /**
   * 采集任务下游任务派发逻辑：处理 OTA_COLLECT_ORDER 成功后的订单映射、createDutyTasks、日志与异常降级
   */
  public async dispatchDownstreamTasks(
    task: DutyClaimedTask,
    identity: StationIdentity,
    targetChannel: string,
    execRes: DutyTaskExecutionResult,
    taskLogger: DutyTaskLogger,
    currentPayload: DutyTaskResultPayload
  ): Promise<DutyTaskResultPayload> {
    if (task.msgType !== 'OTA_COLLECT_ORDER' || execRes.status !== 'SUCCEEDED' || !execRes.result?.orders) {
      return currentPayload;
    }

    const orders = execRes.result.orders as Array<{ orderId: string; hotelId?: string; cancelOrder?: boolean }>;
    if (orders.length === 0) {
      return currentPayload;
    }

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

      return currentPayload;
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

      // Fail-Fast 刚性约束：下游任务创建失败绝不能向中台虚报成功，转为失败回执并标明可重试
      return buildTaskResultPayload(task, identity.stationId, {
        status: 'FAIL',
        errorCode: 'DOWNSTREAM_CREATION_FAILED',
        errorMessage: `下游订单处理任务创建失败: ${errMsg}`,
        retryable: true,
        result: execRes.result,
      });
    }
  }

  /**
   * 单任务执行与回执主干方法：驱动认领、前置校验、执行器调度、下游派发及结果回执提交
   */
  public async processClaimedTask(task: DutyClaimedTask, identity: StationIdentity): Promise<void> {
    const parsedContext = await this.validateAndParseClaimedTask(task, identity.stationId);
    if (!parsedContext) {
      return;
    }

    const targetChannel = parsedContext.channelCode!;
    const taskOrderId = parsedContext.orderId;
    const taskLogger = createTaskLogger(
      task,
      { channelCode: targetChannel, orderId: taskOrderId },
      (entry) => this.appendDutyLog(entry)
    );

    // 1. 任务认领日志 (CLAIM)
    taskLogger.log({
      level: 'INFO',
      event: 'DUTY_TASK_CLAIM',
      taskActionStage: 'claim',
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
        taskOrderId ? ` | 订单号: ${taskOrderId}` : ''
      }`,
    });

    // 开发调试保护：若关闭确认号回填开关，拦截 OTA_CONFIRM_IMPORT 任务，避免误在渠道后台接单确认
    if (task.msgType === 'OTA_CONFIRM_IMPORT' && !this.confirmImportEnabled) {
      const failureMsg = '已关闭订单确认号回填开关，系统已拦截确认号回填与接单操作（开发调试保护模式）';
      await this.rejectClaimedTask(
        task,
        identity.stationId,
        'CONFIRM_IMPORT_DISABLED',
        failureMsg,
        '回填拦截',
        'result',
        false,
        { channelId: targetChannel, orderId: taskOrderId }
      );
      return;
    }

    const runner = this.runners.get(targetChannel);
    if (!runner || !runner.isRunning()) {
      const failureMsg = `渠道「${targetChannel}」当前未在运行状态`;
      const isCollect = task.msgType === 'OTA_COLLECT_ORDER';
      await this.rejectClaimedTask(
        task,
        identity.stationId,
        'TASK_ROUTE_UNAVAILABLE',
        failureMsg,
        '渠道未就绪',
        'result',
        !isCollect,
        { channelId: targetChannel, orderId: taskOrderId }
      );
      return;
    }

    // 检查渠道能力白名单：若渠道执行器明确声明不支持该任务类型，立即 Fail-Fast 拒单
    if (
      runner.supportedTaskTypes &&
      !runner.supportedTaskTypes.includes(task.msgType as import('./dutyContracts').SupportedDutyTaskType)
    ) {
      const failureMsg = `渠道「${targetChannel}」执行器暂不支持任务类型「${task.msgType}」`;
      await this.rejectClaimedTask(
        task,
        identity.stationId,
        'TASK_NOT_SUPPORTED_BY_CHANNEL',
        failureMsg,
        '能力不支持',
        'result',
        false,
        { channelId: targetChannel, orderId: taskOrderId }
      );
      return;
    }

    this.coordinatorStatus = 'EXECUTING';

    // 2. 任务执行开始日志 (EXECUTE)
    taskLogger.log({
      level: 'PLAYWRIGHT',
      event: 'DUTY_TASK_EXECUTE_START',
      taskActionStage: 'execute',
      taskStatus: 'PROCESSING',
      message: `[任务执行 execute] 正在执行 ${task.msgType} (ID: ${task.id})`,
      details: `执行渠道: ${targetChannel} | 业务主键: ${task.businessId || '-'}${
        taskOrderId ? ` | 订单号: ${taskOrderId}` : ''
      }`,
    });

    const startTime = Date.now();
    const execRes: DutyTaskExecutionResult = await runner.executeTask(task, (entry) => taskLogger.log(entry));
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

    let resultPayload = buildTaskResultPayload(task, identity.stationId, {
      status: wireStatus,
      confirmationNo,
      result: execRes.result,
      errorCode: execRes.errorCode || (isSuccess ? undefined : 'TASK_EXECUTION_FAILED'),
      errorMessage: execRes.errorMessage,
      retryable: isSuccess
        ? undefined
        : typeof execRes.retryable === 'boolean'
          ? execRes.retryable
          : (isRiskIntercepted ? false : true),
    });

    if (isRiskIntercepted) {
      const channelLabel = resolveChannelMeta(targetChannel).name || targetChannel;
      taskLogger.log({
        level: 'WARN',
        event: 'DUTY_TASK_RISK_CONTROL_INTERCEPTED',
        taskActionStage: 'execute',
        message: `[风控拦截熔断] 页面遭遇${channelLabel}安全验证/滑块/人机拦截，已自动熔断阻断机器重试`,
        details: `渠道: ${targetChannel} | 请人工在浏览器窗口中完成验证`,
      });
    }

    taskLogger.log({
      level: isSuccess ? 'SUCCESS' : 'ERROR',
      event: isSuccess ? 'DUTY_TASK_EXECUTE_SUCCESS' : 'DUTY_TASK_EXECUTE_FAILED',
      taskActionStage: 'result',
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

    // 4. 下游任务派发
    resultPayload = await this.dispatchDownstreamTasks(
      task,
      identity,
      targetChannel,
      execRes,
      taskLogger,
      resultPayload
    );

    this.coordinatorStatus = 'REPORTING';
    try {
      await submitDutyTaskResult(task.id, resultPayload);
      const isResultSuccess = resultPayload.status === 'SUCCESS';
      taskLogger.log({
        level: isResultSuccess ? 'INFO' : 'ERROR',
        event: isResultSuccess ? 'DUTY_TASK_RESULT_SUBMIT' : 'DUTY_TASK_RESULT_SUBMIT_FAILED',
        taskActionStage: 'result',
        taskStatus: isResultSuccess ? 'SUCCEEDED' : 'FAILED',
        apiUrl: `/toolkit/toolbox/tasks/${task.id}/result`,
        apiMethod: 'PUT',
        apiParams: resultPayload,
        apiResponse: { success: isResultSuccess },
        httpStatus: 200,
        message: `[回执提交 RESULT] 任务 ${task.msgType} 执行结果已成功回执中台 (ID: ${task.id})`,
        details: `回执状态: ${resultPayload.status}${taskOrderId ? ` | 订单号: ${taskOrderId}` : ''}`,
      });
    } catch (submitErr) {
      const submitErrMsg = submitErr instanceof Error ? submitErr.message : String(submitErr);
      taskLogger.log({
        level: 'ERROR',
        event: 'DUTY_TASK_RESULT_SUBMIT_FAILED',
        taskActionStage: 'result',
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
  }

  private async acquireStationIdentity(): Promise<StationIdentity | null> {
    try {
      const identity = await this.stationCoordinator.ensureIdentity();
      if (!this.stationCoordinator.isHeartbeatActive()) {
        void this.stationCoordinator.reportActualState(this.getActiveChannelCodes());
        this.stationCoordinator.startHeartbeat(() => this.getActiveChannelCodes());
      }
      return identity;
    } catch {
      this.coordinatorStatus = 'CLAIM_BACKOFF';
      return null;
    }
  }

  private async handleClaimLoopError(err: unknown): Promise<void> {
    if (!this.stopSignal && this.getActiveRunners().length > 0) {
      this.coordinatorStatus = 'CLAIM_BACKOFF';
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    this.appendDutyLog({
      level: 'ERROR',
      module: 'DUTY_TASK',
      event: 'DUTY_TASK_CLAIM_LOOP_ERROR',
      taskActionStage: 'claim',
      message: `[任务调度异常] 任务调度认领与回执循环异常: ${errMsg}`,
      details: err instanceof Error ? err.stack : '调度器已进入退避状态，将在 3 秒后自动重试',
    });
    if (this.stopSignal || this.getActiveRunners().length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SYSTEM_TIMING.CLAIM_BACKOFF));
  }

  private async runClaimLoop(): Promise<void> {
    while (!this.stopSignal && this.getActiveRunners().length > 0) {
      try {
        const identity = await this.acquireStationIdentity();
        if (!identity || this.stopSignal || this.getActiveRunners().length === 0) {
          if (this.stopSignal || this.getActiveRunners().length === 0) break;
          await new Promise((resolve) => setTimeout(resolve, SYSTEM_TIMING.CLAIM_BACKOFF));
          continue;
        }

        this.coordinatorStatus = 'CLAIMING';
        const task = await claimDutyTask({ stationId: identity.stationId, appId: identity.appId, direction: 'INBOUND' });
        if (this.stopSignal || this.getActiveRunners().length === 0) break;
        if (!task) {
          this.coordinatorStatus = 'IDLE';
          const jitter = SYSTEM_TIMING.CLAIM_IDLE_JITTER_BASE + Math.floor(Math.random() * SYSTEM_TIMING.CLAIM_IDLE_JITTER_SPREAD);
          await new Promise((resolve) => setTimeout(resolve, jitter));
          continue;
        }

        await this.processClaimedTask(task, identity);
      } catch (err) {
        await this.handleClaimLoopError(err);
      }
    }
    this.isClaimingLoopRunning = false;
    this.coordinatorStatus = this.getActiveRunners().length === 0 || this.stopSignal ? 'STOPPED' : 'IDLE';
  }
}

export const dutyOrchestrationEngine = new DutyOrchestrationEngine();
