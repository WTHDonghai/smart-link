/**
 * 注入至受控浏览器目标页面的视觉追踪器与大模型接管样式
 * 包含：全屏呼吸发光接管边框、四角科技准星、顶部居中毛玻璃 HUD、虚拟发光光标、点击水波纹及元素聚焦高亮框
 */
export const VISUAL_TRACKER_CSS = `
  @keyframes __sl_pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
  @keyframes __sl_ripple {
    0% { width: 6px; height: 6px; opacity: 0.9; transform: translate(-50%, -50%) scale(1); }
    100% { width: 60px; height: 60px; opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
  }
  @keyframes __sl_vignette_pulse {
    0%, 100% { opacity: 0.9; }
    50% { opacity: 0.55; }
  }
  #__smartlink_takeover_vignette__ {
    --sl-accent-color: #004ac6;
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    pointer-events: none !important;
    z-index: 2147483645 !important;
    box-shadow: inset 0 0 0 2.5px rgba(0, 74, 198, 0.8), inset 0 0 32px rgba(0, 74, 198, 0.22) !important;
    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1) !important;
    animation: __sl_vignette_pulse 3.5s ease-in-out infinite !important;
    box-sizing: border-box !important;
  }
  #__smartlink_takeover_vignette__.theme-info {
    --sl-accent-color: #004ac6;
    box-shadow: inset 0 0 0 2.5px rgba(0, 74, 198, 0.8), inset 0 0 32px rgba(0, 74, 198, 0.22) !important;
  }
  #__smartlink_takeover_vignette__.theme-action {
    --sl-accent-color: #8b5cf6;
    box-shadow: inset 0 0 0 2.5px rgba(139, 92, 246, 0.85), inset 0 0 32px rgba(139, 92, 246, 0.28) !important;
  }
  #__smartlink_takeover_vignette__.theme-success {
    --sl-accent-color: #10b981;
    box-shadow: inset 0 0 0 2px rgba(16, 185, 129, 0.85), inset 0 0 28px rgba(16, 185, 129, 0.22) !important;
  }
  #__smartlink_takeover_vignette__.theme-warn {
    --sl-accent-color: #f59e0b;
    box-shadow: inset 0 0 0 2.5px rgba(245, 158, 11, 0.9), inset 0 0 36px rgba(245, 158, 11, 0.3) !important;
  }
  #__smartlink_takeover_vignette__.theme-error {
    --sl-accent-color: #ef4444;
    box-shadow: inset 0 0 0 3px rgba(239, 68, 68, 0.95), inset 0 0 40px rgba(239, 68, 68, 0.35) !important;
  }
  .__sl_corner__ {
    position: absolute !important;
    width: 18px !important;
    height: 18px !important;
    pointer-events: none !important;
    transition: border-color 0.35s cubic-bezier(0.16, 1, 0.3, 1) !important;
  }
  .__sl_corner_tl__ {
    top: 6px !important;
    left: 6px !important;
    border-top: 2.5px solid var(--sl-accent-color, #004ac6) !important;
    border-left: 2.5px solid var(--sl-accent-color, #004ac6) !important;
  }
  .__sl_corner_tr__ {
    top: 6px !important;
    right: 6px !important;
    border-top: 2.5px solid var(--sl-accent-color, #004ac6) !important;
    border-right: 2.5px solid var(--sl-accent-color, #004ac6) !important;
  }
  .__sl_corner_bl__ {
    bottom: 6px !important;
    left: 6px !important;
    border-bottom: 2.5px solid var(--sl-accent-color, #004ac6) !important;
    border-left: 2.5px solid var(--sl-accent-color, #004ac6) !important;
  }
  .__sl_corner_br__ {
    bottom: 6px !important;
    right: 6px !important;
    border-bottom: 2.5px solid var(--sl-accent-color, #004ac6) !important;
    border-right: 2.5px solid var(--sl-accent-color, #004ac6) !important;
  }
  #__smartlink_cursor__ {
    position: fixed !important;
    width: 22px !important;
    height: 22px !important;
    border-radius: 50% !important;
    background: rgba(0, 74, 198, 0.88) !important;
    border: 2.5px solid #ffffff !important;
    box-shadow: 0 0 14px rgba(0, 74, 198, 0.65), 0 3px 8px rgba(0, 0, 0, 0.35) !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    transform: translate(-50%, -50%) !important;
    transition: left 0.35s cubic-bezier(0.2, 0.9, 0.3, 1), top 0.35s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.15s ease, opacity 0.2s ease !important;
    opacity: 0;
    left: -100px;
    top: -100px;
  }
  #__smartlink_cursor__.clicking {
    transform: translate(-50%, -50%) scale(0.7) !important;
    background: rgba(220, 38, 38, 0.9) !important;
    box-shadow: 0 0 16px rgba(220, 38, 38, 0.8) !important;
  }
  #__smartlink_hud__ {
    position: fixed !important;
    top: 12px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    background: rgba(11, 28, 48, 0.94) !important;
    backdrop-filter: blur(14px) !important;
    -webkit-backdrop-filter: blur(14px) !important;
    border: 1px solid rgba(220, 233, 255, 0.3) !important;
    border-radius: 9999px !important;
    padding: 7px 18px !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 74, 198, 0.25) !important;
    color: #ffffff !important;
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    font-size: 13px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-weight: 500 !important;
    letter-spacing: 0.2px !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
    max-width: 92vw !important;
    white-space: nowrap !important;
  }
  #__sl_text__ {
    max-width: 480px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    display: inline-block !important;
    vertical-align: middle !important;
  }
  #__smartlink_highlight__ {
    position: fixed !important;
    border: 2px solid #004ac6 !important;
    border-radius: 6px !important;
    box-shadow: 0 0 18px rgba(0, 74, 198, 0.6), inset 0 0 10px rgba(0, 74, 198, 0.15) !important;
    background: rgba(0, 74, 198, 0.08) !important;
    pointer-events: none !important;
    z-index: 2147483646 !important;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
    opacity: 0;
  }
`;
