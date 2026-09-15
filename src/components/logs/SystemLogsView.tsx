import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  setFilterLevel, 
  setFilterSearch, 
  toggleAutoScroll, 
  clearLogs, 
  addLog 
} from '../../store/slices/systemLogSlice';
import { showToast } from '../../store/slices/appSlice';
import { 
  Terminal, 
  Search, 
  Trash2, 
  Download, 
  Play, 
  Pause, 
  Bot, 
  Info, 
  AlertTriangle, 
  XCircle, 
  CheckCircle2,
  RefreshCw
} from 'lucide-react';

export const SystemLogsView: React.FC = () => {
  const dispatch = useAppDispatch();
  const logs = useAppSelector((state) => state.systemLog.logs);
  const filterLevel = useAppSelector((state) => state.systemLog.filterLevel);
  const filterSearch = useAppSelector((state) => state.systemLog.filterSearch);
  const isAutoScroll = useAppSelector((state) => state.systemLog.isAutoScroll);

  const filteredLogs = logs.filter((log) => {
    const matchesLevel = filterLevel === 'ALL' || log.level === filterLevel;
    const matchesSearch = !filterSearch || 
      log.message.toLowerCase().includes(filterSearch.toLowerCase()) ||
      (log.details && log.details.toLowerCase().includes(filterSearch.toLowerCase())) ||
      (log.channelId && log.channelId.toLowerCase().includes(filterSearch.toLowerCase()));
    return matchesLevel && matchesSearch;
  });

  const handleExport = () => {
    const text = logs.map(l => `[${l.timestamp}] [${l.level}] ${l.message} ${l.details ? `| ${l.details}` : ''}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-link-auto-logs-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
    dispatch(showToast({
      title: '系统日志导出完成',
      description: '已保存至本地文件',
      type: 'success'
    }));
  };

  const handleTriggerCrawlerPing = () => {
    dispatch(addLog({
      level: 'PLAYWRIGHT',
      channelId: 'meituan',
      message: '[Playwright:ManualPing] Injected polling script to active Chromium worker. Session verified (200 OK).'
    }));
    dispatch(showToast({
      title: '已发送 Playwright 探活探针',
      type: 'info'
    }));
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'PLAYWRIGHT':
        return (
          <span className="bg-purple-100 text-purple-800 border border-purple-200 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold flex items-center gap-1">
            <Bot className="w-3 h-3" />
            PLAYWRIGHT
          </span>
        );
      case 'SUCCESS':
        return (
          <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">
            SUCCESS
          </span>
        );
      case 'WARN':
        return (
          <span className="bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">
            WARN
          </span>
        );
      case 'ERROR':
        return (
          <span className="bg-rose-100 text-rose-800 border border-rose-200 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">
            ERROR
          </span>
        );
      default:
        return (
          <span className="bg-blue-100 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">
            INFO
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-[1400px] mx-auto w-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0]">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4.5 rounded-full bg-[#004ac6] shrink-0" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">
            系统日志
          </h1>
          <span className="text-xs text-[#737686] ml-2">
            共 {logs.length} 条记录
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTriggerCrawlerPing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#dce9ff] text-[#004ac6] hover:bg-[#eff4ff] rounded-lg text-xs font-medium shadow-2xs transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>心跳探针</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#dce9ff] text-[#434655] hover:text-[#0b1c30] hover:bg-[#eff4ff] rounded-lg text-xs font-medium shadow-2xs transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出</span>
          </button>

          <button
            type="button"
            onClick={() => dispatch(clearLogs())}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#dce9ff] text-[#ba1a1a] hover:bg-rose-50 rounded-lg text-xs font-medium shadow-2xs transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>清空</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'PLAYWRIGHT', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => dispatch(setFilterLevel(lvl))}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                filterLevel === lvl
                  ? 'bg-[#004ac6] text-white'
                  : 'bg-white border border-[#dce9ff] text-[#434655] hover:bg-[#f8faff]'
              }`}
            >
              {lvl === 'ALL' ? '全部日志' : lvl}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#737686]" />
          <input
            type="text"
            value={filterSearch}
            onChange={(e) => dispatch(setFilterSearch(e.target.value))}
            placeholder="搜索日志关键字..."
            className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#dce9ff] rounded-lg text-xs text-[#0b1c30] placeholder-[#737686] outline-none focus:border-[#004ac6]"
          />
        </div>
      </div>

      {/* Terminal View Container */}
      <div className="rounded-xl border border-[#213145] bg-[#0b1c30] text-gray-200 overflow-hidden shadow-lg flex flex-col">
        {/* Terminal Header */}
        <div className="px-4 py-2.5 bg-[#071322] border-b border-[#213145] flex items-center justify-between text-xs text-gray-400 select-none">
          <div className="flex items-center gap-2 font-mono">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>playwright-daemon@smartlink-auto: ~/runtime/logs</span>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-emerald-400">● 实时捕获中</span>
            <span>共 {filteredLogs.length} 条记录</span>
          </div>
        </div>

        {/* Log Entries Stream */}
        <div className="p-4 font-mono text-xs overflow-y-auto max-h-[600px] space-y-2.5 select-text">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              暂无匹配的系统运行日志
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 p-2 rounded hover:bg-white/5 transition-colors border-l-2 border-transparent hover:border-[#004ac6]"
              >
                <span className="text-gray-500 shrink-0 select-none">
                  {log.timestamp}
                </span>

                <div className="shrink-0">
                  {getLevelBadge(log.level)}
                </div>

                <div className="flex flex-col flex-1 min-w-0">
                  <div className="text-gray-100 font-medium break-all">
                    {log.message}
                  </div>
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
