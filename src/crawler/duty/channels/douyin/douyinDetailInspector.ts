import type { Page, Locator, FrameLocator } from 'playwright';
import { logger } from '@/src/services/logger';
import { updateVisualTrackerStatus, visualClickLocator } from '@/src/crawler/visualTracker';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  getScaledTimeout,
  humanDelay,
  isElementVisible,
} from '../../dutyTimingConfig';
import { assertNoDouyinPageRisk } from './douyinRiskGuard';
import { dismissDouyinNoticeModals } from './douyinModalGuard';
import { getDouyinOrderScope, locateDouyinOrderCard } from './douyinCardLocator';
import {
  isDouyinOrderDetailUrl,
  isDouyinRiskControlText,
  isDouyinSecretNumUrl,
  parseDouyinSecretNumResponse,
  DOUYIN_REVEAL_PHONE_SELECTOR,
} from './douyinOrderParsers';

export interface DouyinDetailInspectorOptions {
  refreshOrderList: (page: Page) => Promise<unknown>;
}

type ResponseLike = {
  url: () => string;
  status: () => number;
  text: () => Promise<string>;
  request?: () => { method: () => string };
};

/**
 * 判断网络响应是否属于抖音详情 POST 接口（过滤 OPTIONS 预检请求）
 */
function isDouyinDetailResponse(res: { url: () => string; request?: () => { method: () => string } }): boolean {
  if (!isDouyinOrderDetailUrl(res.url())) return false;
  return res.request?.().method().toUpperCase() === 'POST';
}

/**
 * 校验并反序列化抖音详情权威网络报文
 * 遵循 Fail-Fast 原则：风控拦截、非 0 业务状态码、单号缺失等均立即阻断
 */
