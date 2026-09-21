import { describe, expect, it } from 'vitest';
import packageManifest from '../../package.json';

describe('desktop package manifest', () => {
  it('carries shared main-process dependencies in the installer', () => {
    expect(packageManifest.dependencies).toMatchObject({
      'electron-updater': expect.any(String),
      liqe: expect.any(String),
      playwright: expect.any(String),
      tslog: expect.any(String),
    });
    expect('liqe' in packageManifest.devDependencies).toBe(false);
  });

  it('uses a version newer than the legacy 1.0.4 client for upgrade compatibility', () => {
    expect(packageManifest.version).toBe('2.0.0');
  });
});
