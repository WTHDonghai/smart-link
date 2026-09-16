import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  updateChannelTargetSystem, 
  setSelectedChannelForTemplate,
  removeChannel
} from '../../store/slices/channelSlice';
import { showToast } from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import { OTAChannel } from '../../types';
import { AddChannelDropdown } from './AddChannelDropdown';
import { Settings, ChevronDown, Save, Trash2 } from 'lucide-react';

export const ChannelMappingView: React.FC = () => {
  const dispatch = useAppDispatch();
  const channels = useAppSelector((state) => state.channel.channels);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleSelectTargetSystem = (channelId: string, targetSystem: string) => {
    dispatch(updateChannelTargetSystem({ channelId, targetSystem }));
  };

  const handleSave = (channel: OTAChannel) => {
    dispatch(showToast({
      title: `已保存「${channel.name}」渠道配置`,
      description: `接收系统：${channel.targetSystem}，配置已保存生效`,
      type: 'success'
    }));
    dispatch(addLog({
      level: 'INFO',
      channelId: channel.id,
      message: `[ChannelConfig] Saved mapping for ${channel.name} (${channel.code}) -> ${channel.targetSystem}`
    }));
  };

  const handleDelete = (channel: OTAChannel) => {
    dispatch(removeChannel(channel.id));
    setConfirmDeleteId(null);
    dispatch(showToast({
      title: `已删除「${channel.name}」渠道`,
      description: '该渠道映射已从列表中移除',
      type: 'info'
    }));
    dispatch(addLog({
      level: 'WARN',
      channelId: channel.id,
      message: `[ChannelConfig] Removed channel mapping ${channel.name} (${channel.code})`
    }));
  };

  return (
    <div className="flex flex-col gap-5 max-w-[1400px] mx-auto w-full p-6">
      {/* 顶部标题栏与添加按钮：纯粹聚焦操作 */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0]">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-4.5 rounded-full bg-[#004ac6] shrink-0" />
          <h1 className="text-xl font-bold text-[#0b1c30] tracking-tight">
            渠道映射
          </h1>
          <span className="text-xs text-[#737686] ml-2">
            共 <span className="font-mono font-medium text-[#0b1c30]">{channels.length}</span> 个渠道
          </span>
        </div>

        <div>
          <AddChannelDropdown />
        </div>
      </div>

      {/* Main Card Panel: Channel Mapping Table - 清爽直观 */}
      <div className="bg-white rounded-xl shadow-xs border border-[#dce9ff] overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#f8faff] text-[#434655] text-xs font-semibold border-b border-[#e5edfa]">
                <th className="py-3 px-6" scope="col">
                  OTA 渠道
                </th>
                <th className="py-3 px-4" scope="col">
                  文旅渠道（对应接收系统）
                </th>
                <th className="py-3 px-4 whitespace-nowrap w-36" scope="col">
                  订单备注模板
                </th>
                <th className="py-3 px-6 text-right whitespace-nowrap w-44" scope="col">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf3fc] text-[#0b1c30] text-sm" id="channel-table-body">
              {channels.map((ch) => {
                const isPaused = ch.status === 'paused';
                return (
                  <tr
                    key={ch.id}
                    className={`channel-row hover:bg-[#f8faff] transition-colors ${
                      isPaused ? 'opacity-60 bg-gray-50/50' : ''
                    }`}
                    data-channel-id={ch.id}
                  >
                    {/* OTA 渠道 */}
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg ${ch.bgColor} ${ch.textColor} flex items-center justify-center font-bold text-sm shrink-0`}
                        >
                          {ch.short}
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-[#0b1c30]">
                              {ch.name}
                            </span>
                            {isPaused && (
                              <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-medium">
                                已暂停
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-[#737686] font-mono">
                            {ch.code}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* 文旅渠道（对应接收系统） */}
                    <td className="py-3.5 px-4">
                      <div className="relative w-full max-w-xs">
                        <select
                          value={ch.targetSystem}
                          onChange={(e) => handleSelectTargetSystem(ch.id, e.target.value)}
                          className="w-full h-9 pl-3 pr-8 rounded-lg bg-white text-[#0b1c30] text-xs shadow-2xs focus:ring-1 focus:ring-[#004ac6] focus:outline-hidden appearance-none cursor-pointer border border-[#dce9ff] hover:border-[#004ac6]/60 transition-colors font-medium"
                        >
                          {ch.targetSystemOptions.map((opt) => (
                            <option key={opt.val} value={opt.val}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-[#737686]">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </td>

                    {/* 订单备注模板 */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => dispatch(setSelectedChannelForTemplate(ch.id))}
                        className="inline-flex items-center gap-1.5 text-xs text-[#004ac6] hover:text-[#003ea8] font-medium hover:underline cursor-pointer shrink-0 whitespace-nowrap"
                      >
                        <Settings className="w-3.5 h-3.5 shrink-0" />
                        <span>配置模板</span>
                      </button>
                    </td>

                    {/* 操作 */}
                    <td className="py-3.5 px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleSave(ch)}
                          className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium text-white bg-[#004ac6] hover:bg-[#003da6] rounded-md shadow-2xs transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none"
                          title="保存配置"
                        >
                          <Save className="w-3.5 h-3.5 shrink-0" />
                          <span>保存</span>
                        </button>

                        {confirmDeleteId === ch.id ? (
                          <div className="inline-flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDelete(ch)}
                              className="inline-flex items-center justify-center h-8 px-2.5 text-xs font-medium text-white bg-[#ba1a1a] hover:bg-[#93000a] rounded-md transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none"
                            >
                              确认
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="inline-flex items-center justify-center h-8 px-2.5 text-xs font-medium text-[#434655] hover:bg-[#eff4ff] border border-[#dce9ff] rounded-md transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(ch.id)}
                            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium text-[#ba1a1a] hover:bg-rose-50 border border-[#ffdad6] hover:border-[#ba1a1a]/40 rounded-md transition-colors shrink-0 whitespace-nowrap cursor-pointer select-none"
                            title="删除渠道"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            <span>删除</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
