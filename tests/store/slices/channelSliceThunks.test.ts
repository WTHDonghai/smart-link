import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchChannelMappingData,
  saveChannelMapping,
} from '../../../src/store/slices/channelSlice';
import * as dutyBridge from '../../../src/services/dutyBridge';

vi.mock('../../../src/services/channelApi', () => ({
  fetchCulturalTourismChannels: vi.fn().mockResolvedValue([]),
  fetchChannelMappings: vi.fn().mockResolvedValue([]),
  saveChannelMappingsBatch: vi.fn().mockResolvedValue({
    message: 'ok',
    records: [],
  }),
  saveChannelRemarkTemplate: vi.fn(),
  fetchChannelRemarkTemplate: vi.fn(),
}));

vi.mock('../../../src/services/dutyBridge', () => ({
  updateDutyTemplateCache: vi.fn(),
  syncMeituanBizSplitBestEffort: vi.fn(),
}));

describe('channelSlice thunks 商旅分流开关联动', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchChannelMappingData 成功后应按 MEITUANBIZ 映射存在性推送分流开关（best-effort）', async () => {
    const { fetchChannelMappings } = await import('../../../src/services/channelApi');
    vi.mocked(fetchChannelMappings).mockResolvedValueOnce([
      {
        id: 'map-mt',
        mappingId: 'map-mt',
        otaChannelCode: 'MEITUAN',
        otaChannelName: '美团',
        channelId: 'pms-1',
        channelCode: 'MT',
        channelName: '美团直连',
        status: 'A',
      },
      {
        id: 'map-biz',
        mappingId: 'map-biz',
        otaChannelCode: 'MEITUANBIZ',
        otaChannelName: '美团商旅',
        channelId: 'pms-2',
        channelCode: 'MTBIZ',
        channelName: '商旅渠道',
        status: 'A',
      },
    ]);

    const dispatch = vi.fn();
    await fetchChannelMappingData()(dispatch, vi.fn(), undefined);

    expect(dutyBridge.syncMeituanBizSplitBestEffort).toHaveBeenCalledWith(true);
  });

  it('仅散客映射时推送分流关闭（false）', async () => {
    const { fetchChannelMappings } = await import('../../../src/services/channelApi');
    vi.mocked(fetchChannelMappings).mockResolvedValueOnce([
      {
        id: 'map-mt',
        mappingId: 'map-mt',
        otaChannelCode: 'MEITUAN',
        otaChannelName: '美团',
        channelId: 'pms-1',
        channelCode: 'MT',
        channelName: '美团直连',
        status: 'A',
      },
    ]);

    const dispatch = vi.fn();
    await fetchChannelMappingData()(dispatch, vi.fn(), undefined);

    expect(dutyBridge.syncMeituanBizSplitBestEffort).toHaveBeenCalledWith(false);
  });

  it('saveChannelMapping 成功后应触发映射重拉（fetchChannelMappingData）并同步分流开关', async () => {
    const { saveChannelMappingsBatch, fetchChannelMappings } = await import(
      '../../../src/services/channelApi'
    );
    vi.mocked(saveChannelMappingsBatch).mockResolvedValueOnce({
      ok: true,
      message: 'ok',
      savedMappings: [],
      records: [
        {
          id: 'map-biz',
          mappingId: 'map-biz',
          otaChannelCode: 'MEITUANBIZ',
          otaChannelName: '美团商旅',
          channelId: 'pms-2',
          channelCode: 'MTBIZ',
          channelName: '商旅渠道',
          status: 'A',
        },
      ],
    });

    const dispatch = vi.fn();
    const result = await saveChannelMapping({
      channelId: 'meituanbiz',
      otaChannelCode: 'MEITUANBIZ',
      otaChannelName: '美团商旅',
      pmsChannelId: 'pms-2',
      channelCode: 'MTBIZ',
      status: 'A',
    })(dispatch, vi.fn(), undefined);

    expect(result.type).toBe(saveChannelMapping.fulfilled.type);

    // 保存成功后 dispatch 了映射重拉 thunk（与 pending/fulfilled 生命周期 action 混在同一次 dispatch 流中）：
    // 拦截被 dispatch 的函数并真实执行，验证重拉落地且分流开关随新映射集同步
    const dispatchedFns = dispatch.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is (d: unknown, g: unknown, e: unknown) => Promise<unknown> =>
        typeof arg === 'function'
      );
    expect(dispatchedFns).toHaveLength(1);
    await dispatchedFns[0](vi.fn(), vi.fn(), undefined);

    expect(fetchChannelMappings).toHaveBeenCalledTimes(1);
    expect(dutyBridge.syncMeituanBizSplitBestEffort).toHaveBeenCalledWith(false);
  });
});
