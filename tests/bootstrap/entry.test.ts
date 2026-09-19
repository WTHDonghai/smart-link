import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountApplication } from '../../src/bootstrap/entry';
import { startApp } from '../../src/bootstrap/AppBootstrap';
import type { HostBridgeApi } from '../../src/types';
import type { AppUpdateBridgeApi } from '../../src/types/update';

vi.mock('../../src/bootstrap/AppBootstrap', () => ({
  startApp: vi.fn(),
}));

const startAppMock = vi.mocked(startApp);
const root = { innerHTML: '' } as HTMLElement;

describe('application entry host guard', () => {
  beforeEach(() => {
    root.innerHTML = '';
    startAppMock.mockClear();
  });

  it('renders a blocker and does not start the application bootstrap when host is missing', async () => {
    const result = await mountApplication(root, undefined);

    expect(result).toBe('blocked');
    expect(root.innerHTML).toContain('仅支持桌面端');
    expect(startAppMock).not.toHaveBeenCalled();
  });

  it('starts the application bootstrap for a desktop host', async () => {
    const host: HostBridgeApi = {
      crawler: {
        collectHotels: () => Promise.reject(new Error('not called')),
        syncProfile: () => Promise.reject(new Error('not called')),
      },
      duty: {
        startDuty: () => Promise.reject(new Error('not called')),
        stopDuty: () => Promise.reject(new Error('not called')),
        stopAllDuty: () => Promise.reject(new Error('not called')),
        getStatus: () => Promise.reject(new Error('not called')),
        syncTokens: () => Promise.reject(new Error('not called')),
        clearTokens: () => Promise.reject(new Error('not called')),
        takePendingLogs: () => Promise.resolve([]),
        onLog: () => () => undefined,
      },
      update: {
        getState: () => Promise.reject(new Error('not called')),
        checkForUpdate: () => Promise.reject(new Error('not called')),
        installUpdate: () => Promise.reject(new Error('not called')),
        onUpdateState: () => () => undefined,
      } satisfies AppUpdateBridgeApi,
      env: {},
    };

    const result = await mountApplication(root, host);

    expect(result).toBe('started');
    expect(startAppMock).toHaveBeenCalledTimes(1);
    expect(startAppMock).toHaveBeenCalledWith(root);
  });
});
