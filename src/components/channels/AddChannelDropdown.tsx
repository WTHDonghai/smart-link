import React, { useState, useRef, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { ALL_CHANNELS_CATALOG, addChannelById } from '../../store/slices/channelSlice';
import { showToast } from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import { Plus, ChevronDown, Check, PlusCircle } from 'lucide-react';

export const AddChannelDropdown: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const currentChannels = useAppSelector((state) => state.channel.channels);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectChannel = (channelId: string, channelName: string) => {
    const alreadyAdded = currentChannels.some(c => c.id === channelId);
    if (alreadyAdded) return;

    dispatch(addChannelById(channelId));
    dispatch(showToast({
      title: `成功添加「${channelName}」渠道`,
      description: '请为新渠道选择对应的文旅接收系统并保存',
      type: 'success'
    }));
    dispatch(addLog({
      level: 'INFO',
      channelId,
      message: `[ChannelManager] Added new OTA channel: ${channelName} (${channelId}). Associated default routing and Playwright context.`
    }));
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-8.5 px-3.5 rounded-lg bg-[#004ac6] hover:bg-[#003da6] active:bg-[#002f80] text-white font-semibold text-xs shadow-2xs transition-colors inline-flex items-center gap-1.5 cursor-pointer select-none"
        type="button"
        id="add-channel-btn"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>添加渠道</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-[#dce9ff] py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3.5 py-1.5 text-xs text-[#434655] font-semibold border-b border-[#eff4ff] flex items-center justify-between">
            <span>选择要添加的 OTA 渠道</span>
            <span className="text-[11px] text-[#737686]">共 {ALL_CHANNELS_CATALOG.length} 个渠道</span>
          </div>

          <div className="py-1 max-h-72 overflow-y-auto">
            {ALL_CHANNELS_CATALOG.map((ch) => {
              const isAdded = currentChannels.some(c => c.id === ch.id);
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => !isAdded && handleSelectChannel(ch.id, ch.name)}
                  disabled={isAdded}
                  className={`w-full px-3.5 py-2.5 flex items-center justify-between transition-colors text-left ${
                    isAdded
                      ? 'opacity-60 cursor-not-allowed bg-[#f8f9ff]'
                      : 'hover:bg-[#eff4ff] cursor-pointer group'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${ch.bgColor} ${ch.textColor} flex items-center justify-center font-bold text-sm shadow-2xs shrink-0`}>
                      {ch.short}
                    </div>
                    <div className="flex flex-col leading-tight">
                      <span className={`text-sm font-medium text-[#0b1c30] ${!isAdded ? 'group-hover:text-[#004ac6]' : ''}`}>
                        {ch.name}
                      </span>
                      <span className="text-[11px] text-[#737686] font-mono">
                        {ch.code}
                      </span>
                    </div>
                  </div>

                  <div>
                    {isAdded ? (
                      <span className="text-[11px] text-[#737686] bg-[#dce9ff]/60 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-600" />
                        已添加
                      </span>
                    ) : (
                      <PlusCircle className="w-4 h-4 text-[#004ac6] opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
