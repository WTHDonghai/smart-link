import { describe, it, expect } from 'vitest';
import { settleRendererServerReadiness } from '../../scripts/devRunner.mjs';

describe('devRunner renderer readiness', () => {
  it('does not launch the desktop child when the asset server already failed', async () => {
    let probeCalls = 0;
    const failure = new Error('renderer asset server exited');

    await expect(
      settleRendererServerReadiness({
        url: 'http://127.0.0.1:3000',
        probe: async () => {
          probeCalls += 1;
          return true;
        },
        getFailure: () => failure,
      })
    ).rejects.toThrow('renderer asset server exited');

    expect(probeCalls).toBe(0);
  });

  it('checks readiness again after a settle delay to close the exit race', async () => {
    let probeCalls = 0;
    let failure;
    setTimeout(() => {
      failure = new Error('renderer asset server exited after readiness');
    }, 10);

    await expect(
      settleRendererServerReadiness({
        url: 'http://127.0.0.1:3000',
        probe: async () => {
          probeCalls += 1;
          return true;
        },
        getFailure: () => failure,
        settleMs: 50,
      })
    ).rejects.toThrow('renderer asset server exited after readiness');

    expect(probeCalls).toBe(1);
  });
});
