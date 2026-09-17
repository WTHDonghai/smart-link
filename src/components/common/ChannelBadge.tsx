import React from 'react';
import type { ChannelMeta } from '../../types';
import {
  resolveChannelMeta,
  type ChannelIdentitySource,
  type ChannelCandidate,
} from '../../utils/channelMeta';

export type ChannelBadgeSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ChannelBadgeProps {
  /** 渠道对象实体（支持 HotelMapping、OTAChannel、CulturalTourismChannel 或任意包含渠道标识的对象） */
  channel?: ChannelIdentitySource | null;
  /** 也可直接传入渠道代码或 ID 字符串 */
  channelCode?: string;
  channelId?: string;
  /** 外部可显式传入 channels 列表（默认空数组） */
  channels?: readonly ChannelCandidate[];
  /** 尺寸规范：xs (w-6 h-6), sm (w-7 h-7), md (w-8 h-8), lg (w-9 h-9) */
  size?: ChannelBadgeSize;
  /** 额外容器类名 */
  className?: string;
  /** 是否展示原生 title 悬浮提示（默认 true） */
  showTooltip?: boolean;
}

const SIZE_STYLES: Record<
  ChannelBadgeSize,
  { sizeClass: string; textClass: string; roundedClass: string }
> = {
  xs: { sizeClass: 'w-6 h-6', textClass: 'text-[11px]', roundedClass: 'rounded-md' },
  sm: { sizeClass: 'w-7 h-7', textClass: 'text-xs', roundedClass: 'rounded-md' },
  md: { sizeClass: 'w-8 h-8', textClass: 'text-sm', roundedClass: 'rounded-lg' },
  lg: { sizeClass: 'w-9 h-9', textClass: 'text-sm', roundedClass: 'rounded-lg' },
};

/**
 * 通用渠道图徽/徽标组件
 * 统一渲染各 OTA 渠道的专属简称（如「美」、「商」、「抖」）与品牌主题配色
 */
export const ChannelBadge: React.FC<ChannelBadgeProps> = ({
  channel,
  channelCode,
  channelId,
  channels = [],
  size = 'sm',
  className = '',
  showTooltip = true,
}) => {
  const source: ChannelIdentitySource = channel || {
    channelCode,
    channelId,
  };

  const meta: ChannelMeta = resolveChannelMeta(source, channels);
  const sizeStyle = SIZE_STYLES[size] || SIZE_STYLES.sm;

  return (
    <div
      className={`${sizeStyle.sizeClass} ${sizeStyle.roundedClass} ${meta.bgColor} ${meta.textColor} flex items-center justify-center font-bold ${sizeStyle.textClass} shrink-0 select-none ${className}`}
      title={showTooltip ? meta.name : undefined}
      aria-label={meta.name}
    >
      {meta.short}
    </div>
  );
};
