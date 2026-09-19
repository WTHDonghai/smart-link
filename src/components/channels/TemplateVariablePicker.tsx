import React, { useState } from 'react';
import { Tag } from 'lucide-react';
import type { ProtocolFieldMapping, ProtocolFieldCategory } from '../../types/template';

interface TemplateVariablePickerProps {
  fields: ProtocolFieldMapping[];
  onInsertTag: (tag: string) => void;
  disabled?: boolean;
}

const CATEGORY_TABS: { key: 'all' | ProtocolFieldCategory; label: string }[] = [
  { key: 'all', label: '全部参数' },
  { key: 'basic', label: '基础信息' },
  { key: 'hotel', label: '酒店房型' },
  { key: 'date', label: '入离时间' },
  { key: 'guest', label: '住客信息' },
  { key: 'finance', label: '财务结算' },
  { key: 'rights', label: '权益服务' },
  { key: 'invoice', label: '发票税票' },
];

export const TemplateVariablePicker: React.FC<TemplateVariablePickerProps> = ({
  fields,
  onInsertTag,
  disabled = false,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | ProtocolFieldCategory>('all');

  const visibleFields = fields.filter((f) => {
    if (!f.enabled) return false;
    if (activeTab === 'all') return true;
    return f.category === activeTab;
  });

  return (
    <div className="space-y-3">
      {/* 变量分类标签导航 */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-[#0b1c30] flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-[#004ac6]" />
          <span>点击插入业务参数变量</span>
        </label>
        <span className="text-[11px] text-[#737686]">
          当前可用 {visibleFields.length} 个字段
        </span>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[#e5edfa] scrollbar-none">
        {CATEGORY_TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              disabled={disabled}
              onClick={() => setActiveTab(tab.key)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? 'bg-[#004ac6] text-white shadow-2xs'
                  : 'text-[#434655] hover:bg-[#eff4ff] hover:text-[#004ac6]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 变量芯片列表 */}
      <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-[#f8faff] border border-[#dce9ff] max-h-36 overflow-y-auto">
        {visibleFields.map((field) => (
          <button
            key={field.key}
            type="button"
            disabled={disabled}
            onClick={() => onInsertTag(`{${field.label}}`)}
            className="group px-2.5 py-1 text-xs font-mono bg-white hover:bg-[#004ac6] hover:text-white text-[#004ac6] border border-[#dce9ff] rounded-md transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-50"
            title={`${field.description || field.label} (路径: ${field.path || field.conditionExpr || '派生'})`}
          >
            <span>{`{${field.label}}`}</span>
            {field.sampleValue && (
              <span className="text-[10px] opacity-60 font-sans group-hover:text-blue-100">
                ({field.sampleValue})
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
