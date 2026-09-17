import type { DutyClaimedTask } from '../../types';

export interface DutyTaskExecutionResult {
  status: 'SUCCEEDED' | 'FAILED';
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface DutyUnhandledOrderSummary {
  orderId: string;
  hotelId?: string;
  hotelName?: string;
  cancelOrder?: boolean;
  orderDisplayLabel?: string;
}

export interface ExtractedOrderDetail {
  otaOrderId: string;
  otaChannel: string;
  unitId?: string;
  unitName?: string;
  guestName: string;
  guestMobile?: string;
  roomTypeName: string;
  ratePlanName?: string;
  arrival: string;     // YYYY-MM-DD
  departure: string;   // YYYY-MM-DD
  nights: number;
  quantity: number;
  totalPrice: number;
  raw?: Record<string, unknown>;
}

export interface RawMeituanDutyOrder {
  orderId: string;
  hotelId?: string;
  hotelName?: string;
  orderDisplayLabel: string;
  orderTime?: string;
  roomName: string;
  ratePlanName?: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  quantity: number;
  totalAmount: number;
  contacts: Array<{ name: string; phone: string }>;
  paymentType?: string;
  cancelOrder?: boolean;
  raw: Record<string, unknown>;
}

export interface ChannelDutyRunner {
  readonly channelCode: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;

  /** 页面操作：刷新订单列表并获取当前待处理订单概要 */
  collectUnhandledOrders(): Promise<DutyUnhandledOrderSummary[]>;

  /** 页面操作：在当前渠道后台点击打开订单详情并抓取结构化字段（绝无虚构默认值） */
  inspectOrderDetail(otaOrderId: string): Promise<ExtractedOrderDetail>;

  /** 页面操作：关闭详情视图（弹窗/抽屉）以保持页面就绪 */
  closeOrderDetail?(): Promise<void>;

  /** 页面操作：在渠道后台页面执行确认号回填 */
  confirmImport?(confirmNo: string, otaOrderId: string): Promise<void>;

  /** 页面操作：在渠道后台确认取消（我已知晓） */
  confirmCancel?(otaOrderId: string): Promise<void>;

  /** 兼容层：支持直接执行任务 */
  executeTask?(task: DutyClaimedTask): Promise<DutyTaskExecutionResult>;
}
