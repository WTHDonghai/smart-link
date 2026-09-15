import React, { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { setSelectedChannelForTemplate, updateRemarkTemplate } from '../../store/slices/channelSlice';
import { showToast } from '../../store/slices/appSlice';
import { X, Tag, Check, Eye } from 'lucide-react';

export const RemarkTemplateModal: React.FC = () => {
  const dispatch = useAppDispatch();
  const selectedChannelId = useAppSelector((state) => state.channel.selectedChannelForTemplate);
  const channels = useAppSelector((state) => state.channel.channels);
  
  const currentChannel = channels.find(c => c.id === selectedChannelId);

  const [templateText, setTemplateText] = useState('');

  useEffect(() => {
    if (currentChannel) {
      setTemplateText(currentChannel.remarkTemplate);
    }
  }, [currentChannel]);

  if (!selectedChannelId || !currentChannel) return null;

  const availableVariables = [
    { tag: '{OTA订单号}', desc: '例如 MT-20260914-9921' },
    { tag: '{入住人}', desc: '例如 林浩辰' },
    { tag: '{联系电话}', desc: '例如 138****9210' },
    { tag: '{房型名称}', desc: '例如 商务大床房' },
    { tag: '{间夜数}', desc: '例如 2' },
    { tag: '{房间数}', desc: '例如 1' },
    { tag: '{底价}', desc: '例如 ¥760' },
    { tag: '{实付金额}', desc: '例如 ¥840' },
    { tag: '{入住离店日期}', desc: '例如 2026-09-15 至 2026-09-17' },
    { tag: '{渠道来源}', desc: '例如 ' + currentChannel.name },
  ];

  const handleInsertTag = (tag: string) => {
    setTemplateText(prev => prev + tag);
  };

  // Generate live preview by replacing tags
  const renderPreview = () => {
    return templateText
      .replace(/\{OTA订单号\}/g, `${currentChannel.code}-20260914-8849`)
      .replace(/\{入住人\}/g, '张小泉')
      .replace(/\{联系电话\}/g, '139****5820')
      .replace(/\{房型名称\}/g, '豪华商务海景大床房')
      .replace(/\{间夜数\}/g, '2间夜')
      .replace(/\{房间数\}/g, '1间')
      .replace(/\{底价\}/g, '780')
      .replace(/\{实付金额\}/g, '860')
      .replace(/\{入住离店日期\}/g, '2026-09-16至2026-09-18')
      .replace(/\{渠道来源\}/g, currentChannel.name);
  };

  const handleSave = () => {
    dispatch(updateRemarkTemplate({ channelId: currentChannel.id, template: templateText }));
    dispatch(showToast({
      title: `已更新「${currentChannel.name}」备注模板`,
      description: '后续来自该渠道的订单将自动按此模板注入文旅大中台接收系统',
      type: 'success'
    }));
    dispatch(setSelectedChannelForTemplate(null));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#dce9ff] w-full max-w-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#eff4ff] flex items-center justify-between bg-[#f8f9ff]">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg ${currentChannel.bgColor} ${currentChannel.textColor} flex items-center justify-center font-bold text-sm shadow-xs`}>
              {currentChannel.short}
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0b1c30]">
                配置订单备注模板 - {currentChannel.name} ({currentChannel.code})
              </h2>
              <p className="text-xs text-[#434655]">
                自定义该 OTA 渠道搬单至文旅大中台时的格式化文本与动态参数
              </p>
            </div>
          </div>
          <button
            onClick={() => dispatch(setSelectedChannelForTemplate(null))}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#737686] hover:bg-[#dce9ff] hover:text-[#0b1c30] transition-colors"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Quick Insert Variable Chips */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[#0b1c30] flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#004ac6]" />
                <span>点击插入动态参数变量</span>
              </label>
              <span className="text-[11px] text-[#737686]">自动识别并注入字段</span>
            </div>
            <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-[#eff4ff]/60 border border-[#dce9ff]">
              {availableVariables.map((v) => (
                <button
                  key={v.tag}
                  type="button"
                  onClick={() => handleInsertTag(v.tag)}
                  className="px-2.5 py-1 text-xs font-mono bg-white hover:bg-[#004ac6] hover:text-white text-[#004ac6] border border-[#dce9ff] rounded-md transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                  title={v.desc}
                >
                  <span>{v.tag}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Template Textarea */}
          <div>
            <label className="text-xs font-semibold text-[#0b1c30] block mb-1.5">
              备注模板文本内容
            </label>
            <textarea
              rows={4}
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              className="w-full p-3 rounded-xl border border-[#dce9ff] focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/20 font-mono text-sm text-[#0b1c30] outline-none resize-y transition-all bg-white"
              placeholder="请输入模板文本，例如：【美团搬单】单号:{OTA订单号}，房型:{房型名称}，入住人:{入住人}..."
            />
          </div>

          {/* Live Preview Box */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5">
            <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-emerald-900">
              <Eye className="w-3.5 h-3.5 text-emerald-700" />
              <span>实时效果预览 (到达文旅大中台接收系统的备注展示)</span>
            </div>
            <div className="p-3 bg-white rounded-lg border border-emerald-100 text-xs text-gray-800 font-mono leading-relaxed break-all shadow-2xs">
              {renderPreview() || '<空模板>'}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#eff4ff] bg-[#f8f9ff] flex items-center justify-between">
          <button
            type="button"
            onClick={() => setTemplateText(`【${currentChannel.name}搬单】OTA单号:{OTA订单号} | 预订人:{入住人} ({联系电话}) | 房型:{房型名称} | 结算价:¥{底价}`)}
            className="text-xs text-[#737686] hover:text-[#004ac6] underline"
          >
            恢复默认模板
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => dispatch(setSelectedChannelForTemplate(null))}
              className="px-4 py-2 text-xs font-semibold text-[#434655] hover:bg-[#eff4ff] rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 text-xs font-semibold text-white bg-[#004ac6] hover:bg-[#2563eb] rounded-lg shadow-sm transition-all flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>保存模板</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
