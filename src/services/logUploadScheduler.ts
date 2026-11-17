/**
 * 日志上传调度器：每日凌晨定时上传昨日日志
 *
 * 策略（北京时间 02:00 定时，跨时区按本地时钟偏移换算）：
 *   - 应用启动时补传昨日日志（应用在凌晨未运行时，由启动收口兜底；已上传过则当日不重复）
 *   - 定时器对准本地时区的「02:00」触发，每次触发后自动排期下一天，无轮询空转
 *   - 未登录（无 tenantId）时跳过本次调度，等下个窗口，不抛错不重试风暴
 */

import { logger } from './logger';
import { loadTokensFromStorage } from './platformAuth';
import { uploadLogContent } from './logUploadApi';
import {
  buildLogUploadObjectKey,
  buildLogUploadFileName,
  serializeLogsForUpload,
} from '../utils/logUploadPath';

/** 每日定时上传时刻：本地时区凌晨 2 点（按用户约定为北京时间凌晨 2 点） */
const SCHEDULE_HOUR = 2;
const SCHEDULE_MINUTE = 0;

/** 启动补传延迟：错开启动高峰 */
const STARTUP_DELAY_MS = 2 * 60 * 1000;

/** 单次分页拉取日志的页大小 */
const LOG_PAGE_SIZE = 2000;

/** 已触发过上传的本地日期锚点（YYYY-MM-DD），防止同日重复上传 */
let lastUploadedDateKey: string | null = null;

let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let isUploading = false;

