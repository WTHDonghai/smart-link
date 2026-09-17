import React, { useState, useRef, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  setFilterLevel,
  setFilterModule,
  setFilterSearch, 
  toggleAutoScroll, 
  clearLogs,
  clearAllLogs,
} from '../../store/slices/systemLogSlice';
import { showToast } from '../../store/slices/appSlice';
import { 
  Terminal, 
  Search, 
  Trash2, 
  Download, 
  Play, 
  Pause, 
  X,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Code2,
  ChevronDown,
  ChevronUp,
  Upload,
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import type { LogLevel, LogModule } from '../../types';

function formatJsonPayload(data: unknown): string {
  if (data === undefined) return '(无入参)';
  if (data === null) return 'null';
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return data;
    }
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

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
  const isAutoScroll = useAppSelector((state) => state.systemLog.isAutoScroll);

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

  const handleCopyText = async (key: string, text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('当前环境不支持剪贴板写入');
      }
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 1500);
      dispatch(showToast({ type: 'success', title: '已复制到剪贴板' }));
    } catch {
      dispatch(showToast({ type: 'error', title: '复制失败，请手动选择复制' }));
    }
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter((log) => {
    const matchesLevel = filterLevel === 'ALL' || log.level === filterLevel;
    const isApiLog =
      log.module === 'API' ||
      !!log.apiUrl ||
      (typeof log.event === 'string' && log.event.startsWith('API_'));
    const matchesModule =
      filterModule === 'ALL'
        ? true
        : filterModule === 'API'
          ? isApiLog
          : log.module === filterModule;
    const matchesSearch =
      !filterSearch ||
      log.message.toLowerCase().includes(filterSearch.toLowerCase()) ||
      (log.details && log.details.toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.channelId && log.channelId.toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.taskId && log.taskId.toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.msgType && log.msgType.toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.taskActionStage && log.taskActionStage.toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.apiUrl && log.apiUrl.toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.apiMethod && log.apiMethod.toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.apiParams !== undefined && JSON.stringify(log.apiParams).toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.apiResponse !== undefined && JSON.stringify(log.apiResponse).toLowerCase().includes(filterSearch.toLowerCase()));
    return matchesLevel && matchesModule && matchesSearch;
  });

  // 当开启自动滚动且新日志到达时，自动保持置顶于最新的日志
  useEffect(() => {
    if (isAutoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [filteredLogs.length, isAutoScroll]);

  const handleClearLogs = async () => {
    dispatch(clearLogs());
    await dispatch(clearAllLogs());
    dispatch(
      showToast({
        title: '系统日志已清空',
        description: '已清除内存与持久化存储',
        type: 'success',
      })
    );
  };

  const handleExport = () => {
    const text = logs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level}] [${l.module || 'UNKNOWN'}]${
            l.apiMethod ? ` [${l.apiMethod}]` : ''
          }${l.apiUrl ? ` [${l.apiUrl}]` : ''}${
            l.httpStatus ? ` [HTTP ${l.httpStatus}]` : ''
          }${
            l.taskActionStage ? ` [${l.taskActionStage}]` : ''
          }${l.msgType ? ` [msgType:${l.msgType}]` : ''}${
            l.taskId ? ` [taskId:${l.taskId}]` : ''
          } ${l.message} ${l.details ? `| ${l.details}` : ''}${
            l.apiParams !== undefined ? ` | params: ${JSON.stringify(l.apiParams)}` : ''
          }${
            l.apiResponse !== undefined ? ` | response: ${JSON.stringify(l.apiResponse)}` : ''
          }${
            l.taskResult !== undefined
              ? ` | result: ${typeof l.taskResult === 'object' ? JSON.stringify(l.taskResult) : String(l.taskResult)}`
              : ''
          }`
      )
      .join('\n');
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

  const renderLevelBadge = (level: string) => {
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

  const renderTaskMetaChips = (log: (typeof logs)[number]) => {
    if (!log.taskActionStage && !log.msgType && !log.taskId && !log.taskStatus) return null;

    return (
      <div className="flex flex-wrap items-center gap-1.5 my-1 font-mono text-[11px]">
        {/* 1. 任务流转阶段: 优先明确是 CLAIM 认领还是 RESULT 结果 */}
        {log.taskActionStage === 'CLAIM' && (
          <span className="px-1.5 py-0.5 rounded font-semibold bg-purple-500/25 text-purple-300 border border-purple-500/40">
            认领 CLAIM
          </span>
        )}
        {log.taskActionStage === 'EXECUTE' && (
          <span className="px-1.5 py-0.5 rounded font-semibold bg-blue-500/25 text-blue-300 border border-blue-500/40">
            执行 EXECUTE
          </span>
        )}
        {log.taskActionStage === 'RESULT' && (
          <span
            className={`px-1.5 py-0.5 rounded font-semibold ${
              log.taskStatus === 'SUCCEEDED'
                ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                : 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
            }`}
          >
            结果 RESULT
          </span>
        )}
        {log.taskActionStage === 'REPORT' && (
          <span className="px-1.5 py-0.5 rounded font-semibold bg-amber-500/25 text-amber-300 border border-amber-500/40">
            上报 REPORT
          </span>
        )}

        {/* 2. 任务消息类型 msgType */}
        {log.msgType && (
          <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-600/40">
            msgType: {log.msgType}
          </span>
        )}

        {/* 3. 任务 ID */}
        {log.taskId && (
          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
            taskId: {log.taskId}
          </span>
        )}

        {/* 4. 任务执行状态 (成功/失败) */}
        {log.taskStatus && (
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold ${
              log.taskStatus === 'SUCCEEDED'
                ? 'text-emerald-400 bg-emerald-950/50 border border-emerald-600/40'
                : log.taskStatus === 'FAILED'
                ? 'text-rose-400 bg-rose-950/50 border border-rose-600/40'
                : 'text-amber-400 bg-amber-950/50 border border-amber-600/40'
            }`}
          >
            {log.taskStatus === 'SUCCEEDED' ? (
              <>
                <CheckCircle2 className="w-3 h-3" />
                <span>成功</span>
              </>
            ) : log.taskStatus === 'FAILED' ? (
              <>
                <XCircle className="w-3 h-3" />
                <span>失败</span>
              </>
            ) : (
              <span>{log.taskStatus}</span>
            )}
          </span>
        )}
      </div>
    );
  };

  const renderApiPayloadSection = (log: (typeof logs)[number]) => {
    const hasApiInfo = !!log.apiUrl || !!log.apiMethod || log.apiParams !== undefined || log.apiResponse !== undefined;
    if (!hasApiInfo) return null;

    const expanded = isPayloadExpanded(log.id);
    const method = (log.apiMethod || 'API').toUpperCase();
    const paramsText = formatJsonPayload(log.apiParams);
    const responseText = formatJsonPayload(log.apiResponse);

    const getMethodTone = (m: string) => {
      switch (m) {
        case 'GET':
          return 'bg-emerald-950/60 text-emerald-300 border-emerald-600/40';
        case 'POST':
          return 'bg-blue-950/60 text-blue-300 border-blue-600/40';
        case 'PUT':
          return 'bg-amber-950/60 text-amber-300 border-amber-600/40';
        case 'DELETE':
          return 'bg-rose-950/60 text-rose-300 border-rose-600/40';
        default:
          return 'bg-purple-950/60 text-purple-300 border-purple-600/40';
      }
    };

    return (
      <div className="mt-2 flex flex-col gap-1.5 font-mono text-xs">
        {/* API 核心摘要条 */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-1.5 bg-[#071322] border border-[#213145] rounded-md select-none">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold border ${getMethodTone(method)}`}>
              {method}
            </span>
            {log.apiUrl && (
              <span className="text-cyan-300 text-[11px] font-semibold bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40 truncate max-w-[400px]" title={log.apiUrl}>
                {log.apiUrl}
              </span>
            )}
            {log.httpStatus && (
              <span
                className={`px-1.5 py-0.5 rounded text-[11px] font-bold border ${
                  log.httpStatus >= 200 && log.httpStatus < 300
                    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-600/40'
                    : 'bg-rose-950/50 text-rose-300 border-rose-600/40'
                }`}
              >
                HTTP {log.httpStatus}
              </span>
            )}
            {log.durationMs !== undefined && (
              <span className="text-gray-400 text-[11px]">
                {log.durationMs}ms
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => toggleLogExpand(log.id)}
            className="inline-flex items-center gap-1 text-[11px] text-gray-300 hover:text-white px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700 transition-colors cursor-pointer"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3 text-cyan-400" />
                <span>收起传参与返回</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3 text-cyan-400" />
                <span>展开传参与返回</span>
              </>
            )}
          </button>
        </div>

        {/* 展开呈现：请求入参 & 接口返回 */}
        {expanded && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-[11px]">
            {/* 1. 请求入参面板 */}
            <div className="bg-[#050e18] border border-[#1e293b] rounded-md p-2.5 flex flex-col min-w-0 shadow-inner">
              <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#1e293b] text-gray-400 select-none">
                <span className="font-bold text-amber-300 inline-flex items-center gap-1">
                  <Upload className="w-3 h-3" />
                  <span>📤 请求入参 (Params / Body)</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyText(`${log.id}-params`, paramsText)}
                  disabled={log.apiParams === undefined}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700"
                  title="复制请求参数"
                >
                  {copiedKey === `${log.id}-params` ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400 font-semibold">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>复制入参</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="text-amber-200/90 font-mono text-[11px] overflow-x-auto max-h-56 p-2 rounded bg-black/40 border border-[#1b2533] select-text whitespace-pre-wrap break-all leading-relaxed">
                {paramsText}
              </pre>
            </div>

            {/* 2. 接口返回面板 */}
            <div className="bg-[#050e18] border border-[#1e293b] rounded-md p-2.5 flex flex-col min-w-0 shadow-inner">
              <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#1e293b] text-gray-400 select-none">
                <span className="font-bold text-cyan-300 inline-flex items-center gap-1">
                  <Download className="w-3 h-3" />
                  <span>📥 接口返回 (Response Data)</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyText(`${log.id}-response`, responseText)}
                  disabled={log.apiResponse === undefined}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700"
                  title="复制接口返回"
                >
                  {copiedKey === `${log.id}-response` ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400 font-semibold">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>复制返回</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="text-cyan-200/90 font-mono text-[11px] overflow-x-auto max-h-56 p-2 rounded bg-black/40 border border-[#1b2533] select-text whitespace-pre-wrap break-all leading-relaxed">
                {responseText}
              </pre>
            </div>
          </div>
        )}
      </div>
    );
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
      <div className="flex flex-col gap-2.5 shrink-0">
        {/* Module Filter Pills */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[#737686] font-medium mr-1 select-none">业务模块:</span>
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
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer select-none ${
                  filterModule === mod.key
                    ? 'bg-[#004ac6] text-white font-semibold shadow-2xs'
                    : 'bg-white border border-[#dce9ff] text-[#434655] hover:bg-[#f8faff]'
                }`}
              >
                {mod.label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#737686] pointer-events-none" />
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => dispatch(setFilterSearch(e.target.value))}
              placeholder="搜索日志 / URL / 参数 / msgType..."
              className="w-full h-8.5 pl-8.5 pr-8 bg-white border border-[#dce9ff] rounded-lg text-xs text-[#0b1c30] placeholder-[#94a3b8] outline-hidden focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] transition-colors"
            />
            {filterSearch && (
              <button
                type="button"
                onClick={() => dispatch(setFilterSearch(''))}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#0b1c30] p-0.5 cursor-pointer"
                title="清空搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Level Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[#737686] font-medium mr-1 select-none">日志级别:</span>
          {(['ALL', 'PLAYWRIGHT', 'INFO', 'WARN', 'ERROR', 'SUCCESS'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => dispatch(setFilterLevel(lvl as 'ALL' | LogLevel))}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer select-none ${
                filterLevel === lvl
                  ? 'bg-slate-800 text-white font-semibold shadow-2xs'
                  : 'bg-white border border-[#e2e8f0] text-[#737686] hover:bg-[#f8faff]'
              }`}
            >
              {lvl === 'ALL' ? '全部级别' : lvl}
            </button>
          ))}
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
            <div className="py-12 text-center text-gray-500">
              暂无匹配的系统运行日志
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
                  {renderTaskMetaChips(log)}

                  {/* 接口请求传参与返回详情区 (传参 & 返回) */}
                  {renderApiPayloadSection(log)}

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
