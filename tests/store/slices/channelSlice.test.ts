import { describe, it, expect } from 'vitest';
import channelReducer, {
  addChannelById,
  removeChannel,
  updateChannelTargetSystem,
  selectCulturalTourismChannel,
  setSelectedChannelForTemplate,
  clearChannelError,
  fetchChannelMappingData,
  saveChannelMapping,
  SCHEMA_STORAGE_PREFIX,
} from '../../../src/store/slices/channelSlice';

describe('channelSlice', () => {
  it('initializes with default 3 active channels and null template selection', () => {
    const state = channelReducer(undefined, { type: '@@INIT' });
    expect(state.selectedChannelForTemplate).toBeNull();
    expect(state.channels.length).toBe(3);
    expect(state.channels.map((c) => c.id)).toEqual(['meituan', 'meituanbiz', 'douyin']);
  });

  describe('addChannelById', () => {
    it('successfully adds a new unmapped channel from catalog', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, addChannelById('ctrip'));

      expect(nextState.channels.length).toBe(4);
      const addedChannel = nextState.channels.find((c) => c.id === 'ctrip');
      expect(addedChannel).toBeDefined();
      expect(addedChannel?.name).toBe('携程旅行');
      expect(addedChannel?.code).toBe('CTRIP');
      expect(addedChannel?.todayOrders).toBe(0);
      expect(addedChannel?.lastSyncTime).toBe('刚刚初始化');
      expect(addedChannel?.targetSystem).toBe('ctrip_direct');
    });

    it('enforces deduplication and does not add duplicate channel if already present', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      expect(initialState.channels.some((c) => c.id === 'meituan')).toBe(true);

      const nextState = channelReducer(initialState, addChannelById('meituan'));
      expect(nextState.channels.length).toBe(3);
      expect(nextState.channels.filter((c) => c.id === 'meituan').length).toBe(1);
    });

    it('ignores unknown catalog channel ids gracefully without mutating state', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, addChannelById('non_existent_channel_id'));

      expect(nextState.channels.length).toBe(3);
      expect(nextState.channels).toEqual(initialState.channels);
    });

    it('loads custom schema from localStorage while using an empty remote-template projection', () => {
      const customCtripSchema = {
        channelId: 'ctrip',
        channelCode: 'CTRIP',
        version: '9.9.9',
        updatedAt: '2026-09-16',
        fields: [],
      };
      localStorage.setItem(`${SCHEMA_STORAGE_PREFIX}ctrip`, JSON.stringify(customCtripSchema));

      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, addChannelById('ctrip'));

      const ctrip = nextState.channels.find((c) => c.id === 'ctrip');
      expect(ctrip).toBeDefined();
      expect(ctrip?.remarkTemplate).toBe('');
      expect(ctrip?.protocolSchema?.version).toBe('9.9.9');

      localStorage.removeItem(`${SCHEMA_STORAGE_PREFIX}ctrip`);
    });
  });

  describe('removeChannel', () => {
    it('removes target channel from channels array', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, removeChannel('meituanbiz'));

      expect(nextState.channels.length).toBe(2);
      expect(nextState.channels.find((c) => c.id === 'meituanbiz')).toBeUndefined();
      expect(nextState.channels.map((c) => c.id)).toEqual(['meituan', 'douyin']);
    });

    it('removes target channel from channels array and synchronizes removal from mappings cache', () => {
      const initialState = {
        ...channelReducer(undefined, { type: '@@INIT' }),
        mappings: [
          {
            id: 'map-meituan',
            mappingId: 'map-meituan',
            otaChannelCode: 'MEITUAN',
            otaChannelName: '美团',
            channelId: '101',
            channelCode: 'MT_DIRECT',
            channelName: '美团直连',
            status: 'A',
          },
          {
            id: 'map-douyin',
            mappingId: 'map-douyin',
            otaChannelCode: 'DOUYIN',
            otaChannelName: '抖音',
            channelId: '102',
            channelCode: 'DY_DIRECT',
            channelName: '抖音直连',
            status: 'A',
          },
        ],
      };

      const nextState = channelReducer(initialState, removeChannel('meituan'));

      expect(nextState.channels.some((c) => c.id === 'meituan')).toBe(false);
      expect(nextState.mappings.some((m) => m.otaChannelCode === 'MEITUAN')).toBe(false);
      expect(nextState.mappings.some((m) => m.otaChannelCode === 'DOUYIN')).toBe(true);
    });

    it('handles removing non-existent channel without side effects', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, removeChannel('not_in_list'));

      expect(nextState.channels.length).toBe(3);
      expect(nextState.channels).toEqual(initialState.channels);
    });
  });

  describe('updateChannelTargetSystem', () => {
    it('updates the target system route for specified channel', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(
        initialState,
        updateChannelTargetSystem({ channelId: 'meituan', targetSystem: 'meituan_sub_01' })
      );

      const target = nextState.channels.find((c) => c.id === 'meituan');
      expect(target?.targetSystem).toBe('meituan_sub_01');

      // Unrelated channel remains unchanged
      const unaffected = nextState.channels.find((c) => c.id === 'douyin');
      expect(unaffected?.targetSystem).toBe('douyin');
    });

    it('ignores update for unknown channel id', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(
        initialState,
        updateChannelTargetSystem({ channelId: 'unknown', targetSystem: 'xyz' })
      );

      expect(nextState.channels).toEqual(initialState.channels);
    });
  });

  describe('setSelectedChannelForTemplate', () => {
    it('sets and clears active template editing channel', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      expect(initialState.selectedChannelForTemplate).toBeNull();

      const selectedState = channelReducer(initialState, setSelectedChannelForTemplate('douyin'));
      expect(selectedState.selectedChannelForTemplate).toBe('douyin');

      const clearedState = channelReducer(selectedState, setSelectedChannelForTemplate(null));
      expect(clearedState.selectedChannelForTemplate).toBeNull();
    });
  });

  describe('selectCulturalTourismChannel & clearChannelError', () => {
    it('selectCulturalTourismChannel updates channelId, channelCode and targetSystem for target channel', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(
        initialState,
        selectCulturalTourismChannel({
          channelId: 'meituan',
          pmsChannelId: '99',
          pmsChannelCode: 'MT_DIRECT',
          pmsChannelName: '美团直签通道',
        })
      );

      const target = nextState.channels.find((c) => c.id === 'meituan');
      expect(target?.channelId).toBe('99');
      expect(target?.channelCode).toBe('MT_DIRECT');
      expect(target?.channelName).toBe('美团直签通道');
      expect(target?.targetSystem).toBe('MT_DIRECT');
    });

    it('selectCulturalTourismChannel supports resetting fields when pmsChannelId is empty', () => {
      const stateWithSelection = channelReducer(
        undefined,
        selectCulturalTourismChannel({
          channelId: 'meituan',
          pmsChannelId: '99',
          pmsChannelCode: 'MT_DIRECT',
          pmsChannelName: '美团直签通道',
        })
      );

      const resetState = channelReducer(
        stateWithSelection,
        selectCulturalTourismChannel({
          channelId: 'meituan',
          pmsChannelId: '',
          pmsChannelCode: '',
          pmsChannelName: '',
        })
      );

      const target = resetState.channels.find((c) => c.id === 'meituan');
      expect(target?.channelId).toBe('');
      expect(target?.channelCode).toBe('');
      expect(target?.channelName).toBe('');
      expect(target?.targetSystem).toBe('');
      expect(target?.isMapped).toBe(false);
    });

    it('selectCulturalTourismChannel sets isMapped to true if selected pmsChannelId matches saved mapping, else false', () => {
      const initialState = {
        ...channelReducer(undefined, { type: '@@INIT' }),
        mappings: [
          {
            id: 'map-meituan',
            mappingId: 'map-meituan',
            otaChannelCode: 'MEITUAN',
            otaChannelName: '美团',
            channelId: '100',
            channelCode: 'MT_SAVED',
            channelName: '美团已保存通道',
            status: 'A',
          },
        ],
      };

      // 1. 选中已保存生效的渠道 100 -> isMapped 为 true
      const stateMatched = channelReducer(
        initialState,
        selectCulturalTourismChannel({
          channelId: 'meituan',
          pmsChannelId: '100',
          pmsChannelCode: 'MT_SAVED',
          pmsChannelName: '美团已保存通道',
        })
      );
      const targetMatched = stateMatched.channels.find((c) => c.id === 'meituan');
      expect(targetMatched?.isMapped).toBe(true);

      // 2. 变更选中为其他未生效渠道 101 -> isMapped 为 false
      const stateChanged = channelReducer(
        stateMatched,
        selectCulturalTourismChannel({
          channelId: 'meituan',
          pmsChannelId: '101',
          pmsChannelCode: 'MT_OTHER',
          pmsChannelName: '美团其他通道',
        })
      );
      const targetChanged = stateChanged.channels.find((c) => c.id === 'meituan');
      expect(targetChanged?.isMapped).toBe(false);
    });

    it('clearChannelError clears error message', () => {
      const stateWithError = {
        ...channelReducer(undefined, { type: '@@INIT' }),
        error: '发生网络错误',
      };
      const cleared = channelReducer(stateWithError, clearChannelError());
      expect(cleared.error).toBeNull();
    });
  });

  describe('fetchChannelMappingData extraReducers', () => {
    it('handles pending state', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, {
        type: fetchChannelMappingData.pending.type,
      });

      expect(nextState.isLoading).toBe(true);
      expect(nextState.error).toBeNull();
    });

    it('handles fulfilled state and merges remote mappings to channels', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const mockPayload = {
        culturalTourismChannels: [
          { id: '1', channelId: '1', channelCode: 'MT', channelName: '美团直连', status: 'A' },
        ],
        mappings: [
          {
            id: 'map-1',
            mappingId: 'map-1',
            otaChannelCode: 'MEITUAN',
            otaChannelName: '美团',
            channelId: '1',
            channelCode: 'MT',
            channelName: '美团直连',
            status: 'A',
          },
        ],
      };

      const nextState = channelReducer(initialState, {
        type: fetchChannelMappingData.fulfilled.type,
        payload: mockPayload,
      });

      expect(nextState.isLoading).toBe(false);
      expect(nextState.culturalTourismChannels.length).toBe(1);
      expect(nextState.mappings.length).toBe(1);

      const meituanChannel = nextState.channels.find((c) => c.code === 'MEITUAN');
      expect(meituanChannel?.isMapped).toBe(true);
      expect(meituanChannel?.channelId).toBe('1');
      expect(meituanChannel?.channelCode).toBe('MT');
      expect(meituanChannel?.channelName).toBe('美团直连');

      const douyinChannel = nextState.channels.find((c) => c.code === 'DOUYIN');
      expect(douyinChannel?.isMapped).toBe(false);
      expect(douyinChannel?.channelId).toBe('');
      expect(douyinChannel?.channelCode).toBe('');
      expect(douyinChannel?.targetSystem).toBe('');
    });

    it('dynamically populates remote mapped channels not in current list (catalog channels and custom channels)', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      expect(initialState.channels.length).toBe(3);

      const mockPayload = {
        culturalTourismChannels: [
          { id: '2', channelId: '2', channelCode: 'CTRIP_PMS', channelName: '携程直连通道', status: 'A' },
          { id: '3', channelId: '3', channelCode: 'XY_PMS', channelName: '闲鱼分销通道', status: 'A' },
        ],
        mappings: [
          {
            id: 'map-ctrip',
            mappingId: 'map-ctrip',
            otaChannelCode: 'CTRIP',
            otaChannelName: '携程旅行',
            channelId: '2',
            channelCode: 'CTRIP_PMS',
            channelName: '携程直连通道',
            status: 'A',
          },
          {
            id: 'map-custom',
            mappingId: 'map-custom',
            otaChannelCode: 'XIANYU',
            otaChannelName: '闲鱼文旅',
            channelId: '3',
            channelCode: 'XY_PMS',
            channelName: '闲鱼分销通道',
            status: 'A',
          },
        ],
      };

      const nextState = channelReducer(initialState, {
        type: fetchChannelMappingData.fulfilled.type,
        payload: mockPayload,
      });

      // 3 initial + 2 new remote mapped = 5
      expect(nextState.channels.length).toBe(5);

      const ctrip = nextState.channels.find((c) => c.code === 'CTRIP');
      expect(ctrip).toBeDefined();
      expect(ctrip?.name).toBe('携程旅行'); // from catalog
      expect(ctrip?.isMapped).toBe(true);
      expect(ctrip?.channelId).toBe('2');
      expect(ctrip?.channelCode).toBe('CTRIP_PMS');
      expect(ctrip?.targetSystem).toBe('CTRIP_PMS');

      const custom = nextState.channels.find((c) => c.code === 'XIANYU');
      expect(custom).toBeDefined();
      expect(custom?.name).toBe('闲鱼文旅');
      expect(custom?.isMapped).toBe(true);
      expect(custom?.channelId).toBe('3');
      expect(custom?.channelCode).toBe('XY_PMS');
      expect(custom?.targetSystem).toBe('XY_PMS');
    });

    it('handles rejected state and captures error', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, {
        type: fetchChannelMappingData.rejected.type,
        payload: '文旅平台服务不可用',
      });

      expect(nextState.isLoading).toBe(false);
      expect(nextState.error).toBe('文旅平台服务不可用');
    });
  });

  describe('saveChannelMapping extraReducers', () => {
    it('handles pending state and marks savingChannelId', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, {
        type: saveChannelMapping.pending.type,
        meta: { arg: { channelId: 'meituan' } },
      });

      expect(nextState.isSaving).toBe(true);
      expect(nextState.savingChannelId).toBe('meituan');
      expect(nextState.error).toBeNull();
    });

    it('handles fulfilled state, marks channel as isMapped and updates mappings cache', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, {
        type: saveChannelMapping.fulfilled.type,
        payload: {
          channelId: 'meituan',
          savedPayload: {
            otaChannelCode: 'MEITUAN',
            otaChannelName: '美团',
            channelCode: 'MT',
            channelId: '101',
            status: 'A',
          },
          message: '保存成功',
        },
      });

      expect(nextState.isSaving).toBe(false);
      expect(nextState.savingChannelId).toBeNull();

      const target = nextState.channels.find((c) => c.id === 'meituan');
      expect(target?.isMapped).toBe(true);
      expect(target?.channelId).toBe('101');
      expect(target?.channelCode).toBe('MT');

      expect(nextState.mappings.some((m) => m.otaChannelCode === 'MEITUAN' && m.channelId === '101')).toBe(true);
    });

    it('handles fulfilled state with explicit pmsChannelName and guarantees channelName consistency without reverting to channelCode', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, {
        type: saveChannelMapping.fulfilled.type,
        payload: {
          channelId: 'meituan',
          savedPayload: {
            otaChannelCode: 'MEITUAN',
            otaChannelName: '美团',
            channelCode: 'MT_PMS',
            channelId: '201',
            status: 'A',
          },
          message: '保存成功',
        },
        meta: {
          arg: {
            channelId: 'meituan',
            otaChannelCode: 'MEITUAN',
            pmsChannelId: '201',
            channelCode: 'MT_PMS',
            pmsChannelName: '美团直连文旅云通道',
          },
        },
      });

      const target = nextState.channels.find((c) => c.id === 'meituan');
      expect(target?.isMapped).toBe(true);
      expect(target?.channelName).toBe('美团直连文旅云通道');
      expect(target?.channelCode).toBe('MT_PMS');

      const mappingRecord = nextState.mappings.find((m) => m.otaChannelCode === 'MEITUAN');
      expect(mappingRecord).toBeDefined();
      expect(mappingRecord?.channelName).toBe('美团直连文旅云通道');
      expect(mappingRecord?.channelCode).toBe('MT_PMS');
    });

    it('handles fulfilled state with server-returned mappingId, prioritizing server key into channel and mappings cache', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, {
        type: saveChannelMapping.fulfilled.type,
        payload: {
          channelId: 'meituan',
          mappingId: 'server-mapping-id-9988',
          savedPayload: {
            otaChannelCode: 'MEITUAN',
            otaChannelName: '美团',
            channelCode: 'MT_PMS',
            channelId: '301',
            status: 'A',
          },
          message: '保存成功',
        },
      });

      const target = nextState.channels.find((c) => c.id === 'meituan');
      expect(target?.isMapped).toBe(true);
      expect(target?.mappingId).toBe('server-mapping-id-9988');
      expect(target?.channelId).toBe('301');

      const mappingRecord = nextState.mappings.find((m) => m.otaChannelCode === 'MEITUAN');
      expect(mappingRecord).toBeDefined();
      expect(mappingRecord?.mappingId).toBe('server-mapping-id-9988');
      expect(mappingRecord?.id).toBe('server-mapping-id-9988');
    });


    it('handles rejected state', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, {
        type: saveChannelMapping.rejected.type,
        payload: '保存失败: 接口超时',
        meta: { arg: { channelId: 'meituan' } },
      });

      expect(nextState.isSaving).toBe(false);
      expect(nextState.savingChannelId).toBeNull();
      expect(nextState.error).toBe('保存失败: 接口超时');
    });
  });
});
