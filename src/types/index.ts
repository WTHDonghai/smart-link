export type NavTab = 
  | 'channel-mapping' 
  | 'hotel-sync' 
  | 'product-mapping' 
  | 'order-guardian' 
  | 'system-logs';

export interface OTAChannel {
  id: string;
  name: string;
  code: string;
  short: string;
  bgColor: string;
  textColor: string;
  targetSystem: string;
  targetSystemOptions: { val: string; label: string }[];
  remarkTemplate: string;
  status: 'active' | 'warning' | 'paused';
  crawlerStatus: 'online' | 'refreshing' | 'offline';
  todayOrders: number;
  lastSyncTime: string;
}

export interface HotelMapping {
  id: string;
  otaChannelId: string;
  otaHotelName: string;
  otaHotelId: string;
  pmsHotelName: string;
  pmsHotelId: string;
  city: string;
  starRating: string;
  status: 'mapped' | 'pending' | 'error';
  lastScraped: string;
  roomCount: number;
}

export interface ProductMapping {
  id: string;
  hotelId: string;
  hotelName: string;
  otaChannelId: string;
  otaProductName: string;
  otaProductCode: string;
  otaPhysicalRoomName: string;
  otaPhysicalRoomCode: string;
  internalRoomType: string;
  rateCode: string;
  bookingType: string;
  status: 'completed' | 'pending' | 'active' | 'inactive';
  priceRule?: 'direct' | 'markup_fixed' | 'markup_percent';
  markupValue?: number;
  autoSyncInventory?: boolean;
}

export type OrderStatus = 'transferred' | 'processing' | 'confirmed' | 'failed' | 'manual_review' | 'pending' | 'success' | 'cancelled' | 'importing';

export interface GuardianOrder {
  id: string;
  otaOrderNo: string;
  pmsOrderNo: string;
  channelId: string;
  channelName: string;
  hotelName: string;
  roomTypeName: string;
  ratePlanCode?: string;
  guestName: string;
  guestPhone: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  rooms: number;
  otaPrice: number;
  pmsCostPrice: number;
  profit: number;
  status: OrderStatus;
  failureReason?: string;
  bookingType?: string;
  travelRoomType?: string;
  dailyPrices?: { date: string; price: number }[];
  remark: string;
  scrapedAt: string;
  transferredAt: string;
  crawlerDurationMs: number;
}

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: 'PLAYWRIGHT' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  channelId?: string;
  message: string;
  details?: string;
}

export interface PlaywrightConfig {
  isRunning: boolean;
  headless: boolean;
  workerCount: number;
  activeThreads: number;
  crawlIntervalSec: number;
  autoCaptchaSolver: boolean;
  proxyEnabled: boolean;
  browserType: 'chromium' | 'firefox' | 'webkit';
  sessions: {
    channelId: string;
    accountName: string;
    cookieStatus: 'valid' | 'expiring' | 'expired';
    lastPing: string;
  }[];
}
