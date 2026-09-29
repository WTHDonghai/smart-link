import type { Page } from 'playwright';
import { updateVisualTrackerStatus, visualClickLocator } from '@/src/crawler/visualTracker';
import {
  DouyinDutyErrorCode,
  DutyExecutionError,
} from './douyinDutyContracts';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  humanDelay,
  isElementVisible,
} from '../../dutyTimingConfig';
import { assertNoDouyinPageRisk } from './douyinRiskGuard';
import { dismissDouyinNoticeModals } from './douyinModalGuard';
import { getDouyinOrderScope, locateDouyinOrderCard } from './douyinCardLocator';
import { extractDouyinOrderFromResponse } from './douyinOrderParsers';

export interface DouyinDetailInspectorOptions {
  refreshOrderList: (page: Page) => Promise<unknown>;
  getCachedOrderRaw?: (orderId: string) => Record<string, unknown> | null;
}

/**
 * 抖音订单详情查看器：负责卡片定位、展开交互、网络响应预拦截与权威原始报文获取
 */
export class DouyinDetailInspector {
  /**
   * 在抖音后台页面定位订单卡片并展开/查看详情，抓取详情原始数据
   * 遵循 Fail-Fast 原则：100% 权威网络接口为源，只返回原始数据，零 DOM 业务数据拼接
   */
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

    await updateVisualTrackerStatus(page, `🔍 正在定位抖音订单「${cleanOrderId}」卡片并展示详情...`, 'action');

    const scope = getDouyinOrderScope(page);

    // 1. 预先挂载本次查看详情专属的单次网络响应监听
    let capturedDetail: Record<string, unknown> | null = null;
    const onResponse = async (res: { url: () => string; status: () => number; text: () => Promise<string> }) => {
      try {
        if (res.status() === 200) {
          const url = res.url();
          if (url.includes(cleanOrderId) || url.includes('detail') || url.includes('query')) {
            const text = await res.text().catch(() => '');
            if (text && text.includes(cleanOrderId)) {
              try {
                const parsed = JSON.parse(text);
                const extracted = extractDouyinOrderFromResponse(parsed, cleanOrderId);
                if (extracted) {
                  capturedDetail = extracted;
                }
              } catch {
                // 忽略非合法 JSON
              }
            }
          }
        }
      } catch {
        // 忽略监听异常
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

    try {
      // 2. 定位目标订单卡片，若未可见先刷新列表确保处于最新视图
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

      // 3. 点击订单卡片或“详情”入口展开详情
      const detailTrigger = orderCard.locator(
        'a:has-text("详情"), button:has-text("详情"), [class*="detail"], a[href*="detail"]'
      ).first();

      if (await isElementVisible(detailTrigger, ACTION_TIMEOUT.ELEMENT)) {
        await visualClickLocator(page, detailTrigger, `点击订单「${cleanOrderId}」详情链接`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
      } else {
        await visualClickLocator(page, orderCard, `点击订单「${cleanOrderId}」卡片展开详情`);
        await humanDelay(page, ...HUMAN_DELAY.SHORT);
      }

      // 4. 敏感信息脱敏解除交互（如查看真实姓名/手机号或小眼睛图标）
      try {
        const revealBtn = scope.locator(
          '.reveal-name, [data-test="reveal-name"], button:has-text("查看姓名"), [class*="icon-eye"], [class*="eye-open"]'
        ).first();
        if (await isElementVisible(revealBtn, ACTION_TIMEOUT.SENSITIVE_FIELD)) {
          await visualClickLocator(page, revealBtn, '点击查看脱敏信息');
          await humanDelay(page, ...HUMAN_DELAY.SENSITIVE_REVEAL);
        }
      } catch {
        // 容错脱敏解除
      }

      // 5. 权威网络数据捕获与新鲜度优先：
      // 优先顺序：
      // (1) capturedDetail：本次卡片交互/详情展开实时捕获的新鲜网络报文；
      // (2) cachedRaw：若本次点击未触发新网络请求（前端 SPA 直接在内存中展开），回退至最近列表采集的原始报文；
      let rawDetail: Record<string, unknown> | null = capturedDetail;

      if (!rawDetail && options.getCachedOrderRaw) {
        const cached = options.getCachedOrderRaw(cleanOrderId);
        if (cached) {
          rawDetail = extractDouyinOrderFromResponse(cached, cleanOrderId) || cached;
        }
      }

      if (!rawDetail) {
        await assertNoDouyinPageRisk(page);
        throw new DutyExecutionError(
          `抖音订单「${cleanOrderId}」详情网络响应超时或未捕获到原始报文`,
          DouyinDutyErrorCode.ORDER_DETAIL_TIMEOUT,
          true
        );
      }

      let resultDetail = rawDetail;

      // 6. 敏感信息自动解密尝试（对标参考项目：若存在手机号密文则调用官方 decrypt 接口）
      try {
        const guestInfo = (rawDetail.guest_info || {}) as Record<string, unknown>;
        const userList = Array.isArray(guestInfo.user_list) ? guestInfo.user_list : [];
        const firstGuest = (userList[0] || {}) as Record<string, unknown>;
        const currentPhone = String(firstGuest.phone || '').trim();
        const ciphertext = String(
          firstGuest.phone_ciphertext ||
          (guestInfo.buyer as Record<string, unknown> | undefined)?.phone_ciphertext ||
          ''
        ).trim();

        if (ciphertext && (!currentPhone || currentPhone.includes('*')) && typeof page.evaluate === 'function') {
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
              const plain = String(json?.data || json?.decrypted_data || '').trim();
              return /^1\d{10}$/.test(plain) ? plain : null;
            } catch {
              return null;
            }
          }, ciphertext).catch(() => null);

          if (decryptedPhone) {
            // 深拷贝一份副本，杜绝原地修改污染共享缓存
            resultDetail = JSON.parse(JSON.stringify(rawDetail)) as Record<string, unknown>;
            const clonedGuestInfo = (resultDetail.guest_info || {}) as Record<string, unknown>;
            const clonedUserList = Array.isArray(clonedGuestInfo.user_list) ? clonedGuestInfo.user_list : [];
            if (clonedUserList[0]) {
              (clonedUserList[0] as Record<string, unknown>).phone = decryptedPhone;
            }
          }
        }
      } catch {
        // 容错密文解密，Fail-Fast 保证在后续清洗与入单校验中严格把控
      }

      return resultDetail;
    } finally {
      if (typeof offFn === 'function') {
        offFn.call(page, 'response', onResponse);
      } else if (typeof removeListenerFn === 'function') {
        removeListenerFn.call(page, 'response', onResponse);
      }
      await dismissDouyinNoticeModals(page, scope).catch(() => false);
    }
  }
}
