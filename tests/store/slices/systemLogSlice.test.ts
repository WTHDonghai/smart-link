import { describe, it, expect } from 'vitest';
import systemLogReducer, {
  setFilterLevel,
  setFilterModule,
  setFilterEvent,
  setFilterChannel,
  setFilterTimeRange,
  toggleOnlyErrors,
  setFilterSearch,
  toggleAutoScroll,
  addLog,
  hydrateLogs,
  clearLogs,
} from '../../../src/store/slices/systemLogSlice';
import { SystemLogEntry } from '../../../src/types';

describe('systemLogSlice', () => {
  it('initializes with clean empty logs and default filter configurations', () => {
    const state = systemLogReducer(undefined, { type: '@@INIT' });

    expect(state.logs).toEqual([]);
    expect(state.filterLevel).toBe('ALL');
    expect(state.filterModule).toBe('ALL');
    expect(state.filterEvent).toBe('ALL');
    expect(state.filterChannel).toBe('ALL');
    expect(state.filterTimeRange).toBe('ALL');
    expect(state.onlyErrors).toBe(false);
    expect(state.filterSearch).toBe('');
    expect(state.isAutoScroll).toBe(true);
    expect(state.storedLogCount).toBe(0);
  });

  describe('filter actions', () => {
    it('updates log level filter accurately', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const errorState = systemLogReducer(initialState, setFilterLevel('ERROR'));
      expect(errorState.filterLevel).toBe('ERROR');

      const playwrightState = systemLogReducer(errorState, setFilterLevel('PLAYWRIGHT'));
      expect(playwrightState.filterLevel).toBe('PLAYWRIGHT');

      const allState = systemLogReducer(playwrightState, setFilterLevel('ALL'));
      expect(allState.filterLevel).toBe('ALL');
    });

    it('updates module and automatically resets event filter if module changed', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      const withEvent = systemLogReducer(initialState, setFilterEvent('ORDER_TRANSFER_PMS_FAILED'));
      expect(withEvent.filterEvent).toBe('ORDER_TRANSFER_PMS_FAILED');

      const moduleChanged = systemLogReducer(withEvent, setFilterModule('AUTH'));
      expect(moduleChanged.filterModule).toBe('AUTH');
      expect(moduleChanged.filterEvent).toBe('ALL');
    });

    it('updates channel and timeRange filters correctly', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const channelState = systemLogReducer(initialState, setFilterChannel('meituan'));
      expect(channelState.filterChannel).toBe('meituan');

      const timeState = systemLogReducer(channelState, setFilterTimeRange('7D'));
      expect(timeState.filterTimeRange).toBe('7D');
    });

    it('toggles onlyErrors flag', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      expect(initialState.onlyErrors).toBe(false);

      const toggled = systemLogReducer(initialState, toggleOnlyErrors());
      expect(toggled.onlyErrors).toBe(true);

      const toggledBack = systemLogReducer(toggled, toggleOnlyErrors());
      expect(toggledBack.onlyErrors).toBe(false);
    });

    it('updates keyword search query', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const searchState = systemLogReducer(initialState, setFilterSearch('DY-20260914-5502'));
      expect(searchState.filterSearch).toBe('DY-20260914-5502');

      const clearedSearchState = systemLogReducer(searchState, setFilterSearch(''));
      expect(clearedSearchState.filterSearch).toBe('');
    });

    it('toggles auto scroll flag between true and false', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      expect(initialState.isAutoScroll).toBe(true);

      const disabledState = systemLogReducer(initialState, toggleAutoScroll());
      expect(disabledState.isAutoScroll).toBe(false);

      const enabledState = systemLogReducer(disabledState, toggleAutoScroll());
      expect(enabledState.isAutoScroll).toBe(true);
    });
  });

  describe('addLog', () => {
    it('prepends a new log entry with generated id, timestamp, and createdAt', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const nextState = systemLogReducer(
        initialState,
        addLog({
          level: 'INFO',
          module: 'ORDER',
          event: 'ORDER_POLL_SUCCESS',
          channelId: 'meituan',
          orderNo: 'MT-20260916-001',
          message: '[CrawlerEngine] 手动触发拉取完成',
          details: '拉取到 2 个待处理新订单',
          durationMs: 340,
        })
      );

      expect(nextState.logs.length).toBe(1);
      expect(nextState.storedLogCount).toBe(1);

      const newLog = nextState.logs[0];
      expect(newLog.id).toMatch(/^log-\d+-[a-z0-9]+$/);
      // 验证日期时间格式为 YYYY-MM-DD HH:mm:ss.SSS
      expect(newLog.timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(typeof newLog.createdAt).toBe('number');
      expect(newLog.createdAt).toBeGreaterThan(0);
      expect(newLog.level).toBe('INFO');
      expect(newLog.module).toBe('ORDER');
      expect(newLog.event).toBe('ORDER_POLL_SUCCESS');
      expect(newLog.channelId).toBe('meituan');
      expect(newLog.orderNo).toBe('MT-20260916-001');
      expect(newLog.message).toBe('[CrawlerEngine] 手动触发拉取完成');
      expect(newLog.details).toBe('拉取到 2 个待处理新订单');
      expect(newLog.durationMs).toBe(340);
    });

    it('enforces maximum 500 logs cap by dropping the oldest log when exceeded', () => {
      const fullLogs: SystemLogEntry[] = Array.from({ length: 500 }, (_, index) => ({
        id: `existing-log-${index}`,
        timestamp: '2026-09-16 10:00:00.000',
        createdAt: 1726452000000 + index,
        level: 'INFO',
        message: `Existing log entry #${index}`,
      }));

      const stateAtCap = {
        ...systemLogReducer(undefined, { type: '@@INIT' }),
        logs: fullLogs,
        storedLogCount: 500,
      };

      expect(stateAtCap.logs.length).toBe(500);
      expect(stateAtCap.logs[0].id).toBe('existing-log-0');
      expect(stateAtCap.logs[499].id).toBe('existing-log-499');

      // 插入第 501 条新日志
      const nextState = systemLogReducer(
        stateAtCap,
        addLog({
          level: 'WARN',
          channelId: 'douyin',
          message: 'Cap overflow test log',
        })
      );

      // 断言日志总数被严格保持在 500 条上限
      expect(nextState.logs.length).toBe(500);
      expect(nextState.storedLogCount).toBe(501);

      // 断言新插入的日志位于队首
      expect(nextState.logs[0].message).toBe('Cap overflow test log');
      expect(nextState.logs[0].level).toBe('WARN');

      // 断言最老的一条日志 (existing-log-499) 被弹出丢弃
      expect(nextState.logs.some((l) => l.id === 'existing-log-499')).toBe(false);
      expect(nextState.logs[499].id).toBe('existing-log-498');
    });
  });

  describe('hydrateLogs', () => {
    it('populates state logs from storage history batch', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      const mockHistory: SystemLogEntry[] = [
        {
          id: 'hist-1',
          timestamp: '2026-09-16 12:00:00.000',
          createdAt: 1726459200000,
          level: 'SUCCESS',
          module: 'AUTH',
          event: 'AUTH_LOGIN_SUCCESS',
          message: '历史登录成功',
        },
      ];

      const hydrated = systemLogReducer(initialState, hydrateLogs(mockHistory));
      expect(hydrated.logs.length).toBe(1);
      expect(hydrated.logs[0].id).toBe('hist-1');
      expect(hydrated.logs[0].message).toBe('历史登录成功');
    });
  });

  describe('clearLogs', () => {
    it('clears active logs in state to empty array', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      const withLog = systemLogReducer(
        initialState,
        addLog({
          level: 'INFO',
          message: '临时日志',
        })
      );
      expect(withLog.logs.length).toBe(1);

      const clearedState = systemLogReducer(withLog, clearLogs());
      expect(clearedState.logs).toEqual([]);
      expect(clearedState.logs.length).toBe(0);
    });
  });
});
