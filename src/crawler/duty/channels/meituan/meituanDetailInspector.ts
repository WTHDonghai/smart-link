import type { Page, Response } from 'playwright';
import { updateVisualTrackerStatus, visualClickLocator } from '@/src/crawler/visualTracker';
import {
  MeituanDutyErrorCode,
  DutyExecutionError,
} from './meituanDutyContracts';
import {
  isMeituanDetailUrl,
  isMeituanSensitiveUrl,
  parseMeituanSensitiveResponse,
  mergeSensitiveDataIntoRawDetail,
  hasPlainMobileNumber,
} from './meituanOrderParsers';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  humanDelay,
  getScaledTimeout,
  isProbeVisible,
  isElementVisible,
} from '../../dutyTimingConfig';
import { assertNoMeituanPageRisk } from './meituanRiskGuard';
import { dismissMeituanNoticeModals } from './meituanModalGuard';
import { getMeituanOrderScope, locateMeituanOrderCard } from './meituanCardLocator';

export interface DetailInspectorOptions {
  refreshOrderList: (page: Page) => Promise<Response>;
}

/**
 * 美团订单详情查看器：负责卡片定位、网络响应预拦截、脱敏信息解除及报文融合
 */
export class MeituanDetailInspector {
  /**
   * 在美团后台页面定位订单卡片并内联展开/点击，抓取详情原始数据（回写明文客人姓名）
   * 遵循 Fail-Fast 原则：100% 权威网络接口为源，智能跳过电话解密，只返回原始数据，零 DOM 业务数据拼接
   */
  public async inspectOrderDetail(
    page: Page,
    otaOrderId: string,
    options: DetailInspectorOptions
  ): Promise<Record<string, unknown>> {
    await assertNoMeituanPageRisk(page);

    await updateVisualTrackerStatus(page, `🔍 正在定位订单「${otaOrderId}」卡片并展示详情...`, 'action');

    const scope = getMeituanOrderScope(page);

    // 1. 预先挂载本次查看详情专属的单次网络响应监听（在探测卡片前就位，避免探测阶段网络请求遗漏）
    const capturedRef: {
      rawDetail: unknown | null;
      sensitive: { guestName?: string; guestMobile?: string } | null;
    } = {
      rawDetail: null,
      sensitive: null,
    };

    const onResponse = async (res: { url: () => string; status: () => number; text: () => Promise<string> }) => {
      try {
        const url = res.url();
        if (res.status() === 200) {
          if (isMeituanDetailUrl(url, otaOrderId)) {
            const text = await res.text().catch(() => '');
            if (text) {
              try {
                const parsed = JSON.parse(text);
                const payloadOrderId = String(parsed?.data?.orderId || '').trim();
                if (!payloadOrderId || payloadOrderId === otaOrderId.trim()) {
                  capturedRef.rawDetail = parsed;
                }
              } catch {
                // 忽略非合法 JSON
              }
            }
          } else if (isMeituanSensitiveUrl(url)) {
            const text = await res.text().catch(() => '');
            if (text) {
              try {
                const parsed = JSON.parse(text);
                const sensitive = parseMeituanSensitiveResponse(parsed);
                if (sensitive) {
                  capturedRef.sensitive = {
                    guestName: sensitive.guestName || capturedRef.sensitive?.guestName,
                    guestMobile: sensitive.guestMobile || capturedRef.sensitive?.guestMobile,
                  };
                }
              } catch {
                // 忽略非合法 JSON
              }
            }
          }
        }
      } catch {
        // 忽略响应监听内解析异常
      }
    };

    const onFn = (page as { on?: (event: string, handler: typeof onResponse) => void }).on;
    const offFn = (page as { off?: (event: string, handler: typeof onResponse) => void }).off;
    const removeListenerFn = (
      page as { removeListener?: (event: string, handler: typeof onResponse) => void }
    ).removeListener;

    if (typeof onFn === 'function') {
      onFn.call(page, 'response', onResponse);
    }

    const detailResponsePromise = typeof page.waitForResponse === 'function'
      ? page
          .waitForResponse(
            (res) => isMeituanDetailUrl(res.url(), otaOrderId) && res.status() === 200,
            { timeout: getScaledTimeout(ACTION_TIMEOUT.NETWORK) }
          )
          .then(async (res) => {
            try {
              const text = await res.text();
              const parsed = JSON.parse(text);
              const payloadOrderId = String(
                parsed?.orderId ||
                parsed?.data?.orderDetail?.orderId ||
                parsed?.data?.order?.orderId ||
                parsed?.data?.orderId ||
                ''
              ).trim();
              if (payloadOrderId && payloadOrderId !== otaOrderId.trim()) {
                return null;
              }
              return parsed;
            } catch {
              return null;
            }
          })
          .catch(() => null)
      : Promise.resolve(null);

    try {
      // 2. 定位目标订单卡片，若未可见先刷新待确认列表确保处于最新视图
      let orderCard = await locateMeituanOrderCard(page, scope, otaOrderId);

      if (!orderCard) {
        await updateVisualTrackerStatus(
          page,
          `🔄 待确认列表中未直接发现订单「${otaOrderId}」，正在刷新待确认列表...`,
          'action'
        );
        await options.refreshOrderList(page);
        await humanDelay(page, ...HUMAN_DELAY.MEDIUM);
        orderCard = await locateMeituanOrderCard(page, scope, otaOrderId);
      }

      if (!orderCard || !await isElementVisible(orderCard, ACTION_TIMEOUT.QUICK_ACTION)) {
        await assertNoMeituanPageRisk(page);
        throw new DutyExecutionError(
          `待确认列表中未找到美团订单「${otaOrderId}」卡片，订单可能已被处理或取消`,
          MeituanDutyErrorCode.ORDER_CARD_NOT_FOUND,
          false
        );
      }

      // 3. 点击订单卡片触发右侧详情展示与网络拦截（若卡片探查阶段已激活右侧且捕获详情，免除多余的重复点击）
      const isCurrentDetail = await isProbeVisible(
        scope.locator(`.detail-header:has-text("${otaOrderId}")`).first()
      );
      if (!capturedRef.rawDetail || !isCurrentDetail) {
        await visualClickLocator(page, orderCard, `点击订单「${otaOrderId}」卡片展示详情`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
      }

      // 4. 姓名脱敏解除交互（基于美团详情页真实 DOM 结构精准定位，无二次确认弹窗）
      try {
        const revealNameBtn = scope.locator(
          '.detail-info-item .guest-name .btn-text, ' +
          '.guest-name .btn-text, ' +
          '.display-name + .btn-text, ' +
          'p.detail-info-item:has(.info-key:has-text("客人姓名")) .btn-text, ' +
          'p.detail-info-item:has(.info-key:has-text("客人姓名")) span.btn-text, ' +
          '.guest-name [class*="btn"], ' +
          '[data-test="reveal-guest-name"], .reveal-name-btn'
        ).first();

        if (await isElementVisible(revealNameBtn, ACTION_TIMEOUT.SENSITIVE_FIELD)) {
          await visualClickLocator(page, revealNameBtn, '点击查看真实客人姓名');
          await humanDelay(page, ...HUMAN_DELAY.SENSITIVE_REVEAL);
        }
      } catch {
        // 容错姓名脱敏交互
      }

      // 5. 智能跳过电话解密 (Smart Skip Phone Privacy)
      // 若姓名解密报文或原始详情已同步包含明文手机号，强制跳过点击“查看电话”，规避 1 秒双重敏感解密风控
      const resolvedPhone = hasPlainMobileNumber(capturedRef.rawDetail, capturedRef.sensitive);

      if (!resolvedPhone) {
        try {
          // 真实 DOM 结构: p.detail-info-item:has(.info-key:has-text("联系客人")) a[href="javascript:;"]
          const revealPhoneBtn = scope.locator(
            'p.detail-info-item:has(.info-key:has-text("联系客人")) a, ' +
            '.detail-info-item:has(.info-key:has-text("联系客人")) a, ' +
            '.detail-info-item:has(.info-key:has-text("联系客人")) [class*="btn"], ' +
            '[data-test="reveal-guest-phone"]'
          ).first();

          if (await isElementVisible(revealPhoneBtn, ACTION_TIMEOUT.SENSITIVE_FIELD)) {
            await visualClickLocator(page, revealPhoneBtn, '点击查看真实联系电话');
            await humanDelay(page, ...HUMAN_DELAY.SENSITIVE_REVEAL);
            // 关键保障：点击“联系客人”展示电话后，美团常弹出“联系客人（虚拟号说明）”提示弹窗，立即关闭以防遮挡
            await dismissMeituanNoticeModals(page, scope).catch(() => false);
          }
        } catch {
          // 容错电话解密交互
        }
      }

      // 6. 等待网络详情拦截 (100% 权威网络源，零 DOM 业务数据拼接)
      const rawDetail = (await detailResponsePromise) || capturedRef.rawDetail;
      if (!rawDetail) {
        await assertNoMeituanPageRisk(page);
        throw new DutyExecutionError(
          `美团订单「${otaOrderId}」详情接口网络响应超时`,
          MeituanDutyErrorCode.ORDER_DETAIL_TIMEOUT,
          true
        );
      }

      // 7. 将解密敏感信息（明文客人姓名/电话）融合回原始报文，直接返回原始数据
      const mergedRaw = mergeSensitiveDataIntoRawDetail(rawDetail, capturedRef.sensitive);
      return mergedRaw as Record<string, unknown>;
    } finally {
      if (typeof offFn === 'function') {
        offFn.call(page, 'response', onResponse);
      } else if (typeof removeListenerFn === 'function') {
        removeListenerFn.call(page, 'response', onResponse);
      }
      // 确保本次订单详情查看完毕后清理任何残留的非业务提示弹窗
      await dismissMeituanNoticeModals(page, scope).catch(() => false);
    }
  }
}
