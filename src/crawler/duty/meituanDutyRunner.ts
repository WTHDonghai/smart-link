import type { Page } from 'playwright';
import { createPersistentBrowserSession, type BrowserSession } from '../browserManager';
import { updateVisualTrackerStatus, visualClickLocator } from '../visualTracker';
import type { DutyClaimedTask } from '../../types';
import type {
  ChannelDutyRunner,
  DutyTaskExecutionResult,
  DutyUnhandledOrderSummary,
  ExtractedOrderDetail,
  RawMeituanDutyOrder,
} from './dutyContracts';
import { getMeituanOrderUrl } from '../../config/otaUrls';
import { dispatchDutyTask } from './dutyTaskDispatcher';

export function getDefaultMeituanOrderUrl(): string {
  return getMeituanOrderUrl();
}

/**
 * 从美团订单列表 API 报文中解析出待处理订单概要列表（纯纯函数，绝无假数据兜底）
 */
export function extractMeituanOrdersFromPayload(payload: unknown): RawMeituanDutyOrder[] {
  if (!payload || typeof payload !== 'object') return [];

  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  const rawList: unknown[] =
    Array.isArray(data.list) ? data.list :
    Array.isArray(data.orders) ? data.orders :
    Array.isArray(data.orderList) ? data.orderList :
    Array.isArray(data.items) ? data.items :
    Array.isArray(root.orders) ? root.orders :
    Array.isArray(root.list) ? root.list :
    Array.isArray(payload) ? payload : [];

  const orders: RawMeituanDutyOrder[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const orderId = String(rec.orderId || rec.orderID || rec.otaOrderId || rec.orderNo || '').trim();
    if (!orderId) continue;

    const checkInDate = String(rec.checkInDateString || rec.checkInDate || rec.arrival || '').slice(0, 10);
    const checkOutDate = String(rec.checkOutDateString || rec.checkOutDate || rec.departure || '').slice(0, 10);

    let nights = Number(rec.nights || rec.nightCount || 0);
    if (!nights && checkInDate && checkOutDate) {
      const diff = Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / 86400000);
      nights = diff > 0 ? diff : 1;
    }
    if (!nights) nights = 1;

    const rawTotal = Number(rec.totalFee ?? rec.price ?? rec.totalPrice ?? 0);
    const totalAmount = rec.totalFee != null || rawTotal > 1000 ? rawTotal / 100 : rawTotal;

    const contacts: Array<{ name: string; phone: string }> = [];
    const rawContacts = Array.isArray(rec.contacts) ? rec.contacts : Array.isArray(rec.guests) ? rec.guests : [];
    for (const c of rawContacts) {
      if (c && typeof c === 'object') {
        const cRec = c as Record<string, unknown>;
        contacts.push({
          name: String(cRec.name || '').trim(),
          phone: String(cRec.phone || cRec.mobile || '').trim(),
        });
      }
    }
    if (contacts.length === 0 && (rec.guestName || rec.guestMobile)) {
      contacts.push({
        name: String(rec.guestName || '').trim(),
        phone: String(rec.guestMobile || '').trim(),
      });
    }

    orders.push({
      orderId,
      hotelId: String(rec.poiId || rec.hotelId || '').trim() || undefined,
      hotelName: String(rec.poiName || rec.hotelName || '').trim() || undefined,
      orderDisplayLabel: String(rec.orderDisplayLabel || rec.statusText || rec.status || '新订').trim(),
      orderTime: String(rec.aptCreatTimeString || rec.orderTime || '').trim() || undefined,
      roomName: String(rec.roomName || rec.roomTypeName || '').trim(),
      ratePlanName: String(rec.ratePlanName || rec.rateCode || '').trim(),
      checkInDate,
      checkOutDate,
      nights,
      quantity: Number(rec.roomCount || rec.quantity || 1),
      totalAmount,
      contacts,
      cancelOrder: Boolean(rec.cancelOrder || rec.status === 'CANCEL'),
      raw: rec,
    });
  }

  return orders;
}

/**
 * 从美团订单详情响应报文中解析出高精度结构化字段（绝不兜底假数据）
 */
