import type { DutyClaimedTask } from '../../types';

export interface DutyTaskExecutionResult {
  status: 'SUCCEEDED' | 'FAILED';
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
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
  executeTask(task: DutyClaimedTask): Promise<DutyTaskExecutionResult>;
}
