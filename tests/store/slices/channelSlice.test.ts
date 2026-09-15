import { describe, it, expect } from 'vitest';
import channelReducer, {
  addChannelById,
  removeChannel,
  updateChannelTargetSystem,
  updateRemarkTemplate,
  setSelectedChannelForTemplate,
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
  });

  describe('removeChannel', () => {
    it('removes target channel from channels array', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const nextState = channelReducer(initialState, removeChannel('meituanbiz'));

      expect(nextState.channels.length).toBe(2);
      expect(nextState.channels.find((c) => c.id === 'meituanbiz')).toBeUndefined();
      expect(nextState.channels.map((c) => c.id)).toEqual(['meituan', 'douyin']);
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

  describe('updateRemarkTemplate', () => {
    it('updates remark template string for specified channel', () => {
      const initialState = channelReducer(undefined, { type: '@@INIT' });
      const customTemplate = '【美团VIP】OTA单号:{OTA订单号}，请务必安排无烟房！';

      const nextState = channelReducer(
        initialState,
        updateRemarkTemplate({ channelId: 'meituan', template: customTemplate })
      );

      const target = nextState.channels.find((c) => c.id === 'meituan');
      expect(target?.remarkTemplate).toBe(customTemplate);
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
});
