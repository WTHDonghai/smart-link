import type { Page, FrameLocator, Locator } from 'playwright';
import {
  ACTION_TIMEOUT,
  getScaledTimeout,
  isElementVisible,
} from '../../dutyTimingConfig';
import { dismissDouyinNoticeModals } from './douyinModalGuard';

/**
 * 抖音商户后台订单主区域操作 Scope
 * 抖音履约工作台 (fulfillment-workbench) 运行于顶层 SPA，直接使用主页面操作
 */
export function getDouyinOrderScope(page: Page): Page | FrameLocator {
  return page;
}

/**
 * 抖音订单卡片唯一确定性选择器生成器
 * 生产环境真实 DOM 验证依据：
 * 1. 抖音商户后台订单卡片根节点为自定义组件 `.hotel-book-list-order-card`；
 * 2. 订单号（预约单号 book_order_id）仅存在于 `data-form-insight-meta` 埋点属性与无障碍属性 `aria-label` 中；
 * 3. 卡片内文本（innerText）未渲染订单号，严禁使用任何脆弱或臆造的 :has-text() / table-row 猜测选择器。
 */
export function buildDouyinOrderCardSelector(cleanOrderId: string): string {
  return (
    `.hotel-book-list-order-card[data-form-insight-meta="${cleanOrderId}"], ` +
    `.hotel-book-list-order-card[aria-label="${cleanOrderId}"], ` +
    `[data-form-insight-meta="${cleanOrderId}"]`
  );
}

/**
 * 在抖音商户后台列表中精确定位目标订单卡片
 * 遵循确定性与反过度设计准则，仅使用经生产环境验证的确切 DOM 属性
 */
export async function locateDouyinOrderCard(
  page: Page,
  scope: Page | FrameLocator,
  otaOrderId: string
): Promise<Locator | null> {
  const cleanOrderId = String(otaOrderId || '').trim();
  if (!cleanOrderId) return null;

  // 清理可能阻挡的提示弹窗
  await dismissDouyinNoticeModals(page, scope);

  const cardSelector = buildDouyinOrderCardSelector(cleanOrderId);
  const card = scope.locator(cardSelector).first();

  if (await isElementVisible(card, ACTION_TIMEOUT.QUICK_ACTION)) {
    try {
      if (typeof card.scrollIntoViewIfNeeded === 'function') {
        await card.scrollIntoViewIfNeeded({ timeout: getScaledTimeout(ACTION_TIMEOUT.PROBE) });
      }
    } catch {
      // 容错滚动
    }
    return card;
  }

  return null;
}
