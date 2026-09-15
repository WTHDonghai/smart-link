import React from 'react';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionText,
  onAction,
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center text-center p-8 min-h-[220px] ${className}`}>
      <div className="w-12 h-12 rounded-xl bg-[#eff4ff] text-[#004ac6] border border-[#dce9ff] flex items-center justify-center mb-3 shadow-2xs">
        {icon || <Inbox className="w-6 h-6 text-[#004ac6]" />}
      </div>
      <h3 className="text-sm font-bold text-[#0b1c30]">{title}</h3>
      {description && (
        <p className="text-xs text-[#737686] max-w-sm mt-1 mb-4 leading-relaxed">
          {description}
        </p>
      )}
      {actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-[#004ac6] bg-[#edf4ff] hover:bg-[#dce9ff] rounded-lg transition-colors cursor-pointer"
        >
          {actionText}
        </button>
      )}
    </div>
  );
};