export function extractMeituanOrderDetailFromPayload(
  payload: unknown,
  targetOrderId?: string
): Partial<ExtractedOrderDetail> | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  const orderId = String(
    data.orderId || data.orderID || data.otaOrderId || data.orderNo || root.orderId || ''
  ).trim();

  if (targetOrderId && orderId && orderId !== targetOrderId) {
    return null;
  }

  const checkInDate = String(data.checkInDateString || data.checkInDate || data.arrival || '').slice(0, 10);
  const checkOutDate = String(data.checkOutDateString || data.checkOutDate || data.departure || '').slice(0, 10);

  let nights = Number(data.nights || data.nightCount || 0);
  if (!nights && checkInDate && checkOutDate) {
    const diff = Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / 86400000);
    nights = diff > 0 ? diff : 1;
  }

  const rawTotal = Number(data.totalFee ?? data.price ?? data.totalPrice ?? 0);
  const totalPrice = data.totalFee != null || rawTotal > 1000 ? rawTotal / 100 : rawTotal;

  let guestName = '';
  let guestMobile = '';
  const rawContacts = Array.isArray(data.contacts) ? data.contacts : Array.isArray(data.guests) ? data.guests : [];
  if (rawContacts.length > 0 && rawContacts[0] && typeof rawContacts[0] === 'object') {
    const c = rawContacts[0] as Record<string, unknown>;
    guestName = String(c.name || '').trim();
    guestMobile = String(c.phone || c.mobile || '').trim();
  }
  if (!guestName && (data.guestName || data.customerName || data.contactName)) {
    guestName = String(data.guestName || data.customerName || data.contactName || '').trim();
  }
  if (!guestMobile && (data.guestMobile || data.customerMobile || data.contactPhone)) {
    guestMobile = String(data.guestMobile || data.customerMobile || data.contactPhone || '').trim();
  }

  const roomTypeName = String(data.roomName || data.roomTypeName || data.roomTitle || '').trim();
  const ratePlanName = String(data.ratePlanName || data.rateCode || data.productName || '').trim();
  const quantity = Number(data.roomCount || data.quantity || 1);
  const unitId = String(data.poiId || data.hotelId || '').trim() || undefined;
  const unitName = String(data.poiName || data.hotelName || '').trim() || undefined;

  return {
    otaOrderId: orderId || targetOrderId,
    otaChannel: 'MEITUAN',
    unitId,
    unitName,
    guestName,
    guestMobile,
    roomTypeName,
    ratePlanName,
    arrival: checkInDate,
    departure: checkOutDate,
    nights,
    quantity,
    totalPrice,
    raw: data,
  };
}

export class MeituanDutyRunner implements ChannelDutyRunner {
  public readonly channelCode = 'MEITUAN';
  private session: BrowserSession | null = null;
  private running = false;
  private explicitTargetUrl?: string;

  constructor(targetUrl?: string) {
    if (targetUrl && targetUrl.trim()) {
      this.explicitTargetUrl = targetUrl.trim();
    }
  }

  public get targetUrl(): string {
    return this.explicitTargetUrl || getMeituanOrderUrl();
  }

  public isRunning(): boolean {
    return this.running;
  }

