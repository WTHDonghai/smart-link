import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Response as PlaywrightResponse } from 'playwright';
import { MeituanDutyRunner, humanDelay, checkMeituanPageRisk, dismissMeituanNoticeModals } from '../../../src/crawler/duty/meituanDutyRunner';
import {
  extractMeituanOrdersFromPayload,
  extractMeituanOrderDetailFromPayload,
  extractMeituanSensitiveDataFromPayload,
  fmtDate,
  isMeituanDetailUrl,
  isMeituanListUrl,
  isMeituanSensitiveUrl,
} from '../../../src/crawler/duty/meituanOrderParsers';
import * as dutyRuntimeApi from '../../../src/services/dutyRuntimeApi';
import { APP_ENV_KEYS } from '../../../src/types/env';
import type { DutyClaimedTask } from '../../../src/types';
import { createPersistentBrowserSession } from '../../../src/crawler/browserManager';

vi.mock('../../../src/crawler/browserManager', () => ({
  createPersistentBrowserSession: vi.fn(),
}));

describe('meituanDutyRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractMeituanOrdersFromPayload', () => {
    it('should return empty array for null, undefined, or empty payload', () => {
      expect(extractMeituanOrdersFromPayload(null)).toEqual([]);
      expect(extractMeituanOrdersFromPayload(undefined)).toEqual([]);
      expect(extractMeituanOrdersFromPayload({})).toEqual([]);
      expect(extractMeituanOrdersFromPayload({ data: {} })).toEqual([]);
    });

    it('should extract orders from Meituan data.list payload with cent-to-yuan conversion and contact parsing', () => {
      const mockPayload = {
        code: 0,
        data: {
          list: [
            {
              orderId: 'MT-8899001',
              poiId: 'poi-1001',
              poiName: '美团大酒店(外滩店)',
              orderDisplayLabel: '待处理新订',
              aptCreatTimeString: '2026-09-17 14:00:00',
              roomName: '高级商务双床房',
              ratePlanName: '含双早标准价',
              checkInDateString: '2026-09-18',
              checkOutDateString: '2026-09-20',
              nights: 2,
              roomCount: 1,
              totalFee: 59800, // 59800 分 = 598 元
              contacts: [
                { name: '张三', phone: '13800138000' },
                { name: '李四', mobile: '13900139000' },
              ],
              cancelOrder: false,
            },
          ],
        },
      };

      const result = extractMeituanOrdersFromPayload(mockPayload);
      expect(result).toHaveLength(1);

      const order = result[0];
      expect(order.orderId).toBe('MT-8899001');
      expect(order.hotelId).toBe('poi-1001');
      expect(order.hotelName).toBe('美团大酒店(外滩店)');
      expect(order.orderDisplayLabel).toBe('待处理新订');
      expect(order.roomName).toBe('高级商务双床房');
      expect(order.ratePlanName).toBe('含双早标准价');
      expect(order.checkInDate).toBe('2026-09-18');
      expect(order.checkOutDate).toBe('2026-09-20');
      expect(order.nights).toBe(2);
      expect(order.quantity).toBe(1);
      expect(order.totalAmount).toBe(598);
      expect(order.contacts).toEqual([
        { name: '张三', phone: '13800138000' },
        { name: '李四', phone: '13900139000' },
      ]);
      expect(order.cancelOrder).toBe(false);
    });

    it('should derive night count from dates when nights field is omitted', () => {
      const mockPayload = {
        data: {
          orders: [
            {
              orderId: 'MT-776655',
              checkInDate: '2026-10-01',
              checkOutDate: '2026-10-04',
              price: 360,
              guestName: '王五',
              guestMobile: '13700000000',
            },
          ],
        },
      };

      const result = extractMeituanOrdersFromPayload(mockPayload);
      expect(result).toHaveLength(1);
      expect(result[0].nights).toBe(3);
      expect(result[0].totalAmount).toBe(360);
      expect(result[0].contacts).toEqual([{ name: '王五', phone: '13700000000' }]);
    });

    it('should detect cancel order when cancelOrder is true or status is CANCEL', () => {
      const mockPayload = [
        {
          orderId: 'MT-CANCEL-1',
          cancelOrder: true,
          totalPrice: 200,
        },
        {
          orderId: 'MT-CANCEL-2',
          status: 'CANCEL',
          totalPrice: 300,
        },
      ];

      const result = extractMeituanOrdersFromPayload(mockPayload);
      expect(result).toHaveLength(2);
      expect(result[0].cancelOrder).toBe(true);
      expect(result[1].cancelOrder).toBe(true);
    });
  });

  describe('extractMeituanOrderDetailFromPayload', () => {
    it('should return null for non-object payloads or mismatched order IDs', () => {
      expect(extractMeituanOrderDetailFromPayload(null)).toBeNull();
      expect(extractMeituanOrderDetailFromPayload('invalid')).toBeNull();
      expect(extractMeituanOrderDetailFromPayload({ data: { orderId: 'MT-1' } }, 'MT-2')).toBeNull();
    });

    it('should extract structured order details from detail response payload', () => {
      const payload = {
        code: 0,
        data: {
          orderId: 'MT-DETAIL-888',
          poiId: 'poi-999',
          poiName: '美团度假酒店',
          roomTypeName: '海景大床房',
          ratePlanName: '连住特惠',
          checkInDateString: '2026-10-01',
          checkOutDateString: '2026-10-03',
          nights: 2,
          roomCount: 1,
          totalFee: 88000,
          contacts: [{ name: '赵六', phone: '13500135000' }],
        },
      };

      const detail = extractMeituanOrderDetailFromPayload(payload, 'MT-DETAIL-888');
      expect(detail).not.toBeNull();
      expect(detail?.otaOrderId).toBe('MT-DETAIL-888');
      expect(detail?.otaChannel).toBe('MEITUAN');
      expect(detail?.guestName).toBe('赵六');
      expect(detail?.guestMobile).toBe('13500135000');
      expect(detail?.roomTypeName).toBe('海景大床房');
      expect(detail?.ratePlanName).toBe('连住特惠');
      expect(detail?.arrival).toBe('2026-10-01');
      expect(detail?.departure).toBe('2026-10-03');
      expect(detail?.nights).toBe(2);
      expect(detail?.totalPrice).toBe(880);
      expect(detail?.unitId).toBe('poi-999');
      expect(detail?.unitName).toBe('美团度假酒店');
    });

    it('should extract structured order details from nested data.orderDetail payload', () => {
      const payload = {
        code: 0,
        data: {
          orderDetail: {
            orderId: '20260917092248573000',
            checkInDate: '2026-09-17',
            checkOutDate: '2026-09-18',
            roomName: '豪华大床房',
            ratePlanName: '含单早特惠',
            totalFee: 32000,
            nights: 1,
            roomCount: 1,
            poiId: 'poi-8888',
            poiName: '美团精品度假村',
            contacts: [{ name: '李明', phone: '13800138000' }],
          },
        },
      };

      const detail = extractMeituanOrderDetailFromPayload(payload, '20260917092248573000');
      expect(detail).not.toBeNull();
      expect(detail?.otaOrderId).toBe('20260917092248573000');
      expect(detail?.arrival).toBe('2026-09-17');
      expect(detail?.departure).toBe('2026-09-18');
      expect(detail?.roomTypeName).toBe('豪华大床房');
      expect(detail?.totalPrice).toBe(320);
      expect(detail?.guestName).toBe('李明');
      expect(detail?.guestMobile).toBe('13800138000');
    });

    it('should extract dates and details from timestamp format in orderDetail', () => {
      const payload = {
        code: 0,
        data: {
          orderDetail: {
            orderId: 'MT-TS-111',
            checkInDate: 1789400000000,
            checkOutDate: 1789486400000,
            roomTypeName: '行政商务房',
            guestName: '王五',
            price: 500,
          },
        },
      };

      const detail = extractMeituanOrderDetailFromPayload(payload, 'MT-TS-111');
      expect(detail).not.toBeNull();
      expect(detail?.otaOrderId).toBe('MT-TS-111');
      expect(detail?.arrival).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(detail?.departure).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(detail?.roomTypeName).toBe('行政商务房');
      expect(detail?.totalPrice).toBe(500);
    });

    it('should derive arrival and departure from roomNightPriceModels when top-level dates are absent', () => {
      const payload = {
        code: 0,
        data: {
          orderDetail: {
            orderId: 'MT-MODELS-222',
            roomTypeName: '家庭亲子房',
            guestName: '陈七',
            roomNightPriceModels: [
              { dateStr: '2026-11-01', floorPrice: 30000 },
              { dateStr: '2026-11-02', floorPrice: 32000 },
            ],
          },
        },
      };

      const detail = extractMeituanOrderDetailFromPayload(payload, 'MT-MODELS-222');
      expect(detail).not.toBeNull();
      expect(detail?.arrival).toBe('2026-11-01');
      expect(detail?.departure).toBe('2026-11-03');
      expect(detail?.nights).toBe(2);
    });
  });

  describe('fmtDate', () => {
    it('should return empty string for null, undefined, empty, or invalid inputs', () => {
      expect(fmtDate(null)).toBe('');
      expect(fmtDate(undefined)).toBe('');
      expect(fmtDate('')).toBe('');
      expect(fmtDate('   ')).toBe('');
      expect(fmtDate('invalid-date')).toBe('');
    });

    it('should normalize standard hyphen, slash, dot, and Chinese dates', () => {
      expect(fmtDate('2026-09-17')).toBe('2026-09-17');
      expect(fmtDate('2026/9/17')).toBe('2026-09-17');
      expect(fmtDate('2026.09.17')).toBe('2026-09-17');
      expect(fmtDate('2026年09月17日')).toBe('2026-09-17');
      expect(fmtDate('2026年9月7日')).toBe('2026-09-07');
    });

    it('should normalize compact YYYYMMDD string', () => {
      expect(fmtDate('20260917')).toBe('2026-09-17');
    });

    it('should auto-complete current year for short dates', () => {
      const currentYear = new Date().getFullYear();
      expect(fmtDate('09-17')).toBe(`${currentYear}-09-17`);
      expect(fmtDate('9.7')).toBe(`${currentYear}-09-07`);
      expect(fmtDate('09月17日')).toBe(`${currentYear}-09-17`);
    });

    it('should convert numeric timestamps and timestamp strings to YYYY-MM-DD', () => {
      const ts = Date.UTC(2026, 8, 17, 12, 0, 0);
      const result = fmtDate(ts);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fmtDate(String(ts))).toBe(result);
    });
  });

  describe('isMeituanDetailUrl and isMeituanSensitiveUrl', () => {
    it('should match real Meituan line net order detail URL with orderId', () => {
      const realLineNetUrl =
        'https://eb.meituan.com/api/v1/ebooking/orders/20260917092248573000?userId=295692068&pageRequestSource=1&yodaReady=h5&csecplatform=4';
      expect(isMeituanDetailUrl(realLineNetUrl, '20260917092248573000')).toBe(true);
      expect(isMeituanDetailUrl(realLineNetUrl)).toBe(true);
    });

    it('should not match task list URL', () => {
      const listUrl = 'https://eb.meituan.com/api/v1/ebooking/orders/task/list?scenario=0';
      expect(isMeituanDetailUrl(listUrl)).toBe(false);
    });

    it('should match sensitive data URL and confirmPhone URL', () => {
      expect(
        isMeituanSensitiveUrl(
          'https://eb.meituan.com/api/v1/ebooking/orders/sensitiveData/20260917092248573000?requiredSensitiveData=2'
        )
      ).toBe(true);
      expect(
        isMeituanSensitiveUrl(
          'https://eb.meituan.com/api/v1/ebooking/resale/20260917092248573000/confirmPhone?userId=123'
        )
      ).toBe(true);
    });

    it('isMeituanListUrl should only match the fixed task list endpoint path', () => {
      expect(isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/orders/task/list?scenario=0')).toBe(true);
      expect(isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/orders/task/list')).toBe(true);
      expect(isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/orders/list')).toBe(false);
      expect(isMeituanListUrl('http://localhost:3000/api/mock/orders')).toBe(false);
      expect(isMeituanListUrl('/orders/unhandled')).toBe(false);
    });

    it('isMeituanListUrl should not match sensitive data or single order detail URLs', () => {
      expect(isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/orders/sensitiveData/12345')).toBe(false);
      expect(isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/resale/12345/confirmPhone')).toBe(false);
      expect(isMeituanListUrl('https://eb.meituan.com/api/v1/ebooking/orders/20260917092248573000')).toBe(false);
    });
  });

  describe('extractMeituanSensitiveDataFromPayload', () => {
    it('should return null for empty or invalid payload', () => {
      expect(extractMeituanSensitiveDataFromPayload(null)).toBeNull();
      expect(extractMeituanSensitiveDataFromPayload({})).toBeNull();
      expect(extractMeituanSensitiveDataFromPayload({ data: {} })).toBeNull();
    });

    it('should extract decrypted name and phone from sensitiveDataList and ignore placeholders', () => {
      const payload = {
        code: 0,
        data: {
          sensitiveDataList: [
            {
              guestInfos: [
                {
                  name: '张三丰',
                  phone: '13912345678',
                },
              ],
            },
          ],
        },
      };

      const result = extractMeituanSensitiveDataFromPayload(payload);
      expect(result).not.toBeNull();
      expect(result?.guestName).toBe('张三丰');
      expect(result?.guestMobile).toBe('13912345678');
    });

    it('should ignore masked names and placeholder text', () => {
      const payload = {
        data: {
          sensitiveDataList: [
            {
              guestInfos: [
                { name: '张*', phone: '139****5678' },
                { name: '查看姓名', phone: '13800138000' },
              ],
            },
          ],
        },
      };

      const result = extractMeituanSensitiveDataFromPayload(payload);
      expect(result?.guestName).toBeUndefined();
      expect(result?.guestMobile).toBe('13800138000');
    });

    it('should extract direct phone from confirmPhone response', () => {
      const payload = {
        code: 0,
        data: {
          phone: '13788889999',
        },
      };

      const result = extractMeituanSensitiveDataFromPayload(payload);
      expect(result?.guestMobile).toBe('13788889999');
    });
  });

  describe('humanDelay', () => {
    it('humanDelay should wait within the default range [3000, 8000] ms when no range specified', async () => {
      const waitForTimeout = vi.fn().mockResolvedValue(undefined);
      const mockPage = { waitForTimeout };

      await humanDelay(mockPage as unknown as Parameters<typeof humanDelay>[0]);
      expect(waitForTimeout).toHaveBeenCalledTimes(1);
      const calledDelay = waitForTimeout.mock.calls[0][0] as number;
      expect(calledDelay).toBeGreaterThanOrEqual(3000);
      expect(calledDelay).toBeLessThanOrEqual(8000);
    });

    it('humanDelay should wait within the custom range in milliseconds', async () => {
      const waitForTimeout = vi.fn().mockResolvedValue(undefined);
      const mockPage = { waitForTimeout };

      await humanDelay(mockPage as unknown as Parameters<typeof humanDelay>[0], 1000, 2000);
      expect(waitForTimeout).toHaveBeenCalledTimes(1);
      const calledDelay = waitForTimeout.mock.calls[0][0] as number;
      expect(calledDelay).toBeGreaterThanOrEqual(1000);
      expect(calledDelay).toBeLessThanOrEqual(2000);
    });

    it('humanDelay should fallback to setTimeout when waitForTimeout is missing', async () => {
      const start = Date.now();
      await humanDelay({} as unknown as Parameters<typeof humanDelay>[0], 10, 20);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(5);
    });
  });

  describe('checkMeituanPageRisk', () => {
    it('should return false for null or undefined page', async () => {
      expect(await checkMeituanPageRisk(null as unknown as Parameters<typeof checkMeituanPageRisk>[0])).toBe(false);
      expect(await checkMeituanPageRisk(undefined as unknown as Parameters<typeof checkMeituanPageRisk>[0])).toBe(false);
    });

    it('should return true when page URL contains verify.meituan.com or yoda', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://verify.meituan.com/v2/ext_verify?action=spider'),
        frames: vi.fn().mockReturnValue([]),
      };
      expect(await checkMeituanPageRisk(mockPage as unknown as Parameters<typeof checkMeituanPageRisk>[0])).toBe(true);
    });

    it('should return true when child frame URL contains verify.meituan.com', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html'),
        frames: vi.fn().mockReturnValue([
          { url: () => 'https://verify.meituan.com/v2/captcha' },
        ]),
      };
      expect(await checkMeituanPageRisk(mockPage as unknown as Parameters<typeof checkMeituanPageRisk>[0])).toBe(true);
    });

    it('should return true when frame.evaluate returns true', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html'),
        frames: vi.fn().mockReturnValue([
          {
            url: () => 'https://eb.meituan.com/child',
            evaluate: vi.fn().mockResolvedValue(true),
          },
        ]),
      };
      expect(await checkMeituanPageRisk(mockPage as unknown as Parameters<typeof checkMeituanPageRisk>[0])).toBe(true);
    });

    it('should return false when frame.evaluate returns false or non-boolean', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html'),
        frames: vi.fn().mockReturnValue([
          {
            url: () => 'https://eb.meituan.com/child',
            evaluate: vi.fn().mockResolvedValue(false),
          },
        ]),
      };
      expect(await checkMeituanPageRisk(mockPage as unknown as Parameters<typeof checkMeituanPageRisk>[0])).toBe(false);

      // 非 boolean (例如返回空数组或对象) 应当稳健返回 false
      const mockPageNonBool = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html'),
        frames: vi.fn().mockReturnValue([
          {
            url: () => 'https://eb.meituan.com/child',
            evaluate: vi.fn().mockResolvedValue([]),
          },
        ]),
      };
      expect(await checkMeituanPageRisk(mockPageNonBool as unknown as Parameters<typeof checkMeituanPageRisk>[0])).toBe(false);
    });

    it('should handle detached frame or evaluate rejection gracefully and return false', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html'),
        frames: vi.fn().mockReturnValue([
          {
            url: () => { throw new Error('frame detached'); },
            evaluate: vi.fn().mockRejectedValue(new Error('execution context destroyed')),
          },
        ]),
      };
      expect(await checkMeituanPageRisk(mockPage as unknown as Parameters<typeof checkMeituanPageRisk>[0])).toBe(false);
    });
  });

  describe('dismissMeituanNoticeModals', () => {
    it('should return false for null or undefined page', async () => {
      expect(await dismissMeituanNoticeModals(null as unknown as Parameters<typeof dismissMeituanNoticeModals>[0])).toBe(false);
      expect(await dismissMeituanNoticeModals(undefined as unknown as Parameters<typeof dismissMeituanNoticeModals>[0])).toBe(false);
    });

    it('should return false when no modal is visible', async () => {
      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(false),
      };
      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
        locator: vi.fn().mockReturnValue(mockModal),
      };
      expect(await dismissMeituanNoticeModals(mockPage as unknown as Parameters<typeof dismissMeituanNoticeModals>[0])).toBe(false);
    });

    it('should detect and click dismiss button for notice modal such as 联系客人 and wait for hidden', async () => {
      let modalVisible = true;
      const clickMock = vi.fn().mockImplementation(async () => {
        modalVisible = false;
      });
      const waitForMock = vi.fn().mockResolvedValue(undefined);

      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockImplementation(async () => modalVisible),
        click: clickMock,
      };

      const mockTitle = {
        innerText: vi.fn().mockResolvedValue('联系客人'),
      };

      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockImplementation(async () => modalVisible),
        innerText: vi.fn().mockResolvedValue('联系客人\n请拨打手机号15680403734转1109（虚拟号码）\n您的通话可能会被录音\n我知道了'),
        locator: vi.fn((sel: string) => {
          if (sel.includes('.mtd-modal-title')) {
            return mockTitle;
          }
          return mockDismissBtn;
        }),
        waitFor: waitForMock,
      };

      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
        locator: vi.fn().mockReturnValue(mockModal),
      };

      const result = await dismissMeituanNoticeModals(mockPage as unknown as Parameters<typeof dismissMeituanNoticeModals>[0]);
      expect(result).toBe(true);
      expect(clickMock).toHaveBeenCalledTimes(1);
      expect(waitForMock).toHaveBeenCalledWith({ state: 'hidden', timeout: 1500 });
    });

    it('should NOT dismiss modal when it contains 酒店确认号 (core business red line)', async () => {
      const clickMock = vi.fn().mockResolvedValue(undefined);
      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockResolvedValue(true),
        click: clickMock,
      };

      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('接单确认\n酒店确认号：\n确认接受'),
        locator: vi.fn().mockReturnValue(mockDismissBtn),
        waitFor: vi.fn(),
      };

      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
        locator: vi.fn().mockReturnValue(mockModal),
      };

      const result = await dismissMeituanNoticeModals(mockPage as unknown as Parameters<typeof dismissMeituanNoticeModals>[0]);
      expect(result).toBe(false);
      expect(clickMock).not.toHaveBeenCalled();
    });

    it('should NOT dismiss modal when it contains risk verification keywords (risk red line)', async () => {
      const clickMock = vi.fn().mockResolvedValue(undefined);
      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockResolvedValue(true),
        click: clickMock,
      };

      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('安全验证\n为了您的账号安全，请完成滑动验证码'),
        locator: vi.fn().mockReturnValue(mockDismissBtn),
        waitFor: vi.fn(),
      };

      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
        locator: vi.fn().mockReturnValue(mockModal),
      };

      const result = await dismissMeituanNoticeModals(mockPage as unknown as Parameters<typeof dismissMeituanNoticeModals>[0]);
      expect(result).toBe(false);
      expect(clickMock).not.toHaveBeenCalled();
    });

    it('should NOT dismiss modal when it contains dangerous cancellation keywords (danger red line)', async () => {
      const clickMock = vi.fn().mockResolvedValue(undefined);
      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockResolvedValue(true),
        click: clickMock,
      };

      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('提示\n确认取消该笔订单吗？取消后不可恢复'),
        locator: vi.fn().mockReturnValue(mockDismissBtn),
        waitFor: vi.fn(),
      };

      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
        locator: vi.fn().mockReturnValue(mockModal),
      };

      const result = await dismissMeituanNoticeModals(mockPage as unknown as Parameters<typeof dismissMeituanNoticeModals>[0]);
      expect(result).toBe(false);
      expect(clickMock).not.toHaveBeenCalled();
    });

    it('should return false when dismiss button is not visible', async () => {
      const clickMock = vi.fn().mockResolvedValue(undefined);
      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockResolvedValue(false),
        click: clickMock,
      };

      const mockModal = {
        first: () => mockModal,
        count: vi.fn().mockResolvedValue(1),
        nth: () => mockModal,
        isVisible: vi.fn().mockResolvedValue(true),
        innerText: vi.fn().mockResolvedValue('纯展示信息公告'),
        locator: vi.fn().mockReturnValue(mockDismissBtn),
        waitFor: vi.fn(),
      };

      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
        locator: vi.fn().mockReturnValue(mockModal),
      };

      const result = await dismissMeituanNoticeModals(mockPage as unknown as Parameters<typeof dismissMeituanNoticeModals>[0]);
      expect(result).toBe(false);
      expect(clickMock).not.toHaveBeenCalled();
    });

    it('should skip hidden inactive modals and successfully dismiss subsequent visible notice modal', async () => {
      let isModalVisible = true;
      const clickMock = vi.fn().mockImplementation(async () => {
        isModalVisible = false;
      });
      const waitForMock = vi.fn().mockResolvedValue(undefined);

      const hiddenModal = {
        isVisible: vi.fn().mockResolvedValue(false),
        innerText: vi.fn().mockResolvedValue(''),
      };

      const mockDismissBtn = {
        first: () => mockDismissBtn,
        isVisible: vi.fn().mockImplementation(async () => isModalVisible),
        click: clickMock,
      };

      const mockTitle = {
        innerText: vi.fn().mockResolvedValue('联系客人'),
      };

      const visibleModal = {
        first: () => visibleModal,
        isVisible: vi.fn().mockImplementation(async () => isModalVisible),
        innerText: vi.fn().mockResolvedValue('联系客人\n请拨打手机号18512801426转1730 （虚拟号码，请勿留存）\n我知道了'),
        locator: vi.fn().mockImplementation((sel: string) => {
          if (sel.includes('.mtd-modal-title')) {
            return mockTitle;
          }
          return mockDismissBtn;
        }),
        waitFor: waitForMock,
      };

      const modalList = [hiddenModal, visibleModal];
      const mockModalLocator = {
        count: vi.fn().mockResolvedValue(modalList.length),
        nth: vi.fn().mockImplementation((i: number) => modalList[i]),
      };

      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
        locator: vi.fn().mockReturnValue(mockModalLocator),
      };

      const result = await dismissMeituanNoticeModals(mockPage as unknown as Parameters<typeof dismissMeituanNoticeModals>[0]);
      expect(result).toBe(true);
      expect(clickMock).toHaveBeenCalledTimes(1);
      expect(waitForMock).toHaveBeenCalledWith({ state: 'hidden', timeout: 1500 });
    });
  });

  describe('MeituanDutyRunner lifecycle and page operations', () => {
    let runner: MeituanDutyRunner;

    beforeEach(() => {
      runner = new MeituanDutyRunner();
    });

    it('should dynamically reflect the configured Meituan order URL', () => {
      const original = process.env[APP_ENV_KEYS.otaOrderMeituan];
      try {
        process.env[APP_ENV_KEYS.otaOrderMeituan] =
          'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled';
        const mockRunner = new MeituanDutyRunner();
        expect(mockRunner.targetUrl).toBe(
          'http://127.0.0.1:18080/ebooking/order-gx/index.html?scenario=empty#/unhandled'
        );
      } finally {
        if (original === undefined) {
          delete process.env[APP_ENV_KEYS.otaOrderMeituan];
        } else {
          process.env[APP_ENV_KEYS.otaOrderMeituan] = original;
        }
      }
    });

    it('should initialize with correct default state', () => {
      expect(runner.channelCode).toBe('MEITUAN');
      expect(runner.isRunning()).toBe(false);
    });

    it('should respect explicitly provided targetUrl in constructor', () => {
      const customRunner = new MeituanDutyRunner('http://127.0.0.1:9999/custom/orders');
      expect(customRunner.targetUrl).toBe('http://127.0.0.1:9999/custom/orders');
    });

    it('collectUnhandledOrders should throw when runner is not running', async () => {
      await expect(runner.collectUnhandledOrders()).rejects.toThrow('未运行');
    });

    it('collectUnhandledOrders should fail fast when the reused browser page is closed', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          isClosed: vi.fn().mockReturnValue(true),
        },
      };

      await expect(runner.collectUnhandledOrders()).rejects.toThrow('浏览器页面已关闭');
    });

    it('waitForBrowserClose should resolve when the user closes the browser page', async () => {
      const context = new EventEmitter();
      const page = new EventEmitter();
      const contextClose = vi.fn();
      context.once('close', contextClose);

      (runner as unknown as { session: unknown }).session = {
        context,
        page,
        close: vi.fn().mockResolvedValue(undefined),
      };

      const waiting = runner.waitForBrowserClose();
      page.emit('close');
      await waiting;

      expect(contextClose).not.toHaveBeenCalled();
    });

    describe('waitForPageReady and start initialization', () => {
      it('waitForPageReady should wait for core container, perform settling delay and succeed', async () => {
        const waitForMock = vi.fn().mockResolvedValue(undefined);
        const mockLocator = {
          first: () => mockLocator,
          waitFor: waitForMock,
        };
        const mockPage = {
          url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
          locator: vi.fn().mockReturnValue(mockLocator),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
        };

        await runner.waitForPageReady(mockPage as unknown as Parameters<typeof runner.waitForPageReady>[0], { timeout: 10000 });

        expect(waitForMock).toHaveBeenCalledWith({ state: 'attached', timeout: 10000 });
        expect(mockPage.waitForTimeout).toHaveBeenCalled();
      });

      it('waitForPageReady should fail fast with RISK_VERIFICATION_REQUIRED if page contains risk verification', async () => {
        const mockPage = {
          url: vi.fn().mockReturnValue('https://verify.meituan.com/v2/captcha'),
          locator: vi.fn(),
        };

        await expect(
          runner.waitForPageReady(mockPage as unknown as Parameters<typeof runner.waitForPageReady>[0])
        ).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
      });

      it('waitForPageReady should throw TARGET_PAGE_NOT_READY when core container wait times out', async () => {
        const mockLocator = {
          first: () => mockLocator,
          waitFor: vi.fn().mockRejectedValue(new Error('timeout 15000ms waiting for selector')),
        };
        const mockPage = {
          url: vi.fn().mockReturnValue('https://eb.meituan.com/order'),
          locator: vi.fn().mockReturnValue(mockLocator),
        };

        await expect(
          runner.waitForPageReady(mockPage as unknown as Parameters<typeof runner.waitForPageReady>[0], { timeout: 15000 })
        ).rejects.toThrow('TARGET_PAGE_NOT_READY');
      });

      it('waitForPageReady should throw RISK_VERIFICATION_REQUIRED if container wait fails and risk is detected', async () => {
        let callCount = 0;
        const mockLocator = {
          first: () => mockLocator,
          waitFor: vi.fn().mockRejectedValue(new Error('timeout')),
        };
        const mockPage = {
          url: vi.fn().mockImplementation(() => {
            callCount++;
            return callCount > 1 ? 'https://verify.meituan.com/v2/captcha' : 'https://eb.meituan.com/order';
          }),
          locator: vi.fn().mockReturnValue(mockLocator),
        };

        await expect(
          runner.waitForPageReady(mockPage as unknown as Parameters<typeof runner.waitForPageReady>[0])
        ).rejects.toThrow('RISK_VERIFICATION_REQUIRED');
      });

      it('start should navigate to targetUrl, await waitForPageReady, and set running to true', async () => {
        const mockPage = {
          url: vi.fn().mockReturnValue('https://eb.meituan.com/other'),
          goto: vi.fn().mockResolvedValue(undefined),
          bringToFront: vi.fn().mockResolvedValue(undefined),
        };
        const mockSession = {
          page: mockPage,
          context: {},
          close: vi.fn(),
        };

        (createPersistentBrowserSession as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(mockSession);

        const readySpy = vi.spyOn(runner, 'waitForPageReady').mockResolvedValue(undefined);

        await runner.start();

        expect(mockPage.goto).toHaveBeenCalledWith(runner.targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        });
        expect(readySpy).toHaveBeenCalledWith(mockPage);
        expect(runner.isRunning()).toBe(true);
      });

      it('start should remain not running if waitForPageReady fails', async () => {
        const mockPage = {
          url: vi.fn().mockReturnValue('https://eb.meituan.com/other'),
          goto: vi.fn().mockResolvedValue(undefined),
          bringToFront: vi.fn().mockResolvedValue(undefined),
        };
        const mockSession = {
          page: mockPage,
          context: {},
          close: vi.fn(),
        };

        (createPersistentBrowserSession as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(mockSession);

        vi.spyOn(runner, 'waitForPageReady').mockRejectedValue(new Error('Page container timeout'));

        await expect(runner.start()).rejects.toThrow('Page container timeout');
        expect(runner.isRunning()).toBe(false);
      });
    });

    it('collectUnhandledOrders should refresh order list and return order summaries from single-shot response', async () => {
      const clickSpy = vi.fn().mockResolvedValue(undefined);
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html#/unhandled'),
          locator: vi.fn().mockReturnValue({
            waitFor: vi.fn().mockResolvedValue(undefined),
            getAttribute: vi.fn().mockResolvedValue('mtd-tabs-item mtd-tabs-item-large'),
            click: clickSpy,
          }),
          reload: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({
            status: vi.fn().mockReturnValue(200),
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                data: {
                  list: [
                    {
                      orderId: 'MT-ORD-101',
                      poiId: 'poi-101',
                      poiName: '美团精品酒店',
                      orderDisplayLabel: '新订待处理',
                      cancelOrder: false,
                    },
                  ],
                },
              })
            ),
          }),
          evaluate: vi.fn().mockResolvedValue([]),
        },
      };

      const summaries = await runner.collectUnhandledOrders();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toEqual({
        orderId: 'MT-ORD-101',
        hotelId: 'poi-101',
        hotelName: '美团精品酒店',
        cancelOrder: false,
        orderDisplayLabel: '新订待处理',
      });
      expect(clickSpy).toHaveBeenCalledTimes(2);
    });

    it('collectUnhandledOrders should fail fast and throw LIST_RESPONSE_TIMEOUT when network response times out (no DOM fallback)', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html#/unhandled'),
          locator: vi.fn().mockReturnValue({
            waitFor: vi.fn().mockResolvedValue(undefined),
            getAttribute: vi.fn().mockResolvedValue('mtd-tabs-item mtd-tabs-item-large'),
            click: vi.fn().mockResolvedValue(undefined),
          }),
          reload: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockRejectedValue(new Error('timeout')),
        },
      };

      await expect(runner.collectUnhandledOrders()).rejects.toThrow('LIST_RESPONSE_TIMEOUT');
    });

    it('collectUnhandledOrders should compensate debounce delay using performance.now() when called within REFRESH_DEBOUNCE threshold', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const waitForTimeout = vi.fn().mockResolvedValue(undefined);
      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html#/unhandled'),
        locator: vi.fn().mockReturnValue({
          waitFor: vi.fn().mockResolvedValue(undefined),
          getAttribute: vi.fn().mockResolvedValue('mtd-tabs-item mtd-tab-active'),
          click: vi.fn().mockResolvedValue(undefined),
        }),
        waitForTimeout,
        waitForResponse: vi.fn().mockResolvedValue({
          status: () => 200,
          text: () => Promise.resolve(JSON.stringify({ code: 0, data: [] })),
        }),
      };
      (runner as unknown as { session: { page: unknown } }).session = { page: mockPage };

      // 首次采集，刷新时间记录为当前单调时钟
      await runner.collectUnhandledOrders();

      // 紧接着发起第二次采集，应当触发防抖补偿等待 (waitForTimeout 被调用且延迟大于 0)
      waitForTimeout.mockClear();
      await runner.collectUnhandledOrders();
      expect(waitForTimeout).toHaveBeenCalled();
      const calledDelay = waitForTimeout.mock.calls[0][0];
      expect(calledDelay).toBeGreaterThan(0);
    });

    it('refreshOrderList should always switch through all orders before pending', async () => {
      const actions: string[] = [];
      const allResponse = { status: vi.fn().mockReturnValue(200), text: vi.fn().mockResolvedValue('{}') };
      const pendingResponse = { status: vi.fn().mockReturnValue(200), text: vi.fn().mockResolvedValue('{}') };
      let allTabActive = false;
      const allClick = vi.fn(async () => {
        actions.push('all');
        allTabActive = true;
      });
      const pendingClick = vi.fn(async () => { actions.push('pending'); });
      const reloadSpy = vi.fn().mockResolvedValue(undefined);
      const locatorSpy = vi.fn((selector: string) => {
        const isAll = selector.includes('全部订单');
        const active = isAll ? allTabActive : true;
        return {
          waitFor: vi.fn().mockResolvedValue(undefined),
          getAttribute: vi.fn().mockResolvedValue(active ? 'mtd-tabs-item mtd-tabs-item-large mtd-tab-active' : 'mtd-tabs-item mtd-tabs-item-large'),
          click: isAll ? allClick : pendingClick,
        };
      });
      const waitForResponse = vi.fn()
        .mockResolvedValueOnce(allResponse)
        .mockResolvedValueOnce(pendingResponse);
      const waitForTimeout = vi.fn().mockResolvedValue(undefined);

      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html#/unhandled'),
        locator: locatorSpy,
        reload: reloadSpy,
        waitForResponse,
        waitForTimeout,
      };

      const response = await runner.refreshOrderList(mockPage as unknown as import('playwright').Page);

      expect(locatorSpy).toHaveBeenCalledWith(
        '.tab-container .mtd-tabs-item:has-text("待确认订单")'
      );
      expect(locatorSpy).toHaveBeenCalledWith('.tab-container .mtd-tabs-item.mtd-tab-active:has-text("全部订单")');
      expect(waitForResponse).toHaveBeenCalledTimes(2);
      const [delayMs] = waitForTimeout.mock.calls[0];
      expect(delayMs).toBeGreaterThanOrEqual(1000);
      expect(delayMs).toBeLessThanOrEqual(2000);
      expect(actions).toEqual(['all', 'pending']);
      expect(response).toBe(pendingResponse);
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('refreshOrderList should resolve the order iframe inside the merchant shell page', async () => {
      const clickSpy = vi.fn().mockResolvedValue(undefined);
      const listResponse = { status: vi.fn().mockReturnValue(200), text: vi.fn().mockResolvedValue('{}') };
      const waitForResponse = vi.fn().mockResolvedValue(listResponse);
      const locatorSpy = vi.fn((selector: string) => {
        const active = selector.includes('全部订单') && selector.includes('mtd-tab-active');
        return {
          waitFor: vi.fn().mockResolvedValue(undefined),
          getAttribute: vi.fn().mockResolvedValue(active ? 'mtd-tabs-item mtd-tabs-item-large mtd-tab-active' : 'mtd-tabs-item mtd-tabs-item-large'),
          click: clickSpy,
        };
      });
      const frameLocatorSpy = vi.fn().mockReturnValue({ locator: locatorSpy });

      const mockPage = {
        url: vi.fn().mockReturnValue(
          'https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Forder-gx%2Findex.html%23%2Funhandled'
        ),
        frameLocator: frameLocatorSpy,
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        waitForResponse,
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };

      const response = await runner.refreshOrderList(mockPage as unknown as import('playwright').Page);

      expect(frameLocatorSpy).toHaveBeenCalledWith('#me-iframe-container');
      expect(locatorSpy).toHaveBeenCalledWith(
        '.tab-container .mtd-tabs-item:has-text("待确认订单")'
      );
      expect(clickSpy).toHaveBeenCalledTimes(2);
      expect(response).toBe(listResponse);
    });

    it('refreshOrderList should switch directly to pending when all orders is already active', async () => {
      const actions: string[] = [];
      const pendingResponse = { status: vi.fn().mockReturnValue(200), text: vi.fn().mockResolvedValue('{}') };
      const allClick = vi.fn(async () => { actions.push('all'); });
      const pendingClick = vi.fn(async () => { actions.push('pending'); });
      const locatorSpy = vi.fn((selector: string) => {
        const isAll = selector.includes('全部订单');
        const active = isAll;
        return {
          waitFor: vi.fn().mockResolvedValue(undefined),
          getAttribute: vi.fn().mockResolvedValue(active ? 'mtd-tabs-item mtd-tabs-item-large mtd-tab-active' : 'mtd-tabs-item mtd-tabs-item-large'),
          click: isAll ? allClick : pendingClick,
        };
      });
      const waitForResponse = vi.fn().mockResolvedValue(pendingResponse);
      const waitForTimeout = vi.fn().mockResolvedValue(undefined);
      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html#/all'),
        locator: locatorSpy,
        reload: vi.fn().mockResolvedValue(undefined),
        waitForResponse,
        waitForTimeout,
      };

      const response = await runner.refreshOrderList(mockPage as unknown as import('playwright').Page);

      expect(actions).toEqual(['pending']);
      expect(waitForResponse).toHaveBeenCalledTimes(1);
      expect(waitForTimeout).not.toHaveBeenCalled();
      expect(response).toBe(pendingResponse);
    });

    it('refreshOrderList should fail fast when the exact pending tab is unavailable', async () => {
      const reloadSpy = vi.fn().mockResolvedValue(undefined);
      const mockPage = {
        url: vi.fn().mockReturnValue('https://eb.meituan.com/ebooking/order-gx/index.html#/unhandled'),
        locator: vi.fn().mockReturnValue({
          waitFor: vi.fn().mockRejectedValue(new Error('not visible')),
          getAttribute: vi.fn().mockResolvedValue(null),
          click: vi.fn().mockResolvedValue(undefined),
        }),
        reload: reloadSpy,
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };

      await expect(runner.refreshOrderList(mockPage as unknown as import('playwright').Page))
        .rejects
        .toThrow('LIST_TRIGGER_UNAVAILABLE');
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('refreshOrderList should throw RISK_VERIFICATION_REQUIRED when page is in risk state', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://verify.meituan.com/v2/ext_verify'),
        frames: vi.fn().mockReturnValue([]),
      };

      await expect(runner.refreshOrderList(mockPage as unknown as import('playwright').Page))
        .rejects
        .toThrow('RISK_VERIFICATION_REQUIRED');
    });

    it('collectUnhandledOrders should throw RISK_VERIFICATION_REQUIRED when page is in risk state', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          url: vi.fn().mockReturnValue('https://verify.meituan.com/v2/ext_verify'),
          frames: vi.fn().mockReturnValue([]),
        },
      };

      await expect(runner.collectUnhandledOrders())
        .rejects
        .toThrow('RISK_VERIFICATION_REQUIRED');
    });

    it('inspectOrderDetail should throw RISK_VERIFICATION_REQUIRED when page is in risk state', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          url: vi.fn().mockReturnValue('https://verify.meituan.com/v2/ext_verify'),
          frames: vi.fn().mockReturnValue([]),
        },
      };

      await expect(runner.inspectOrderDetail('MT-RISK-001'))
        .rejects
        .toThrow('RISK_VERIFICATION_REQUIRED');
    });

    it('confirmImport should throw RISK_VERIFICATION_REQUIRED when page is in risk state', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          url: vi.fn().mockReturnValue('https://verify.meituan.com/v2/ext_verify'),
          frames: vi.fn().mockReturnValue([]),
        },
      };

      await expect(runner.confirmImport('CFM-12345', 'MT-RISK-001'))
        .rejects
        .toThrow('RISK_VERIFICATION_REQUIRED');
    });

    it('inspectOrderDetail should throw when runner is not running', async () => {
      await expect(runner.inspectOrderDetail('MT-123')).rejects.toThrow('未运行');
    });

    it('inspectOrderDetail should delegate parsing to parser and return parsed fields with raw payload without premature field validation', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => {
            const card = {
              isVisible: vi.fn().mockResolvedValue(true),
              click: vi.fn().mockResolvedValue(undefined),
              scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
              locator: () => ({
                first: () => ({
                  isVisible: vi.fn().mockResolvedValue(false),
                  click: vi.fn().mockResolvedValue(undefined),
                }),
              }),
            };
            return {
              count: vi.fn().mockResolvedValue(1),
              nth: () => card,
              first: () => card,
            };
          },
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({
            url: () => 'https://eb.meituan.com/api/v1/ebooking/orders/MT-EMPTY-FIELDS',
            status: () => 200,
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                data: {
                  orderId: 'MT-EMPTY-FIELDS',
                  guestName: '',
                  roomTypeName: '',
                  arrival: '',
                  departure: '',
                },
              })
            ),
          }),
        },
      };

      const raw = await runner.inspectOrderDetail('MT-EMPTY-FIELDS');
      expect(raw).toBeDefined();
      expect((raw.data as Record<string, unknown>).orderId).toBe('MT-EMPTY-FIELDS');
    });

    it('inspectOrderDetail should extract raw response from network and return raw object directly', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        locator: () => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(false),
            click: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => cardLocator,
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({
            url: () => 'https://eb.meituan.com/api/v1/ebooking/orders/MT-DOM-001',
            status: () => 200,
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                data: {
                  orderId: 'MT-DOM-001',
                  guestName: '李小龙',
                  guestMobile: '13888889999',
                  roomTypeName: '豪华江景房',
                  ratePlanName: '含早特惠',
                  arrival: '2026-09-20',
                  departure: '2026-09-22',
                  nights: 2,
                  totalPrice: 660,
                  hotelName: '江景国际大饭店',
                },
              })
            ),
          }),
        },
      };

      const raw = await runner.inspectOrderDetail('MT-DOM-001');
      const orderData = (raw.data as Record<string, unknown>);
      expect(orderData.orderId).toBe('MT-DOM-001');
      expect(orderData.guestName).toBe('李小龙');
      expect(orderData.guestMobile).toBe('13888889999');
      expect(orderData.roomTypeName).toBe('豪华江景房');
      expect(orderData.ratePlanName).toBe('含早特惠');
      expect(orderData.arrival).toBe('2026-09-20');
      expect(orderData.departure).toBe('2026-09-22');
      expect(orderData.nights).toBe(2);
      expect(orderData.totalPrice).toBe(660);
      expect(orderData.hotelName).toBe('江景国际大饭店');
    });

    it('inspectOrderDetail should trigger refreshOrderList pre-requisite when order card is not initially visible', async () => {
      (runner as unknown as { running: boolean }).running = true;
      let hasRefreshed = false;
      const refreshSpy = vi.spyOn(runner, 'refreshOrderList').mockImplementation(async () => {
        hasRefreshed = true;
        return {
          status: () => 200,
          text: async () => JSON.stringify({ code: 0, data: { list: [] } }),
        } as unknown as PlaywrightResponse;
      });

      const cardLocator = {
        isVisible: vi.fn().mockImplementation(async () => {
          return hasRefreshed;
        }),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        locator: () => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(false),
            click: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            count: vi.fn().mockImplementation(async () => (hasRefreshed ? 1 : 0)),
            nth: () => cardLocator,
            first: () => cardLocator,
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({
            url: () => 'https://eb.meituan.com/api/v1/ebooking/orders/MT-REFRESH-001',
            status: () => 200,
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                data: {
                  orderId: 'MT-REFRESH-001',
                  guestName: '张三',
                  guestMobile: '13900001111',
                  roomTypeName: '标准双人间',
                  ratePlanName: '标准价',
                  arrival: '2026-09-25',
                  departure: '2026-09-26',
                  nights: 1,
                  totalPrice: 300,
                  hotelName: '阳光商务酒店',
                },
              })
            ),
          }),
        },
      };

      const raw = await runner.inspectOrderDetail('MT-REFRESH-001');
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      const orderData = (raw.data as Record<string, unknown>);
      expect(orderData.orderId).toBe('MT-REFRESH-001');
      expect(orderData.guestName).toBe('张三');
      expect(orderData.roomTypeName).toBe('标准双人间');
    });

    it('inspectOrderDetail should prioritize and merge intercepted network detail when available', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        locator: () => ({
          first: () => ({
            isVisible: vi.fn().mockResolvedValue(false),
            click: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: () => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => cardLocator,
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({
            url: () => 'https://eb.meituan.com/api/v1/ebooking/orders/MT-NET-002',
            status: () => 200,
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                data: {
                  orderId: 'MT-NET-002',
                  guestName: '周星驰',
                  guestMobile: '13911112222',
                  roomTypeName: '至尊套房',
                  ratePlanName: '商务协议价',
                  checkInDateString: '2026-10-01',
                  checkOutDateString: '2026-10-04',
                  nights: 3,
                  quantity: 1,
                  totalFee: 150000,
                  poiId: 'poi-net-002',
                  poiName: '至尊商务酒店',
                },
              })
            ),
          }),
          evaluate: vi.fn().mockResolvedValue(null),
        },
      };

      const raw = await runner.inspectOrderDetail('MT-NET-002');
      const orderData = (raw.data as Record<string, unknown>);
      expect(orderData.orderId).toBe('MT-NET-002');
      expect(orderData.guestName).toBe('周星驰');
      expect(orderData.roomTypeName).toBe('至尊套房');
      expect(orderData.nights).toBe(3);
      expect(orderData.totalFee).toBe(150000);
      expect(orderData.poiId).toBe('poi-net-002');
    });

    it('inspectOrderDetail should intercept real Meituan line net URL /api/v1/ebooking/orders/${orderId} and merge unmasked sensitiveData', async () => {
      (runner as unknown as { running: boolean }).running = true;

      const orderId = '20260917092248573000';
      const onSpy = vi.fn();
      const offSpy = vi.fn();

      const revealBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };
      const confirmDialogBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };
      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        locator: (selector: string) => ({
          first: () => {
            if (selector.includes('查看姓名')) return revealBtn;
            return {
              isVisible: vi.fn().mockResolvedValue(false),
              scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
              click: vi.fn().mockResolvedValue(undefined),
            };
          },
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          on: onSpy,
          off: offSpy,
          locator: (selector: string) => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => {
              if (selector.includes('查看姓名') || selector.includes('btn-text') || selector.includes('guest-name')) return revealBtn;
              if (selector.includes('我已知晓') || selector.includes('确定')) return confirmDialogBtn;
              return cardLocator;
            },
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({
            url: () =>
              `https://eb.meituan.com/api/v1/ebooking/orders/${orderId}?userId=295692068&pageRequestSource=1`,
            status: () => 200,
            text: vi.fn().mockResolvedValue(
              JSON.stringify({
                code: 0,
                data: {
                  orderDetail: {
                    orderId,
                    checkInDate: '2026-09-17',
                    checkOutDate: '2026-09-18',
                    roomName: '豪华景观大床房',
                    ratePlanName: '连住特惠',
                    totalFee: 29800,
                    poiId: 'poi-999',
                    poiName: '美团度假村',
                    guestName: '李*',
                    guestMobile: '138****8888',
                  },
                },
              })
            ),
          }),
          evaluate: vi.fn().mockResolvedValue({
            guestName: '李*',
            roomTypeName: '豪华景观大床房',
            arrival: '2026-09-17',
            departure: '2026-09-18',
            totalPrice: 298,
            quantity: 1,
            hotelName: '美团度假村',
          }),
        },
      };

      onSpy.mockImplementation((event: string, handler: (res: unknown) => Promise<void>) => {
        if (event === 'response') {
          queueMicrotask(() => {
            void handler({
              url: () => `https://eb.meituan.com/api/v1/ebooking/orders/sensitiveData/${orderId}?requiredSensitiveData=2`,
              status: () => 200,
              text: () =>
                Promise.resolve(
                  JSON.stringify({
                    code: 0,
                    data: {
                      sensitiveDataList: [
                        {
                          guestInfos: [
                            {
                              name: '李小龙',
                              phone: '13812345678',
                            },
                          ],
                        },
                      ],
                    },
                  })
                ),
            });
          });
        }
      });

      const raw = await runner.inspectOrderDetail(orderId);
      const rawOrderDetail = ((raw.data as Record<string, unknown>)?.orderDetail as Record<string, unknown>);
      expect(rawOrderDetail?.orderId).toBe(orderId);
      expect(rawOrderDetail?.checkInDate).toBe('2026-09-17');
      expect(rawOrderDetail?.checkOutDate).toBe('2026-09-18');
      expect(rawOrderDetail?.roomName).toBe('豪华景观大床房');
      expect(rawOrderDetail?.guestName).toBe('李小龙');
      expect(rawOrderDetail?.guestMobile).toBe('13812345678');
      expect(rawOrderDetail?.totalFee).toBe(29800);

      expect(offSpy).toHaveBeenCalledWith('response', expect.any(Function));
    });

    it('confirmImport and confirmCancel should operate page locators safely', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const fillSpy = vi.fn().mockResolvedValue(undefined);
      const clickSpy = vi.fn().mockResolvedValue(undefined);

      const inputLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        fill: fillSpy,
        inputValue: vi.fn().mockResolvedValue('CFM-12345'),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const btnLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: clickSpy,
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: clickSpy,
        locator: (selector: string) => ({
          first: () => {
            if (selector.includes('input')) return inputLocator;
            if (selector.includes('button')) return btnLocator;
            return {
              isVisible: vi.fn().mockResolvedValue(false),
              scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
              click: clickSpy,
            };
          },
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: (selector: string) => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => {
              if (selector.includes('input')) return inputLocator;
              if (selector.includes('button')) return btnLocator;
              return cardLocator;
            },
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({ status: () => 200, url: () => 'confirm' }),
        },
      };

      await expect(runner.confirmImport('CFM-12345', 'MT-ORD-99')).resolves.toBeUndefined();
      await expect(runner.confirmCancel('MT-ORD-99')).resolves.toBeUndefined();
    });

    it('confirmImport should target accept button using DOM structure and CSS classes rather than naive text matching', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const clickedSelectors: string[] = [];
      const clickSpy = vi.fn().mockResolvedValue(undefined);

      const acceptBtnLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: clickSpy,
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const inputLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        fill: vi.fn().mockResolvedValue(undefined),
        inputValue: vi.fn().mockResolvedValue('CFM-12345'),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const confirmBtnLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: clickSpy,
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: clickSpy,
        locator: (selector: string) => ({
          first: () => {
            if (selector.includes('input')) return inputLocator;
            if (selector.includes('确认接受')) return confirmBtnLocator;
            return {
              isVisible: vi.fn().mockResolvedValue(false),
              scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
              click: clickSpy,
            };
          },
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: (selector: string) => {
            clickedSelectors.push(selector);
            return {
              count: vi.fn().mockResolvedValue(1),
              nth: () => cardLocator,
              first: () => {
                if (selector.includes('.mtd-btn.op-btn.mtd-btn-primary') || selector.includes('.btn-wrap .btn-container')) {
                  return acceptBtnLocator;
                }
                if (selector.includes('input')) {
                  return inputLocator;
                }
                if (selector.includes('确认接受')) {
                  return confirmBtnLocator;
                }
                return cardLocator;
              },
            };
          },
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({ status: () => 200, url: () => 'confirm' }),
        },
      };

      await expect(runner.confirmImport('CFM-12345', 'MT-ORD-99')).resolves.toBeUndefined();
      expect(clickSpy).toHaveBeenCalled();

      // Verify the accept button selector was queried using DOM hierarchy and CSS classes
      const acceptSelector = clickedSelectors.find(
        (s) => s.includes('.btn-wrap') && s.includes('button.mtd-btn.op-btn.mtd-btn-primary')
      );
      expect(acceptSelector).toBeDefined();
      expect(acceptSelector).toContain('.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary');
      expect(acceptSelector).not.toEqual('button:has-text("接受")');
    });

    it('confirmImport should follow full modal flow: click accept, fill confirmNo in modal, and click 确认接受 in modal footer', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const clickedLabels: string[] = [];
      let filledValue = '';

      const acceptBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockImplementation(async () => {
          clickedLabels.push('accept-btn');
        }),
      };

      const modalInput = {
        isVisible: vi.fn().mockResolvedValue(true),
        inputValue: vi.fn().mockImplementation(async () => filledValue),
        fill: vi.fn().mockImplementation(async (val: string) => {
          filledValue = val;
        }),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const modalConfirmBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockImplementation(async () => {
          clickedLabels.push('modal-confirm-btn');
        }),
      };

      const modalDialog = {
        isVisible: vi.fn().mockResolvedValue(true),
        locator: (sel: string) => ({
          first: () => {
            if (sel.includes('input')) return modalInput;
            if (sel.includes('确认接受')) return modalConfirmBtn;
            return { isVisible: vi.fn().mockResolvedValue(false) };
          },
        }),
      };

      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        locator: (sel: string) => ({
          first: () => {
            if (sel.includes('input')) return modalInput;
            if (sel.includes('确认接受')) return modalConfirmBtn;
            if (sel.includes('button') || sel.includes('op-btn')) return acceptBtn;
            return { isVisible: vi.fn().mockResolvedValue(false) };
          },
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: (selector: string) => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => {
              if (selector.includes('input')) return modalInput;
              if (selector.includes('确认接受')) return modalConfirmBtn;
              if (selector.includes('.mtd-btn.op-btn.mtd-btn-primary') || selector.includes('.btn-wrap') || selector.includes('button')) return acceptBtn;
              if (selector.includes('.mtd-modal') || selector.includes('.modal-container')) return modalDialog;
              return cardLocator;
            },
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({ status: () => 200, url: () => 'https://eb.meituan.com/api/order/confirm' }),
        },
      };

      await runner.confirmImport('CFM-REAL-888', 'MT-ORD-REAL');
      expect(clickedLabels).toEqual(['accept-btn', 'modal-confirm-btn']);
      expect(filledValue).toBe('CFM-REAL-888');
    });

    it('confirmImport should prefer pressSequentially with humanized delay when available', async () => {
      (runner as unknown as { running: boolean }).running = true;
      let typedValue = '';
      let passedOptions: { delay?: number } | undefined;

      const acceptBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const modalInput = {
        isVisible: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
        inputValue: vi.fn().mockImplementation(async () => typedValue),
        pressSequentially: vi.fn().mockImplementation(async (val: string, opts?: { delay?: number }) => {
          typedValue = val;
          passedOptions = opts;
        }),
        fill: vi.fn(),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const modalConfirmBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const modalDialog = {
        isVisible: vi.fn().mockResolvedValue(true),
        locator: (sel: string) => ({
          first: () => {
            if (sel.includes('input')) return modalInput;
            if (sel.includes('确认接受')) return modalConfirmBtn;
            return { isVisible: vi.fn().mockResolvedValue(false) };
          },
        }),
      };

      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        locator: (sel: string) => ({
          first: () => {
            if (sel.includes('input')) return modalInput;
            if (sel.includes('确认接受')) return modalConfirmBtn;
            if (sel.includes('button') || sel.includes('op-btn')) return acceptBtn;
            return { isVisible: vi.fn().mockResolvedValue(false) };
          },
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: (selector: string) => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => {
              if (selector.includes('input')) return modalInput;
              if (selector.includes('确认接受')) return modalConfirmBtn;
              if (selector.includes('.mtd-btn.op-btn.mtd-btn-primary') || selector.includes('.btn-wrap') || selector.includes('button')) return acceptBtn;
              if (selector.includes('.mtd-modal') || selector.includes('.modal-container')) return modalDialog;
              return cardLocator;
            },
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({ status: () => 200, url: () => 'https://eb.meituan.com/api/order/confirm' }),
        },
      };

      await runner.confirmImport('CFM-HUMAN-777', 'MT-ORD-PRESS');
      expect(modalInput.pressSequentially).toHaveBeenCalledTimes(1);
      expect(modalInput.fill).not.toHaveBeenCalled();
      expect(typedValue).toBe('CFM-HUMAN-777');
      expect(passedOptions?.delay).toBeGreaterThanOrEqual(35);
      expect(passedOptions?.delay).toBeLessThanOrEqual(75);
    });

    it('confirmImport should fail fast with CONFIRM_INPUT_ALREADY_FILLED when modal input contains different confirm number', async () => {
      (runner as unknown as { running: boolean }).running = true;

      const acceptBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const modalInput = {
        isVisible: vi.fn().mockResolvedValue(true),
        inputValue: vi.fn().mockResolvedValue('CFM-EXISTING-999'),
        fill: vi.fn(),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const modalDialog = {
        isVisible: vi.fn().mockResolvedValue(true),
        locator: (sel: string) => ({
          first: () => {
            if (sel.includes('input')) return modalInput;
            return { isVisible: vi.fn().mockResolvedValue(false) };
          },
        }),
      };

      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        locator: (sel: string) => ({
          first: () => {
            if (sel.includes('input')) return modalInput;
            if (sel.includes('button') || sel.includes('op-btn')) return acceptBtn;
            return { isVisible: vi.fn().mockResolvedValue(false) };
          },
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: (selector: string) => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => {
              if (selector.includes('input')) return modalInput;
              if (selector.includes('.mtd-btn.op-btn.mtd-btn-primary') || selector.includes('.btn-wrap') || selector.includes('button')) return acceptBtn;
              if (selector.includes('.mtd-modal') || selector.includes('.modal-container')) return modalDialog;
              return cardLocator;
            },
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({ status: () => 200 }),
        },
      };

      await expect(runner.confirmImport('CFM-NEW-111', 'MT-ORD-CONFLICT'))
        .rejects
        .toThrow('已存在其他确认号「CFM-EXISTING-999」');
    });

    it('confirmImport should fail fast with CONFIRM_VALUE_MISMATCH when filled value does not match read-back', async () => {
      (runner as unknown as { running: boolean }).running = true;

      const acceptBtn = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };

      let currentVal = '';
      const modalInput = {
        isVisible: vi.fn().mockResolvedValue(true),
        inputValue: vi.fn().mockImplementation(async () => currentVal),
        fill: vi.fn().mockImplementation(async () => {
          currentVal = 'CFM-CORRUPTED'; // Simulate UI read-back mismatch
        }),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      const modalDialog = {
        isVisible: vi.fn().mockResolvedValue(true),
        locator: (sel: string) => ({
          first: () => {
            if (sel.includes('input')) return modalInput;
            return { isVisible: vi.fn().mockResolvedValue(false) };
          },
        }),
      };

      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        locator: (sel: string) => ({
          first: () => {
            if (sel.includes('input')) return modalInput;
            if (sel.includes('button') || sel.includes('op-btn')) return acceptBtn;
            return { isVisible: vi.fn().mockResolvedValue(false) };
          },
        }),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: (selector: string) => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => {
              if (selector.includes('input')) return modalInput;
              if (selector.includes('.mtd-btn.op-btn.mtd-btn-primary') || selector.includes('.btn-wrap') || selector.includes('button')) return acceptBtn;
              if (selector.includes('.mtd-modal') || selector.includes('.modal-container')) return modalDialog;
              return cardLocator;
            },
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
          waitForResponse: vi.fn().mockResolvedValue({ status: () => 200 }),
        },
      };

      await expect(runner.confirmImport('CFM-TARGET-123', 'MT-ORD-MISMATCH'))
        .rejects
        .toThrow('确认号填入后读回校验不一致');
    });

    it('confirmCancel should throw when otaOrderId is empty', async () => {
      (runner as unknown as { running: boolean }).running = true;
      (runner as unknown as { session: { page: unknown } }).session = {
        page: { locator: vi.fn() },
      };
      await expect(runner.confirmCancel(''))
        .rejects
        .toThrow('otaOrderId 不能为空');
    });

    it('confirmCancel should locate order card, activate detail, find 我已知晓 button via DOM hierarchy/CSS, and click it', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const clickedActions: string[] = [];

      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockImplementation(async () => {
          clickedActions.push('card-click');
        }),
      };

      const ackBtnLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockImplementation(async () => {
          clickedActions.push('ack-btn-click');
        }),
      };

      const queriedSelectors: string[] = [];

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: (selector: string) => {
            queriedSelectors.push(selector);
            return {
              count: vi.fn().mockResolvedValue(1),
              nth: () => cardLocator,
              first: () => {
                if (selector.includes('我已知晓')) return ackBtnLocator;
                if (selector.includes('.detail-header')) return { isVisible: vi.fn().mockResolvedValue(true) };
                return cardLocator;
              },
            };
          },
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
        },
      };

      await runner.confirmCancel('MT-ORD-CANCEL-01');
      expect(clickedActions).toEqual(['card-click', 'ack-btn-click']);

      // Verify the button selector was queried using strict DOM hierarchy and CSS classes
      const ackSelector = queriedSelectors.find(
        (s) => s.includes('.btn-wrap') && s.includes('button.mtd-btn.op-btn.mtd-btn-primary') && s.includes('我已知晓')
      );
      expect(ackSelector).toBeDefined();
      expect(ackSelector).toContain('.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓")');
    });

    it('confirmCancel should fail fast with CONFIRM_SUBMIT_NOT_FOUND when 我已知晓 button is not visible', async () => {
      (runner as unknown as { running: boolean }).running = true;

      const cardLocator = {
        isVisible: vi.fn().mockResolvedValue(true),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
      };

      const ackBtnLocator = {
        isVisible: vi.fn().mockResolvedValue(false),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
      };

      (runner as unknown as { session: { page: unknown } }).session = {
        page: {
          locator: (selector: string) => ({
            count: vi.fn().mockResolvedValue(1),
            nth: () => cardLocator,
            first: () => {
              if (selector.includes('我已知晓')) return ackBtnLocator;
              if (selector.includes('.detail-header')) return { isVisible: vi.fn().mockResolvedValue(true) };
              return cardLocator;
            },
          }),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
        },
      };

      await expect(runner.confirmCancel('MT-ORD-CANCEL-NOTFOUND'))
        .rejects
        .toThrow('详情头部未找到「我已知晓」确认取消操作按钮');
    });
  });

  describe('MeituanDutyRunner executeTask delegation via dispatchDutyTask', () => {
    let runner: MeituanDutyRunner;

    beforeEach(() => {
      runner = new MeituanDutyRunner();
    });

    it('should reject task execution when runner is not running', async () => {
      const task: DutyClaimedTask = {
        id: 'task-001',
        businessId: 'biz-001',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: '',
      };

      const result = await runner.executeTask(task);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('RUNNER_NOT_RUNNING');
      expect(result.errorMessage).toContain('未运行');
    });

    it('should execute OTA_COLLECT_ORDER and return unhandled order summaries', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const collectSpy = vi.spyOn(runner, 'collectUnhandledOrders').mockResolvedValue([
        {
          orderId: 'MT-CAP-001',
          hotelId: 'poi-1',
          hotelName: '美团精选酒店',
          orderDisplayLabel: '新订',
          cancelOrder: false,
        },
      ]);

      const task: DutyClaimedTask = {
        id: 'task-collect-01',
        businessId: 'MT-COLLECT',
        businessType: 'ORDER',
        msgType: 'OTA_COLLECT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: '',
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('SUCCEEDED');
      expect(execResult.result?.otaChannelCode).toBe('MEITUAN');
      expect(execResult.result?.recordCount).toBe(1);
      expect(collectSpy).toHaveBeenCalledTimes(1);
    });

    it('should execute OTA_IMPORT_ORDER by inspecting order details and importing to middle platform', async () => {
      (runner as unknown as { running: boolean }).running = true;

      const inspectSpy = vi.spyOn(runner, 'inspectOrderDetail').mockResolvedValue({
        otaOrderId: 'MT-998877',
        otaChannel: 'MEITUAN',
        unitId: 'hotel-007',
        unitName: '美团旗舰店',
        guestName: '孙悟空',
        guestMobile: '13900001111',
        roomTypeName: '水帘洞豪华大套房',
        ratePlanName: '含早特惠',
        arrival: '2026-09-25',
        departure: '2026-09-27',
        nights: 2,
        quantity: 1,
        floorPrice: 99800,
      });

      const importSpy = vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockResolvedValue({
        success: true,
        pmsOrderId: 'PMS-ORDER-888',
      });

      const taskPayload = {
        otaOrderId: 'MT-998877',
        unitId: 'hotel-007',
      };
      const task: DutyClaimedTask = {
        id: 'task-import-01',
        businessId: 'MT-998877',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('SUCCEEDED');
      expect(execResult.result?.pmsOrderId).toBe('PMS-ORDER-888');
      expect(execResult.result?.otaOrderId).toBe('MT-998877');
      expect(inspectSpy).toHaveBeenCalledWith('MT-998877');

      // 验证调用中台 importToolkitOrder 时传入的是页面实际提取的真实字段，绝对没有虚构默认值
      expect(importSpy).toHaveBeenCalledTimes(1);
      expect(importSpy).toHaveBeenCalledWith({
        extUnitCode: 'hotel-007',
        orders: [
          {
            otaOrderId: 'MT-998877',
            otaChannel: 'MEITUAN',
            contact: {
              name: '孙悟空',
              mobile: '13900001111',
            },
            booking: {
              roomType: '水帘洞豪华大套房',
              originRoomType: '水帘洞豪华大套房',
              rateCode: '含早特惠',
              arrival: '2026-09-25',
              departure: '2026-09-27',
              roomTypeId: 'ROOM_DEFAULT',
              nights: 2,
              quantity: 1,
              totalPrice: 998,
              paytype: '预付',
              pricing: [
                {
                  date: '2026-09-25',
                  price: 499,
                },
                {
                  date: '2026-09-26',
                  price: 499,
                },
              ],
            },
            remark: '',
          },
        ],
      });
    });

    it('should fail fast with ORDER_DETAIL_FETCH_FAILED when inspectOrderDetail throws', async () => {
      (runner as unknown as { running: boolean }).running = true;

      vi.spyOn(runner, 'inspectOrderDetail').mockRejectedValue(
        new Error('美团订单「MT-ERR-01」详情提取失败：页面及接口均未获取到关键字段')
      );

      const task: DutyClaimedTask = {
        id: 'task-import-inspect-fail',
        businessId: 'MT-ERR-01',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify({ otaOrderId: 'MT-ERR-01' })).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('FAILED');
      expect(execResult.errorCode).toBe('ORDER_DETAIL_FETCH_FAILED');
      expect(execResult.errorMessage).toContain('详情提取失败');
    });

    it('should return IMPORT_FAILED when importToolkitOrder fails', async () => {
      (runner as unknown as { running: boolean }).running = true;

      vi.spyOn(runner, 'inspectOrderDetail').mockResolvedValue({
        otaOrderId: 'MT-CONFLICT',
        otaChannel: 'MEITUAN',
        guestName: '猪八戒',
        roomTypeName: '高老庄标准间',
        arrival: '2026-10-01',
        departure: '2026-10-02',
        nights: 1,
        quantity: 1,
        totalPrice: 200,
      });

      vi.spyOn(dutyRuntimeApi, 'importToolkitOrder').mockRejectedValue(new Error('PMS 房态冲突'));

      const task: DutyClaimedTask = {
        id: 'task-import-err',
        businessId: 'MT-CONFLICT',
        businessType: 'ORDER',
        msgType: 'OTA_IMPORT_ORDER',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify({ otaOrderId: 'MT-CONFLICT' })).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('FAILED');
      expect(execResult.errorCode).toBe('IMPORT_FAILED');
      expect(execResult.errorMessage).toContain('PMS 房态冲突');
    });

    it('should execute OTA_CONFIRM_IMPORT and call runner.confirmImport', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const confirmSpy = vi.spyOn(runner, 'confirmImport').mockResolvedValue(undefined);

      const taskPayload = { confirmNo: 'CFM-9988', otaOrderId: 'MT-IMPORT-OK' };
      const task: DutyClaimedTask = {
        id: 'task-cfm-01',
        businessId: 'MT-IMPORT-OK',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('SUCCEEDED');
      expect(execResult.result?.confirmed).toBe(true);
      expect(execResult.result?.confirmNo).toBe('CFM-9988');
      expect(confirmSpy).toHaveBeenCalledWith('CFM-9988', 'MT-IMPORT-OK');
    });

    it('should fail fast and throw DutyExecutionError when confirmImport is called while confirmImportEnabled is false', async () => {
      runner.setConfirmImportEnabled(false);
      expect(runner.confirmImportEnabled).toBe(false);

      await expect(runner.confirmImport('CFM-001', 'MT-ORD-001')).rejects.toThrow('已关闭订单确认号回填开关');

      runner.setConfirmImportEnabled(true);
    });

    it('should intercept OTA_CONFIRM_IMPORT via executeTask when confirmImportEnabled is false', async () => {
      (runner as unknown as { running: boolean }).running = true;
      runner.setConfirmImportEnabled(false);

      const taskPayload = { confirmNo: 'CFM-9988', otaOrderId: 'MT-IMPORT-OK' };
      const task: DutyClaimedTask = {
        id: 'task-cfm-disabled-runner',
        businessId: 'MT-IMPORT-OK',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_IMPORT',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('FAILED');
      expect(execResult.errorCode).toBe('CONFIRM_IMPORT_DISABLED');
      expect(execResult.errorMessage).toContain('已关闭订单确认号回填开关');
      expect(execResult.retryable).toBe(false);

      runner.setConfirmImportEnabled(true);
    });

    it('should execute OTA_CONFIRM_CANCEL and acknowledge cancellation', async () => {
      (runner as unknown as { running: boolean }).running = true;
      const cancelSpy = vi.spyOn(runner, 'confirmCancel').mockResolvedValue(undefined);

      const task: DutyClaimedTask = {
        id: 'task-cancel-01',
        businessId: 'MT-CANCEL-REQ',
        businessType: 'ORDER',
        msgType: 'OTA_CONFIRM_CANCEL',
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: '',
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('SUCCEEDED');
      expect(execResult.result?.acknowledged).toBe(true);
      expect(cancelSpy).toHaveBeenCalledWith('MT-CANCEL-REQ');
    });

    it('should fail fast on unsupported task message type', async () => {
      (runner as unknown as { running: boolean }).running = true;

      const task: DutyClaimedTask = {
        id: 'task-unknown',
        businessId: 'biz-none',
        businessType: 'ORDER',
        msgType: 'UNKNOWN_MSG_TYPE' as unknown as DutyClaimedTask['msgType'],
        stationId: 'st-01',
        leaseToken: 'lt-01',
        data: '',
      };

      const execResult = await runner.executeTask(task);
      expect(execResult.status).toBe('FAILED');
      expect(execResult.errorCode).toBe('UNSUPPORTED_TASK_TYPE');
    });
  });
});
