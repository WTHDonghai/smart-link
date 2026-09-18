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
 * 高鲁棒性日期格式化函数（纯函数，支持各种日期字符串、短日期与时间戳毫秒数）
 */
export function fmtDate(value: unknown): string {
  if (value == null || value === '') return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';

    // 1. 标准年月日：2026-09-17, 2026/09/17, 2026.09.17, 2026年09月17日
    const fullMatch = trimmed.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/);
    if (fullMatch) {
      const y = fullMatch[1];
      const m = fullMatch[2].padStart(2, '0');
      const d = fullMatch[3].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    // 2. 紧凑年月日：20260917
    const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactMatch) {
      return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
    }

    // 3. 无年份短日期：09-17, 09/17, 09.17, 09月17日 -> 自动补充当前年份
    const shortMatch = trimmed.match(/^(\d{1,2})[-/.月](\d{1,2})(?:日)?/);
    if (shortMatch) {
      const currentYear = new Date().getFullYear();
      const m = shortMatch[1].padStart(2, '0');
      const d = shortMatch[2].padStart(2, '0');
      return `${currentYear}-${m}-${d}`;
    }

    // 4. 若为纯数字字符串，按时间戳解析
    if (/^\d{10,13}$/.test(trimmed)) {
      const numeric = Number(trimmed);
      const date = new Date(numeric < 10000000000 ? numeric * 1000 : numeric);
      if (!Number.isNaN(date.getTime())) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
  }

  // 5. 数值时间戳（秒或毫秒）
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const date = new Date(value < 10000000000 ? value * 1000 : value);
    if (!Number.isNaN(date.getTime())) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  return '';
}

/**
 * 判断 URL 是否属于美团待处理订单列表接口（如 /orders/task/list, /orders/list 等）
 */
export function isMeituanListUrl(url: string): boolean {
  const norm = String(url || '');
  if (norm.includes('/orders/sensitiveData') || norm.includes('/confirmPhone')) {
    return false;
  }
  return (
    norm.includes('/orders/task/list') ||
    norm.includes('/orders/list') ||
    norm.includes('/orders/unhandled') ||
    norm.includes('/api/mock/orders') ||
    (norm.includes('/api/v1/ebooking/orders') &&
      (norm.includes('/task/list') || norm.includes('/list') || norm.includes('scenario=')))
  );
}

/**
 * 判断 URL 是否属于美团订单详情接口
 */
export function isMeituanDetailUrl(url: string, targetOrderId?: string): boolean {
  const norm = String(url || '');
  if (norm.includes('/task/list') || norm.includes('/sensitiveData') || norm.includes('/confirmPhone')) {
    return false;
  }
  if (targetOrderId && (norm.includes(`/orders/${targetOrderId}`) || norm.includes(`orderId=${targetOrderId}`))) {
    return true;
  }
  return (
    norm.includes('/api/v1/ebooking/orders/') ||
    norm.includes('/orders/detail') ||
    norm.includes('/ebooking/orders/') ||
    norm.includes('/ebooking/order/') ||
    norm.includes('/detail') ||
    norm.includes('/api/mock/orders')
  );
}

/**
 * 判断 URL 是否属于美团敏感数据解密接口（如查看姓名、电话）
 */
export function isMeituanSensitiveUrl(url: string): boolean {
  const norm = String(url || '');
  return norm.includes('/sensitiveData') || norm.includes('/confirmPhone');
}

/**
 * 检测文本是否命中美团安全验证/滑块/人机风控特征（纯纯函数）
 */
export function isMeituanRiskControlText(text: string): boolean {
  if (!text) return false;
  return /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|yoda|captcha/i.test(text);
}

/**
 * 快速嗅探当前页面是否处于美团安全验证/滑块拦截态
 */
