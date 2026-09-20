import type { DutyClaimedTask, SystemLogEntry } from '../../types';
import type {
  ChannelDutyRunner,
  DutyTaskExecutionResult,
  ExtractedOrderDetail,
} from './dutyContracts';
import { parseDutyTaskContext, isRiskControlError, type ParsedDutyTaskContext } from './dutyTaskContext';
import { createTaskLogger } from './dutyTaskLogger';
import { importToolkitOrder } from '../../services/dutyRuntimeApi';
import { fetchChannelRemarkTemplate } from '../../services/channelApi';
import { alignOrderToProtocol } from '../../utils/template/orderProtocolNormalizer';
import {
  renderRemarkFromProtocol,
  buildImportPayloadFromProtocol,
} from '../../utils/template/orderPayloadTransformer';
import { logger } from '../../services/logger';

/**
 * 顶层任务生命周期通用编排调度器 (Top-Level Duty Task Dispatcher)
 * 对所有 OTA 渠道（美团、携程、抖音等）提供统一通用的任务编排流转：
 * 1. OTA_COLLECT_ORDER: 路由至渠道页面操作收集待处理订单 -> 返回概要供中台创建下游任务；
 * 2. OTA_IMPORT_ORDER: 解析任务入参 -> 路由至渠道执行页面查看详情并抓取字段 -> Fail-Fast 严格校验 -> 统一调用中台 importToolkitOrder -> 调度关闭详情；
 * 3. OTA_CONFIRM_IMPORT: 解析确认号 -> 路由至渠道执行页面回填；
 * 4. OTA_CONFIRM_CANCEL: 解析单号 -> 路由至渠道执行取消确认；
 * 彻底消除各渠道对内存缓存的读取，杜绝任何假数据兜底！
 */
