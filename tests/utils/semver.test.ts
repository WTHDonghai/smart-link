import { describe, expect, it } from 'vitest';
import { compareSemVer, parseSemVer } from '../../src/utils/semver';

describe('semver', () => {
  it('compares patch and prerelease precedence', () => {
    expect(compareSemVer(
      parseSemVer('1.0.1'),
      parseSemVer('1.0.0')
    )).toBe(1);
    expect(compareSemVer(
      parseSemVer('1.0.0-alpha'),
      parseSemVer('1.0.0')
    )).toBe(-1);
    expect(compareSemVer(
      parseSemVer('1.0.0-alpha.2'),
      parseSemVer('1.0.0-alpha.10')
    )).toBe(-1);
  });

  it('rejects invalid versions', () => {
    expect(() => parseSemVer('not-a-version', 'currentVersion')).toThrow(
      '无效的 currentVersion SemVer: not-a-version'
    );
  });
});