export async function checkMeituanPageRisk(page: Page): Promise<boolean> {
  if (!page || typeof page.evaluate !== 'function') return false;
  try {
    const risk = await page.evaluate(() => {
      // 1. 检查 DOM 中是否挂载了人机/滑块/安全验证跨域 iframe 或容器（双保险）
      const hasCaptchaEl = Boolean(
        document.querySelector(
          'iframe[src*="captcha"], iframe[src*="verify"], iframe[src*="yoda"], #yodaBox, .yoda-captcha, [data-test="captcha"]'
        )
      );
      if (hasCaptchaEl) return true;

      // 2. 嗅探页面主体、标题与 URL 文本是否包含风控关键词
      const norm = (str: string | null | undefined) => String(str || '').replace(/\s+/g, ' ').trim();
      const bodyText = norm(document.body ? document.body.innerText || document.body.textContent : '');
      const title = norm(document.title);
      const url = String(window.location.href || '');
      const combined = `${title}\n${url}\n${bodyText.slice(0, 2000)}`;
      return /安全验证|登录验证|验证码|滑块|人机|访问频繁|操作频繁|稍后再试|yoda|captcha/i.test(combined);
    });
    return risk === true;
  } catch {
    return false;
  }
}

/**
 * 拟真人随机微延迟函数，打破机械等长时钟
 */
