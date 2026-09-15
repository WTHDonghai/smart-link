import React from 'react';

interface XiruanLogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

/**
 * 杭州西软 OTA智能搬单 Logo 图标
 * 严格按照 1024x1024 品牌标识还原：
 * 包含 XD 智能眼镜/视镜、内部青蓝科技 HUD 芯片线路与右向指引箭头
 */
export const XiruanLogoMark: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => {
  return (
    <svg
      viewBox="0 0 260 110"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        {/* 视镜内侧青蓝渐变镜片 */}
        <linearGradient id="lensGrad" x1="60" y1="20" x2="200" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0052cc" />
          <stop offset="55%" stopColor="#0091ff" />
          <stop offset="100%" stopColor="#00d8ff" />
        </linearGradient>

        {/* 内部高亮 HUD 科技回路 */}
        <linearGradient id="hudGlow" x1="70" y1="25" x2="190" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00d8ff" stopOpacity="0.4" />
          <stop offset="70%" stopColor="#38efff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* 视镜镜片内部区域 (Cyan HUD Lens) */}
      <path
        d="M 68 25 
           L 182 25 
           C 192 25 197 32 192 41
           L 173 70 
           C 170 75 164 77 158 77 
           L 142 77 
           C 134 77 129 60 120 48 
           C 114 41 106 41 100 48 
           C 91 60 86 77 78 77 
           L 72 77 
           C 65 77 60 72 63 64 
           L 68 25 Z"
        fill="url(#lensGrad)"
      />

      {/* 镜片内部科技芯片晶体与电路折线 (Circuit HUD Overlay) */}
      <path
        d="M 78 33 
           L 165 33 
           L 180 50 
           L 166 66 
           L 146 66 
           L 136 44 
           L 104 44 
           L 96 55 
           L 82 55 Z"
        fill="#0066ee"
        fillOpacity="0.5"
      />
      
      {/* 科技回路发光细线 */}
      <path
        d="M 82 36 L 142 36 L 150 48 L 174 48"
        stroke="url(#hudGlow)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 96 46 L 110 46 L 118 58"
        stroke="#38efff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeOpacity="0.75"
      />

      {/* === 主白色轮廓 (Outer White Logo Structure) === */}
      {/* 左侧 "X" 交叉延伸部 */}
      <path
        d="M 5 20 
           L 26 20 
           L 50 50 
           L 26 82 
           L 5 82 
           L 32 50 Z"
        fill="#FFFFFF"
      />
      <path
        d="M 28 20 
           L 49 20 
           L 72 50 
           L 54 75 
           L 42 75 
           L 58 53 Z"
        fill="#FFFFFF"
      />

      {/* 中部智能护目镜/视镜框架 (Thick White Visor Frame) */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M 56 12 
           L 188 12 
           C 205 12 215 25 205 40 
           L 184 75 
           C 176 88 165 92 153 92 
           L 142 92 
           C 133 92 127 80 120 71 
           C 116 66 110 66 106 71 
           C 99 80 93 92 84 92 
           L 68 92 
           C 51 92 42 80 48 64 
           L 56 12 Z 
           
           M 70 26 
           L 65 65 
           C 63 71 67 76 74 76 
           L 80 76 
           C 87 76 92 61 101 49 
           C 107 41 117 41 123 49 
           C 132 61 137 76 144 76 
           L 156 76 
           C 161 76 166 73 169 68 
           L 188 38 
           C 192 31 187 26 178 26 
           L 70 26 Z"
        fill="#FFFFFF"
      />

      {/* 右侧箭头指示符 (White Chevron >) */}
      <path
        d="M 198 20 
           L 216 20 
           L 242 53 
           L 216 86 
           L 198 86 
           L 222 53 Z"
        fill="#FFFFFF"
      />
    </svg>
  );
};

/**
 * 侧边栏图标规格组件
 */
export const XiruanLogoBadge: React.FC<{ className?: string }> = ({ className = 'w-9 h-9' }) => {
  return (
    <div
      className={`rounded-lg bg-gradient-to-br from-[#0076f5] via-[#0052cc] to-[#003da5] flex items-center justify-center p-1.5 shadow-sm shrink-0 select-none overflow-hidden ${className}`}
      title="杭州西软 OTA智能搬单"
    >
      <XiruanLogoMark className="w-full h-full object-contain" />
    </div>
  );
};

/**
 * 侧边栏展开时的完整品牌标识
 */
export const XiruanBrandHeader: React.FC = () => {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <XiruanLogoBadge className="w-9 h-9" />
      <div className="flex flex-col min-w-0 justify-center">
        <div className="flex items-center gap-1.5">
          <span className="font-extrabold text-sm text-[#0b1c30] leading-none tracking-tight whitespace-nowrap">
            杭州西软
          </span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#edf4ff] text-[#004ac6] border border-[#d2e3fc] leading-none">
            OTA
          </span>
        </div>
        <span className="text-[11px] font-semibold text-[#525f7f] mt-1 tracking-wider whitespace-nowrap">
          OTA智能搬单系统
        </span>
      </div>
    </div>
  );
};
