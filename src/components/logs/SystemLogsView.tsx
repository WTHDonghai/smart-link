import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  setFilterLevel,
  setFilterModule,
  setFilterSearch,
  setFilterStartDate,
  setFilterEndDate,
  setFilterDateRange,
  resetDateFilter,
  setFilterTaskStage,
  resetLogFilters,
  toggleAutoScroll,
  clearLogs,
  clearAllLogs,
} from '../../store/slices/systemLogSlice';
import { showToast } from '../../store/slices/appSlice';
import { syncDutyStatusThunk } from '../../store/slices/orderGuardianSlice';
import { TASK_STAGES } from '../../utils/taskStage';
import { isLogQuerySyntaxValid } from '../../utils/logQuery';
import { getTodayDateString, getPastDateString } from '../../utils/logDate';
import { formatLogsForExport } from '../../utils/logExport';
import {
  Terminal,
  Search,
  Trash2,
  Download,
  Play,
  Pause,
  X,
  Code2,
  Calendar,
  RotateCcw,
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { LogTaskMetaChips } from './LogTaskMetaChips';
import { LogApiPayloadSection } from './LogApiPayloadSection';
import { parseDateBounds, matchesLogFilter } from '../../services/logStorage';
import type { LogLevel, LogModule, LogFilterParams } from '../../types';

export interface SystemLogsViewProps {
  defaultExpandApiPayloads?: boolean;
}

export const SystemLogsView: React.FC<SystemLogsViewProps> = ({
  defaultExpandApiPayloads = false,
}) => {
  const dispatch = useAppDispatch();
  const logs = useAppSelector((state) => state.systemLog.logs);
  const filterLevel = useAppSelector((state) => state.systemLog.filterLevel);
  const filterModule = useAppSelector((state) => state.systemLog.filterModule);
  const filterSearch = useAppSelector((state) => state.systemLog.filterSearch);
  const filterStartDate = useAppSelector((state) => state.systemLog.filterStartDate);
  const filterEndDate = useAppSelector((state) => state.systemLog.filterEndDate);
  const filterTaskStage = useAppSelector((state) => state.systemLog.filterTaskStage);
  const isAutoScroll = useAppSelector((state) => state.systemLog.isAutoScroll);
  const hasInvalidQuerySyntax = !!filterSearch && !isLogQuerySyntaxValid(filterSearch);

  const [expandAllApiPayloads, setExpandAllApiPayloads] = useState(defaultExpandApiPayloads);
  const [toggledLogIds, setToggledLogIds] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isPayloadExpanded = (logId: string) => {
    const isToggled = toggledLogIds.has(logId);
    return expandAllApiPayloads ? !isToggled : isToggled;
  };

  const toggleLogExpand = (logId: string) => {
    setToggledLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyText = async (key: string, text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('当前环境不支持剪贴板写入');
      }
      setCopiedKey(key);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
        copyTimerRef.current = null;
      }, 1500);
      dispatch(showToast({ type: 'success', title: '已复制到剪贴板' }));
    } catch {
      dispatch(showToast({ type: 'error', title: '复制失败，请手动选择复制' }));
    }
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const filteredLogs = useMemo(() => {
    const bounds = parseDateBounds(filterStartDate, filterEndDate);
    if (bounds.startMs !== null && bounds.endMs !== null && bounds.startMs > bounds.endMs) {
      return [];
    }

    const filterParams: LogFilterParams = {
      level: filterLevel,
      module: filterModule,
      startDate: filterStartDate,
      endDate: filterEndDate,
      taskActionStage: filterTaskStage,
      search: filterSearch,
    };

    return logs.filter((log) => matchesLogFilter(log, filterParams, bounds));
  }, [
    logs,
    filterLevel,
    filterModule,
    filterTaskStage,
    filterStartDate,
    filterEndDate,
    filterSearch,
  ]);

  // 挂载时立即拉取后台与主进程的最新值守/调度运行日志（全局轮询由 App.tsx 统一维持）
  useEffect(() => {
    void dispatch(syncDutyStatusThunk());
  }, [dispatch]);

  // 当开启自动滚动且新日志到达时，自动保持置顶于最新的日志
  useEffect(() => {
    if (isAutoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [filteredLogs.length, isAutoScroll]);

  const handleClearLogs = async () => {
    dispatch(clearLogs());
    const action = await dispatch(clearAllLogs());
    if (clearAllLogs.fulfilled.match(action)) {
      dispatch(
        showToast({
          title: '系统日志已清空',
          description: '已清除内存与持久化存储',
          type: 'success',
        })
      );
    } else {
      dispatch(
        showToast({
          title: '清空日志失败',
          description: '持久化存储未能清空，请重试',
          type: 'error',
        })
      );
    }
  };

  const handleExport = () => {
    const text = formatLogsForExport(filteredLogs);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-link-auto-logs-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
    dispatch(
      showToast({
        title: '系统日志导出完成',
        description: '已保存至本地文件',
        type: 'success',
      })
    );
  };

  const renderLevelBadge = (level: LogLevel) => {
    switch (level) {
      case 'PLAYWRIGHT':
        return <StatusBadge variant="playwright" label="PLAYWRIGHT" icon={true} size="xs" />;
      case 'SUCCESS':
        return <StatusBadge variant="success" label="SUCCESS" size="xs" />;
      case 'WARN':
        return <StatusBadge variant="warning" label="WARN" size="xs" />;
      case 'ERROR':
        return <StatusBadge variant="failed" label="ERROR" size="xs" />;
      default:
        return <StatusBadge variant="info" label="INFO" size="xs" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden w-full p-4 md:p-6 gap-3 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4.5 rounded-full bg-[#004ac6] shrink-0" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">
            系统日志
          </h1>
          <span className="text-xs text-[#737686] ml-2">
            共 <span className="font-mono font-medium text-[#0b1c30]">{logs.length}</span> 条记录
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle All API Payloads */}
          <button
            type="button"
            onClick={() => {
              setExpandAllApiPayloads((prev) => !prev);
              setToggledLogIds(new Set());
            }}
            className={`h-8.5 px-3 border rounded-lg text-xs font-medium shadow-2xs transition-colors cursor-pointer select-none inline-flex items-center gap-1.5 ${
              expandAllApiPayloads
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-white border-[#dce9ff] text-[#434655] hover:bg-gray-50'
            }`}
            title={expandAllApiPayloads ? '点击收起全部接口传参和返回' : '点击展开全部接口传参和返回'}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{expandAllApiPayloads ? '收起全部参数' : '展开全部参数'}</span>
          </button>

          {/* Auto Scroll Toggle Button */}
          <button
            type="button"
            onClick={() => dispatch(toggleAutoScroll())}
            className={`h-8.5 px-3 border rounded-lg text-xs font-medium shadow-2xs transition-colors cursor-pointer select-none inline-flex items-center gap-1.5 ${
              isAutoScroll 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' 
                : 'bg-white border-[#dce9ff] text-[#434655] hover:bg-gray-50'
            }`}
            title={isAutoScroll ? '点击暂停自动滚动' : '点击开启自动滚动'}
          >
            {isAutoScroll ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>自动滚动: 开</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>自动滚动: 关</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExport}
            className="h-8.5 px-3 bg-white border border-[#dce9ff] text-[#434655] hover:text-[#0b1c30] hover:bg-[#eff4ff] rounded-lg text-xs font-medium shadow-2xs transition-colors cursor-pointer select-none inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出</span>
          </button>

          <button
            type="button"
            onClick={handleClearLogs}
            className="h-8.5 px-3 bg-white border border-[#ffdad6] text-[#ba1a1a] hover:bg-rose-50 rounded-lg text-xs font-medium shadow-2xs transition-colors cursor-pointer select-none inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>清空</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-2.5 shrink-0 bg-white p-3 rounded-xl border border-[#e2e8f0] shadow-2xs">
        {/* Row 1: 统一输入与时间检索控制栏 (高度统一为 h-8，消除参差错落) */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* 统一专业日志搜索框 (合二为一：支持自由文本、单号与专业查询语句，如 order:12345 stage:claim level:error) */}
          <div className="flex-1 min-w-[260px] max-w-lg">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#737686] pointer-events-none" />
              <input
                type="text"
                value={filterSearch}
                onChange={(e) => dispatch(setFilterSearch(e.target.value))}
                placeholder="搜索日志关键词，或查询语句 (如 order:12345 stage:claim level:error)..."
                className="w-full h-8 pl-8 pr-8 bg-[#f8faff] border border-[#dce9ff] rounded-lg text-xs font-mono text-[#0b1c30] placeholder-[#94a3b8] outline-hidden focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] transition-colors"
              />
              {filterSearch && (
                <button
                  type="button"
                  onClick={() => dispatch(setFilterSearch(''))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#0b1c30] p-0.5 cursor-pointer"
                  title="清空搜索条件"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {hasInvalidQuerySyntax && (
              <p className="mt-1 text-[11px] text-amber-800">
                查询语法不完整，已按字面文本匹配
              </p>
            )}
          </div>

          {/* 日期过滤组合：预设胶囊 + 自定义起止日期 */}
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <span className="text-xs text-[#737686] font-medium mr-0.5 select-none inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-[#004ac6]" />
              <span>日期:</span>
            </span>

            {/* 预设胶囊按钮组 */}
            {(() => {
              const todayStr = getTodayDateString();
              const past3DaysStr = getPastDateString(2);
              const past7DaysStr = getPastDateString(6);
              const isToday = filterStartDate === todayStr && filterEndDate === todayStr;
              const is3Days = filterStartDate === past3DaysStr && filterEndDate === todayStr;
              const is7Days = filterStartDate === past7DaysStr && filterEndDate === todayStr;
              const isAllDate = !filterStartDate && !filterEndDate;

              return (
                <div className="inline-flex rounded-lg border border-[#dce9ff] p-0.5 bg-[#f8faff] gap-0.5">
                  <button
                    type="button"
                    onClick={() => dispatch(resetDateFilter())}
                    className={`h-7 px-2 rounded text-xs font-medium transition-colors cursor-pointer select-none ${
                      isAllDate
                        ? 'bg-[#004ac6] text-white font-semibold shadow-2xs'
                        : 'text-[#434655] hover:bg-white hover:text-[#0b1c30]'
                    }`}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatch(setFilterDateRange({ startDate: todayStr, endDate: todayStr }))}
                    className={`h-7 px-2 rounded text-xs font-medium transition-colors cursor-pointer select-none ${
                      isToday
                        ? 'bg-[#004ac6] text-white font-semibold shadow-2xs'
                        : 'text-[#434655] hover:bg-white hover:text-[#0b1c30]'
                    }`}
                  >
                    今天
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatch(setFilterDateRange({ startDate: past3DaysStr, endDate: todayStr }))}
                    className={`h-7 px-2 rounded text-xs font-medium transition-colors cursor-pointer select-none ${
                      is3Days
                        ? 'bg-[#004ac6] text-white font-semibold shadow-2xs'
                        : 'text-[#434655] hover:bg-white hover:text-[#0b1c30]'
                    }`}
                  >
                    近3天
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatch(setFilterDateRange({ startDate: past7DaysStr, endDate: todayStr }))}
                    className={`h-7 px-2 rounded text-xs font-medium transition-colors cursor-pointer select-none ${
                      is7Days
                        ? 'bg-[#004ac6] text-white font-semibold shadow-2xs'
                        : 'text-[#434655] hover:bg-white hover:text-[#0b1c30]'
                    }`}
                  >
                    近7天
                  </button>
                </div>
              );
            })()}

            {/* 日期范围选择器 (h-8 统一高度) */}
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => dispatch(setFilterStartDate(e.target.value))}
                aria-label="日志开始日期"
                className="h-8 px-2 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-lg text-xs font-mono text-[#0b1c30] outline-hidden cursor-pointer"
              />
              <span className="text-xs text-[#737686]">至</span>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => dispatch(setFilterEndDate(e.target.value))}
                aria-label="日志结束日期"
                className="h-8 px-2 bg-white border border-[#dce9ff] focus:border-[#004ac6] rounded-lg text-xs font-mono text-[#0b1c30] outline-hidden cursor-pointer"
              />
              {(filterStartDate || filterEndDate) && (
                <button
                  type="button"
                  onClick={() => dispatch(resetDateFilter())}
                  className="text-[#94a3b8] hover:text-[#0b1c30] p-1 cursor-pointer"
                  title="清除日期筛选"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 重置所有筛选按钮 */}
          {(filterLevel !== 'ALL' ||
            filterModule !== 'ALL' ||
            !!filterSearch ||
            !!filterStartDate ||
            !!filterEndDate ||
            filterTaskStage !== 'ALL') && (
            <button
              type="button"
              onClick={() => dispatch(resetLogFilters())}
              className="h-8 px-2.5 bg-gray-100 hover:bg-gray-200 text-[#434655] rounded-lg text-xs font-medium transition-colors cursor-pointer select-none inline-flex items-center gap-1 shrink-0 ml-auto"
              title="重置所有筛选条件"
            >
              <RotateCcw className="w-3 h-3" />
              <span>重置</span>
            </button>
          )}
        </div>

        {/* Row 2: 维度徽章选择栏 (分组排列，整齐清晰) */}
        <div className="flex items-center gap-2.5 flex-wrap pt-2 border-t border-[#f1f5f9]">
          {/* 业务模块 Group */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-[#737686] font-medium mr-0.5 select-none shrink-0">业务模块:</span>
            {(
              [
                { key: 'ALL', label: '全部' },
                { key: 'API', label: '接口请求' },
                { key: 'DUTY_TASK', label: '任务调度' },
                { key: 'ORDER', label: '订单值守' },
                { key: 'HOTEL', label: '门店采集' },
                { key: 'SYSTEM', label: '系统内核' },
              ] as const
            ).map((mod) => (
              <button
                key={mod.key}
                type="button"
                onClick={() => dispatch(setFilterModule(mod.key as 'ALL' | LogModule))}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer select-none ${
                  filterModule === mod.key
                    ? 'bg-[#004ac6] text-white font-semibold shadow-2xs'
                    : 'bg-[#f8faff] border border-[#dce9ff] text-[#434655] hover:bg-white'
                }`}
              >
                {mod.label}
              </button>
            ))}
          </div>

          {/* 竖分割线 */}
          <div className="hidden lg:block h-3.5 w-px bg-slate-200 shrink-0 mx-0.5" />

          {/* Task 操作 Group */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-[#737686] font-medium mr-0.5 select-none shrink-0">Task 操作:</span>
            {TASK_STAGES.map((op) => {
              const isSelected = filterTaskStage === op.key;
              return (
                <button
                  key={op.key}
                  type="button"
                  onClick={() => dispatch(setFilterTaskStage(isSelected && op.key !== 'ALL' ? 'ALL' : op.key))}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer select-none ${
                    isSelected
                      ? 'bg-[#004ac6] text-white font-semibold shadow-2xs'
                      : 'bg-[#f8faff] border border-[#dce9ff] text-[#434655] hover:bg-white'
                  }`}
                >
                  {op.label}
                </button>
              );
            })}
          </div>

          {/* 竖分割线 */}
          <div className="hidden lg:block h-3.5 w-px bg-slate-200 shrink-0 mx-0.5" />

          {/* 日志级别 Group */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-[#737686] font-medium mr-0.5 select-none shrink-0">日志级别:</span>
            {(['ALL', 'PLAYWRIGHT', 'INFO', 'WARN', 'ERROR', 'SUCCESS'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => dispatch(setFilterLevel(lvl as 'ALL' | LogLevel))}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer select-none ${
                  filterLevel === lvl
                    ? 'bg-slate-800 text-white font-semibold shadow-2xs'
                    : 'bg-[#f8faff] border border-[#e2e8f0] text-[#737686] hover:bg-white'
                }`}
              >
                {lvl === 'ALL' ? '全部级别' : lvl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Terminal View Container */}
      <div className="flex-1 min-h-0 rounded-xl border border-[#213145] bg-[#0b1c30] text-gray-200 overflow-hidden shadow-lg flex flex-col">
        {/* Terminal Header */}
        <div className="px-4 py-2.5 bg-[#071322] border-b border-[#213145] flex items-center justify-between text-xs text-gray-400 select-none shrink-0">
          <div className="flex items-center gap-2 font-mono">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>duty-task-daemon@smartlink: ~/runtime/logs</span>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-emerald-400">● 实时捕获中</span>
            <span>当前显示 {filteredLogs.length} 条</span>
          </div>
        </div>

        {/* Log Entries Stream */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 min-h-0 p-4 font-mono text-xs overflow-y-auto space-y-2.5 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-gray-400 select-none">
              <p className="text-xs">暂无匹配的系统运行日志</p>
              {(filterLevel !== 'ALL' ||
                filterModule !== 'ALL' ||
                !!filterSearch ||
                !!filterStartDate ||
                !!filterEndDate ||
                filterTaskStage !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => dispatch(resetLogFilters())}
                  className="px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-cyan-400 border border-slate-600 rounded text-xs font-medium transition-colors cursor-pointer inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>清空所有筛选条件</span>
                </button>
              )}
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 p-2.5 rounded hover:bg-white/5 transition-colors border-l-2 border-transparent hover:border-[#004ac6] bg-[#0b1c30]"
              >
                <span className="text-gray-500 shrink-0 select-none font-mono text-[11px] pt-0.5">
                  {log.timestamp}
                </span>

                <div className="shrink-0 pt-0.5">
                  {renderLevelBadge(log.level)}
                </div>

                <div className="flex flex-col flex-1 min-w-0">
                  <div className="text-gray-100 font-medium break-all">
                    {log.message}
                  </div>

                  {/* 任务流转元数据标签 (CLAIM / RESULT / msgType / taskId / 成功或失败) */}
                  <LogTaskMetaChips log={log} />

                  {/* 接口请求传参与返回详情区 (传参 & 返回) */}
                  <LogApiPayloadSection
                    log={log}
                    expanded={isPayloadExpanded(log.id)}
                    copiedKey={copiedKey}
                    onToggleExpand={() => toggleLogExpand(log.id)}
                    onCopy={handleCopyText}
                  />

                  {/* 详细执行结果结构体 (非 API 专属的任务原生结果) */}
                  {log.taskResult !== undefined && !log.apiUrl && (
                    <div className="text-emerald-300 text-[11px] mt-1 break-all bg-emerald-950/30 border border-emerald-800/40 p-2 rounded font-mono">
                      <span className="text-gray-400 mr-1.5 font-bold">result:</span>
                      {typeof log.taskResult === 'object'
                        ? JSON.stringify(log.taskResult)
                        : String(log.taskResult)}
                    </div>
                  )}

                  {log.details && (
                    <div className="text-gray-400 text-[11px] mt-1 break-all bg-black/30 p-1.5 rounded">
                      {log.details}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