function parseDouyinDetailPayload(text: string, cleanOrderId: string): Record<string, unknown> {
  if (!text) {
    throw new Error('详情接口响应体为空');
  }

  if (isDouyinRiskControlText(text)) {
    throw new Error('详情接口报文命中安全验证/风控特征');
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`详情响应 JSON 反序列化失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!json || typeof json !== 'object') {
    throw new Error('详情接口返回非对象类型的 JSON 报文');
  }

  // 业务状态码校验 (Fail-Fast: status_code !== 0)
  if (json.status_code !== undefined && json.status_code !== 0) {
    const msg = String(json.status_msg || '无详细错误信息');
    throw new Error(`详情接口返回业务错误 (code: ${json.status_code}, msg: ${msg})`);
  }

  // 目标订单单号校验
  if (!text.includes(cleanOrderId)) {
    throw new Error(`详情接口响应不包含目标单号「${cleanOrderId}」`);
  }

  return json;
}

/**
 * 抖音订单详情查看器：负责卡片定位、展开交互、网络响应权威拦截与敏感数据解密
 * 遵循 KISS 与 Fail-Fast 原则：100% 权威网络接口为源，零 DOM 业务数据拼接
 */
export class DouyinDetailInspector {
  public async inspectOrderDetail(
    page: Page,
    otaOrderId: string,
    options: DouyinDetailInspectorOptions
  ): Promise<Record<string, unknown>> {
    await assertNoDouyinPageRisk(page);

    const cleanOrderId = String(otaOrderId || '').trim();
    if (!cleanOrderId) {
      throw new DutyExecutionError(
        'otaOrderId 不能为空',
        DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
        false
      );
    }

    await updateVisualTrackerStatus(page, `正在定位抖音订单「${cleanOrderId}」卡片并展示详情...`, 'action');
    logger.info(`[抖音详情] 开始定位订单「${cleanOrderId}」卡片并准备抓取权威详情报文`, {
      module: 'DUTY_TASK',
      channelId: 'DOUYIN',
      orderNo: cleanOrderId,
    });

    const scope = getDouyinOrderScope(page);

    // 1. 在操作前启动 waitForResponse 声明式 Promise 监听（过滤 isDouyinDetailResponse）
    const detailResponsePromise = page.waitForResponse(
      (res) => isDouyinDetailResponse(res),
      { timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }
    );
    // 避免在卡片定位异常提前退出时，后台网络等待超时引发未捕获的 Promise Rejection
    detailResponsePromise.catch(() => {});

    let rawDetail: Record<string, unknown>;

    try {
      // 2. 定位目标订单卡片，若未可见先刷新列表
      const orderCard = await this.locateOrderCard(page, scope, cleanOrderId, options);

      // 3. 点击订单卡片展开详情抽屉并触发详情接口
      await this.triggerDetailExpand(page, orderCard, cleanOrderId);

      // 4. 等待权威网络响应
      let response: ResponseLike;
      try {
        response = await detailResponsePromise;
      } catch (err) {
        await assertNoDouyinPageRisk(page);
        throw new DutyExecutionError(
          `抖音订单「${cleanOrderId}」详情网络响应超时或未捕获到原始报文（诊断原因: ${err instanceof Error ? err.message : String(err)}）`,
          DouyinDutyErrorCode.ORDER_DETAIL_TIMEOUT,
          true
        );
      }

      // 5. HTTP 状态码校验 (Fail-Fast: status !== 200)
      if (response.status() !== 200) {
        logger.warn(`[抖音详情] 订单「${cleanOrderId}」详情接口非 200 (HTTP ${response.status()})`, {
          module: 'DUTY_TASK',
          channelId: 'DOUYIN',
          orderNo: cleanOrderId,
          httpStatus: response.status(),
          apiUrl: response.url(),
        });
        await assertNoDouyinPageRisk(page);
        throw new DutyExecutionError(
          `抖音订单「${cleanOrderId}」详情接口返回异常 HTTP 状态码: ${response.status()}`,
          DouyinDutyErrorCode.ORDER_DETAIL_HTTP_ERROR,
          false
        );
      }

      // 6. 反序列化与业务校验
      try {
        const text = await response.text().catch((err) => {
          throw new Error(`读取响应文本失败: ${err instanceof Error ? err.message : String(err)}`);
        });
        rawDetail = parseDouyinDetailPayload(text, cleanOrderId);
      } catch (err) {
        logger.error(`[抖音详情] 订单「${cleanOrderId}」详情解析失败: ${err instanceof Error ? err.message : String(err)}`, {
          module: 'DUTY_TASK',
          channelId: 'DOUYIN',
          orderNo: cleanOrderId,
        });
        await assertNoDouyinPageRisk(page);
        throw new DutyExecutionError(
          `抖音订单「${cleanOrderId}」详情解析失败（诊断原因: ${err instanceof Error ? err.message : String(err)}）`,
          DouyinDutyErrorCode.ORDER_DETAIL_FIELD_MISSING,
          false
        );
      }

      logger.info(`[抖音详情] 订单「${cleanOrderId}」权威详情网络原始报文捕获成功`, {
        module: 'DUTY_TASK',
        channelId: 'DOUYIN',
        orderNo: cleanOrderId,
        apiUrl: response.url(),
      });
    } finally {
      await dismissDouyinNoticeModals(page, scope).catch(() => false);
    }

    // 7. 敏感信息脱敏解除：定位界面元素并点击触发，拦截 get_secret_num 接口响应
    return await this.revealAndCapturePhone(page, scope, rawDetail, cleanOrderId);
  }

  /**
   * 定位订单卡片，若不可见则触发列表刷新并二次查找
   */
  private async locateOrderCard(
    page: Page,
    scope: Page | FrameLocator,
    cleanOrderId: string,
    options: DouyinDetailInspectorOptions
  ): Promise<Locator> {
    let orderCard = await locateDouyinOrderCard(page, scope, cleanOrderId);

    if (!orderCard) {
      await updateVisualTrackerStatus(
        page,
        `🔄 列表中未直接发现订单「${cleanOrderId}」，正在刷新列表...`,
        'action'
      );
      await options.refreshOrderList(page);
      await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
      orderCard = await locateDouyinOrderCard(page, scope, cleanOrderId);
    }

    if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
      await assertNoDouyinPageRisk(page);
      throw new DutyExecutionError(
        `待处理列表中未找到抖音订单「${cleanOrderId}」卡片，订单可能已被处理或取消`,
        DouyinDutyErrorCode.ORDER_CARD_NOT_FOUND,
        false
      );
    }

    return orderCard;
  }

  /**
   * 点击订单卡片展开详情抽屉并触发详情接口调用
   * 依据抖音商户后台真实 DOM 调研：卡片根节点 (.hotel-book-list-order-card) 整体自带 cursor-pointer，
   * 点击卡片任意区域即可触发详情抽屉展开与网络接口调用，页面不存在独立的“详情”按钮。
   */
  private async triggerDetailExpand(
    page: Page,
    orderCard: Locator,
    cleanOrderId: string
  ): Promise<void> {
    await visualClickLocator(page, orderCard, `点击订单「${cleanOrderId}」卡片展开详情`);
    await humanDelay(page, ...HUMAN_DELAY.SHORT);
  }


  /**
   * 定位页面电话图标并点击，通过 Playwright waitForResponse 拦截 get_secret_num 接口响应获取联系电话
   */
  private async revealAndCapturePhone(
    page: Page,
    scope: Page | FrameLocator,
    rawDetail: Record<string, unknown>,
    cleanOrderId: string
  ): Promise<Record<string, unknown>> {
    try {
      // 1. 定位脱敏解除元素（图标/按钮），不可见则直接返回
      const revealPhoneBtn = scope.locator(DOUYIN_REVEAL_PHONE_SELECTOR).first();
      if (!await isElementVisible(revealPhoneBtn, ACTION_TIMEOUT.SENSITIVE_FIELD)) {
        return rawDetail;
      }

      // 2. 声明式监听 get_secret_num 接口响应
      const secretResponsePromise = typeof page.waitForResponse === 'function'
        ? page
            .waitForResponse(
              (res) => isDouyinSecretNumUrl(res.url()) && res.status() === 200,
              { timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }
            )
            .catch(() => null)
        : Promise.resolve(null);

      // 3. 拟人化点击电话图标
      await updateVisualTrackerStatus(
        page,
        `正在点击订单「${cleanOrderId}」联系电话图标获取隐私号码...`,
        'action'
      );
      await visualClickLocator(page, revealPhoneBtn, `点击订单「${cleanOrderId}」联系电话图标获取隐私号码`);
      await humanDelay(page, ...HUMAN_DELAY.SENSITIVE_REVEAL);

      // 4. 等待拦截到的网络响应
      const secretResponse = await secretResponsePromise;
      if (!secretResponse) {
        return rawDetail;
      }

      const responseText = await secretResponse.text().catch(() => '');
      if (!responseText || isDouyinRiskControlText(responseText)) {
        return rawDetail;
      }

      const decryptedPhone = parseDouyinSecretNumResponse(responseText);
      if (decryptedPhone) {
        logger.info(`[抖音详情] 订单「${cleanOrderId}」联系电话获取成功: ${decryptedPhone}`, {
          module: 'DUTY_TASK',
          channelId: 'DOUYIN',
          orderNo: cleanOrderId,
        });

        const resultDetail = JSON.parse(JSON.stringify(rawDetail)) as Record<string, unknown>;
        resultDetail.decryptedPhone = decryptedPhone;

        // 若根级有 guest_info
        if (resultDetail.guest_info && typeof resultDetail.guest_info === 'object') {
          const guestInfo = resultDetail.guest_info as Record<string, unknown>;
          const userList = Array.isArray(guestInfo.user_list) ? guestInfo.user_list : [];
          if (userList[0] && typeof userList[0] === 'object') {
            (userList[0] as Record<string, unknown>).phone = decryptedPhone;
          }
          if (guestInfo.buyer && typeof guestInfo.buyer === 'object') {
            (guestInfo.buyer as Record<string, unknown>).phone = decryptedPhone;
          }
        }

        // 若为抖音标准嵌套字符串结构 data.data，同步更新内部实体
        const innerDataObj = resultDetail.data as Record<string, unknown> | undefined;
        if (innerDataObj && typeof innerDataObj.data === 'string') {
          try {
            const parsedInner = JSON.parse(innerDataObj.data);
            if (parsedInner && typeof parsedInner === 'object') {
              const innerGuest = (parsedInner.guest_info || {}) as Record<string, unknown>;
              const innerUsers = Array.isArray(innerGuest.user_list) ? innerGuest.user_list : [];
              if (innerUsers[0] && typeof innerUsers[0] === 'object') {
                (innerUsers[0] as Record<string, unknown>).phone = decryptedPhone;
              }
              if (innerGuest.buyer && typeof innerGuest.buyer === 'object') {
                (innerGuest.buyer as Record<string, unknown>).phone = decryptedPhone;
              }
              innerDataObj.data = JSON.stringify(parsedInner);
            }
          } catch {
            // 忽略嵌套反序列化异常
          }
        }

        return resultDetail;
      }
    } catch (err) {
      logger.warn(`[抖音详情] 订单「${cleanOrderId}」尝试获取联系电话异常: ${err instanceof Error ? err.message : String(err)}`, {
        module: 'DUTY_TASK',
        channelId: 'DOUYIN',
        orderNo: cleanOrderId,
      });
    } finally {
      await dismissDouyinNoticeModals(page, scope).catch(() => false);
    }

    return rawDetail;
  }
}
