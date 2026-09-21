import { describe, expect, it, vi } from 'vitest';
import type { HostBridgeApi, SystemLogEntry } from '../../src/types';

const { exposeInMainWorldMock, ipcRendererMock } = vi.hoisted(() => {
  return {
    exposeInMainWorldMock: vi.fn(),
    ipcRendererMock: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: exposeInMainWorldMock },
  ipcRenderer: ipcRendererMock,
}));

vi.mock('../../src/types/env', () => ({
  selectAppEnv: () => ({ mode: 'test' }),
}));

import '../../electron/preload';

describe('desktop preload log subscription', () => {
  it('removes the same host log channel used by onLog', () => {
    expect(exposeInMainWorldMock).toHaveBeenCalledWith('host', expect.anything());
    const host = exposeInMainWorldMock.mock.calls[0][1] as HostBridgeApi;
    const entry = {
      id: 'log-1',
      createdAt: 1,
    } as SystemLogEntry;
    const callback = vi.fn();
    ipcRendererMock.on.mockReturnValue(undefined);
    ipcRendererMock.on.mockImplementationOnce(() => undefined);

    const unsubscribe = host.duty.onLog(callback);
    unsubscribe();

    const registeredChannel = ipcRendererMock.on.mock.calls[0][0];
    const registeredListener = ipcRendererMock.on.mock.calls[0][1] as (...args: unknown[]) => void;
    registeredListener({}, entry);

    expect(registeredChannel).toBe('host:log-entry');
    expect(callback).toHaveBeenCalledWith(entry);
    expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('host:log-entry', registeredListener);
    expect(ipcRendererMock.removeListener).not.toHaveBeenCalledWith('duty:log-entry', registeredListener);
  });
});
