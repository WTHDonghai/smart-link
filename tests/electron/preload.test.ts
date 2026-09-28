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

const exposedHost = exposeInMainWorldMock.mock.calls[0][1] as HostBridgeApi;

describe('desktop preload log subscription', () => {
  it('removes the same host log channel used by host.log.onLog', () => {
    expect(exposeInMainWorldMock).toHaveBeenCalledWith('host', expect.anything());
    const host = exposedHost;
    const entry = {
      id: 'log-1',
      createdAt: 1,
    } as SystemLogEntry;
    const callback = vi.fn();
    ipcRendererMock.on.mockReturnValue(undefined);
    expect(host.log).toBeDefined();
    const unsubscribe = host.log!.onLog(callback);
    unsubscribe();

    const registeredChannel = ipcRendererMock.on.mock.calls[0][0];
    const registeredListener = ipcRendererMock.on.mock.calls[0][1] as (...args: unknown[]) => void;
    registeredListener({}, entry);

    expect(registeredChannel).toBe('host:log-entry');
    expect(callback).toHaveBeenCalledWith(entry);
    expect(ipcRendererMock.removeListener).toHaveBeenCalledWith('host:log-entry', registeredListener);
    expect(ipcRendererMock.removeListener).not.toHaveBeenCalledWith('duty:log-entry', registeredListener);
  });

  it('exposes setConfirmImportEnabled and delegates to ipcRenderer', async () => {
    const host = exposedHost;
    ipcRendererMock.invoke.mockResolvedValueOnce({ success: true });

    const res = await host.duty.setConfirmImportEnabled(false);

    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('duty:set-confirm-import-enabled', false);
    expect(res).toEqual({ success: true });
  });

  it('exposes updateTemplateCache and delegates to ipcRenderer', async () => {
    const host = exposedHost;
    const payload = { channelCode: 'MEITUAN', template: '美团模板内容' };
    ipcRendererMock.invoke.mockResolvedValueOnce({ success: true });

    const res = await host.duty.updateTemplateCache(payload);

    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('duty:update-template-cache', payload);
    expect(res).toEqual({ success: true });
  });

  it('exposes clipboard.writeText and delegates to ipcRenderer', async () => {
    const host = exposedHost;
    ipcRendererMock.invoke.mockResolvedValueOnce(true);

    expect(host.clipboard).toBeDefined();
    const res = await host.clipboard!.writeText('MT-ORDER-TEST');

    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('clipboard:write-text', 'MT-ORDER-TEST');
    expect(res).toBe(true);
  });

  it('exposes clipboard.readText and delegates to ipcRenderer', async () => {
    const host = exposedHost;
    ipcRendererMock.invoke.mockResolvedValueOnce('PASTED-ORDER-123');

    expect(host.clipboard).toBeDefined();
    const res = await host.clipboard!.readText();

    expect(ipcRendererMock.invoke).toHaveBeenCalledWith('clipboard:read-text');
    expect(res).toBe('PASTED-ORDER-123');
  });
});
