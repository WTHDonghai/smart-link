import { describe, it, expect } from 'vitest';
import { formatLogsForExport } from '../../src/utils/logExport';
import type { SystemLogEntry } from '../../src/types';

function createLog(overrides: Partial<SystemLogEntry> = {}): SystemLogEntry {
  return {
    id: 'log-1',
    timestamp: '2026-09-18 10:00:00.000',
    createdAt: 1726624800000,
    level: 'INFO',
    message: '基础日志',
    ...overrides,
  };
}

describe('formatLogsForExport', () => {
  it('renders a minimal entry with timestamp, level, module fallback and message', () => {
    const text = formatLogsForExport([createLog()]);

    expect(text).toBe('[2026-09-18 10:00:00.000] [INFO] [UNKNOWN] 基础日志 ');
  });

  it('includes task and API context fields when present', () => {
    const text = formatLogsForExport([
      createLog({
        level: 'SUCCESS',
        module: 'API',
        apiMethod: 'POST',
        apiUrl: '/toolkit/orders/import',
        httpStatus: 200,
        taskActionStage: 'order-import-submit',
        msgType: 'OTA_IMPORT_ORDER',
        orderNo: 'MT-889900',
        taskId: 'task-42',
        message: '入单成功',
        details: 'PMS-001',
        apiParams: { orderNo: 'MT-889900' },
        apiResponse: { success: true },
        taskResult: { imported: true },
      }),
    ]);

    expect(text).toContain('[SUCCESS] [API]');
    expect(text).toContain('[POST]');
    expect(text).toContain('[/toolkit/orders/import]');
    expect(text).toContain('[HTTP 200]');
    expect(text).toContain('[order-import-submit]');
    expect(text).toContain('[msgType:OTA_IMPORT_ORDER]');
    expect(text).toContain('[orderNo:MT-889900]');
    expect(text).toContain('[taskId:task-42]');
    expect(text).toContain('| PMS-001');
    expect(text).toContain('| params: {"orderNo":"MT-889900"}');
    expect(text).toContain('| response: {"success":true}');
    expect(text).toContain('| result: {"imported":true}');
  });

  it('renders primitive task results without JSON quoting', () => {
    const text = formatLogsForExport([createLog({ taskResult: 'done' })]);

    expect(text).toContain('| result: done');
  });

  it('joins multiple entries with a single newline in input order', () => {
    const text = formatLogsForExport([
      createLog({ id: 'log-a', message: '第一条' }),
      createLog({ id: 'log-b', message: '第二条' }),
    ]);
    const lines = text.split('\n');

    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('第一条');
    expect(lines[1]).toContain('第二条');
  });

  it('returns an empty string when there is nothing to export', () => {
    expect(formatLogsForExport([])).toBe('');
  });
});
