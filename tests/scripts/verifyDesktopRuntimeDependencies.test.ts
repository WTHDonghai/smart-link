import { describe, expect, it } from 'vitest';
import {
  findMissingRuntimeDependencies,
  packageName,
} from '../../scripts/verifyDesktopRuntimeDependencies.mjs';

describe('desktop runtime dependency verifier', () => {
  it('extracts scoped package names and ignores relative and host modules', () => {
    expect(packageName('@scope/package/subpath')).toBe('@scope/package');
    expect(packageName('liqe')).toBe('liqe');
    expect(packageName('./local-file')).toBeNull();
    expect(packageName('node:fs')).toBeNull();
    expect(packageName('electron')).toBe('electron');
  });

  it('requires every bare import in the desktop runtime to be a production dependency', () => {
    const source = [
      'import { parse } from "liqe";',
      'import { helper } from "@scope/package/subpath";',
      'import fs from "node:fs";',
      'import { app } from "electron";',
      'import "./local-file.js";',
      'const updater = require("electron-updater");',
    ].join('\n');

    expect(findMissingRuntimeDependencies({
      source,
      dependencies: {
        '@scope/package': '^1.0.0',
        'electron-updater': '^6.0.0',
        liqe: '^3.0.0',
      },
    })).toEqual([]);
  });

  it('reports missing production dependencies with stable order', () => {
    expect(findMissingRuntimeDependencies({
      source: 'import "zod"; import "@scope/pkg"; import "liqe";',
      dependencies: { liqe: '^3.0.0' },
    })).toEqual(['@scope/pkg', 'zod']);
  });
});
