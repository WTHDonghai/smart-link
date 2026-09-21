import { describe, it, expect } from 'vitest';
import {
  getTodayDateString,
  getPastDateString,
  formatJsonPayload,
} from '../../src/utils/logDate';

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

describe('logDate date helpers', () => {
  it('formats today as a zero-padded YYYY-MM-DD string', () => {
    const today = getTodayDateString();

    expect(today).toBe(toDateString(new Date()));
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns today when zero days back is requested', () => {
    expect(getPastDateString(0)).toBe(getTodayDateString());
  });

  it('subtracts the requested number of calendar days', () => {
    const expected = new Date();
    expected.setDate(expected.getDate() - 3);

    expect(getPastDateString(3)).toBe(toDateString(expected));
  });
});

describe('formatJsonPayload', () => {
  it('labels undefined payloads with a friendly placeholder', () => {
    expect(formatJsonPayload(undefined)).toBe('(无入参)');
  });

  it('renders null as the literal null value', () => {
    expect(formatJsonPayload(null)).toBe('null');
  });

  it('pretty prints a JSON string payload', () => {
    expect(formatJsonPayload('{"orderNo":"MT-1","ok":true}')).toBe(
      '{\n  "orderNo": "MT-1",\n  "ok": true\n}'
    );
  });

  it('returns the raw string when the payload is not valid JSON', () => {
    expect(formatJsonPayload('raw text payload')).toBe('raw text payload');
  });

  it('pretty prints object payloads', () => {
    expect(formatJsonPayload({ taskId: 'task-1', count: 2 })).toBe(
      '{\n  "taskId": "task-1",\n  "count": 2\n}'
    );
  });

  it('falls back to string conversion when serialization is impossible', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    expect(formatJsonPayload(circular)).toBe('[object Object]');
  });
});
