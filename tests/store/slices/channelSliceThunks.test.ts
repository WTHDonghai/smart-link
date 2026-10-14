import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchChannelMappingData,
  saveChannelMapping,
  deleteChannelMappingThunk,
} from '../../../src/store/slices/channelSlice';
import * as dutyBridge from '../../../src/services/dutyBridge';
import type { UnknownAction } from '@reduxjs/toolkit';

vi.mock('../../../src/services/channelApi', () => ({
  fetchCulturalTourismChannels: vi.fn().mockResolvedValue([]),
  fetchChannelMappings: vi.fn().mockResolvedValue([]),
  saveChannelMappingsBatch: vi.fn().mockResolvedValue({
    message: 'ok',
    records: [],
  }),
  saveChannelRemarkTemplate: vi.fn(),
  fetchChannelRemarkTemplate: vi.fn(),
  deleteChannelMapping: vi.fn(),
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

  describe('deleteChannelMappingThunk 删除渠道映射', () => {
    it('持久化映射先真实调用远端 DELETE，成功后本地移除渠道并重拉映射集', async () => {
      const { deleteChannelMapping, fetchChannelMappings } = await import(
        '../../../src/services/channelApi'
      );
      vi.mocked(deleteChannelMapping).mockResolvedValueOnce(undefined);
      vi.mocked(fetchChannelMappings).mockResolvedValueOnce([]);

      const dispatch = vi.fn();
      const result = await deleteChannelMappingThunk({
        channelId: 'meituanbiz',
        mappingId: 'map-biz',
      })(dispatch, vi.fn(), undefined);

      expect(result.type).toBe(deleteChannelMappingThunk.fulfilled.type);
      expect(result.payload).toEqual({ channelId: 'meituanbiz' });

      // 1. 真实发起了远端删除，传入确切的 mappingId
      expect(deleteChannelMapping).toHaveBeenCalledWith('map-biz');

      // 2. 远端成功后分发了本地移除动作，payload 精确指向被删渠道
      const removeAction = dispatch.mock.calls
        .map((call) => call[0] as UnknownAction)
        .find((action) => action.type === 'channel/removeChannel');
      expect(removeAction).toBeDefined();
      expect((removeAction as UnknownAction & { payload: string }).payload).toBe('meituanbiz');

      // 3. 触发了映射重拉 thunk：拦截被 dispatch 的函数并真实执行，验证重拉落地
      const dispatchedFns = dispatch.mock.calls
        .map((call) => call[0])
        .filter((arg): arg is (d: unknown, g: unknown, e: unknown) => Promise<unknown> =>
          typeof arg === 'function'
        );
      expect(dispatchedFns).toHaveLength(1);
      await dispatchedFns[0](vi.fn(), vi.fn(), undefined);
      expect(fetchChannelMappings).toHaveBeenCalledTimes(1);
    });

    it('远端删除失败时立即阻断 reject，绝不本地假删', async () => {
      const { deleteChannelMapping } = await import('../../../src/services/channelApi');
      vi.mocked(deleteChannelMapping).mockRejectedValueOnce(
        new Error('平台接口调用失败 (500): 服务器内部错误')
      );

      const dispatch = vi.fn();
      const result = await deleteChannelMappingThunk({
        channelId: 'meituan',
        mappingId: 'map-mt',
      })(dispatch, vi.fn(), undefined);

      expect(result.type).toBe(deleteChannelMappingThunk.rejected.type);
      expect(result.payload).toBe('平台接口调用失败 (500): 服务器内部错误');

      // 严禁任何本地移除或重拉动作逃逸
      const actionTypes = dispatch.mock.calls.map((call) => (call[0] as UnknownAction).type);
      expect(actionTypes).not.toContain('channel/removeChannel');
      expect(dispatch.mock.calls.some((call) => typeof call[0] === 'function')).toBe(false);
    });

    it('本地未保存草稿（无 mappingId）不发起远端调用，直接本地移除', async () => {
      const { deleteChannelMapping } = await import('../../../src/services/channelApi');

      const dispatch = vi.fn();
      const result = await deleteChannelMappingThunk({
        channelId: 'qunar',
      })(dispatch, vi.fn(), undefined);

      expect(result.type).toBe(deleteChannelMappingThunk.fulfilled.type);
      expect(deleteChannelMapping).not.toHaveBeenCalled();

      const removeAction = dispatch.mock.calls
        .map((call) => call[0] as UnknownAction)
        .find((action) => action.type === 'channel/removeChannel');
      expect((removeAction as UnknownAction & { payload: string }).payload).toBe('qunar');
    });
  });
});
