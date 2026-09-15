import React from 'react';
import { CheckCircle2, AlertCircle, Clock, Ban, Bot, AlertTriangle, Info } from 'lucide-react';

export type StatusVariant = 
  | 'success' 
  | 'failed' 
  | 'warning' 
  | 'info' 
  | 'cancelled' 
  | 'pending'
  | 'playwright';

export interface StatusBadgeProps {
  variant: StatusVariant;
  label: React.ReactNode;
  icon?: boolean | React.ReactNode;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  variant,
  label,
  icon = false,
  size = 'xs',
  className = '',
}) => {
  const sizeClasses = {
    xs: 'text-[11px] px-2 py-0.5',
    sm: 'text-xs px-2.5 py-0.5',
    md: 'text-xs px-3 py-1',
  }[size];

  const variantStyles: Record<StatusVariant, { bg: string; text: string; border: string; defaultIcon: React.ReactNode }> = {
    success: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      defaultIcon: <CheckCircle2 className="w-3 h-3" />,
    },
    failed: {
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      border: 'border-rose-200',
      defaultIcon: <AlertCircle className="w-3 h-3" />,
    },
    warning: {
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      border: 'border-amber-200',
      defaultIcon: <AlertTriangle className="w-3 h-3" />,
    },
    info: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-200',
      defaultIcon: <Info className="w-3 h-3" />,
    },
    cancelled: {
      bg: 'bg-gray-100',
      text: 'text-gray-600',
      border: 'border-gray-200',
      defaultIcon: <Ban className="w-3 h-3" />,
    },
    pending: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      border: 'border-amber-200',
      defaultIcon: <Clock className="w-3 h-3" />,
    },
    playwright: {
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      border: 'border-purple-200',
      defaultIcon: <Bot className="w-3 h-3" />,
    },
  };

  const current = variantStyles[variant] || variantStyles.info;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium select-none ${current.bg} ${current.text} ${current.border} ${sizeClasses} ${className}`}
    >
      {icon === true ? current.defaultIcon : icon || null}
      <span>{label}</span>
    </span>
  );
};
