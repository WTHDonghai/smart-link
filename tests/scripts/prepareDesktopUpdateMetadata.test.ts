import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeWindowsUpdateMetadata } from '../../scripts/prepareDesktopUpdateMetadata.mjs';

describe('prepare desktop update metadata', () => {
  it('keeps only the updater cache directory name', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'smart-link-update-metadata-'));
    const metadataPath = path.join(directory, 'app-update.yml');
    writeFileSync(metadataPath, [
      'provider: generic',
      'url: https://updates.invalid/',
      'updaterCacheDirName: smart-link-updater',
      '',
    ].join('\n'));

    const metadata = normalizeWindowsUpdateMetadata(metadataPath);

    expect(metadata).toEqual({ updaterCacheDirName: 'smart-link-updater' });
    expect(readFileSync(metadataPath, 'utf8')).toBe(
      'updaterCacheDirName: smart-link-updater\n'
    );
    rmSync(directory, { recursive: true, force: true });
  });
});
