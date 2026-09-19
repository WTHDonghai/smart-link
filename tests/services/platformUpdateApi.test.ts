import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestPlatformApiMock } = vi.hoisted(() => ({
  requestPlatformApiMock: vi.fn(),
}));

vi.mock('../../src/services/platformApi', () => ({
  TOOLKIT_MODULE: 'toolkit',
  requestPlatformApi: requestPlatformApiMock,
}));

import {
  findPlatformAppUpdateDescriptor,
  parsePlatformUpdateResponse,
} from '../../src/services/platformUpdateApi';

function updateResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      needUpgrade: true,
      latestVersion: '1.1.0',
      updateType: '',
      downloadDirectory: 'https://updates.example.test/windows/x64/1.1.0/',
      ...overrides,
    },
  };
}

describe('platform update API', () => {
  beforeEach(() => {
    requestPlatformApiMock.mockReset();
  });

  it('requests and parses the legacy platform update descriptor', async () => {
    requestPlatformApiMock.mockResolvedValue(updateResponse());

    const descriptor = await findPlatformAppUpdateDescriptor({
      appId: 'smart-link',
      stationId: 'station-001',
      platform: 'windows',
      currentVersion: '1.0.0',
    });

    expect(requestPlatformApiMock).toHaveBeenCalledWith(
      '/toolkit/toolbox/apps/smart-link/updates?platform=windows&currentVersion=1.0.0&stationId=station-001',
      { timeoutMs: 15000 }
    );
    expect(descriptor).toEqual({
      version: '1.1.0',
      feedUrl: 'https://updates.example.test/windows/x64/1.1.0/',
    });
  });

  it('returns no descriptor when the platform says no upgrade is needed', () => {
    expect(parsePlatformUpdateResponse(
      { success: true, data: { needUpgrade: false } },
      '1.0.0',
      'smart-link'
    )).toBeNull();
  });

  it('rejects a directory whose version segment does not match the latest version', () => {
    expect(() => parsePlatformUpdateResponse(
      updateResponse({
        latestVersion: '1.2.0',
        downloadDirectory: 'https://updates.example.test/windows/x64/1.1.0/',
      }),
      '1.0.0',
      'smart-link'
    )).toThrow('平台更新目录版本与 latestVersion 不一致');
  });

  it('rejects update types other than NSIS', () => {
    expect(() => parsePlatformUpdateResponse(
      updateResponse({ updateType: 'OPTIONAL' }),
      '1.0.0',
      'smart-link'
    )).toThrow('平台更新类型暂不支持: OPTIONAL');
  });
});
