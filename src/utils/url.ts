/**
 * URL 规范化与安全拼接通用工具
 * 适用于文旅平台网关、各 OTA 渠道接口及本地代理服务
 */

/**
 * 格式化 Base URL
 * 去除首尾空白，并移除末尾所有的多余斜杠
 */
export function formatBaseUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  return rawUrl.trim().replace(/\/+$/, '');
}

/**
 * 安全拼接 Base URL 与 API 相对路径
 * 无论 baseUrl 是否包含末尾斜杠、path 是否包含前导斜杠，均能安全拼接
 * 并且能完整保留 baseUrl 中自带的子路径前缀 (如 https://gateway.com/hotel/v1)
 */
export function joinApiUrl(baseUrl: string, path: string): string {
  const cleanBase = formatBaseUrl(baseUrl);
  if (!cleanBase) {
    throw new Error('无法拼接 API 请求地址：Base URL 为空');
  }
  const cleanPath = (path || '').trim().replace(/^\/+/, '');
  return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
}