export async function humanDelay(page: Page, minMs = 500, maxMs = 900): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  if (page && typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(delay);
  } else {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * 从美团敏感数据解密接口（/sensitiveData/ 或 /confirmPhone）响应报文中解析真实客人姓名与手机号
 */
export function extractMeituanSensitiveDataFromPayload(
  payload: unknown
): { guestName?: string; guestMobile?: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  let guestName = '';
  let guestMobile = '';

  const isPlainName = (name: string): boolean => {
    const t = name.trim();
    if (!t || t.includes('*')) return false;
    return !/^(查看姓名|获取姓名|显示姓名|解密|未知|无|暂无|点击查看|联系客人|平台保护|隐私保护)$/.test(t);
  };

  const isPlainPhone = (phone: string): boolean => {
    const t = phone.trim();
    if (!t || t.includes('*')) return false;
    return /^1[3-9]\d{9}(#\d{1,8})?$/.test(t);
  };

  // 1. 尝试从 sensitiveDataList 中提取
  const rawLists: unknown[] = [];
  if (Array.isArray(data.sensitiveDataList)) rawLists.push(...data.sensitiveDataList);
  if (data.data && typeof data.data === 'object') {
    const nestedData = data.data as Record<string, unknown>;
    if (Array.isArray(nestedData.sensitiveDataList)) rawLists.push(...nestedData.sensitiveDataList);
  }
  if (Array.isArray(root.sensitiveDataList)) rawLists.push(...root.sensitiveDataList);

  for (const item of rawLists) {
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const infos = Array.isArray(rec.guestInfos) ? rec.guestInfos : [];
      for (const info of infos) {
        if (info && typeof info === 'object') {
          const g = info as Record<string, unknown>;
          const n = String(g.name || '').trim();
          const p = String(g.phone || g.mobile || '').trim();
          if (n && isPlainName(n) && !guestName) guestName = n;
          if (p && isPlainPhone(p) && !guestMobile) guestMobile = p;
        }
      }
    }
  }

  // 2. 尝试从 confirmPhone 或顶层直接属性提取
  const directPhone = String(data.phone || data.mobile || root.phone || root.mobile || '').trim();
  if (directPhone && isPlainPhone(directPhone) && !guestMobile) {
    guestMobile = directPhone;
  }

  const directName = String(data.name || data.guestName || root.name || root.guestName || '').trim();
  if (directName && isPlainName(directName) && !guestName) {
    guestName = directName;
  }

  if (!guestName && !guestMobile) return null;
  return {
    guestName: guestName || undefined,
    guestMobile: guestMobile || undefined,
  };
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

    const checkInDate = fmtDate(rec.checkInDateString || rec.checkInDate || rec.arrival);
    const checkOutDate = fmtDate(rec.checkOutDateString || rec.checkOutDate || rec.departure);

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
 * 兼容多层嵌套结构（如 data.orderDetail、data.order、data）、时间戳日期与间夜价格明细
 */
export function extractMeituanOrderDetailFromPayload(
  payload: unknown,
  targetOrderId?: string
): Partial<ExtractedOrderDetail> | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  // 解构核心详情对象（可能位于 data.orderDetail 或 data.order 或顶层 data）
  const orderObj = (
    (data.orderDetail && typeof data.orderDetail === 'object' ? data.orderDetail : null) ||
    (data.order && typeof data.order === 'object' ? data.order : null) ||
    (root.orderDetail && typeof root.orderDetail === 'object' ? root.orderDetail : null) ||
    data
  ) as Record<string, unknown>;

  const orderId = String(
    orderObj.orderId ||
      orderObj.orderID ||
      orderObj.otaOrderId ||
      orderObj.orderNo ||
      data.orderId ||
      data.orderID ||
      data.otaOrderId ||
      root.orderId ||
      ''
  ).trim();

  if (targetOrderId && orderId && orderId !== targetOrderId) {
    return null;
  }

  // 解析入住与离店日期（优先取入离日期字段，再取时间戳或通用别名，最后从 roomNightPriceModels 提取）
  let checkInDate = fmtDate(
    orderObj.checkInDateString ||
      orderObj.checkInDate ||
      orderObj.arrival ||
      orderObj.inDate ||
      orderObj.startDate ||
      orderObj.bizDay ||
      data.checkInDateString ||
      data.checkInDate ||
      data.arrival
  );

  let checkOutDate = fmtDate(
    orderObj.checkOutDateString ||
      orderObj.checkOutDate ||
      orderObj.departure ||
      orderObj.outDate ||
      orderObj.endDate ||
      data.checkOutDateString ||
      data.checkOutDate ||
      data.departure
  );

  // 若顶层未直接提供入住/离店日期，尝试从间夜价格明细中推导
  if (!checkInDate || !checkOutDate) {
    const priceList = Array.isArray(orderObj.roomNightPriceModels)
      ? orderObj.roomNightPriceModels
      : Array.isArray(orderObj.priceInfoConstitute)
      ? orderObj.priceInfoConstitute
      : Array.isArray(orderObj.priceInfo)
      ? orderObj.priceInfo
      : Array.isArray(data.roomNightPriceModels)
      ? data.roomNightPriceModels
      : [];

    if (priceList.length > 0) {
      const dates: string[] = [];
      for (const item of priceList) {
        if (item && typeof item === 'object') {
          const itemRec = item as Record<string, unknown>;
          const d = fmtDate(itemRec.dateStr || itemRec.dateString || itemRec.bizDay || itemRec.date);
          if (d && !dates.includes(d)) dates.push(d);
        }
      }
      dates.sort();
      if (dates.length > 0) {
        if (!checkInDate) checkInDate = dates[0];
        if (!checkOutDate) {
          const lastDate = new Date(dates[dates.length - 1]);
          if (!Number.isNaN(lastDate.getTime())) {
            lastDate.setDate(lastDate.getDate() + 1);
            const y = lastDate.getFullYear();
            const m = String(lastDate.getMonth() + 1).padStart(2, '0');
            const d = String(lastDate.getDate()).padStart(2, '0');
            checkOutDate = `${y}-${m}-${d}`;
          }
        }
      }
    }
  }

  let nights = Number(
    orderObj.nights || orderObj.nightCount || orderObj.liveDays || data.nights || data.nightCount || 0
  );
  if (!nights && checkInDate && checkOutDate) {
    const diff = Math.round((Date.parse(checkOutDate) - Date.parse(checkInDate)) / 86400000);
    nights = diff > 0 ? diff : 1;
  }
  if (!nights) nights = 1;

  const rawTotal = Number(
    orderObj.totalFee ??
      orderObj.price ??
      orderObj.totalPrice ??
      data.totalFee ??
      data.price ??
      data.totalPrice ??
      0
  );
  const totalPrice =
    orderObj.totalFee != null || data.totalFee != null || rawTotal > 1000
      ? rawTotal / 100
      : rawTotal;

  let guestName = '';
  let guestMobile = '';
  const rawContacts = Array.isArray(orderObj.contacts)
    ? orderObj.contacts
    : Array.isArray(orderObj.guests)
    ? orderObj.guests
    : Array.isArray(data.contacts)
    ? data.contacts
    : Array.isArray(data.guests)
    ? data.guests
    : [];

  for (const c of rawContacts) {
    if (c && typeof c === 'object') {
      const cRec = c as Record<string, unknown>;
      const n = String(cRec.name || '').trim();
      const p = String(cRec.phone || cRec.mobile || '').trim();
      if (n && !guestName) guestName = n;
      if (p && !guestMobile) guestMobile = p;
    }
  }
  if (!guestName) {
    guestName = String(
      orderObj.guestName ||
        orderObj.customerName ||
        orderObj.contactName ||
        data.guestName ||
        data.customerName ||
        data.contactName ||
        ''
    ).trim();
  }
  if (!guestMobile) {
    guestMobile = String(
      orderObj.guestMobile ||
        orderObj.customerMobile ||
        orderObj.contactPhone ||
        data.guestMobile ||
        data.customerMobile ||
        data.contactPhone ||
        ''
    ).trim();
  }

  const roomTypeName = String(
    orderObj.roomName ||
      orderObj.roomTypeName ||
      orderObj.roomTitle ||
      data.roomName ||
      data.roomTypeName ||
      data.roomTitle ||
      ''
  ).trim();

  const ratePlanName = String(
    orderObj.ratePlanName ||
      orderObj.rateCode ||
      orderObj.productName ||
      data.ratePlanName ||
      data.rateCode ||
      data.productName ||
      ''
  ).trim();

  const quantity = Number(
    orderObj.roomCount || orderObj.quantity || data.roomCount || data.quantity || 1
  );
  const unitId =
    String(orderObj.poiId || orderObj.hotelId || data.poiId || data.hotelId || '').trim() ||
    undefined;
  const unitName =
    String(orderObj.poiName || orderObj.hotelName || data.poiName || data.hotelName || '').trim() ||
    undefined;

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
    raw: (orderObj || data) as Record<string, unknown>,
  };
}

