import type { DutyClaimedTask, ImportPayload, ImportOrderPricing } from '../../types';
import type {
  ChannelDutyRunner,
  DutyTaskExecutionResult,
  ExtractedOrderDetail,
} from './dutyContracts';
import { importToolkitOrder } from '../../services/dutyRuntimeApi';

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
  runner: ChannelDutyRunner
): Promise<DutyTaskExecutionResult> {
  if (!runner.isRunning()) {
    return {
      status: 'FAILED',
      errorCode: 'RUNNER_NOT_RUNNING',
      errorMessage: `渠道「${runner.channelCode}」值守执行器未运行，无法处理任务`,
    };
  }

  let taskData: Record<string, unknown> = {};
  if (task.data) {
    try {
      const rawDecoded = Buffer.from(task.data, 'base64').toString('utf-8');
      taskData = JSON.parse(rawDecoded) as Record<string, unknown>;
    } catch {
      taskData = {};
    }
  }

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
        return {
          status: 'FAILED',
          errorCode: 'COLLECT_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }

    case 'OTA_IMPORT_ORDER': {
      const orderInArray =
        Array.isArray(taskData.orders) && taskData.orders[0] && typeof taskData.orders[0] === 'object'
          ? (taskData.orders[0] as Record<string, unknown>).otaOrderId
          : undefined;
      const otaOrderId = String(orderInArray || taskData.otaOrderId || task.businessId || '').trim();
      if (!otaOrderId) {
        return {
          status: 'FAILED',
          errorCode: 'MISSING_ORDER_ID',
          errorMessage: '任务载荷中缺少订单编号 otaOrderId / businessId',
        };
      }

      // 1. 路由至对应渠道专属页面操作：点击打开详情弹窗并抓取结构化字段
      let detail: ExtractedOrderDetail;
      try {
        detail = await runner.inspectOrderDetail(otaOrderId);
      } catch (inspectErr) {
        return {
          status: 'FAILED',
          errorCode: 'ORDER_DETAIL_FETCH_FAILED',
          errorMessage: inspectErr instanceof Error ? inspectErr.message : String(inspectErr),
        };
      }

      // 2. 顶层 Fail-Fast 严格校验：确保关键字段非空，绝不兜底假数据
      if (!detail.guestName || !detail.roomTypeName || !detail.arrival || !detail.departure) {
        return {
          status: 'FAILED',
          errorCode: 'ORDER_DETAIL_INVALID',
          errorMessage: `渠道「${runner.channelCode}」提取的订单「${otaOrderId}」详情字段不完整，缺少必须的业务字段 (入住人/房型/日期)`,
        };
      }

      // 3. 统一组装符合中台线缆契约的入单请求 (ImportPayload)
      const extUnitCode =
        (typeof taskData.extUnitCode === 'string' && taskData.extUnitCode.trim())
          ? taskData.extUnitCode.trim()
          : (typeof taskData.unitId === 'string' && taskData.unitId.trim())
            ? taskData.unitId.trim()
            : (task.unitId || detail.unitId || null);

      const arrivalDate = detail.arrival;
      const stayNights = Math.max(1, detail.nights || 1);
      const rawPricing = Array.isArray((detail.raw as Record<string, unknown> | undefined)?.pricing)
        ? ((detail.raw as Record<string, unknown>).pricing as Array<{ date?: string; price?: number }>)
        : [];

      let pricing: ImportOrderPricing[] = [];
      if (rawPricing.length === stayNights && rawPricing.every((p) => p.date && typeof p.price === 'number')) {
        pricing = rawPricing.map((p) => ({
          date: String(p.date),
          price: Number(p.price),
        }));
      } else {
        const nightlyPrice = Math.round((detail.totalPrice / stayNights) * 100) / 100;
        pricing = Array.from({ length: stayNights }, (_, i) => {
          const d = new Date(`${arrivalDate}T00:00:00.000Z`);
          d.setUTCDate(d.getUTCDate() + i);
          return {
            date: d.toISOString().slice(0, 10),
            price: nightlyPrice,
          };
        });
      }

      const rawGoodsId = (detail.raw as Record<string, unknown> | undefined)?.goodsId ||
                         (detail.raw as Record<string, unknown> | undefined)?.roomTypeId;
      const roomTypeId = rawGoodsId ? String(rawGoodsId).trim() : 'ROOM_DEFAULT';

      const rawPaytype = (detail.raw as Record<string, unknown> | undefined)?.paymentType ||
                         (detail.raw as Record<string, unknown> | undefined)?.paytype;
      const paytype = rawPaytype ? String(rawPaytype).trim() : '预付';

      const importPayload: ImportPayload = {
        extUnitCode,
        orders: [
          {
            otaOrderId: detail.otaOrderId,
            otaChannel: detail.otaChannel || runner.channelCode,
            contact: {
              name: detail.guestName,
              mobile: detail.guestMobile || '',
            },
            booking: {
              roomType: detail.roomTypeName,
              originRoomType: detail.roomTypeName,
              rateCode: detail.ratePlanName || 'OTA',
              arrival: detail.arrival,
              departure: detail.departure,
              roomTypeId,
              nights: stayNights,
              quantity: detail.quantity || 1,
              totalPrice: detail.totalPrice,
              paytype,
              pricing,
            },
            remark: String((detail.raw as Record<string, unknown> | undefined)?.remark || ''),
          },
        ],
      };

      try {
        // 4. 调用统一中台入单接口
        const importRes = await importToolkitOrder(importPayload);

        // 5. 调度渠道关闭详情弹窗以保持页面整洁就绪
        try {
          await runner.closeOrderDetail?.();
        } catch {
          // 容错关闭动作
        }

        return {
          status: 'SUCCEEDED',
          result: {
            otaOrderId,
            pmsOrderId: importRes.pmsOrderId,
            confirmationNo: importRes.confirmationNo,
            imported: true,
          },
        };
      } catch (importErr) {
        return {
          status: 'FAILED',
          errorCode: 'IMPORT_FAILED',
          errorMessage: importErr instanceof Error ? importErr.message : String(importErr),
        };
      }
    }

    case 'OTA_CONFIRM_IMPORT': {
      const confirmNo = String(taskData.confirmNo || '').trim();
      const otaOrderId = String(taskData.otaOrderId || task.businessId || '').trim();
      try {
        await runner.confirmImport?.(confirmNo, otaOrderId);
        return {
          status: 'SUCCEEDED',
          result: {
            confirmed: true,
            confirmNo,
          },
        };
      } catch (err) {
        return {
          status: 'FAILED',
          errorCode: 'CONFIRM_IMPORT_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }

    case 'OTA_CONFIRM_CANCEL': {
      const otaOrderId = String(taskData.otaOrderId || task.businessId || '').trim();
      try {
        await runner.confirmCancel?.(otaOrderId);
        return {
          status: 'SUCCEEDED',
          result: {
            acknowledged: true,
          },
        };
      } catch (err) {
        return {
          status: 'FAILED',
          errorCode: 'CONFIRM_CANCEL_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
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
