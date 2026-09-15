import React, { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { clearToast } from '../../store/slices/appSlice';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export const ToastNotification: React.FC = () => {
  const dispatch = useAppDispatch();
  const toast = useAppSelector((state) => state.app.toast);

  useEffect(() => {
    if (toast?.visible) {
      const timer = setTimeout(() => {
        dispatch(clearToast());
      }, 3200);
      return () => clearTimeout(timer);
    }
  }, [toast, dispatch]);

  if (!toast || !toast.visible) return null;

  const isError = toast.type === 'error';
  const isInfo = toast.type === 'info';

  return (
    <div className="fixed top-12 right-6 z-50 pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="flex items-center gap-3 px-4 py-3 bg-white border border-[#dce9ff] rounded-xl shadow-xl max-w-md">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isError 
            ? 'bg-[#ffdad6] text-[#ba1a1a]' 
            : isInfo 
            ? 'bg-[#dce9ff] text-[#004ac6]' 
            : 'bg-[#e2f9ee] text-[#007d55]'
        }`}>
          {isError ? (
            <AlertCircle className="w-5 h-5" />
          ) : isInfo ? (
            <Info className="w-5 h-5" />
          ) : (
            <CheckCircle2 className="w-5 h-5" />
          )}
        </div>
        <div className="flex flex-col pr-2">
          <span className="font-semibold text-sm text-[#0b1c30] leading-tight">
            {toast.title}
          </span>
          {toast.description && (
            <span className="text-xs text-[#434655] mt-0.5 leading-normal">
              {toast.description}
            </span>
          )}
        </div>
        <button
          onClick={() => dispatch(clearToast())}
          className="text-[#737686] hover:text-[#0b1c30] p-1 rounded-md hover:bg-[#eff4ff] transition-colors ml-auto shrink-0"
          type="button"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
