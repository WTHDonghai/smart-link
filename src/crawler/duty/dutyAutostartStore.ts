import path from 'node:path';
import fs from 'node:fs';
import { resolveUserDataDir } from '../paths';
import { logger } from '../../services/logger';
import type { FilePersistenceResult } from './platformTokenStore';

/** 值守自恢复清单快照：主渠道列表 + 商旅分流开关（恢复 MEITUAN 时别名渠道联动激活的依据） */
export interface DutyAutostartSnapshot {
  channels: string[];
  meituanBizSplitEnabled: boolean;
}

const AUTOSTART_FORMAT_VERSION = 1;
const EMPTY_SNAPSHOT: DutyAutostartSnapshot = { channels: [], meituanBizSplitEnabled: false };

/**
 * 获取 Electron 标准用户数据目录下的值守自恢复清单文件路径
 */
export function getDutyAutostartFile(): string {
  return path.join(resolveUserDataDir(), 'duty-autostart.json');
}

/**
 * 校验并收敛自恢复清单载荷：结构或任一渠道条目非法时整体判无效（返回 null），
 * 不做部分恢复——清单由本应用写入，出现非法结构即意味着损坏或被篡改
 */
export function parseDutyAutostartSnapshot(parsed: unknown): DutyAutostartSnapshot | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== AUTOSTART_FORMAT_VERSION) {
    return null;
  }
  if (!Array.isArray(record.channels) || typeof record.meituanBizSplitEnabled !== 'boolean') {
    return null;
  }
  const codes: string[] = [];
  for (const item of record.channels) {
    if (typeof item !== 'string' || !item.trim()) {
      return null;
    }
    codes.push(item.trim().toUpperCase());
  }
  return { channels: [...new Set(codes)], meituanBizSplitEnabled: record.meituanBizSplitEnabled };
}

/**
 * 读取值守自恢复清单。文件缺失属正常态（从未开启值守），静默返回空清单；
 * 结构无效或读取异常时显式 WARN 后按空清单处理（自恢复是尽力补偿，不阻断启动）
 */
export function loadDutyAutostart(filePath = getDutyAutostartFile()): DutyAutostartSnapshot {
  try {
    if (!fs.existsSync(filePath)) {
      return EMPTY_SNAPSHOT;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) {
      return EMPTY_SNAPSHOT;
    }
    const snapshot = parseDutyAutostartSnapshot(JSON.parse(raw));
    if (!snapshot) {
      logger.warn('[值守恢复] 自恢复清单版本或结构无效，已按空清单处理', {
        module: 'DUTY_TASK',
        details: `文件: ${filePath}`,
      });
      return EMPTY_SNAPSHOT;
    }
    return snapshot;
  } catch (error) {
    logger.warn('[值守恢复] 读取自恢复清单异常，已按空清单处理', {
      module: 'DUTY_TASK',
      details: `${error instanceof Error ? error.message : String(error)} | 文件: ${filePath}`,
    });
    return EMPTY_SNAPSHOT;
  }
}

/**
 * 持久化值守自恢复清单至标准用户数据目录（0o600 权限）
 */
export function saveDutyAutostart(
  snapshot: DutyAutostartSnapshot,
  filePath = getDutyAutostartFile()
): FilePersistenceResult {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = {
      version: AUTOSTART_FORMAT_VERSION,
      channels: [...new Set(snapshot.channels.map((code) => code.trim().toUpperCase()).filter(Boolean))],
      meituanBizSplitEnabled: Boolean(snapshot.meituanBizSplitEnabled),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    return { success: true };
  } catch (error) {
    const message = `写入值守自恢复清单失败: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn('[值守恢复] 写入自恢复清单异常', {
      module: 'DUTY_TASK',
      details: message,
    });
    return { success: false, error: message };
  }
}
