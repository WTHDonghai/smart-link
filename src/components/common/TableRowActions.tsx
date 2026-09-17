import React, { useState, useCallback } from 'react';
import { Save, Trash2, Loader2 } from 'lucide-react';

export interface TableRowActionsProps {
  /** 保存操作回调 */
  onSave?: () => void | Promise<void>;
  /** 是否正在保存 */
  isSaving?: boolean;
  /** 是否有未保存的变更 */
  isUnsaved?: boolean;
  /** 是否禁用保存按钮 */
  saveDisabled?: boolean;
  /** 默认态保存文案，默认 '保存' */
  saveLabel?: string;
  /** 保存中文案，默认 '保存中' */
  savingLabel?: string;
  /** 待保存文案，默认 '待保存' */
  unsavedLabel?: string;
  /** 保存按钮提示文案 */
  saveTitle?: string;
  /** 保存按钮无障碍标签 */
  saveAriaLabel?: string;

  /** 删除操作回调 */
  onDelete?: () => void | Promise<void>;
  /** 是否允许删除（若 false 则不渲染删除相关按钮），默认 true */
  canDelete?: boolean;
  /** 是否正在执行删除中 */
  isDeleting?: boolean;
  /** 删除按钮文案，默认 '删除' */
  deleteLabel?: string;
  /** 删除按钮提示文案 */
  deleteTitle?: string;
  /** 删除按钮无障碍标签 */
  deleteAriaLabel?: string;
  /** 确认删除文案，默认 '确认' */
  confirmText?: string;
  /** 取消删除文案，默认 '取消' */
  cancelText?: string;

  /** 按钮尺寸，'sm' (h-7.5) 或 'md' (h-8)，默认 'sm' */
  size?: 'sm' | 'md';
  /** 额外的容器 class */
  className?: string;
  /** 允许在主要按钮左侧注入自定义操作 */
  children?: React.ReactNode;
}

/**
 * 通用表格行操作控件 (TableRowActions)
 * 统一管理各业务列表行操作列的呈现逻辑：
 * 1. 保存状态机：普通保存 / 待保存高亮 / 保存中 Loading
 * 2. 删除状态机：行内二次确认 (Inline Confirm) 原位切换与防误触
 */
export const TableRowActions: React.FC<TableRowActionsProps> = ({
  onSave,
  isSaving = false,
  isUnsaved = false,
  saveDisabled = false,
  saveLabel = '保存',
  savingLabel = '保存中',
  unsavedLabel = '待保存',
  saveTitle,
  saveAriaLabel,

  onDelete,
  canDelete = true,
  isDeleting = false,
  deleteLabel = '删除',
  deleteTitle = '删除映射',
  deleteAriaLabel,
  confirmText = '确认',
  cancelText = '取消',

  size = 'sm',
  className = '',
  children,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirmDelete = useCallback(async () => {
    if (!onDelete) return;
    try {
      await onDelete();
    } finally {
      setIsConfirming(false);
    }
  }, [onDelete]);

  const handleCancelDelete = useCallback(() => {
    setIsConfirming(false);
  }, []);

  const handleTriggerDelete = useCallback(() => {
    setIsConfirming(true);
  }, []);

  const heightClass = size === 'md' ? 'h-8' : 'h-7.5';

  const computedSaveTitle =
    saveTitle ??
    (isUnsaved
      ? '存在未保存的变更，点击保存'
      : isSaving
      ? '正在保存...'
      : '保存当前配置');

  return (
    <div className={`inline-flex items-center justify-end gap-1.5 shrink-0 ${className}`}>
      {/* 允许外部注入的自定义扩展按钮 */}
      {children}

      {/* 删除二次确认态：原地切换为 [确认] [取消] */}
      {isConfirming ? (
        <div className="inline-flex items-center gap-1 shrink-0 animate-in fade-in duration-100">
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className={`inline-flex items-center justify-center ${heightClass} px-2.5 text-xs font-medium text-white bg-[#ba1a1a] hover:bg-[#93000a] rounded-md transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed`}
            aria-label={confirmText}
            title={confirmText}
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <span>{confirmText}</span>
            )}
          </button>
          <button
            type="button"
            onClick={handleCancelDelete}
            disabled={isDeleting}
            className={`inline-flex items-center justify-center ${heightClass} px-2.5 text-xs font-medium text-[#434655] hover:bg-[#eff4ff] border border-[#dce9ff] rounded-md transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none disabled:opacity-50`}
            aria-label={cancelText}
            title={cancelText}
          >
            <span>{cancelText}</span>
          </button>
        </div>
      ) : (
        <>
          {/* 保存按钮 */}
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving || saveDisabled}
              className={`inline-flex items-center justify-center gap-1.5 ${heightClass} px-3 text-xs font-medium text-white rounded-md shadow-2xs transition-all shrink-0 whitespace-nowrap cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${
                isUnsaved
                  ? 'bg-[#004ac6] hover:bg-[#003da6] ring-2 ring-[#004ac6]/40 shadow-sm font-semibold'
                  : 'bg-[#004ac6] hover:bg-[#003da6]'
              }`}
              title={computedSaveTitle}
              aria-label={saveAriaLabel ?? computedSaveTitle}
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <Save className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>
                {isSaving ? savingLabel : isUnsaved ? unsavedLabel : saveLabel}
              </span>
            </button>
          )}

          {/* 删除按钮 */}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={handleTriggerDelete}
              disabled={isSaving || isDeleting}
              className={`inline-flex items-center justify-center gap-1 ${heightClass} px-2.5 text-xs font-medium text-[#ba1a1a] hover:bg-rose-50 border border-[#ffdad6] hover:border-[#ba1a1a]/40 rounded-md transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed`}
              title={deleteTitle}
              aria-label={deleteAriaLabel ?? deleteTitle}
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{deleteLabel}</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};