export async function dispatchDutyTask(
  task: DutyClaimedTask,
  runner: ChannelDutyRunner,
  onLog?: (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => void
): Promise<DutyTaskExecutionResult> {
  if (!runner.isRunning()) {
    return {
      status: 'FAILED',
      errorCode: 'RUNNER_NOT_RUNNING',
      errorMessage: `渠道「${runner.channelCode}」值守执行器未运行，无法处理任务`,
    };
  }

  const recordLog = (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => {
    if (onLog) {
      onLog(entry);
    } else {
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
    }
  };

  let context: ParsedDutyTaskContext;
  try {
    context = parseDutyTaskContext(task);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      status: 'FAILED',
      errorCode: 'TASK_PAYLOAD_INVALID',
      errorMessage: `任务载荷解析失败: ${errMsg}`,
    };
  }

  const taskLogger = createTaskLogger(
    task,
    { channelCode: runner.channelCode, orderNo: context.orderNo },
    recordLog
  );

  switch (task.msgType) {
    case 'OTA_COLLECT_ORDER': {
      try {
        const unhandledOrders = await runner.collectUnhandledOrders();
        return {
          status: 'SUCCEEDED',
          result: {
            otaChannelCode: runner.channelCode,
            recordCount: unhandledOrders.length,
            orders: unhandledOrders,
          },
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isRisk = isRiskControlError(err);
        const customCode = (err as { errorCode?: string })?.errorCode;
        const customRetryable = (err as { retryable?: boolean })?.retryable;
        return {
          status: 'FAILED',
          errorCode: isRisk ? 'RISK_VERIFICATION_REQUIRED' : (customCode || 'COLLECT_FAILED'),
          errorMessage: errMsg,
          retryable: typeof customRetryable === 'boolean' ? customRetryable : (isRisk ? false : undefined),
        };
      }
    }

    case 'OTA_IMPORT_ORDER': {
      const otaOrderId = context.orderNo || '';
      if (!otaOrderId) {
        return {
          status: 'FAILED',
          errorCode: 'MISSING_ORDER_ID',
          errorMessage: '任务载荷中缺少订单编号 otaOrderId / businessId',
        };
      }

      // 1. 路由至对应渠道专属页面操作：点击打开详情卡片并抓取结构化字段
      let detail: ExtractedOrderDetail;
      try {
        detail = await runner.inspectOrderDetail(otaOrderId);
      } catch (inspectErr) {
        const errMsg = inspectErr instanceof Error ? inspectErr.message : String(inspectErr);
        const isRisk = isRiskControlError(inspectErr);
        const customCode = (inspectErr as { errorCode?: string })?.errorCode;
        const customRetryable = (inspectErr as { retryable?: boolean })?.retryable;
        return {
          status: 'FAILED',
          errorCode: isRisk ? 'RISK_VERIFICATION_REQUIRED' : (customCode || 'ORDER_DETAIL_FETCH_FAILED'),
          errorMessage: errMsg,
          retryable: typeof customRetryable === 'boolean' ? customRetryable : (isRisk ? false : undefined),
        };
      }

      // 2. 顶层 Fail-Fast 严格校验：确保关键字段非空，绝不兜底假数据
      if (!detail.guestName || !detail.roomTypeName || !detail.arrival || !detail.departure) {
        return {
          status: 'FAILED',
          errorCode: 'ORDER_DETAIL_INVALID',
          errorMessage: `渠道「${runner.channelCode}」提取的订单「${otaOrderId}」详情字段不完整，缺少必须的业务字段 (入住人/房型/日期)`,
          retryable: false,
        };
      }

      // 3. 提取 extUnitCode
      const extUnitCode =
        (typeof context.payload.extUnitCode === 'string' && context.payload.extUnitCode.trim())
          ? context.payload.extUnitCode.trim()
          : (typeof context.payload.unitId === 'string' && context.payload.unitId.trim())
            ? context.payload.unitId.trim()
            : (task.unitId || detail.unitId || null);

      // 4. 数据清洗 -> 对齐程序内部统一订单协议
      const protocolData = alignOrderToProtocol(detail, runner.channelCode);

      // 5. 拉取远端模版 -> 基于订单协议渲染 Remark
      let template: string | null = null;
      try {
        const templateRes = await fetchChannelRemarkTemplate(protocolData.otaChannel);
        template = templateRes.remarkTemplate;
      } catch {
        // 网络/服务异常时保持 template = null，触发协议原始备注兜底
      }
      const remark = renderRemarkFromProtocol(protocolData, template);

      // 6. 订单协议 -> 转换为中台入单请求 (ImportPayload)
      const importPayload = buildImportPayloadFromProtocol(protocolData, extUnitCode, remark);

      try {
        // 7. 调用统一中台入单接口
        const importStartTime = Date.now();
        const importRes = await importToolkitOrder(importPayload);
        const importDurationMs = Date.now() - importStartTime;

        taskLogger.log({
          level: 'INFO',
          event: 'DUTY_TASK_ORDER_IMPORT_SUBMIT',
          taskActionStage: 'order-import-submit',
          taskStatus: 'SUCCEEDED',
          apiUrl: '/toolkit/orders/import',
          apiMethod: 'POST',
          apiParams: importPayload,
          apiResponse: importRes,
          durationMs: importDurationMs,
          httpStatus: 200,
          message: `[入单提交 order-import-submit] 订单 ${otaOrderId} 成功提交中台导入 (ID: ${task.id})`,
          details: `PMS单号: ${importRes.pmsOrderId || '-'} | 确认号: ${importRes.confirmationNo || '-'} | 批次: ${importRes.batchId || '-'} | 耗时: ${importDurationMs}ms`,
        });

        // 8. 调度渠道收起详情以保持页面整洁就绪
        try {
          await runner.closeOrderDetail?.();
        } catch {
          // 容错收起动作
        }

        return {
          status: 'SUCCEEDED',
          result: {
            imported: true,
            otaOrderId,
            pmsOrderId: importRes.pmsOrderId,
            confirmationNo: importRes.confirmationNo,
            batchId: importRes.batchId,
          },
        };
      } catch (importErr) {
        const errMsg = importErr instanceof Error ? importErr.message : String(importErr);
        const isRisk = isRiskControlError(importErr);
        const customCode = (importErr as { errorCode?: string })?.errorCode;
        const customRetryable = (importErr as { retryable?: boolean })?.retryable;

        taskLogger.log({
          level: 'ERROR',
          event: 'DUTY_TASK_ORDER_IMPORT_SUBMIT_FAILED',
          taskActionStage: 'order-import-submit',
          taskStatus: 'FAILED',
          apiUrl: '/toolkit/orders/import',
          apiMethod: 'POST',
          apiParams: importPayload,
          apiResponse: { error: errMsg },
          message: `[入单提交失败 order-import-submit] 订单 ${otaOrderId} 提交中台导入异常: ${errMsg} (ID: ${task.id})`,
          details: errMsg,
        });

        return {
          status: 'FAILED',
          errorCode: isRisk ? 'RISK_VERIFICATION_REQUIRED' : (customCode || 'IMPORT_FAILED'),
          errorMessage: errMsg,
          retryable: typeof customRetryable === 'boolean' ? customRetryable : (isRisk ? false : undefined),
        };
      }
    }

    case 'OTA_CONFIRM_IMPORT': {
      const confirmNo = String(context.payload.confirmNo || '').trim();
      const otaOrderId = context.orderNo || '';

      if (!confirmNo) {
        return {
          status: 'FAILED',
          errorCode: 'CONFIRM_NO_MISSING',
          errorMessage: 'OTA_CONFIRM_IMPORT 任务缺失有效的确认号 (confirmNo)',
          retryable: false,
        };
      }
      if (!otaOrderId) {
        return {
          status: 'FAILED',
          errorCode: 'ORDER_ID_MISSING',
          errorMessage: 'OTA_CONFIRM_IMPORT 任务缺失有效的订单号 (otaOrderId)',
          retryable: false,
        };
      }
      if (typeof runner.confirmImport !== 'function') {
        return {
          status: 'FAILED',
          errorCode: 'METHOD_NOT_IMPLEMENTED',
          errorMessage: `渠道「${runner.channelCode}」执行器未实现 confirmImport 方法`,
          retryable: false,
        };
      }

      try {
        await runner.confirmImport(confirmNo, otaOrderId);
        return {
          status: 'SUCCEEDED',
          result: {
            confirmed: true,
            confirmNo,
          },
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isRisk = isRiskControlError(err);
        const customCode = (err as { errorCode?: string })?.errorCode;
        const customRetryable = (err as { retryable?: boolean })?.retryable;
        return {
          status: 'FAILED',
          errorCode: isRisk ? 'RISK_VERIFICATION_REQUIRED' : (customCode || 'CONFIRM_IMPORT_FAILED'),
          errorMessage: errMsg,
          retryable: typeof customRetryable === 'boolean' ? customRetryable : (isRisk ? false : undefined),
        };
      }
    }

    case 'OTA_CONFIRM_CANCEL': {
      const otaOrderId = context.orderNo || '';
      if (!otaOrderId) {
        return {
          status: 'FAILED',
          errorCode: 'ORDER_ID_MISSING',
          errorMessage: 'OTA_CONFIRM_CANCEL 任务缺失有效的订单号 (otaOrderId)',
          retryable: false,
        };
      }
      if (typeof runner.confirmCancel !== 'function') {
        return {
          status: 'FAILED',
          errorCode: 'METHOD_NOT_IMPLEMENTED',
          errorMessage: `渠道「${runner.channelCode}」执行器未实现 confirmCancel 方法`,
          retryable: false,
        };
      }
      try {
        await runner.confirmCancel(otaOrderId);
        return {
          status: 'SUCCEEDED',
          result: {
            acknowledged: true,
          },
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isRisk = isRiskControlError(err);
        const customCode = (err as { errorCode?: string })?.errorCode;
        const customRetryable = (err as { retryable?: boolean })?.retryable;
        return {
          status: 'FAILED',
          errorCode: isRisk ? 'RISK_VERIFICATION_REQUIRED' : (customCode || 'CONFIRM_CANCEL_FAILED'),
          errorMessage: errMsg,
          retryable: typeof customRetryable === 'boolean' ? customRetryable : (isRisk ? false : undefined),
        };
      }
    }

    default:
      return {
        status: 'FAILED',
        errorCode: 'UNSUPPORTED_TASK_TYPE',
        errorMessage: `不支持的任务消息类型: ${task.msgType}`,
      };
  }
}
