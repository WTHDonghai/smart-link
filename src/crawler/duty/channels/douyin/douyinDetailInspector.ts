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

      // 6. HTTP 状态码校验 (Fail-Fast: status !== 200)
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

      // 7. 反序列化与业务校验
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

    // 8. 敏感信息自动解密尝试（若存在 phone_ciphertext 则调用官方 decrypt_data 接口）
    return await this.decryptPhoneIfPresent(page, rawDetail, cleanOrderId);
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
   * 识别 phone_ciphertext 并调用官方解密接口解密手机号
   */
  private async decryptPhoneIfPresent(
    page: Page,
    rawDetail: Record<string, unknown>,
    cleanOrderId: string
  ): Promise<Record<string, unknown>> {
    try {
      const rawString = JSON.stringify(rawDetail);
      const hasUnmaskedPhone = /\\?"phone\\?"\s*:\s*\\?"1[3-9]\d{9}\\?"/.test(rawString);
      const cipherMatch = rawString.match(/\\?"phone_ciphertext\\?"\s*:\s*\\?"([^\\"]+)/);
      const ciphertext = cipherMatch ? cipherMatch[1] : '';

      if (ciphertext && !hasUnmaskedPhone && typeof page.evaluate === 'function') {
        const decryptedPhone = await page.evaluate(async (cipher) => {
          try {
            const res = await fetch('/life/trade_view/v1/commmon/decrypt_data', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ encrypted_data: cipher }),
            });
            if (!res.ok) return null;
            const json = await res.json();
            const statusCode = json?.status_code ?? json?.BaseResp?.StatusCode;
            if (statusCode !== 0 && statusCode !== undefined) return null;
            const raw = String(json?.decrypte_data ?? json?.decrypted_data ?? json?.data ?? '').trim();
            const digits = raw.replace(/[^\d]/g, '').replace(/^86(?=1\d{10}$)/, '');
            return /^1\d{10}$/.test(digits) ? digits : null;
          } catch {
            return null;
          }
        }, ciphertext).catch(() => null);

        if (decryptedPhone) {
          logger.info(`[抖音详情] 订单「${cleanOrderId}」密文手机号解密成功`, {
            module: 'DUTY_TASK',
            channelId: 'DOUYIN',
            orderNo: cleanOrderId,
          });
          const resultDetail = JSON.parse(JSON.stringify(rawDetail)) as Record<string, unknown>;
          resultDetail.decryptedPhone = decryptedPhone;
          const guestInfo = (resultDetail.guest_info || {}) as Record<string, unknown>;
          const userList = Array.isArray(guestInfo.user_list) ? guestInfo.user_list : [];
          if (userList[0]) {
            (userList[0] as Record<string, unknown>).phone = decryptedPhone;
          }
          return resultDetail;
        }
      }
    } catch {
      // 容错密文解密，Fail-Fast 保证在后续清洗与入单校验中严格把控
    }

    return rawDetail;
  }
}
