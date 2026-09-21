import React from 'react';
import { ChevronDown, ChevronUp, Check, Copy, Download, Upload } from 'lucide-react';
import { formatJsonPayload } from '../../utils/logDate';
import type { SystemLogEntry } from '../../types';

const METHOD_TONES: Record<string, string> = {
  GET: 'bg-emerald-950/60 text-emerald-300 border-emerald-600/40',
  POST: 'bg-blue-950/60 text-blue-300 border-blue-600/40',
  PUT: 'bg-amber-950/60 text-amber-300 border-amber-600/40',
  DELETE: 'bg-rose-950/60 text-rose-300 border-rose-600/40',
};

const DEFAULT_METHOD_TONE = 'bg-purple-950/60 text-purple-300 border-purple-600/40';

export interface LogApiPayloadSectionProps {
  log: SystemLogEntry;
  expanded: boolean;
  copiedKey: string | null;
  onToggleExpand: () => void;
  onCopy: (key: string, text: string) => void;
}

export const LogApiPayloadSection: React.FC<LogApiPayloadSectionProps> = ({
  log,
  expanded,
  copiedKey,
  onToggleExpand,
  onCopy,
}) => {
  const hasApiInfo =
    !!log.apiUrl || !!log.apiMethod || log.apiParams !== undefined || log.apiResponse !== undefined;
  if (!hasApiInfo) return null;

  const method = (log.apiMethod || 'API').toUpperCase();
  const paramsText = formatJsonPayload(log.apiParams);
  const responseText = formatJsonPayload(log.apiResponse);
  const paramsKey = `${log.id}-params`;
  const responseKey = `${log.id}-response`;

  return (
    <div className="mt-2 flex flex-col gap-1.5 font-mono text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 p-1.5 bg-[#071322] border border-[#213145] rounded-md select-none">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span
            className={`px-1.5 py-0.5 rounded text-[11px] font-bold border ${
              METHOD_TONES[method] ?? DEFAULT_METHOD_TONE
            }`}
          >
            {method}
          </span>
          {log.apiUrl && (
            <span
              className="text-cyan-300 text-[11px] font-semibold bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40 truncate max-w-[400px]"
              title={log.apiUrl}
            >
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
            <span className="text-gray-400 text-[11px]">{log.durationMs}ms</span>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleExpand}
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

      {expanded && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-[11px]">
          <div className="bg-[#050e18] border border-[#1e293b] rounded-md p-2.5 flex flex-col min-w-0 shadow-inner">
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#1e293b] text-gray-400 select-none">
              <span className="font-bold text-amber-300 inline-flex items-center gap-1">
                <Upload className="w-3 h-3" />
                <span>📤 请求入参 (Params / Body)</span>
              </span>
              <button
                type="button"
                onClick={() => onCopy(paramsKey, paramsText)}
                disabled={log.apiParams === undefined}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700"
                title="复制请求参数"
              >
                {copiedKey === paramsKey ? (
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

          <div className="bg-[#050e18] border border-[#1e293b] rounded-md p-2.5 flex flex-col min-w-0 shadow-inner">
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#1e293b] text-gray-400 select-none">
              <span className="font-bold text-cyan-300 inline-flex items-center gap-1">
                <Download className="w-3 h-3" />
                <span>📥 接口返回 (Response Data)</span>
              </span>
              <button
                type="button"
                onClick={() => onCopy(responseKey, responseText)}
                disabled={log.apiResponse === undefined}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700"
                title="复制接口返回"
              >
                {copiedKey === responseKey ? (
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
