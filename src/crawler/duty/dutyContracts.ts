import type { DutyClaimedTask, DutyTaskMessageType, SystemLogEntry } from '@/src/types'
import { dispatchDutyTask } from './dutyTaskDispatcher';

/**
 * 客户端自动化执行器支持的任务消息类型白名单
 */
export const SUPPORTED_DUTY_TASK_TYPES = [
  'OTA_COLLECT_ORDER',
  'OTA_IMPORT_ORDER',
  'OTA_CONFIRM_IMPORT',
  'OTA_CONFIRM_CANCEL',
] as const satisfies readonly DutyTaskMessageType[];

export type SupportedDutyTaskType = (typeof SUPPORTED_DUTY_TASK_TYPES)[number];

export function isSupportedDutyTaskType(msgType: unknown): msgType is SupportedDutyTaskType {
  return (
    typeof msgType === 'string' &&
    (SUPPORTED_DUTY_TASK_TYPES as readonly string[]).includes(msgType)
  );
}

export interface DutyTaskExecutionResult {
  status: 'SUCCEEDED' | 'FAILED';
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export interface DutyUnhandledOrderSummary {
  orderId: string;
  hotelId?: string;
  hotelName?: string;
  cancelOrder?: boolean;
  afterSaleId?: string;
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
  remark?: string;
  raw?: Record<string, unknown>;
}

export class DutyExecutionError extends Error {
  public readonly errorCode: string;
  public readonly retryable?: boolean;

  constructor(message: string, errorCode: string, retryable?: boolean) {
    super(message.includes(errorCode) ? message : `[${errorCode}] ${message}`);
    this.name = 'DutyExecutionError';
    this.errorCode = errorCode;
    this.retryable = retryable;
    Object.setPrototypeOf(this, DutyExecutionError.prototype);
  }
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

export interface RawDouyinDutyOrder {
  orderId: string;
  bookId?: string;
  afterSaleId?: string;
  hotelId?: string;
  hotelName?: string;
  orderDisplayLabel: string;
  orderTime?: string;
  roomName: string;
  productName?: string;
  productId: string;
  checkInDate?: string;
  checkOutDate?: string;
  nights?: number;
  quantity?: number;
  totalAmount?: number;
  contacts?: Array<{ name: string; phone?: string }>;
  cancelOrder?: boolean;
  raw: Record<string, unknown>;
}

export interface DutyActionDryRunOptions {
  dryRun?: boolean;
}

export interface DutyActionVerificationResult {
  verified: boolean;
  orderId: string;
  action: 'confirmImport' | 'confirmCancel';
  dryRun: boolean;
  verifiedSteps: string[];
  fieldValues?: Record<string, unknown>;
  message?: string;
}

export interface ChannelDutyRunner {
  readonly channelCode: string;
  readonly supportedTaskTypes?: readonly SupportedDutyTaskType[];
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;

  /** 页面操作：刷新订单列表并获取当前待处理订单概要 */
  collectUnhandledOrders(context?: unknown): Promise<DutyUnhandledOrderSummary[]>;

  /** 页面操作：在当前渠道后台点击打开订单详情并抓取原始数据（回写明文客人姓名） */
  inspectOrderDetail(otaOrderId: string): Promise<Record<string, unknown>>;

  /** 页面操作：在渠道后台页面执行确认号回填（支持安全演练 dryRun 模式） */
  confirmImport?(
    confirmNo: string,
    otaOrderId: string,
    options?: DutyActionDryRunOptions
  ): Promise<DutyActionVerificationResult | void>;

  /** 页面操作：在渠道后台确认取消（我已知晓，支持安全演练 dryRun 模式） */
  confirmCancel?(
    otaOrderId: string,
    options?: DutyActionDryRunOptions
  ): Promise<DutyActionVerificationResult | void>;

  /** 可选：是否允许回填订单确认号（安全控制开关） */
  confirmImportEnabled?: boolean;
  setConfirmImportEnabled?(enabled: boolean): void;

  /** 统一任务执行入口：执行认领到的具体值守任务 */
  executeTask(
    task: DutyClaimedTask,
    onLog?: (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => void
  ): Promise<DutyTaskExecutionResult>;
}

/**
 * 渠道自动化值守执行器通用抽象基类
 * 统一管理各渠道的生命周期状态、确认号回填开关，并默认提供客户端支持的全量标准任务白名单
 */
export abstract class BaseChannelDutyRunner implements ChannelDutyRunner {
  public abstract readonly channelCode: string;

  /**
   * 渠道支持的任务类型白名单。
   * 默认具备系统标准的全量值守任务能力（采集、导入、接单、取消）。
   * 处于分期开发或特定受限渠道可显式重写此属性。
   */
  public readonly supportedTaskTypes: readonly SupportedDutyTaskType[] = SUPPORTED_DUTY_TASK_TYPES;

  protected running = false;
  public confirmImportEnabled = true;

  public isRunning(): boolean {
    return this.running;
  }

  public setConfirmImportEnabled(enabled: boolean): void {
    this.confirmImportEnabled = Boolean(enabled);
  }

  public abstract start(): Promise<void>;
  public abstract stop(): Promise<void>;
  public abstract collectUnhandledOrders(context?: unknown): Promise<DutyUnhandledOrderSummary[]>;
  public abstract inspectOrderDetail(otaOrderId: string): Promise<Record<string, unknown>>;

  /**
   * 统一任务执行默认实现：委托给顶层通用任务编排调度器 dispatchDutyTask。
   * 如有特殊渠道需深度定制任务生命周期，亦可单独 override 此方法。
   */
  public async executeTask(
    task: DutyClaimedTask,
    onLog?: (entry: Omit<SystemLogEntry, 'id' | 'timestamp' | 'createdAt'>) => void
  ): Promise<DutyTaskExecutionResult> {
    return dispatchDutyTask(task, this, onLog, {
      confirmImportEnabled: this.confirmImportEnabled,
    });
  }
}

