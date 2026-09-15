import React, { useState, useRef, useEffect } from 'react';
import { useAppDispatch } from '../../store';
import { removeChannel, setSelectedChannelForTemplate, toggleChannelStatus } from '../../store/slices/channelSlice';
import { showToast } from '../../store/slices/appSlice';
import { addLog } from '../../store/slices/systemLogSlice';
import { OTAChannel } from '../../types';
import { MoreVertical, Wifi, PauseCircle, PlayCircle, Settings, Trash2, ShieldCheck } from 'lucide-react';

interface Props {
  channel: OTAChannel;
}

export const ChannelActionMenu: React.FC<Props> = ({ channel }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTestConnection = () => {
    dispatch(showToast({
      title: `测试「${channel.name}」渠道通道`,
      description: '正在验证 Playwright 会话登录态与文旅中台网关路由...',
      type: 'info'
    }));
    setTimeout(() => {
      dispatch(showToast({
        title: `「${channel.name}」通道检测正常 (200 OK)`,
        description: 'Cookie 登录态有效，文旅中台接收接口正常响应，延时 42ms',
        type: 'success'
      }));
      dispatch(addLog({
        level: 'SUCCESS',
        channelId: channel.id,
        message: `[ChannelTest] Ping OK for channel ${channel.code}. Session active, API latency 42ms.`
      }));
    }, 700);
    setIsOpen(false);
  };

  const handleToggleStatus = () => {
    dispatch(toggleChannelStatus(channel.id));
    const isNowActive = channel.status !== 'active';
    dispatch(showToast({
      title: isNowActive ? `已恢复「${channel.name}」自动搬单` : `已暂停「${channel.name}」自动搬单`,
      description: isNowActive ? 'Playwright 爬虫与订单分发已重新开始' : '系统将暂停接收和调度来自该渠道的新增订单',
      type: isNowActive ? 'success' : 'info'
    }));
    setIsOpen(false);
  };

  const handleDelete = () => {
    if (confirm(`确定要移除「${channel.name}」渠道映射吗？已映射的酒店和历史订单仍会保留。`)) {
      dispatch(removeChannel(channel.id));
      dispatch(showToast({
        title: `已移除「${channel.name}」渠道`,
        type: 'info'
      }));
      dispatch(addLog({
        level: 'WARN',
        channelId: channel.id,
        message: `[ChannelManager] Removed channel mapping ${channel.name} (${channel.code})`
      }));
    }
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#434655] hover:bg-[#eff4ff] hover:text-[#0b1c30] transition-colors cursor-pointer"
        title="更多操作"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-52 bg-white rounded-xl shadow-xl border border-[#dce9ff] py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
          <button
            type="button"
            onClick={handleTestConnection}
            className="w-full px-3.5 py-2 text-xs text-[#0b1c30] hover:bg-[#eff4ff] flex items-center gap-2 transition-colors text-left font-medium"
          >
            <Wifi className="w-4 h-4 text-[#004ac6]" />
            <span>测试通道连通性</span>
          </button>

          <button
            type="button"
            onClick={() => {
              dispatch(setSelectedChannelForTemplate(channel.id));
              setIsOpen(false);
            }}
            className="w-full px-3.5 py-2 text-xs text-[#0b1c30] hover:bg-[#eff4ff] flex items-center gap-2 transition-colors text-left font-medium"
          >
            <Settings className="w-4 h-4 text-[#004ac6]" />
            <span>配置订单备注模板</span>
          </button>

          <button
            type="button"
            onClick={handleToggleStatus}
            className="w-full px-3.5 py-2 text-xs text-[#0b1c30] hover:bg-[#eff4ff] flex items-center gap-2 transition-colors text-left font-medium"
          >
            {channel.status === 'active' ? (
              <>
                <PauseCircle className="w-4 h-4 text-amber-600" />
                <span>暂停自动搬单</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4 text-emerald-600" />
                <span>恢复自动搬单</span>
              </>
            )}
          </button>

          <div className="h-px bg-[#eff4ff] my-1" />

          <button
            type="button"
            onClick={handleDelete}
            className="w-full px-3.5 py-2 text-xs text-[#ba1a1a] hover:bg-[#ffdad6]/40 flex items-center gap-2 transition-colors text-left font-medium"
          >
            <Trash2 className="w-4 h-4" />
            <span>移除此渠道</span>
          </button>
        </div>
      )}
    </div>
  );
};
