import type { Page, FrameLocator, Locator } from 'playwright';
import {
  ACTION_TIMEOUT,
  HUMAN_DELAY,
  humanDelay,
  getScaledTimeout,
  isElementVisible,
  isProbeVisible,
} from '../../dutyTimingConfig';
import { dismissMeituanNoticeModals } from './meituanModalGuard';

/**
 * 获取美团商户后台订单主区域操作 Scope（兼容顶层主页面与嵌套的 iframe 壳容器）
 */
export function getMeituanOrderScope(page: Page): Page | FrameLocator {
  if (typeof page.url === 'function' && page.url().includes('/ebooking/merchant/ebIframe')) {
    return page.frameLocator('#me-iframe-container');
  }
  return page;
}

/**
 * 在美团商户后台列表中精确定位目标订单卡片
 * 兼容美团真实 DOM 特征（左侧列表卡片不含订单号文本，订单号展示于右侧详情面板中）
 */
export async function locateMeituanOrderCard(
  page: Page,
  scope: Page | FrameLocator,
  otaOrderId: string
): Promise<Locator | null> {
  const cleanOrderId = String(otaOrderId || '').trim();
  if (!cleanOrderId) return null;

  const items = scope.locator(
    '.mtd-list-item.list-item-container, .list-item-container, .list-item-wrap, tr.order-row'
  );
  const count = typeof items.count === 'function' ? await items.count().catch(() => 0) : 0;
  // 列表中有多笔订单：逐个点击候选卡片探查右侧详情是否与目标订单号匹配
  if (count > 0 && typeof items.nth === 'function') {
    await dismissMeituanNoticeModals(page, scope);
    for (let i = 0; i < count; i++) {
      const candidate = items.nth(i);
      if (!await isElementVisible(candidate)) continue;
      await candidate.click({ timeout: getScaledTimeout(ACTION_TIMEOUT.QUICK_ACTION) }).catch(() => {});
      await humanDelay(page, ...HUMAN_DELAY.MEDIUM);

      const matches = await isProbeVisible(
        scope
          .locator(
            `.detail-container:has-text("${cleanOrderId}"), ` +
            `.right-content:has-text("${cleanOrderId}"), ` +
            `.order-detail:has-text("${cleanOrderId}"), ` +
            `.detail-header:has-text("${cleanOrderId}")`
          )
          .first()
      );

      if (matches) {
        return candidate;
      }
    }
  }
  return null;
}
