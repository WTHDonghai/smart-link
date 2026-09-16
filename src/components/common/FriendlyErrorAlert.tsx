import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { AppError } from '../../types/error';

export interface FriendlyErrorAlertProps {
  error: AppError;
  className?: string;
  onRetry?: () => void;
}

export const FriendlyErrorAlert: React.FC<FriendlyErrorAlertProps> = ({
  error,
  className = '',
  onRetry,
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopyLog = useCallback(async () => {
    const diagnosticInfo = [
      `[错误代码] ${error.code}`,
      `[所属领域] ${error.domain}`,
      `[错误标题] ${error.userTitle}`,
      `[用户说明] ${error.userMessage}`,
      `[排查指引] ${error.suggestion}`,
      `[记录时间] ${error.timestamp}`,
      `[技术详情] ${error.rawMessage}`,
    ].join('\n');

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(diagnosticInfo);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // 忽略复制异常
    }
  }, [error]);

  return (
    <div
      className={`p-4 bg-rose-50 border border-rose-200 rounded-xl flex flex-col gap-2.5 text-left animate-shake ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-rose-900 text-xs">
              {error.userTitle}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100/80 text-rose-700 font-mono font-medium border border-rose-200">
              {error.code}
            </span>
          </div>

          <p className="text-xs text-rose-700 mt-1 leading-relaxed">
            {error.userMessage}
          </p>

          {error.suggestion && (
            <p className="text-[11px] text-rose-600/90 mt-1 leading-relaxed flex items-center gap-1 font-sans">
              <span className="font-medium text-rose-800">指引：</span>
              <span>{error.suggestion}</span>
            </p>
          )}
        </div>
      </div>

      {/* 底部辅助操作区：折叠技术详情与复制排查日志 */}
      <div className="pt-2 border-t border-rose-200/60 flex items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={() => setShowDetails((prev) => !prev)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 hover:text-rose-900 transition-colors cursor-pointer"
        >
          {showDetails ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>收起技术排查详情</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>查看技术排查详情</span>
            </>
          )}
        </button>

        <div className="flex items-center gap-2">
          {error.retryable && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-[11px] font-medium text-rose-700 hover:text-rose-900 underline transition-colors cursor-pointer"
            >
              立即重试
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyLog}
            className="inline-flex items-center gap-1 text-[11px] text-rose-700 hover:text-rose-900 px-2 py-0.5 rounded bg-white border border-rose-200 transition-all cursor-pointer hover:bg-rose-50/50"
            title="复制包含错误代码与技术堆栈的完整诊断信息"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-600" />
                <span className="text-emerald-700">已复制</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>复制日志</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 技术详情展开区：保留原始现场并支持复制 */}
      {showDetails && (
        <div className="mt-1 p-2.5 bg-white/90 border border-rose-200 rounded-lg text-[11px] font-mono text-rose-900/90 leading-relaxed overflow-x-auto select-text break-all animate-fadeIn">
          <div className="text-[10px] text-gray-500 mb-1 font-sans flex items-center justify-between border-b border-rose-100 pb-1">
            <span>原始网络报文与调用上下文 (开发/运维排查专用)</span>
            <span>{error.timestamp.split('T')[1]?.slice(0, 8)}</span>
          </div>
          <p>{error.rawMessage}</p>
        </div>
      )}
    </div>
  );
};