export class MeituanDutyRunner implements ChannelDutyRunner {
  public readonly channelCode = 'MEITUAN';
  private session: BrowserSession | null = null;
  private running = false;
  private explicitTargetUrl?: string;
  private lastListRefreshTime = 0;

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

  /**
   * 触发美团待处理订单列表刷新（具备 3 秒防抖保护，避免连续高频切 Tab 触发接口限流）
   * 核心逻辑：优先定位并点击「待确认订单」Tab 触发列表接口调用；若未发现 Tab，寻找「查询」/「搜索」/「刷新」按钮
   */
  public async refreshOrderList(page: Page, force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastListRefreshTime < 3000) {
      // 防抖：距离上次刷新不足 3 秒，复用当前列表并给予拟真停顿，避免触发频控
      await humanDelay(page, 400, 700);
      return;
    }
    this.lastListRefreshTime = now;

    try {
      // 1. 优先定位并点击「待确认订单」/「待确认」Tab 按钮或菜单项
      const pendingTabSelectors = [
        '[role="tab"]:has-text("待确认订单")',
        '[role="tab"]:has-text("待确认")',
        '.mtd-tabs-item:has-text("待确认订单")',
        '.mtd-tabs-item:has-text("待确认")',
        'li.tab-item:has-text("待确认订单")',
        'li.tab-item:has-text("待确认")',
        'li:has-text("待确认订单")',
        'li:has-text("待确认")',
        'div.tab-item:has-text("待确认订单")',
        'div.tab-item:has-text("待确认")',
        'button:has-text("待确认订单")',
        'button:has-text("待确认")',
        'span:has-text("待确认订单")',
        'span:has-text("待确认")',
        'div:has-text("待确认订单")',
        'div:has-text("待确认")',
      ];

      for (const selector of pendingTabSelectors) {
        const tabLocator = page.locator(selector).first();
        if (await tabLocator.isVisible({ timeout: 500 }).catch(() => false)) {
          await visualClickLocator(page, tabLocator, '点击「待确认订单」Tab');
          await humanDelay(page, 600, 1000);
          return;
        }
      }

      // 2. 次选：点击「查询」/「搜索」/「刷新」控制按钮
      const queryBtn = page
        .locator('button:has-text("查询"), button:has-text("搜索"), button:has-text("刷新"), .refresh-btn, [data-test="refresh"]')
        .first();
      if (await queryBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await visualClickLocator(page, queryBtn, '点击查询/刷新待处理订单');
        await humanDelay(page, 600, 1000);
        return;
      }
    } catch (err) {
      console.warn('[MeituanDutyRunner] 交互点击待确认订单/刷新失败，回退重载:', err);
    }

