import { SimpleTtlCache } from '../../utils/ttlCache';
import { fetchChannelRemarkTemplate } from '../../services/channelApi';
import { SYSTEM_TIMING } from '../../config/timing';

/** 渠道备注模板内存缓存默认有效期：引用系统全局配置 (默认 10 分钟) */
export const REMARK_TEMPLATE_TTL_MS = SYSTEM_TIMING.TEMPLATE_CACHE_TTL;

/**
 * 渠道备注模板专职管理器 (Remark Template Manager)
 * 职责：
 * 1. 负责各 OTA 渠道备注模板的远程异步拉取；
 * 2. 托管带 Singleflight 并发防击穿能力的内存级 TTL 缓存；
 * 3. 提供对内存缓存的主动更新、精准失效与清空能力。
 */
export class RemarkTemplateManager {
  private cache: SimpleTtlCache<string, string | null>;

  constructor(defaultTtlMs = REMARK_TEMPLATE_TTL_MS) {
    this.cache = new SimpleTtlCache<string, string | null>(defaultTtlMs);
  }

  /**
   * 获取指定渠道的备注模板（带内存级 TTL 缓存与 Singleflight 防击穿）
   * @param channelCode 渠道编码（如 MEITUAN, CTRIP, DOUYIN）
   * @param ttlMs 自定义缓存有效期（毫秒）
   */
  public async getTemplate(
    channelCode: string,
    ttlMs = REMARK_TEMPLATE_TTL_MS
  ): Promise<string | null> {
    const code = (channelCode || '').trim().toUpperCase();
    if (!code) {
      return null;
    }

    return this.cache.getOrFetch(
      code,
      async () => {
        const templateRes = await fetchChannelRemarkTemplate(code);
        return templateRes?.remarkTemplate ?? null;
      },
      ttlMs
    );
  }

  /**
   * 直接以最新模板值写入内存缓存，无需下次再发网络请求
   * @param channelCode 渠道编码
   * @param template 最新模板内容或 null
   */
  public updateCache(channelCode: string, template: string | null): void {
    const code = (channelCode || '').trim().toUpperCase();
    if (!code) return;
    this.cache.set(code, template);
  }

  /**
   * 精准失效指定渠道或清空全部备注模板缓存
   * @param channelCode 可选渠道编码。若未提供则清空所有渠道缓存
   */
  public invalidateCache(channelCode?: string): void {
    const code = channelCode?.trim().toUpperCase();
    if (code) {
      this.cache.invalidate(code);
    } else {
      this.cache.clear();
    }
  }

  /**
   * 清理并重置全部渠道备注模板内存缓存
   */
  public clearCache(): void {
    this.invalidateCache();
  }

  /**
   * 检查指定渠道在内存缓存中是否存在有效缓存
   * @param channelCode 渠道编码
   */
  public hasCache(channelCode: string): boolean {
    const code = (channelCode || '').trim().toUpperCase();
    return Boolean(code && this.cache.has(code));
  }
}

/** 模块默认单例实例 */
export const remarkTemplateManager = new RemarkTemplateManager();

/**
 * 获取渠道备注模板（函数式快捷入口）
 */
export async function getCachedChannelRemarkTemplate(
  channelCode: string,
  ttlMs = REMARK_TEMPLATE_TTL_MS
): Promise<string | null> {
  return remarkTemplateManager.getTemplate(channelCode, ttlMs);
}

/**
 * 直接更新渠道备注模板内存缓存（函数式快捷入口）
 */
export function updateRemarkTemplateCache(channelCode: string, template: string | null): void {
  remarkTemplateManager.updateCache(channelCode, template);
}

/**
 * 精准失效渠道备注模板缓存（函数式快捷入口）
 */
export function invalidateRemarkTemplateCache(channelCode?: string): void {
  remarkTemplateManager.invalidateCache(channelCode);
}

/**
 * 清理/重置全部渠道备注模板内存缓存（函数式快捷入口）
 */
export function clearRemarkTemplateCache(): void {
  remarkTemplateManager.clearCache();
}