/** 按本地时区格式化 YYYY-MM-DD */
function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** 距下一个「本地 HH:mm」时刻的毫秒数（导出供单测校验排期算术） */
export function msUntilNextSchedule(now: Date = new Date()): number {
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    SCHEDULE_HOUR,
    SCHEDULE_MINUTE,
    0,
    0
  );
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/** 解析指定日期日志的毫秒边界（本地时区 00:00:00.000 ~ 23:59:59.999） */
function resolveDayBounds(dayDate: Date): { startMs: number; endMs: number; dateKey: string } {
  const startMs = new Date(
    dayDate.getFullYear(),
    dayDate.getMonth(),
    dayDate.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return { startMs, endMs, dateKey: formatDateKey(dayDate) };
}

/** 分页拉取指定日期区间的全部日志条目（游标循环，直至 hasMore 为 false） */
async function collectLogsForDay(bounds: { startMs: number; endMs: number; dateKey: string }) {
  const collected = [];
  let cursor: { createdAt: number; id: string } | undefined = undefined;

  do {
    // 经 logger 查询：先排空写入缓冲再读 IndexedDB，确保收口完整（含尚未 flush 的最新条目）
    // 日期过滤传本地 YYYY-MM-DD：logStorage 按本地时区建天边界，ISO(UTC) 串会被错移一天
    const page = await logger.queryLogs(
      {
        startDate: bounds.dateKey,
        endDate: bounds.dateKey,
      },
      { pageSize: LOG_PAGE_SIZE, cursor }
    );
    collected.push(...page.items);
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);

  return collected;
}

/** 上传指定日期的全部日志；未登录或无日志时显式跳过 */
export async function uploadLogsForDay(dayDate: Date): Promise<'uploaded' | 'empty' | 'no-auth'> {
  const tokens = loadTokensFromStorage();
  const tenantId = tokens?.tenantId?.trim() || '';
  if (!tenantId) {
    return 'no-auth';
  }

  const bounds = resolveDayBounds(dayDate);
  const logs = await collectLogsForDay(bounds);
  if (logs.length === 0) {
    return 'empty';
  }

  const content = serializeLogsForUpload(logs);
  const fileName = buildLogUploadFileName({ tenantId, date: dayDate });
  const objectKey = buildLogUploadObjectKey({ tenantId, date: dayDate, fileName });

  await uploadLogContent({
    objectKey,
    fileName,
    content,
    entryCount: logs.length,
  });

  return 'uploaded';
}

/**
 * 手工触发上传（系统日志页「上传日志」按钮）：上传今天与昨天两天的日志并汇总结果。
 * 供 UI 直接消费：返回每个日期的终态描述；失败向上抛出首个错误由调用方提示。
 */
export async function uploadLogsManually(): Promise<ManualUploadSummary> {
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const items: ManualUploadSummaryItem[] = [];

  let firstError: unknown = null;
  for (const dayDate of [today, yesterday]) {
    const dateKey = formatDateKey(dayDate);
    try {
      const result = await uploadLogsForDay(dayDate);
      items.push({ dateKey, result });
    } catch (error) {
      // 保留第一天失败信息继续尝试第二天，最终抛出首个错误
      if (!firstError) firstError = error;
      items.push({ dateKey, result: 'failed' });
    }
  }

  if (firstError) {
    throw firstError;
  }

  const uploadedDates = items.filter((item) => item.result === 'uploaded').map((item) => item.dateKey);
  const skippedNoAuth = items.some((item) => item.result === 'no-auth');

  return { items, uploadedDates, skippedNoAuth };
}

/** 单日手工上传终态描述 */
export type ManualUploadDayResult = 'uploaded' | 'empty' | 'no-auth' | 'failed';

export interface ManualUploadSummaryItem {
  dateKey: string;
  result: ManualUploadDayResult;
}

export interface ManualUploadSummary {
  items: ManualUploadSummaryItem[];
  /** 成功上传的日期列表（用于成功 toast 文案） */
  uploadedDates: string[];
  /** 任一天因未登录被跳过（用于提示先登录） */
  skippedNoAuth: boolean;
}

/** 定时触发点（本地凌晨 02:00）：上传昨天的日志并登记日期锚点 */
async function runScheduledUpload(): Promise<void> {
  if (isUploading) return;

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateKey = formatDateKey(yesterday);
  if (dateKey === lastUploadedDateKey) {
    return;
  }

  isUploading = true;
  try {
    await uploadLogsForDay(yesterday);
    lastUploadedDateKey = dateKey;
  } catch {
    // 上传失败已由 uploadLogContent 写入 ERROR 结构化日志；不登记锚点，
    // 启动补传窗口或次日定时窗口仍会重试该日期（幂等：文件名含毫秒时间戳，重传为新文件）
  } finally {
    isUploading = false;
  }
}

/**
 * 启动补传：上传昨天的日志（应用凌晨未运行时兜底收口前一天）。
 * 同日已由定时任务上传过则跳过，避免重复上传。
 */
export async function startupCatchUpUpload(): Promise<void> {
  if (isUploading) return;

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateKey = formatDateKey(yesterday);
  if (dateKey === lastUploadedDateKey) {
    return;
  }

  isUploading = true;
  try {
    await uploadLogsForDay(yesterday);
    lastUploadedDateKey = dateKey;
  } catch {
    // 失败已由 uploadLogContent 落 ERROR 日志，不再向上传播；不登记锚点，定时窗口仍可重试
  } finally {
    isUploading = false;
  }
}

/** 排期下一次凌晨定时触发 */
function scheduleNextRun(): void {
  const delay = msUntilNextSchedule();
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    void runScheduledUpload().finally(() => {
      if (!scheduleTimer) scheduleNextRun();
    });
  }, delay);
}

/** 启动日志上传调度（应用启动时调用一次；重复调用幂等） */
export function startLogUploadScheduler(): void {
  if (scheduleTimer || startupTimer) return;

  startupTimer = setTimeout(() => {
    startupTimer = null;
    void startupCatchUpUpload();
  }, STARTUP_DELAY_MS);

  scheduleNextRun();
}

/** 停止调度（测试与关停用） */
export function stopLogUploadScheduler(): void {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  isUploading = false;
  lastUploadedDateKey = null;
}

/** 供测试注入日期锚点 */
export function setLastUploadedDateKeyForTest(dateKey: string | null): void {
  lastUploadedDateKey = dateKey;
}
