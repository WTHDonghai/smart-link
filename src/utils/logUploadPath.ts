import type { SystemLogEntry } from '../types';
import { formatLogsForExport } from './logExport';

/**
 * 日志文件上传路径规划（纯函数）
 *
 * 对象存储键（Key）规范：
 *   smart-link/{tenantId}/{yyyyMMdd}/{文件名}
 *
 * 示例：
 *   smart-link/XR-01/20261117/smart-link-log-XR-01-20261117-183045123.log
 */

/** 文件上传业务模块标识（对应平台文件服务 /file/upload 系列接口的 module 参数） */
export const LOG_UPLOAD_MODULE = 'smart-link';

/** 渲染进程运行时的本地时区 */
const TIME_ZONE_OFFSET_MINUTES = -new Date().getTimezoneOffset();

/** 按本地时区偏移生成 yyyyMMdd 目录段 */
export function buildLogUploadDateSegment(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + TIME_ZONE_OFFSET_MINUTES * 60 * 1000);
  return shifted.toISOString().slice(0, 10).replace(/-/g, '');
}

/** 按本地时区生成 HHmmssSSS 时间段（文件名防碰撞用） */
function buildLogUploadTimeSegment(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + TIME_ZONE_OFFSET_MINUTES * 60 * 1000);
  const timePart = shifted.toISOString().slice(11, 23).replace(/:/g, '');
  return timePart.replace(/\./g, '');
}

/** 去除文件名中的路径分隔符与空白，收敛为单段安全文件名 */
export function sanitizeLogUploadSegment(raw: string): string {
  return raw
    .trim()
    .replace(/[\s\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/^-+/, '')
    .slice(0, 64);
}

/**
 * 组装上传对象键：smart-link/{tenantId}/{yyyyMMdd}/{文件名}
 * 任一段非法即抛错（Fail-Fast，禁止静默兜底路径）
 */
export function buildLogUploadObjectKey(input: {
  tenantId: string;
  date?: Date;
  fileName: string;
}): string {
  const tenant = sanitizeLogUploadSegment(input.tenantId);
  if (!tenant) {
    throw new Error('日志上传路径缺少有效租户标识（tenantId 为空或全部为非法字符）');
  }

  const fileName = sanitizeLogUploadSegment(input.fileName);
  if (!fileName) {
    throw new Error('日志上传路径缺少有效文件名');
  }

  const dateSegment = buildLogUploadDateSegment(input.date);
  return `${LOG_UPLOAD_MODULE}/${tenant}/${dateSegment}/${fileName}`;
}

/** 生成当天日志上传文件名：smart-link-log-{tenantId}-{yyyyMMdd}-{HHmmssSSS}.log */
export function buildLogUploadFileName(input: { tenantId: string; date?: Date }): string {
  const tenant = sanitizeLogUploadSegment(input.tenantId);
  if (!tenant) {
    throw new Error('日志上传文件名缺少有效租户标识（tenantId 为空或全部为非法字符）');
  }

  const date = input.date ?? new Date();
  const dateSegment = buildLogUploadDateSegment(date);
  const timeSegment = buildLogUploadTimeSegment(date);
  return `smart-link-log-${tenant}-${dateSegment}-${timeSegment}.log`;
}

/**
 * 将日志条目序列化为上传文本（复用系统日志页导出的行格式，保持口径一致）
 */
export function serializeLogsForUpload(logs: SystemLogEntry[]): string {
  if (logs.length === 0) return '';
  return formatLogsForExport(logs);
}
