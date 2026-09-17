/**
 * 集中式 OTA 渠道 URL 配置管理 (Single Source of Truth)
 * 统一管理各渠道商户中心与门店采集地址，消除业务源码中的硬编码 URL
 */

export const OTA_ENV_KEY_MAP: Record<string, string> = {
  MEITUAN: 'VITE_OTA_MEITUAN_URL',
  MEITUAN_BIZ: 'VITE_OTA_MEITUAN_BIZ_URL',
  DOUYIN: 'VITE_OTA_DOUYIN_URL',
  CTRIP: 'VITE_OTA_CTRIP_URL',
  TONGCHENG: 'VITE_OTA_TONGCHENG_URL',
  FLIGGY: 'VITE_OTA_FLIGGY_URL',
  QUNAR: 'VITE_OTA_QUNAR_URL',
  RED: 'VITE_OTA_RED_URL',
};

export const DEFAULT_FALLBACK_URLS: Record<string, string> = {
  MEITUAN: 'https://me.meituan.com/ebooking/merchant/product/batch-price',
  MEITUAN_BIZ: 'https://me.meituan.com/ebooking/merchant/product/batch-price',
  DOUYIN: 'https://life.douyin.com/p/poi-manage/home',
  CTRIP: 'https://ebooking.ctrip.com/',
  TONGCHENG: 'https://ebooking.ly.com/',
  FLIGGY: 'https://hotel.fliggy.com/',
  QUNAR: 'https://ebooking.qunar.com/',
  RED: 'https://ark.xiaohongshu.com/',
};

interface ImportMetaWithEnv {
  env?: Record<string, string | undefined>;
}

/**
 * 安全获取环境变量（智能抹平 Vite import.meta.env、Node.js process.env 与 Electron window 上下文）
 */
export function getEnvVar(key: string, defaultValue = ''): string {
  // 1. 优先从 import.meta.env 获取 (Vite 前端客户端或 vite-node)
  try {
    if (typeof import.meta !== 'undefined') {
      const meta = import.meta as unknown as ImportMetaWithEnv;
      if (meta && typeof meta === 'object' && meta.env && meta.env[key]) {
        const val = String(meta.env[key]).trim();
        if (val) return val;
      }
    }
  } catch {
    // 忽略特定运行环境对 import.meta 的解析异常
  }

  // 2. 其次从 Node.js process.env 获取 (Node 服务端、Electron 主进程或纯 Node 脚本)
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      const val = String(process.env[key]).trim();
      if (val) return val;
    }
  } catch {
    // 忽略非 Node 环境异常
  }

  // 3. Electron 渲染进程中通过 contextBridge 注入的环境字典
  try {
    if (typeof window !== 'undefined') {
      const win = window as unknown as { electron?: { env?: Record<string, string> } };
      if (win.electron?.env?.[key]) {
        const val = String(win.electron.env[key]).trim();
        if (val) return val;
      }
    }
  } catch {
    // 忽略异常
  }

  return defaultValue;
}

/**
 * 根据渠道编码规范化获取该渠道配置的目标 URL
 * 支持大写或规范化编码 (如 MEITUAN, MEITUAN_BIZ, MEITUANBIZ, DOUYIN 等)
 */
export function getOtaChannelUrl(channelCode: string): string {
  const cleanCode = (channelCode || '').trim().toUpperCase();
  const stripped = cleanCode.replace(/[-_]/g, '');

  let normalizedCode = cleanCode;
  if (stripped === 'MEITUANBIZ' || stripped === 'MEITUANBUSINESS' || stripped === 'MTBIZ') {
    normalizedCode = 'MEITUAN_BIZ';
  } else if (stripped === 'MEITUAN' || stripped === 'MEITUANHOTEL' || stripped === 'MT') {
    normalizedCode = 'MEITUAN';
  } else if (stripped === 'DOUYIN' || stripped === 'DOUYINLIFE' || stripped === 'DY') {
    normalizedCode = 'DOUYIN';
  } else if (stripped === 'CTRIP' || stripped === 'XIECHENG') {
    normalizedCode = 'CTRIP';
  } else if (stripped === 'FLIGGY' || stripped === 'FEIZHU') {
    normalizedCode = 'FLIGGY';
  } else if (stripped === 'TONGCHENG') {
    normalizedCode = 'TONGCHENG';
  } else if (stripped === 'QUNAR') {
    normalizedCode = 'QUNAR';
  }

  const envKey = OTA_ENV_KEY_MAP[normalizedCode];
  const fallback = DEFAULT_FALLBACK_URLS[normalizedCode] || '';

  if (envKey) {
    // 若美团商旅未单独配置，自动复用美团的配置
    if (normalizedCode === 'MEITUAN_BIZ') {
      const bizVal = getEnvVar(envKey);
      if (bizVal) return bizVal;
      const meituanVal = getEnvVar('VITE_OTA_MEITUAN_URL');
      if (meituanVal) return meituanVal;
    }

    const val = getEnvVar(envKey);
    if (val) return val;
  }

  return fallback;
}

/**
 * 快捷获取美团改价/门店采集标准目标 URL
 */
export function getMeituanCatalogUrl(): string {
  return getOtaChannelUrl('MEITUAN');
}
