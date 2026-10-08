/**
 * 桌面控制台原生剪贴板工具函数 (Electron-Only Native Clipboard)
 * 严格遵循桌面宿主唯一边界规范，直接读写系统底层 Pasteboard，严禁独立 Web 宿主降级
 */

/**
 * 写入文本至系统剪贴板
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text || typeof text !== 'string') {
    return false;
  }

  if (typeof window === 'undefined' || !window.host?.clipboard?.writeText) {
    throw new Error('[Clipboard] 缺失 Electron 原生剪贴板通道，严禁 Web API 降级');
  }

  return await window.host.clipboard.writeText(text);
}

/**
 * 从系统剪贴板读取文本内容
 */
export async function readFromClipboard(): Promise<string> {
  if (typeof window === 'undefined' || !window.host?.clipboard?.readText) {
    throw new Error('[Clipboard] 缺失 Electron 原生剪贴板通道，严禁 Web API 降级');
  }

  return await window.host.clipboard.readText();
}
