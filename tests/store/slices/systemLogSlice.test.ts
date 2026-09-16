import { describe, it, expect } from 'vitest';
import systemLogReducer, {
  setFilterLevel,
  setFilterSearch,
  toggleAutoScroll,
  addLog,
  clearLogs,
} from '../../../src/store/slices/systemLogSlice';
import { SystemLogEntry } from '../../../src/types';

describe('systemLogSlice', () => {
  it('initializes with preset initial logs and default filter configurations', () => {
    const state = systemLogReducer(undefined, { type: '@@INIT' });

    expect(state.logs.length).toBe(7);
    expect(state.filterLevel).toBe('ALL');
    expect(state.filterSearch).toBe('');
    expect(state.isAutoScroll).toBe(true);

    const firstLog = state.logs[0];
    expect(firstLog.id).toBe('log-01');
    expect(firstLog.level).toBe('PLAYWRIGHT');
    expect(firstLog.channelId).toBe('meituan');
  });

  describe('setFilterLevel', () => {
    it('updates log level filter accurately', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const errorState = systemLogReducer(initialState, setFilterLevel('ERROR'));
      expect(errorState.filterLevel).toBe('ERROR');

      const playwrightState = systemLogReducer(errorState, setFilterLevel('PLAYWRIGHT'));
      expect(playwrightState.filterLevel).toBe('PLAYWRIGHT');

      const allState = systemLogReducer(playwrightState, setFilterLevel('ALL'));
      expect(allState.filterLevel).toBe('ALL');
    });
  });

  describe('setFilterSearch', () => {
    it('updates keyword search query', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });

      const searchState = systemLogReducer(initialState, setFilterSearch('ChromiumWorker'));
      expect(searchState.filterSearch).toBe('ChromiumWorker');

      const clearedSearchState = systemLogReducer(searchState, setFilterSearch(''));
      expect(clearedSearchState.filterSearch).toBe('');
    });
  });

  describe('toggleAutoScroll', () => {
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
    it('prepends a new log entry with generated id and valid time string', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      const initialCount = initialState.logs.length;

      const nextState = systemLogReducer(
        initialState,
        addLog({
          level: 'INFO',
          channelId: 'meituan',
          message: '[CrawlerEngine] 手动触发拉取完成',
          details: '拉取到 2 个待处理新订单',
        })
      );

      expect(nextState.logs.length).toBe(initialCount + 1);

      const newLog = nextState.logs[0];
      expect(newLog.id).toMatch(/^log-\d+-[a-z0-9]+$/);
      expect(newLog.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(newLog.level).toBe('INFO');
      expect(newLog.channelId).toBe('meituan');
      expect(newLog.message).toBe('[CrawlerEngine] 手动触发拉取完成');
      expect(newLog.details).toBe('拉取到 2 个待处理新订单');
    });

    it('enforces maximum 300 logs cap by dropping the oldest log when exceeded', () => {
      // 构造包含恰好 300 条日志的初始状态
      const fullLogs: SystemLogEntry[] = Array.from({ length: 300 }, (_, index) => ({
        id: `existing-log-${index}`,
        timestamp: '10:00:00.000',
        level: 'INFO',
        message: `Existing log entry #${index}`,
      }));

      const stateAtCap = {
        ...systemLogReducer(undefined, { type: '@@INIT' }),
        logs: fullLogs,
      };

      expect(stateAtCap.logs.length).toBe(300);
      expect(stateAtCap.logs[0].id).toBe('existing-log-0');
      expect(stateAtCap.logs[299].id).toBe('existing-log-299');

      // 插入第 301 条新日志
      const nextState = systemLogReducer(
        stateAtCap,
        addLog({
          level: 'WARN',
          channelId: 'douyin',
          message: 'Cap overflow test log',
          details: 'This should trigger pop() on the oldest entry',
        })
      );

      // 断言日志总数被严格保持在 300 条上限
      expect(nextState.logs.length).toBe(300);

      // 断言新插入的日志位于队首
      expect(nextState.logs[0].message).toBe('Cap overflow test log');
      expect(nextState.logs[0].level).toBe('WARN');

      // 断言最老的一条日志 (existing-log-299) 被弹出丢弃
      expect(nextState.logs.some((l) => l.id === 'existing-log-299')).toBe(false);

      // 原倒数第二条 (existing-log-298) 现成为最老的一条
      expect(nextState.logs[299].id).toBe('existing-log-298');
    });
  });

  describe('clearLogs', () => {
    it('clears all logs in state to empty array', () => {
      const initialState = systemLogReducer(undefined, { type: '@@INIT' });
      expect(initialState.logs.length).toBeGreaterThan(0);

      const clearedState = systemLogReducer(initialState, clearLogs());
      expect(clearedState.logs).toEqual([]);
      expect(clearedState.logs.length).toBe(0);
    });
  });
});
