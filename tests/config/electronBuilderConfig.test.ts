import { describe, expect, it } from 'vitest';
import electronBuilderConfig from '../../electron-builder.config.mjs';

describe('electron builder config', () => {
  it('uses the reference build-only update placeholder', () => {
    expect(electronBuilderConfig.publish).toEqual([{
      provider: 'generic',
      url: 'https://updates.invalid/',
    }]);
    expect(electronBuilderConfig.afterPack).toBe('scripts/prepareDesktopUpdateMetadata.mjs');
  });
});
