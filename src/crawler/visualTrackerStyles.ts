/**
 * 注入至受控浏览器目标页面的视觉追踪器与大模型接管样式
 * 包含：全屏柔和呼吸光晕（无生硬边框）、移动轨迹光流微粒、中下部避让 HUD、虚拟光标及高亮聚焦框
 */
export const VISUAL_TRACKER_CSS = `
  :host {
    all: initial !important;
    position: fixed !important;
    inset: 0 !important;
    width: 0 !important;
    height: 0 !important;
    overflow: visible !important;
    pointer-events: none !important;
    z-index: 999999 !important;
  }
  @keyframes __sl_pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
  @keyframes __sl_ripple {
    0% { width: 6px; height: 6px; opacity: 0.9; transform: translate(-50%, -50%) scale(1); }
    100% { width: 60px; height: 60px; opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
  }
  @keyframes __sl_trail_fade {
    0% { opacity: 0.9; transform: translate(-50%, -50%) scale(1.1); }
    30% { opacity: 0.75; transform: translate(-50%, -50%) scale(0.9); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(0.2); }
  }

  /* 全屏柔和环境光晕 (纯无边框设计，低噪点高质感内发光，移除无限呼吸动画以消除 GPU 持续重绘开销) */
  #__smartlink_takeover_vignette__ {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    pointer-events: none !important;
    z-index: 999997 !important;
    opacity: 0.85 !important;
    box-shadow: inset 0 0 55px 15px rgba(0, 74, 198, 0.22), inset 0 0 120px 30px rgba(0, 74, 198, 0.08) !important;
    transition: box-shadow 0.4s ease, opacity 0.4s ease !important;
    box-sizing: border-box !important;
  }
  #__smartlink_takeover_vignette__.theme-info {
    box-shadow: inset 0 0 55px 15px rgba(0, 74, 198, 0.22), inset 0 0 120px 30px rgba(0, 74, 198, 0.08) !important;
  }
  #__smartlink_takeover_vignette__.theme-action {
    box-shadow: inset 0 0 60px 18px rgba(139, 92, 246, 0.26), inset 0 0 130px 35px rgba(139, 92, 246, 0.1) !important;
  }
  #__smartlink_takeover_vignette__.theme-success {
    box-shadow: inset 0 0 50px 15px rgba(16, 185, 129, 0.24), inset 0 0 120px 30px rgba(16, 185, 129, 0.08) !important;
  }
  #__smartlink_takeover_vignette__.theme-warn {
    box-shadow: inset 0 0 65px 20px rgba(245, 158, 11, 0.3), inset 0 0 140px 40px rgba(245, 158, 11, 0.12) !important;
  }
  #__smartlink_takeover_vignette__.theme-error {
    box-shadow: inset 0 0 70px 22px rgba(239, 68, 68, 0.35), inset 0 0 150px 45px rgba(239, 68, 68, 0.15) !important;
  }

  /* 鼠标移动微型流光轨迹点 (GPU 加速动画，高发光对比度，自动平滑淡出，移除 will-change 防止显存颠簸) */
  .__sl_trail_dot__ {
    position: fixed !important;
    width: 10px !important;
    height: 10px !important;
    border-radius: 50% !important;
    background: rgba(0, 74, 198, 0.85) !important;
    box-shadow: 0 0 10px rgba(0, 74, 198, 0.8), 0 0 3px #ffffff !important;
    pointer-events: none !important;
    z-index: 999998 !important;
    transform: translate(-50%, -50%) scale(0.2) !important;
    opacity: 0 !important;
    animation: __sl_trail_fade 0.42s cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
  }

  /* 虚拟光标 */
  #__smartlink_cursor__ {
    position: fixed !important;
    width: 22px !important;
    height: 22px !important;
    border-radius: 50% !important;
    background: rgba(0, 74, 198, 0.9) !important;
    border: 2.5px solid #ffffff !important;
    box-shadow: 0 0 16px rgba(0, 74, 198, 0.7), 0 3px 8px rgba(0, 0, 0, 0.35) !important;
    pointer-events: none !important;
    z-index: 999999 !important;
    transform: translate(-50%, -50%) !important;
    transition: left 0.22s cubic-bezier(0.16, 1, 0.3, 1), top 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s ease, opacity 0.2s ease !important;
    opacity: 0;
    left: -100px;
    top: -100px;
    will-change: left, top, transform !important;
  }
  #__smartlink_cursor__.clicking {
    transform: translate(-50%, -50%) scale(0.7) !important;
    background: rgba(220, 38, 38, 0.9) !important;
    box-shadow: 0 0 16px rgba(220, 38, 38, 0.8) !important;
  }

  /* 状态指示面板 HUD：居于浏览器中下部（保留 48px 舒适底边距），当鼠标靠近附近时平滑变半透明，保留良好的可见度与文字可读性，同时透视底层网页并完全穿透点击 */
  #__smartlink_hud__ {
    position: fixed !important;
    bottom: 48px !important;
    top: auto !important;
    left: 50% !important;
    transform: translateX(-50%) translateY(0) !important;
    background: rgba(11, 28, 48, 0.94) !important;
    backdrop-filter: blur(14px) !important;
    -webkit-backdrop-filter: blur(14px) !important;
    border: 1px solid rgba(220, 233, 255, 0.28) !important;
    border-radius: 9999px !important;
    padding: 7px 18px !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 74, 198, 0.25) !important;
    color: #ffffff !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8) !important;
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    font-size: 13px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-weight: 500 !important;
    letter-spacing: 0.2px !important;
    z-index: 999999 !important;
    transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                background 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                border-color 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
    max-width: 92vw !important;
    white-space: nowrap !important;
    pointer-events: auto !important;
    cursor: default !important;
  }

  #__smartlink_hud__.__sl_hud_transparent__,
  #__smartlink_hud__.__sl_hud_hidden__,
  #__smartlink_hud__:hover {
    opacity: 0.6 !important;
    background: rgba(11, 28, 48, 0.65) !important;
    backdrop-filter: blur(8px) !important;
    -webkit-backdrop-filter: blur(8px) !important;
    border-color: rgba(147, 197, 253, 0.55) !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2) !important;
    pointer-events: none !important;
    transform: translateX(-50%) translateY(2px) scale(0.99) !important;
  }

  #__smartlink_hud__ span {
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 1px rgba(0, 0, 0, 0.9) !important;
  }

  #__sl_text__ {
    max-width: 480px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    display: inline-block !important;
    vertical-align: middle !important;
    font-weight: 600 !important;
  }

  /* 高亮聚焦边框 */
  #__smartlink_highlight__ {
    position: fixed !important;
    border: 2px solid #004ac6 !important;
    border-radius: 6px !important;
    box-shadow: 0 0 18px rgba(0, 74, 198, 0.6), inset 0 0 10px rgba(0, 74, 198, 0.15) !important;
    background: rgba(0, 74, 198, 0.08) !important;
    pointer-events: none !important;
    z-index: 999998 !important;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
    opacity: 0 !important;
  }
`;
