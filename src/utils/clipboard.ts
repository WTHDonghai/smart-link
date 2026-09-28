/**
 * 跨运行宿主剪贴板工具函数 (Clipboard Utility)
 * 采用双通道可靠性策略：
 * 1. Electron 桌面原生桥接 (window.host.clipboard) - 系统底层 Pasteboard，无视窗口失焦与权限
 * 2. 现代浏览器异步剪贴板 API (navigator.clipboard)
 */

/**
 * 写入文本至系统剪贴板
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // 1. 优先使用 Electron 桌面原生通道 (最稳健，零权限阻碍，无视窗口失焦)
  if (typeof window !== 'undefined' && window.host?.clipboard?.writeText) {
    try {
      const success = await window.host.clipboard.writeText(text);
      if (success) {
        return true;
      }
    } catch {
      // 宿主异常时穿透至下一级 Web 标准 API
    }
  }

  // 2. 现代浏览器异步剪贴板 API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * 从系统剪贴板读取文本内容
 */
export async function readFromClipboard(): Promise<string> {
  // 1. 优先使用 Electron 桌面原生通道 (直接读取底层 Pasteboard)
  if (typeof window !== 'undefined' && window.host?.clipboard?.readText) {
    try {
      return await window.host.clipboard.readText();
    } catch {
      // 宿主异常时穿透至 Web 标准通道
    }
  }

  // 2. 现代浏览器异步剪贴板 API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }

  return '';
}