  public async start(): Promise<void> {
    if (this.running) return;

    this.session = await createPersistentBrowserSession({
      channelCode: this.channelCode,
      headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
    });

    const page = this.session.page;

    // 页面导航与登录态嗅探（无长效缓存拦截器，彻底杜绝内存驻留）
    await updateVisualTrackerStatus(page, '🤖 正在导航至美团商家后台待处理订单页面...', 'action');
    await page.goto(this.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try {
      await page.bringToFront();
    } catch {
      // 忽略前置失败
    }

    this.running = true;

    const currentUrl = page.url();
    if (currentUrl.includes('passport.meituan.com') || currentUrl.includes('/login') || currentUrl.includes('/auth')) {
      await updateVisualTrackerStatus(page, '⚠️ 美团账号尚未登录，请在当前窗口中扫码登录...', 'warn');
      void (async () => {
        try {
          await page.waitForURL(
            (u) => !u.href.includes('passport.meituan.com') && !u.href.includes('/login') && !u.href.includes('/auth'),
            { timeout: 300000 }
          );
          await updateVisualTrackerStatus(page, '🛡️ 美团账号已成功登录，正在长效监听订单流...', 'success');
        } catch {
          // 超时由后续刷新处理
        }
      })();
    } else {
      await updateVisualTrackerStatus(page, '🛡️ 美团订单值守已激活，正在长效监听订单流...', 'success');
    }
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        // 忽略关闭异常
      }
      this.session = null;
    }
  }

  public async refreshOrderList(page: Page): Promise<void> {
    try {
      const refreshBtn = page.locator('button:has-text("刷新"), .refresh-btn, [data-test="refresh"]').first();
      if (await refreshBtn.isVisible({ timeout: 2000 })) {
        await visualClickLocator(page, refreshBtn, '刷新美团待处理订单');
        await page.waitForTimeout(1500);
        return;
      }
    } catch {
      // 若无局部刷新按钮，执行页面轻量重载
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }

  /**
   * 页面操作：刷新美团待处理列表并即时返回待处理订单概要（无本地状态缓存）
   */
  public async collectUnhandledOrders(): Promise<DutyUnhandledOrderSummary[]> {
    if (!this.running || !this.session) {
      throw new Error('美团值守执行器未运行，无法采集待处理订单');
    }

    const page = this.session.page;
    await updateVisualTrackerStatus(page, '📥 正在执行订单采集任务，刷新待处理列表...', 'action');

    // 在单次触发刷新动作时，挂载本次专属的订单列表响应监听
    const listResponsePromise = typeof page.waitForResponse === 'function'
      ? page
          .waitForResponse(
            (res) => {
              const url = res.url();
              return (
                (url.includes('/orders/task/list') ||
                  url.includes('/orders/list') ||
                  url.includes('/orders/unhandled') ||
                  url.includes('/api/mock/orders') ||
                  url.includes('/api/v1/ebooking/orders')) &&
                res.status() === 200
              );
            },
            { timeout: 3000 }
          )
          .then(async (res) => {
            try {
              const text = await res.text();
              const parsed = JSON.parse(text);
              return extractMeituanOrdersFromPayload(parsed).map((o) => ({
                orderId: o.orderId,
                hotelId: o.hotelId,
                hotelName: o.hotelName,
                cancelOrder: o.cancelOrder,
                orderDisplayLabel: o.orderDisplayLabel,
              }));
            } catch {
              return [] as DutyUnhandledOrderSummary[];
            }
          })
          .catch(() => [] as DutyUnhandledOrderSummary[])
      : Promise.resolve([] as DutyUnhandledOrderSummary[]);

    // 触发刷新
    await this.refreshOrderList(page);

    // 优先读取本次刷新对应的网络响应
    const networkOrders = await listResponsePromise;
    if (networkOrders.length > 0) {
      return networkOrders;
    }

    // 若无网络响应，直接从当前页面 DOM 订单表格中即时提取待处理订单
    const domOrders = await page
      .evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr, .order-list-item, .order-item, [data-order-id]');
        const items: Array<{
          orderId: string;
          hotelId?: string;
          hotelName?: string;
          cancelOrder?: boolean;
          orderDisplayLabel?: string;
        }> = [];

        rows.forEach((row) => {
          const orderIdEl = row.querySelector('[data-field="orderId"], .order-id, .order-no, .order-number');
          let orderId = orderIdEl?.textContent?.trim() || row.getAttribute('data-order-id') || '';
          if (!orderId) {
            const text = row.textContent || '';
            const match = text.match(/(MT[-_A-Za-z0-9]+|\d{10,24})/);
            if (match) orderId = match[0];
          }
          if (!orderId) return;

          const rowText = row.textContent || '';
          const isCancel = rowText.includes('取消') || rowText.includes('退订') || rowText.includes('已退');
          const statusEl = row.querySelector('[data-field="status"], .status-tag, .order-status, .badge');
          const orderDisplayLabel = statusEl?.textContent?.trim() || (isCancel ? '已取消' : '待处理');

          const hotelEl = row.querySelector('[data-field="hotelName"], .hotel-name, .poi-name');
          const hotelName = hotelEl?.textContent?.trim() || undefined;

          items.push({
            orderId,
            hotelName,
            cancelOrder: isCancel,
            orderDisplayLabel,
          });
        });

        return items;
      })
      .catch(() => []);

    return domOrders;
  }

  /**
   * 页面操作：在美团后台页面点击查看订单详情，即时从详情视图或本次点击响应中抓取真实字段
   * 遵循 Fail-Fast 原则：绝无本地缓存读取，绝无假数据兜底！
   */
  public async inspectOrderDetail(otaOrderId: string): Promise<ExtractedOrderDetail> {
    if (!this.running || !this.session) {
      throw new Error('美团值守执行器未运行，无法查看订单详情');
    }

    const page = this.session.page;
    await updateVisualTrackerStatus(page, `🔍 正在查看美团订单「${otaOrderId}」详情...`, 'action');

    // 1. 优先使用搜索框定位目标订单
    try {
      const searchInput = page.locator(
        'input[placeholder*="订单"], input[placeholder*="单号"], input.order-search-input, [data-test="order-search"]'
      ).first();
      if (await searchInput.isVisible({ timeout: 1000 })) {
        await searchInput.fill(otaOrderId);
        const searchBtn = page.locator('button:has-text("查询"), button:has-text("搜索")').first();
        if (await searchBtn.isVisible({ timeout: 1000 })) {
          await visualClickLocator(page, searchBtn, '查询订单');
          await page.waitForTimeout(800);
        }
      }
    } catch {
      // 容错搜索交互
    }

    // 2. 挂载本次点击详情动作专属的单次网络响应监听
    const detailResponsePromise = typeof page.waitForResponse === 'function'
      ? page
          .waitForResponse(
            (res) => {
              const url = res.url();
              return (
                (url.includes('/detail') || url.includes('/orders/detail') || url.includes('/ebooking/order/')) &&
                res.status() === 200
              );
            },
            { timeout: 3000 }
          )
          .then(async (res) => {
            try {
              const text = await res.text();
              const parsed = JSON.parse(text);
              return extractMeituanOrderDetailFromPayload(parsed, otaOrderId);
            } catch {
              return null;
            }
          })
          .catch(() => null)
      : Promise.resolve(null);

    // 3. 定位包含订单号的列表行并点击“详情 / 查看”按钮
    let clicked = false;
    try {
      const orderRow = page.locator(
        `tr:has-text("${otaOrderId}"), .order-item:has-text("${otaOrderId}"), [data-order-id="${otaOrderId}"]`
      ).first();
      if (await orderRow.isVisible({ timeout: 1500 })) {
        const detailBtn = orderRow.locator(
          'button:has-text("详情"), a:has-text("详情"), button:has-text("查看"), a:has-text("查看"), .detail-btn, [data-test="order-detail"]'
        ).first();
        if (await detailBtn.isVisible({ timeout: 1200 })) {
          await visualClickLocator(page, detailBtn, `点击订单「${otaOrderId}」详情`);
          clicked = true;
        }
      }
    } catch {
      // 容错定位
    }

    if (!clicked) {
      try {
        const directBtn = page.locator(`[data-order-id="${otaOrderId}"] .detail-btn, button[data-order-id="${otaOrderId}"]`).first();
        if (await directBtn.isVisible({ timeout: 1000 })) {
          await visualClickLocator(page, directBtn, `点击订单「${otaOrderId}」详情`);
          clicked = true;
        }
      } catch {
        // 容错
      }
    }

    // 4. 等待详情弹窗 / 抽屉可见并从中解析提取字段
    await page.waitForTimeout(600);
    const detailModal = page.locator(
      '.order-detail-modal, .ant-modal, .el-dialog, [role="dialog"], .order-detail-drawer, .order-detail-container, .modal-content'
    ).first();

    await detailModal.isVisible({ timeout: 2000 }).catch(() => false);

    // 从页面 DOM 元素中提取真实字段
    const domExtracted = await page.evaluate(() => {
      const modalEl = document.querySelector(
        '.order-detail-modal, .ant-modal, .el-dialog, [role="dialog"], .order-detail-drawer, .order-detail-container, .modal-content'
      );
      const rootEl = modalEl || document.body;

      const findTextAfterLabel = (keywords: string[]): string => {
        const allTextNodes: string[] = [];
        const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const val = node.nodeValue?.trim();
          if (val) allTextNodes.push(val);
        }

        for (let i = 0; i < allTextNodes.length; i++) {
          const t = allTextNodes[i];
          for (const kw of keywords) {
            if (t.includes(kw)) {
              const colonIdx = t.indexOf('：') !== -1 ? t.indexOf('：') : t.indexOf(':');
              if (colonIdx !== -1 && colonIdx < t.length - 1) {
                const sub = t.slice(colonIdx + 1).trim();
                if (sub) return sub;
              }
              if (i + 1 < allTextNodes.length) {
                const nextVal = allTextNodes[i + 1].trim();
                if (nextVal && !keywords.some((k) => nextVal.includes(k))) {
                  return nextVal;
                }
              }
            }
          }
        }
        return '';
      };

      // 提取入住人
      let guestName = '';
      const guestEl = rootEl.querySelector('[data-field="guestName"], .guest-name, .contact-name, .customer-name');
      if (guestEl && guestEl.textContent?.trim()) {
        guestName = guestEl.textContent.trim();
      } else {
        guestName = findTextAfterLabel(['入住人', '客人姓名', '顾客姓名', '联系人']);
      }

      // 提取手机号
      let guestMobile = '';
      const mobileEl = rootEl.querySelector('[data-field="guestMobile"], .guest-phone, .contact-phone, .customer-mobile');
      if (mobileEl && mobileEl.textContent?.trim()) {
        guestMobile = mobileEl.textContent.trim();
      } else {
        const rawMobile = findTextAfterLabel(['手机号', '联系电话', '客人电话']);
        const match = rawMobile.match(/1[3-9]\d{9}/);
        if (match) guestMobile = match[0];
      }

      // 提取房型
      let roomTypeName = '';
      const roomEl = rootEl.querySelector('[data-field="roomTypeName"], .room-type-name, .room-name');
      if (roomEl && roomEl.textContent?.trim()) {
        roomTypeName = roomEl.textContent.trim();
      } else {
        roomTypeName = findTextAfterLabel(['预订房型', '房型名称', '房型']);
      }

      // 提取产品名称
      let ratePlanName = '';
      const rateEl = rootEl.querySelector('[data-field="ratePlanName"], .rate-plan-name, .product-name');
      if (rateEl && rateEl.textContent?.trim()) {
        ratePlanName = rateEl.textContent.trim();
      } else {
        ratePlanName = findTextAfterLabel(['产品名称', '价格政策', '价格方案']);
      }

      // 提取入离日期并格式化补零
      const normalizeDateString = (raw: string): string => {
        const cleaned = raw.replace(/[年月]/g, '-').replace(/日/g, '').trim();
        const parts = cleaned.split('-');
        if (parts.length === 3) {
          const y = parts[0];
          const m = parts[1].padStart(2, '0');
          const d = parts[2].padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        return cleaned.slice(0, 10);
      };

      let arrival = '';
      let departure = '';
      const arrivalEl = rootEl.querySelector('[data-field="arrival"], .check-in-date, .arrival-date');
      const departureEl = rootEl.querySelector('[data-field="departure"], .check-out-date, .departure-date');
      if (arrivalEl && arrivalEl.textContent?.trim()) {
        arrival = normalizeDateString(arrivalEl.textContent.trim());
      }
      if (departureEl && departureEl.textContent?.trim()) {
        departure = normalizeDateString(departureEl.textContent.trim());
      }
      if (!arrival || !departure) {
        const dateText = findTextAfterLabel(['入离日期', '入住离店', '入住日期', '预订日期']);
        const dateMatches = dateText.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/g);
        if (dateMatches && dateMatches.length >= 2) {
          arrival = normalizeDateString(dateMatches[0]);
          departure = normalizeDateString(dateMatches[1]);
        }
      }

      // 提取金额
      let totalPrice = 0;
      const priceEl = rootEl.querySelector('[data-field="totalPrice"], .total-price, .total-amount, .order-price');
      if (priceEl && priceEl.textContent?.trim()) {
        const num = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) totalPrice = num;
      } else {
        const priceText = findTextAfterLabel(['总金额', '订单总价', '结算金额', '总价']);
        const num = parseFloat(priceText.replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) totalPrice = num;
      }

      // 提取间数
      let quantity = 1;
      const qtyEl = rootEl.querySelector('[data-field="quantity"], .room-count, .room-quantity');
      if (qtyEl && qtyEl.textContent?.trim()) {
        const q = parseInt(qtyEl.textContent.replace(/\D/g, ''), 10);
        if (q > 0) quantity = q;
      }

      const hotelEl = rootEl.querySelector('[data-field="hotelName"], .hotel-name, .poi-name');
      const hotelName = hotelEl?.textContent?.trim() || '';

      return {
        guestName,
        guestMobile,
        roomTypeName,
        ratePlanName,
        arrival,
        departure,
        totalPrice,
        quantity,
        hotelName,
      };
    }).catch(() => null);

    // 5. 等待并融合本次点击操作拦截到的真实详情网络报文
    const networkDetail = await detailResponsePromise;

    const guestName = (networkDetail?.guestName || domExtracted?.guestName || '').trim();
    const guestMobile = (networkDetail?.guestMobile || domExtracted?.guestMobile || '').trim();
    const roomTypeName = (networkDetail?.roomTypeName || domExtracted?.roomTypeName || '').trim();
    const ratePlanName = (networkDetail?.ratePlanName || domExtracted?.ratePlanName || '').trim();
    const arrival = (networkDetail?.arrival || domExtracted?.arrival || '').trim();
    const departure = (networkDetail?.departure || domExtracted?.departure || '').trim();
    const quantity = networkDetail?.quantity || domExtracted?.quantity || 1;
    const totalPrice = networkDetail?.totalPrice ?? domExtracted?.totalPrice ?? 0;
    const unitId = networkDetail?.unitId;
    const unitName = (networkDetail?.unitName || domExtracted?.hotelName || '').trim() || undefined;

    let nights = networkDetail?.nights || 0;
    if (!nights && arrival && departure) {
      const diff = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86400000);
      nights = diff > 0 ? diff : 1;
    }
    if (!nights) nights = 1;

    // 6. Fail-Fast 严格校验：确保关键字段非空，绝不兜底任何假数据
    const missingFields: string[] = [];
    if (!guestName) missingFields.push('guestName(入住人)');
    if (!roomTypeName) missingFields.push('roomTypeName(房型)');
    if (!arrival) missingFields.push('arrival(入住日期)');
    if (!departure) missingFields.push('departure(离店日期)');

    if (missingFields.length > 0) {
      throw new Error(
        `美团订单「${otaOrderId}」详情提取失败：页面及接口均未获取到关键字段 (${missingFields.join(', ')})`
      );
    }

    return {
      otaOrderId,
      otaChannel: this.channelCode,
      unitId,
      unitName,
      guestName,
      guestMobile,
      roomTypeName,
      ratePlanName,
      arrival,
      departure,
      nights,
      quantity,
      totalPrice,
      raw: (networkDetail?.raw as Record<string, unknown>) || undefined,
    };
  }

  /**
   * 页面操作：关闭订单详情弹窗或抽屉，使页面恢复就绪状态
   */
  public async closeOrderDetail(): Promise<void> {
    if (!this.session) return;
    const page = this.session.page;
    try {
      const closeBtn = page.locator(
        'button:has-text("关闭"), .ant-modal-close, .el-dialog__close, [aria-label="Close"], button.close, .detail-close-btn'
      ).first();
      if (await closeBtn.isVisible({ timeout: 1500 })) {
        await visualClickLocator(page, closeBtn, '关闭美团订单详情');
        await page.waitForTimeout(500);
      }
    } catch {
      // 容错关闭动作
    }
  }

  /**
   * 页面操作：在美团后台回填确认号
   */
  public async confirmImport(confirmNo: string, otaOrderId: string): Promise<void> {
    if (!this.running || !this.session) {
      throw new Error('美团值守执行器未运行，无法回填确认号');
    }

    const page = this.session.page;
    await updateVisualTrackerStatus(page, `📝 确认号回填「${confirmNo}」(单号: ${otaOrderId})...`, 'action');

    try {
      const orderRow = page.locator(`tr:has-text("${otaOrderId}"), .order-item:has-text("${otaOrderId}")`).first();
      const scope = (await orderRow.isVisible({ timeout: 1000 })) ? orderRow : page;

      const input = scope.locator(
        'input[name="confirmNo"], input[placeholder*="确认号"], [data-test="confirm-no-input"]'
      ).first();
      if (await input.isVisible({ timeout: 2000 })) {
        await input.fill(confirmNo);
        const submitBtn = scope.locator('button:has-text("提交确认"), button:has-text("确认接单"), button:has-text("保存")').first();
        if (await submitBtn.isVisible({ timeout: 1500 })) {
          await visualClickLocator(page, submitBtn, '提交确认号');
        }
      }
    } catch {
      // 容错回填交互
    }
  }

  /**
   * 页面操作：在美团后台确认取消（我已知晓）
   */
  public async confirmCancel(otaOrderId: string): Promise<void> {
    if (!this.running || !this.session) {
      throw new Error('美团值守执行器未运行，无法确认取消');
    }

    const page = this.session.page;
    await updateVisualTrackerStatus(page, `🛑 在美团后台确认取消订单「${otaOrderId}」（我已知晓）...`, 'action');
    try {
      const ackBtn = page.locator('button:has-text("我已知晓")').first();
      if (await ackBtn.isVisible({ timeout: 2000 })) {
        await visualClickLocator(page, ackBtn, '点击我已知晓');
      }
    } catch {
      // 容错已确认状态
    }
  }

  /**
   * 统一任务执行入口：将任务委托给顶层通用任务编排调度器 dispatchDutyTask
   */
  public async executeTask(task: DutyClaimedTask): Promise<DutyTaskExecutionResult> {
    return dispatchDutyTask(task, this);
  }
}
