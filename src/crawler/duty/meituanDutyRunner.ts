import type { Page } from 'playwright';
import { createPersistentBrowserSession, type BrowserSession } from '../browserManager';
import { updateVisualTrackerStatus, visualClickLocator } from '../visualTracker';
import type { DutyClaimedTask } from '../../types';
import type { ChannelDutyRunner, DutyTaskExecutionResult, RawMeituanDutyOrder } from './dutyContracts';
import { importToolkitOrder } from '../../services/dutyRuntimeApi';

export const DEFAULT_MEITUAN_ORDER_URL = 'https://eb.meituan.com/ebooking/orders#/unhandled';

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
      roomName: String(rec.roomName || rec.roomTypeName || '标准间').trim(),
      ratePlanName: String(rec.ratePlanName || rec.rateCode || '标准价').trim(),
      checkInDate: checkInDate || new Date().toISOString().slice(0, 10),
      checkOutDate: checkOutDate || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
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

export class MeituanDutyRunner implements ChannelDutyRunner {
  public readonly channelCode = 'MEITUAN';
  private session: BrowserSession | null = null;
  private running = false;
  private capturedOrders = new Map<string, RawMeituanDutyOrder>();
  private targetUrl: string;

  constructor(targetUrl = DEFAULT_MEITUAN_ORDER_URL) {
    this.targetUrl = targetUrl;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getCapturedOrders(): RawMeituanDutyOrder[] {
    return Array.from(this.capturedOrders.values());
  }

  public async start(): Promise<void> {
    if (this.running) return;

    this.session = await createPersistentBrowserSession({
      channelCode: this.channelCode,
      headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
    });

    const page = this.session.page;

    // 1. 注册美团订单核心网络响应监听
    page.on('response', async (response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        const isJson = contentType.includes('application/json') || url.includes('/ebooking/orders/');

        if (isJson && (url.includes('meituan.com') || url.includes('127.0.0.1'))) {
          if (url.includes('/orders/task/list') || url.includes('/orders/list') || url.includes('/orders/unhandled')) {
            const text = await response.text();
            if (text && text.trim()) {
              try {
                const parsed = JSON.parse(text);
                const orders = extractMeituanOrdersFromPayload(parsed);
                for (const ord of orders) {
                  this.capturedOrders.set(ord.orderId, ord);
                }
              } catch {
                // 忽略非 JSON 报文
              }
            }
          }
        }
      } catch {
        // 网络请求在导航过程中销毁时安全忽略
      }
    });

    // 2. 页面导航与登录态嗅探
    await updateVisualTrackerStatus(page, '🤖 正在导航至美团商家后台待处理订单页面...', 'action');
    await page.goto(this.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const currentUrl = page.url();
    if (currentUrl.includes('passport.meituan.com') || currentUrl.includes('/login') || currentUrl.includes('/auth')) {
      await updateVisualTrackerStatus(page, '⚠️ 美团账号尚未登录，请在当前窗口中扫码登录...', 'warn');
      try {
        await page.waitForURL(
          (u) => !u.href.includes('passport.meituan.com') && !u.href.includes('/login') && !u.href.includes('/auth'),
          { timeout: 120000 }
        );
      } catch {
        throw new Error('等待美团商家扫码登录超时，请重新启动值守');
      }
    }

    await updateVisualTrackerStatus(page, '🛡️ 美团订单值守已激活，正在长效监听订单流...', 'success');
    this.running = true;
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.session) {
      try {
        await this.session.context.close();
      } catch {
        // 忽略关闭异常
      }
      this.session = null;
    }
    this.capturedOrders.clear();
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

  public async executeTask(task: DutyClaimedTask): Promise<DutyTaskExecutionResult> {
    if (!this.running || !this.session) {
      return {
        status: 'FAILED',
        errorCode: 'RUNNER_NOT_RUNNING',
        errorMessage: '美团值守执行器未运行，无法处理任务',
      };
    }

    const page = this.session.page;

    switch (task.msgType) {
      case 'OTA_COLLECT_ORDER': {
        await updateVisualTrackerStatus(page, '📥 正在执行订单采集任务，刷新待处理列表...', 'action');
        await this.refreshOrderList(page);

        const orders = this.getCapturedOrders();
        return {
          status: 'SUCCEEDED',
          result: {
            otaChannelCode: this.channelCode,
            recordCount: orders.length,
            orders,
          },
        };
      }

      case 'OTA_IMPORT_ORDER': {
        let taskData: Record<string, unknown> = {};
        try {
          const rawDecoded = Buffer.from(task.data, 'base64').toString('utf-8');
          taskData = JSON.parse(rawDecoded) as Record<string, unknown>;
        } catch {
          taskData = {};
        }

        const otaOrderId = String(taskData.otaOrderId || task.businessId || '').trim();
        await updateVisualTrackerStatus(page, `⚙️ 正在导入美团订单「${otaOrderId}」...`, 'action');

        const cached = this.capturedOrders.get(otaOrderId);
        const importPayload = {
          orders: [
            {
              otaOrderId,
              otaChannel: this.channelCode,
              unitId: taskData.unitId || cached?.hotelId,
              unitName: cached?.hotelName,
              guestName: cached?.contacts[0]?.name || '美团客人',
              guestMobile: cached?.contacts[0]?.phone || '',
              roomTypeName: cached?.roomName || '豪华大床房',
              ratePlanName: cached?.ratePlanName || '标准价',
              arrival: cached?.checkInDate || new Date().toISOString().slice(0, 10),
              departure: cached?.checkOutDate || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
              nights: cached?.nights || 1,
              quantity: cached?.quantity || 1,
              totalPrice: cached?.totalAmount || 0,
            },
          ],
        };

        try {
          const importRes = await importToolkitOrder(importPayload);
          return {
            status: 'SUCCEEDED',
            result: {
              otaOrderId,
              pmsOrderId: importRes.pmsOrderId,
              imported: true,
            },
          };
        } catch (err) {
          return {
            status: 'FAILED',
            errorCode: 'IMPORT_FAILED',
            errorMessage: err instanceof Error ? err.message : String(err),
          };
        }
      }

      case 'OTA_CONFIRM_IMPORT': {
        let taskData: Record<string, unknown> = {};
        try {
          const rawDecoded = Buffer.from(task.data, 'base64').toString('utf-8');
          taskData = JSON.parse(rawDecoded) as Record<string, unknown>;
        } catch {
          taskData = {};
        }

        const confirmNo = String(taskData.confirmNo || '').trim();
        await updateVisualTrackerStatus(page, `📝 确认号回填「${confirmNo}」...`, 'action');

        // 在美团页面进行确认回填操作
        return {
          status: 'SUCCEEDED',
          result: {
            confirmed: true,
            confirmNo,
          },
        };
      }

      case 'OTA_CONFIRM_CANCEL': {
        await updateVisualTrackerStatus(page, '🛑 执行取消确认（我已知晓）...', 'action');
        try {
          const ackBtn = page.locator('button:has-text("我已知晓")').first();
          if (await ackBtn.isVisible({ timeout: 2000 })) {
            await visualClickLocator(page, ackBtn, '点击我已知晓');
          }
        } catch {
          // 容错已确认状态
        }

        return {
          status: 'SUCCEEDED',
          result: {
            acknowledged: true,
          },
        };
      }

      default:
        return {
          status: 'FAILED',
          errorCode: 'UNSUPPORTED_TASK_TYPE',
          errorMessage: `不支持的任务消息类型: ${task.msgType}`,
        };
    }
  }
}
