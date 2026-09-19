import { describe, it, expect } from 'vitest';
import { generateLogId } from '../../src/utils/logId';

describe('generateLogId', () => {
  it('builds a log id from the provided creation timestamp', () => {
    const id = generateLogId(1726624800000);

    expect(id.startsWith('log-1726624800000-')).toBe(true);
    expect(id).toMatch(/^log-\d+-[a-z0-9]{6}$/);
  });

  it('generates distinct ids for entries created in the same millisecond', () => {
    const createdAt = 1726624800000;
    const ids = new Set(Array.from({ length: 200 }, () => generateLogId(createdAt)));

    expect(ids.size).toBeGreaterThan(190);
  });
});
