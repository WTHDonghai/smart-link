import React, { useState, useEffect } from 'react';
import { useAppDispatch } from '../../store';
import {
  updateChannelProtocolSchema,
  resetChannelProtocol,
  saveProtocolSchemaToStorage,
} from '../../store/slices/channelSlice';
import { showToast } from '../../store/slices/appSlice';
import { Modal } from '../common/Modal';
import type { ChannelProtocolSchema } from '../../types/template';
import { DEFAULT_MEITUAN_PROTOCOL_SCHEMA } from '../../services/protocols/meituanProtocol';
import { DEFAULT_DOUYIN_PROTOCOL_SCHEMA } from '../../services/protocols/douyinProtocol';
import { SlidersHorizontal, RotateCcw, Search, Check, X } from 'lucide-react';

interface ProtocolFieldManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  channelName: string;
  schema: ChannelProtocolSchema;
}

export const ProtocolFieldManagerModal: React.FC<ProtocolFieldManagerModalProps> = ({
  isOpen,
  onClose,
  channelId,
  channelName,
  schema,
}) => {
  const dispatch = useAppDispatch();
  const [searchTerm, setSearchTerm] = useState('');
  const [draftSchema, setDraftSchema] = useState<ChannelProtocolSchema>(schema);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editPath, setEditPath] = useState('');
  const [editLabel, setEditLabel] = useState('');

  // 弹窗打开时，根据传入的最新 schema 初始化本地编辑草稿 (draftSchema)
  useEffect(() => {
    if (isOpen) {
      setDraftSchema(JSON.parse(JSON.stringify(schema)));
      setEditingKey(null);
      setSearchTerm('');
      setEditPath('');
      setEditLabel('');
    }
  }, [isOpen, schema]);

  const filteredFields = draftSchema.fields.filter((f) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      f.label.toLowerCase().includes(term) ||
      f.key.toLowerCase().includes(term) ||
      f.path.toLowerCase().includes(term)
    );
  });

  const activeCount = draftSchema.fields.filter((f) => f.enabled).length;

  const handleStartEdit = (key: string, currentPath: string, currentLabel: string) => {
    setEditingKey(key);
    setEditPath(currentPath);
    setEditLabel(currentLabel);
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditPath('');
    setEditLabel('');
  };

  const handleSaveEdit = (key: string) => {
    if (!editLabel.trim()) {
      dispatch(showToast({ title: '字段标签不能为空', type: 'error' }));
      return;
    }
    setDraftSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) =>
        f.key === key
          ? { ...f, label: editLabel.trim(), path: editPath.trim() }
          : f
      ),
    }));
    setEditingKey(null);
  };

  const handleToggle = (fieldKey: string) => {
    setDraftSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) =>
        f.key === fieldKey ? { ...f, enabled: !f.enabled } : f
      ),
    }));
  };

  const handleReset = () => {
    dispatch(resetChannelProtocol({ channelId }));
    const defaultSchema =
      channelId === 'douyin'
        ? DEFAULT_DOUYIN_PROTOCOL_SCHEMA
        : DEFAULT_MEITUAN_PROTOCOL_SCHEMA;
    setDraftSchema(JSON.parse(JSON.stringify(defaultSchema)));
    setEditingKey(null);
    dispatch(
      showToast({
        title: '已恢复默认协议配置',
        description: `「${channelName}」已重置为官方标准清洗映射`,
        type: 'success',
      })
    );
  };

  const handleFinishManagement = () => {
    let currentFields = [...draftSchema.fields];

    // 如果用户正在编辑某行尚未点击行内“保存”，直接点击了“完成管理”，自动校验并应用提交
    if (editingKey) {
      if (!editLabel.trim()) {
        dispatch(showToast({ title: '字段标签不能为空', type: 'error' }));
        return;
      }
      currentFields = currentFields.map((f) =>
        f.key === editingKey
          ? { ...f, label: editLabel.trim(), path: editPath.trim() }
          : f
      );
      setEditingKey(null);
    }

    const updatedTimestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const finalSchema: ChannelProtocolSchema = {
      ...draftSchema,
      channelId,
      fields: currentFields,
      updatedAt: updatedTimestamp,
    };

    // 1. 同步提交至 Redux 全局状态
    dispatch(updateChannelProtocolSchema({ channelId, schema: finalSchema }));

    // 2. 双重确定性保障：直接写入本地 LocalStorage 持久化存储
    saveProtocolSchemaToStorage(channelId, finalSchema);

    // 3. 给出明确成功反馈
    const activeFields = currentFields.filter((f) => f.enabled).length;
    dispatch(
      showToast({
        title: `已完成「${channelName}」协议字段管理`,
        description: `协议字段与取值映射已持久化保存 (${activeFields}/${currentFields.length} 项已启用)`,
        type: 'success',
      })
    );

    // 4. 关闭弹窗
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`协议字段裁剪与映射管理 - ${channelName}`}
      subtitle={`当前已启用 ${activeCount}/${draftSchema.fields.length} 个字段，可按需精简白名单或在线调整取值路径`}
      icon={<SlidersHorizontal className="w-4 h-4 text-[#004ac6]" />}
      maxWidth="3xl"
      footer={
        <div className="w-full flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-[#737686] hover:text-[#004ac6] flex items-center gap-1.5 cursor-pointer underline"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢复默认协议</span>
          </button>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-[#434655] hover:bg-[#eff4ff] rounded-lg transition-colors cursor-pointer font-medium"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleFinishManagement}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#003da6] rounded-lg shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>完成管理</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 顶部搜索与说明 */}
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#737686]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索字段名称、英文键或原始 JSON 路径..."
              className="w-full pl-8.5 pr-3 py-1.5 rounded-lg border border-[#dce9ff] text-xs focus:border-[#004ac6] focus:ring-1 focus:ring-[#004ac6] outline-none"
            />
          </div>
          <div className="text-[11px] text-[#737686] shrink-0 bg-[#eff4ff] px-2.5 py-1 rounded-md border border-[#dce9ff]">
            渠道版本: {draftSchema.version}
          </div>
        </div>

        {/* 字段列表表格 */}
        <div className="rounded-xl border border-[#dce9ff] overflow-hidden bg-white shadow-2xs">
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-[#f8faff] text-[#434655] font-semibold border-b border-[#e5edfa] z-10">
                <tr>
                  <th className="py-2.5 px-3 w-16 text-center">启用</th>
                  <th className="py-2.5 px-3 w-28">字段标签</th>
                  <th className="py-2.5 px-3">原始取值路径 / 逻辑</th>
                  <th className="py-2.5 px-3 w-24">转换管道</th>
                  <th className="py-2.5 px-3 w-24 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf3fc]">
                {filteredFields.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-[#737686]">
                      未匹配到符合条件的字段
                    </td>
                  </tr>
                ) : (
                  filteredFields.map((field) => {
                    const isEditing = editingKey === field.key;
                    return (
                      <tr
                        key={field.key}
                        className={`hover:bg-[#f8faff] transition-colors ${
                          !field.enabled ? 'opacity-50 bg-gray-50/50' : ''
                        }`}
                      >
                        {/* 启用开关 */}
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={field.enabled}
                            onChange={() => handleToggle(field.key)}
                            className="w-4 h-4 rounded text-[#004ac6] focus:ring-[#004ac6] cursor-pointer"
                          />
                        </td>

                        {/* 字段中文标签 */}
                        <td className="py-2.5 px-3 font-medium text-[#0b1c30]">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit(field.key);
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              className="w-full px-2 py-1 rounded border border-[#004ac6] text-xs outline-none"
                              placeholder="字段名"
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <span>{field.label}</span>
                              {field.required && (
                                <span
                                  className="text-[10px] text-rose-500 font-bold"
                                  title="核心必需字段"
                                >
                                  *
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 取值路径 */}
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#434655]">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editPath}
                              onChange={(e) => setEditPath(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit(field.key);
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              className="w-full px-2 py-1 rounded border border-[#004ac6] font-mono text-xs outline-none"
                              placeholder="如 data.orderId 或空"
                            />
                          ) : (
                            <div className="truncate max-w-xs" title={field.path || field.conditionExpr}>
                              {field.conditionExpr ? (
                                <span className="text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                                  条件: {field.conditionExpr}
                                </span>
                              ) : (
                                field.path || '-'
                              )}
                            </div>
                          )}
                        </td>

                        {/* 转换管道 */}
                        <td className="py-2.5 px-3 text-[#737686]">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-[#434655]">
                            {field.transform}
                          </span>
                        </td>

                        {/* 操作 */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(field.key)}
                                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-0.5 cursor-pointer"
                                title="保存修改 (Enter)"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>保存</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="text-xs text-[#737686] hover:text-[#0b1c30] font-medium inline-flex items-center gap-0.5 cursor-pointer"
                                title="取消 (Esc)"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>取消</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartEdit(field.key, field.path, field.label)}
                              className="text-xs text-[#004ac6] hover:underline cursor-pointer"
                            >
                              修改路径
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
};