    // 3. 兜底容错：页面轻量重载
    await page.reload({ waitUntil: 'domcontentloaded' });
    await humanDelay(page, 1000, 1500);
  }

  /**
   * 页面操作：刷新美团待处理列表并即时返回待处理订单概要（无本地状态缓存）
   */
  public async collectUnhandledOrders(): Promise<DutyUnhandledOrderSummary[]> {
    if (!this.running || !this.session) {
      throw new Error('美团值守执行器未运行，无法采集待处理订单');
    }

    const page = this.session.page;

    // 前置风控特征嗅探
    if (await checkMeituanPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new Error('美团页面提示安全验证或操作频繁，需要人工在浏览器中完成验证 (RISK_VERIFICATION_REQUIRED)');
    }

    await updateVisualTrackerStatus(page, '📥 正在执行订单采集任务，点击「待确认订单」Tab 刷新列表...', 'action');

    // 在单次触发刷新动作时，挂载本次专属的订单列表响应监听
    const listResponsePromise = typeof page.waitForResponse === 'function'
      ? page
          .waitForResponse(
            (res) => isMeituanListUrl(res.url()) && res.status() === 200,
            { timeout: 5000 }
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

    // 触发刷新：执行「待确认订单」Tab 点击
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

    // 1. 前置风控特征嗅探：若页面已弹出安全验证/滑块，立即熔断阻断
    if (await checkMeituanPageRisk(page)) {
      await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
      throw new Error(`美团后台提示安全验证或操作频繁，需要人工在浏览器中完成验证 (RISK_VERIFICATION_REQUIRED)`);
    }

    await updateVisualTrackerStatus(page, `🔍 正在查看美团订单「${otaOrderId}」详情...`, 'action');

    // 2. 挂载本次查看详情动作专属的单次/流式网络响应监听（随用随销，绝无内存泄露）
    const capturedRef: {
      detail: Partial<ExtractedOrderDetail> | null;
      sensitive: { guestName?: string; guestMobile?: string } | null;
    } = {
      detail: null,
      sensitive: null,
    };

    const onResponse = async (res: { url: () => string; status: () => number; text: () => Promise<string> }) => {
      try {
        const url = res.url();
        if (res.status() === 200) {
          if (isMeituanDetailUrl(url, otaOrderId)) {
            const text = await res.text().catch(() => '');
            if (text) {
              const parsed = JSON.parse(text);
              const parsedDetail = extractMeituanOrderDetailFromPayload(parsed, otaOrderId);
              if (parsedDetail) {
                capturedRef.detail = parsedDetail;
              }
            }
          } else if (isMeituanSensitiveUrl(url)) {
            const text = await res.text().catch(() => '');
            if (text) {
              const parsed = JSON.parse(text);
              const sensitive = extractMeituanSensitiveDataFromPayload(parsed);
              if (sensitive) {
                capturedRef.sensitive = {
                  guestName: sensitive.guestName || capturedRef.sensitive?.guestName,
                  guestMobile: sensitive.guestMobile || capturedRef.sensitive?.guestMobile,
                };
              }
            }
          }
        }
      } catch {
        // 容错网络响应解析异常
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

    // 兼容 waitForResponse
    const detailResponsePromise = typeof page.waitForResponse === 'function'
      ? page
          .waitForResponse(
            (res) => isMeituanDetailUrl(res.url(), otaOrderId) && res.status() === 200,
            { timeout: 8000 }
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

    try {
      // 3. 拟真直达：直接定位订单列表项（Item / Row）并点击，杜绝机器搜索框输入特征
      let clicked = false;
      try {
        const orderRow = page.locator(
          `tr:has-text("${otaOrderId}"), .order-item:has-text("${otaOrderId}"), [data-order-id="${otaOrderId}"], .list-item-wrap:has-text("${otaOrderId}"), .order-card:has-text("${otaOrderId}")`
        ).first();
        if (await orderRow.isVisible({ timeout: 1500 })) {
          const detailBtn = orderRow.locator(
            'button:has-text("详情"), a:has-text("详情"), button:has-text("查看"), a:has-text("查看"), .detail-btn, [data-test="order-detail"]'
          ).first();
          if (await detailBtn.isVisible({ timeout: 1000 })) {
            await visualClickLocator(page, detailBtn, `点击订单「${otaOrderId}」详情`);
            clicked = true;
          } else {
            // 直接点击订单卡片行自身触发展开详情
            await visualClickLocator(page, orderRow, `点击订单「${otaOrderId}」卡片`);
            clicked = true;
          }
        }
      } catch {
        // 容错定位
      }

      if (!clicked) {
        try {
          const directBtn = page.locator(
            `[data-order-id="${otaOrderId}"] .detail-btn, button[data-order-id="${otaOrderId}"], [data-order-id="${otaOrderId}"]`
          ).first();
          if (await directBtn.isVisible({ timeout: 1000 })) {
            await visualClickLocator(page, directBtn, `点击订单「${otaOrderId}」详情`);
            clicked = true;
          }
        } catch {
          // 容错
        }
      }

      // 4. 等待详情弹窗 / 抽屉可见并加入拟真人微延迟
      await humanDelay(page, 500, 800);
      const detailModal = page.locator(
        '.order-detail-modal, .ant-modal, .el-dialog, [role="dialog"], .order-detail-drawer, .order-detail-container, .modal-content'
      ).first();

      await detailModal.isVisible({ timeout: 2000 }).catch(() => false);

      // 二次风控特征检测
      if (await checkMeituanPageRisk(page)) {
        await updateVisualTrackerStatus(page, '⚠️ 美团提示安全验证/滑块，需要人工在浏览器中完成验证', 'warn');
        throw new Error(`美团后台提示安全验证或操作频繁，需要人工在浏览器中完成验证 (RISK_VERIFICATION_REQUIRED)`);
      }

      // 5. 尝试触发姓名脱敏解除（“查看姓名”/“获取姓名”）
      try {
        const revealNameBtn = page.locator(
          'button:has-text("查看姓名"), a:has-text("查看姓名"), ' +
          'button:has-text("获取姓名"), a:has-text("获取姓名"), ' +
          'button:has-text("显示姓名"), a:has-text("显示姓名"), ' +
          '[data-test="reveal-guest-name"], .reveal-name-btn'
        ).first();

        if (await revealNameBtn.isVisible({ timeout: 1200 })) {
          await visualClickLocator(page, revealNameBtn, '点击查看真实客人姓名');
          await humanDelay(page, 400, 700);

          // 检查并点击二次确认弹窗（如“我已知晓”、“确认”、“确定”、“继续查看”）
          const confirmDialogBtn = page.locator(
            '.ant-modal button:has-text("我已知晓"), .ant-modal button:has-text("确定"), .ant-modal button:has-text("确认"), ' +
            '.el-dialog button:has-text("我已知晓"), .el-dialog button:has-text("确定"), .el-dialog button:has-text("确认"), ' +
            '[role="dialog"] button:has-text("我已知晓"), [role="dialog"] button:has-text("确定"), [role="dialog"] button:has-text("确认"), ' +
            'button:has-text("我知道了"), button:has-text("继续查看")'
          ).first();

          if (await confirmDialogBtn.isVisible({ timeout: 1000 })) {
            await visualClickLocator(page, confirmDialogBtn, '确认查看客人信息');
            await humanDelay(page, 500, 800);
          }
        }
      } catch {
        // 容错脱敏解除交互
      }

      // 6. 智能电话脱敏控制 (Smart Skip Phone Privacy)：
      // 美团在查看姓名解密时通常已同时返回真实手机号；若已从接口或当前敏感数据中获取到真实手机号，严禁再次点击「查看电话」二次弹窗，彻底规避 1 秒内连续发起双重敏感解密的极高危风控探针！
      const resolvedPhone = Boolean(
        (capturedRef.sensitive?.guestMobile && !capturedRef.sensitive.guestMobile.includes('*')) ||
        (capturedRef.detail?.guestMobile && !capturedRef.detail.guestMobile.includes('*'))
      );

      if (!resolvedPhone) {
        try {
          const revealPhoneBtn = page.locator(
            'button:has-text("查看电话"), a:has-text("查看电话"), ' +
            'button:has-text("获取电话"), a:has-text("获取电话"), ' +
            'button:has-text("查看手机"), a:has-text("查看手机"), ' +
            'button:has-text("查看完整号码"), a:has-text("查看完整号码")'
          ).first();

          if (await revealPhoneBtn.isVisible({ timeout: 800 })) {
            await visualClickLocator(page, revealPhoneBtn, '点击查看真实联系电话');
            await humanDelay(page, 400, 700);

            const confirmPhoneDialogBtn = page.locator(
              '.ant-modal button:has-text("我已知晓"), .ant-modal button:has-text("确定"), ' +
              '.el-dialog button:has-text("我已知晓"), .el-dialog button:has-text("确定"), ' +
              '[role="dialog"] button:has-text("我已知晓"), [role="dialog"] button:has-text("确定")'
            ).first();

            if (await confirmPhoneDialogBtn.isVisible({ timeout: 800 })) {
              await visualClickLocator(page, confirmPhoneDialogBtn, '确认查看电话');
              await humanDelay(page, 400, 600);
            }
          }
        } catch {
          // 容错电话脱敏解除交互
        }
      }

      // 6. 从页面 DOM 元素中提取真实字段（支持主 Frame 与子 Frame 提取）
      const extractFromContext = () => {
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
        if (/^(查看姓名|获取姓名|显示姓名|点击查看|解密|未知|暂无)$/.test(guestName)) {
          guestName = '';
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

        // 提取入离日期并格式化
        const normalizeDate = (raw: string): string => {
          const trimmed = raw.trim();
          const full = trimmed.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/);
          if (full) {
            return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
          }
          const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
          if (compact) {
            return `${compact[1]}-${compact[2]}-${compact[3]}`;
          }
          const short = trimmed.match(/^(\d{1,2})[-/.月](\d{1,2})(?:日)?/);
          if (short) {
            const cy = new Date().getFullYear();
            return `${cy}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
          }
          return '';
        };

        let arrival = '';
        let departure = '';
        const arrivalEl = rootEl.querySelector('[data-field="arrival"], .check-in-date, .arrival-date');
        const departureEl = rootEl.querySelector('[data-field="departure"], .check-out-date, .departure-date');
        if (arrivalEl && arrivalEl.textContent?.trim()) {
          arrival = normalizeDate(arrivalEl.textContent.trim());
        }
        if (departureEl && departureEl.textContent?.trim()) {
          departure = normalizeDate(departureEl.textContent.trim());
        }
        if (!arrival || !departure) {
          const dateText = findTextAfterLabel(['入离日期', '入住离店', '入住日期', '预订日期', '住离日期']);
          const dateMatches = dateText.match(/(?:\d{4}[-/.]|\d{4}年)?\d{1,2}[-/.]\d{1,2}(?:日)?/g);
          if (dateMatches && dateMatches.length >= 2) {
            arrival = normalizeDate(dateMatches[0]);
            departure = normalizeDate(dateMatches[1]);
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
      };

      let domExtracted = await page.evaluate(extractFromContext).catch(() => null);

      // 若主 Frame 未解析到完整入离日期，尝试跨 Frame 查找
      if ((!domExtracted?.arrival || !domExtracted?.departure) && typeof page.frames === 'function') {
        try {
          const frames = page.frames();
          for (const frame of frames) {
            if (typeof page.mainFrame === 'function' && frame === page.mainFrame()) continue;
            const frameExtracted = await frame.evaluate(extractFromContext).catch(() => null);
            if (frameExtracted && (frameExtracted.arrival || frameExtracted.guestName)) {
              domExtracted = {
                guestName: domExtracted?.guestName || frameExtracted.guestName,
                guestMobile: domExtracted?.guestMobile || frameExtracted.guestMobile,
                roomTypeName: domExtracted?.roomTypeName || frameExtracted.roomTypeName,
                ratePlanName: domExtracted?.ratePlanName || frameExtracted.ratePlanName,
                arrival: domExtracted?.arrival || frameExtracted.arrival,
                departure: domExtracted?.departure || frameExtracted.departure,
                totalPrice: domExtracted?.totalPrice || frameExtracted.totalPrice,
                quantity: domExtracted?.quantity || frameExtracted.quantity,
                hotelName: domExtracted?.hotelName || frameExtracted.hotelName,
              };
              if (domExtracted.arrival && domExtracted.departure) break;
            }
          }
        } catch {
          // 容错跨 Frame 扫描
        }
      }

      // 7. 等待并多路融合本次点击操作拦截到的真实详情网络报文与敏感数据响应
      const networkDetail = (await detailResponsePromise) || capturedRef.detail;
      const sensitiveData = capturedRef.sensitive;

      // 优先采用敏感数据解密接口获取的真实姓名与手机号（绝无星号脱敏）
      const plainSensitiveName =
        sensitiveData?.guestName && !sensitiveData.guestName.includes('*')
          ? sensitiveData.guestName
          : '';
      const plainSensitivePhone =
        sensitiveData?.guestMobile && !sensitiveData.guestMobile.includes('*')
          ? sensitiveData.guestMobile
          : '';

      const plainNetworkName =
        networkDetail?.guestName && !networkDetail.guestName.includes('*')
          ? networkDetail.guestName
          : '';
      const plainNetworkPhone =
        networkDetail?.guestMobile && !networkDetail.guestMobile.includes('*')
          ? networkDetail.guestMobile
          : '';

      const plainDomName =
        domExtracted?.guestName && !domExtracted.guestName.includes('*')
          ? domExtracted.guestName
          : '';
      const plainDomPhone =
        domExtracted?.guestMobile && !domExtracted.guestMobile.includes('*')
          ? domExtracted.guestMobile
          : '';

      const guestName = (
        plainSensitiveName ||
        plainNetworkName ||
        plainDomName ||
        networkDetail?.guestName ||
        domExtracted?.guestName ||
        ''
      ).trim();

      const guestMobile = (
        plainSensitivePhone ||
        plainNetworkPhone ||
        plainDomPhone ||
        networkDetail?.guestMobile ||
        domExtracted?.guestMobile ||
        ''
      ).trim();

      const roomTypeName = (networkDetail?.roomTypeName || domExtracted?.roomTypeName || '').trim();
      const ratePlanName = (networkDetail?.ratePlanName || domExtracted?.ratePlanName || '').trim();
      const arrival = fmtDate(networkDetail?.arrival || domExtracted?.arrival);
      const departure = fmtDate(networkDetail?.departure || domExtracted?.departure);
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

      // 8. Fail-Fast 严格校验：确保关键字段非空，绝不兜底任何假数据
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
    } finally {
      // 保证监听器随用随销，彻底杜绝长效驻留泄露
      if (typeof offFn === 'function') {
        offFn.call(page, 'response', onResponse);
      } else if (typeof removeListenerFn === 'function') {
        removeListenerFn.call(page, 'response', onResponse);
      }
    }
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
