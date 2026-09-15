import React from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { setPlatform } from '../../store/slices/appSlice';
import { Minus, Square, X } from 'lucide-react';

export const WindowTitleBar: React.FC = () => {
  const dispatch = useAppDispatch();
  const platform = useAppSelector((state) => state.app.platform);

  return (
    <header className="h-9 bg-[#f3f6fb] border-b border-[#e2e8f0] select-none flex items-center justify-between px-3 text-xs text-[#434655] z-50 sticky top-0">
      {/* Left section: OS Window controls + App branding */}
      <div className="flex items-center gap-3">
        {platform === 'macos' ? (
          <div className="flex items-center gap-2 group mr-1">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#d89e24]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1aab29]" />
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-[#0b1c30]">
          <div className="w-4 h-4 rounded bg-[#0052cc] flex items-center justify-center p-0.5 shrink-0">
            <svg viewBox="0 0 260 110" fill="none" className="w-full h-full">
              <path d="M 5 20 L 26 20 L 50 50 L 26 82 L 5 82 L 32 50 Z" fill="#FFFFFF" />
              <path fillRule="evenodd" clipRule="evenodd" d="M 56 12 L 188 12 C 205 12 215 25 205 40 L 184 75 C 176 88 165 92 153 92 L 142 92 C 133 92 127 80 120 71 C 116 66 110 66 106 71 C 99 80 93 92 84 92 L 68 92 C 51 92 42 80 48 64 L 56 12 Z" fill="#FFFFFF" />
              <path d="M 198 20 L 216 20 L 242 53 L 216 86 L 198 86 L 222 53 Z" fill="#FFFFFF" />
            </svg>
          </div>
          <span className="font-semibold text-[#004ac6]">杭州西软</span>
          <span className="text-[11px] text-[#737686]">OTA智能搬单系统</span>
        </div>
      </div>

      {/* Right section: System style toggle & window controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => dispatch(setPlatform(platform === 'macos' ? 'windows' : 'macos'))}
          className="text-[11px] text-[#737686] hover:text-[#0b1c30] px-2 py-0.5 rounded transition-colors"
          title="切换窗口风格"
        >
          {platform === 'macos' ? 'macOS' : 'Windows'}
        </button>

        {platform === 'windows' ? (
          <div className="flex items-center border-l border-[#dce9ff] pl-2 ml-1">
            <button
              type="button"
              className="w-6 h-6 flex items-center justify-center hover:bg-[#e2e8f0] rounded transition-colors text-[#737686]"
              title="最小化"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="w-6 h-6 flex items-center justify-center hover:bg-[#e2e8f0] rounded transition-colors text-[#737686]"
              title="最大化"
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              type="button"
              className="w-6 h-6 flex items-center justify-center hover:bg-[#ba1a1a] hover:text-white rounded transition-colors text-[#737686]"
              title="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
};
