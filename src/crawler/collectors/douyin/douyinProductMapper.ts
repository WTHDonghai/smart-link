/**
 * 抖音商品管理与产品映射清洗器 (Douyin Product Mapper)
 * 职责：解析 /life/tobias/merge/products/list 接口，提取商品主数据并结合预售房型快照进行 1:N 展开
 */

import type { DiscoveredProductCandidate } from '../../types';
import type { DouyinSaleProductRoomBinding } from './douyinSaleProductMapper';

export const DOUYIN_PRODUCT_LIST_ENDPOINT_PATH = '/life/tobias/merge/products/list';
export const DOUYIN_CALENDAR_ROOM_ENDPOINT_PATH = '/life/booking/product/list';

export interface DouyinParsedProduct {
  otaChannelCode: 'DOUYIN';
  extUnitCode: string;
  otaRoomTypeId: string;
  otaRoomTypeName: string;
  boundSkuIds: string[];
}

export interface DouyinProductPageParseResult {
  cursor: string;
  total: number;
  products: DouyinParsedProduct[];
}

function text(value: unknown): string {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function identifier(value: unknown, fieldName: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`抖音产品 ${fieldName} 使用了不安全的 numeric ID。`);
    }
  } else if (typeof value !== 'string') {
    throw new Error(`抖音产品 ${fieldName} 必须是字符串或安全的 numeric ID。`);
  }
  const normalized = text(value);
  if (!normalized) {
    throw new Error(`抖音产品缺少必须的 ${fieldName}。`);
  }
  return normalized;
}

/**
 * 判断 URL 是否为商品管理列表端点
 */
export function isDouyinProductListResponseUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  let pathname = text(rawUrl);
  try {
    pathname = new URL(pathname).pathname;
  } catch {
    pathname = pathname.split('?')[0] || pathname;
  }
  return pathname.replace(/\/+$/, '') === DOUYIN_PRODUCT_LIST_ENDPOINT_PATH;
}

/**
 * 判断 URL 是否为日历房接口（严禁将日历房作为主数据源）
 */
export function isDouyinCalendarRoomResponseUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  let pathname = text(rawUrl);
  try {
    pathname = new URL(pathname).pathname;
  } catch {
    pathname = pathname.split('?')[0] || pathname;
  }
  return pathname.replace(/\/+$/, '') === DOUYIN_CALENDAR_ROOM_ENDPOINT_PATH;
}

/**
 * 解析抖音商品管理列表单页网络响应 (POST /life/tobias/merge/products/list)
 */
export function parseDouyinProductResponse(
  value: unknown,
  extUnitCode: string
): DouyinProductPageParseResult {
  const cleanExtUnitCode = text(extUnitCode);
  if (!cleanExtUnitCode) {
    throw new Error('解析抖音商品列表时缺少 extUnitCode。');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('抖音商品列表接口返回非对象数据包。');
  }

  const payload = value as Record<string, unknown>;

  // 1. 业务状态校验
  const base = (payload.BaseResp || payload.baseResp || payload.base_resp) as
    | Record<string, unknown>
    | undefined;
  const statuses = [payload.status_code, payload.statusCode, base?.StatusCode, base?.statusCode].filter(
    (item) => item != null && item !== ''
  );

  if (statuses.length > 0) {
    const isSuccess = statuses.every((s) => [0, 200, '0', '200'].includes(s as string | number));
    if (!isSuccess) {
      const msg =
        text(payload.status_msg || payload.status_message || base?.StatusMessage) ||
        `status=${statuses.join(',')}`;
      throw new Error(`抖音商品列表接口返回业务错误: ${msg}`);
    }
  }

  // 2. 结构校验
  if (!Array.isArray(payload.product_detail_list)) {
    throw new Error('抖音商品列表接口缺少 product_detail_list 数组。');
  }

  const total = typeof payload.total === 'number' ? payload.total : Number(payload.total || 0);
  const cursor = text(payload.cursor || '0');

  const products: DouyinParsedProduct[] = [];
  const seenProductIds = new Set<string>();

  for (const detailValue of payload.product_detail_list) {
    if (!detailValue || typeof detailValue !== 'object' || Array.isArray(detailValue)) {
      throw new Error('抖音 product_detail_list 包含非对象项。');
    }
    const detail = detailValue as Record<string, unknown>;
    const product = detail.product as Record<string, unknown> | undefined;
    if (!product || typeof product !== 'object') {
      throw new Error('抖音 product_detail 缺少 product 基础信息。');
    }

    const otaRoomTypeId = identifier(
      product.product_id ?? product.productId,
      'product_id'
    );
    const otaRoomTypeName = text(product.product_name ?? product.productName);

    if (!otaRoomTypeName) {
      throw new Error('抖音产品缺少 product_name。');
    }

    if (seenProductIds.has(otaRoomTypeId)) {
      throw new Error(`抖音商品列表单页内出现重复 product_id: ${otaRoomTypeId}`);
    }
    seenProductIds.add(otaRoomTypeId);

    // 提取 boundSkuIds
    if (!Array.isArray(detail.sku_list) || detail.sku_list.length === 0) {
      throw new Error(`抖音产品「${otaRoomTypeName}」(${otaRoomTypeId}) 缺少 sku_list。`);
    }

    const boundSkuIds: string[] = [];
    for (const skuValue of detail.sku_list) {
      if (!skuValue || typeof skuValue !== 'object') continue;
      const sku = skuValue as Record<string, unknown>;
      if (!Array.isArray(sku.bind_sku_list) || sku.bind_sku_list.length === 0) {
        throw new Error(`抖音产品「${otaRoomTypeName}」(${otaRoomTypeId}) 缺少 bind_sku_list。`);
      }
      for (const bindingValue of sku.bind_sku_list) {
        if (!bindingValue || typeof bindingValue !== 'object') continue;
        const binding = bindingValue as Record<string, unknown>;
        if (Array.isArray(binding.sku_ids) && binding.sku_ids.length > 0) {
          for (const sId of binding.sku_ids) {
            boundSkuIds.push(identifier(sId, 'bind_sku_list.sku_ids'));
          }
        }
      }
    }

    const uniqueBoundSkuIds = Array.from(new Set(boundSkuIds));
    if (uniqueBoundSkuIds.length === 0) {
      throw new Error(`抖音产品「${otaRoomTypeName}」(${otaRoomTypeId}) 未能提取到任何已绑定销售 SKU。`);
    }

    products.push({
      otaChannelCode: 'DOUYIN',
      extUnitCode: cleanExtUnitCode,
      otaRoomTypeId,
      otaRoomTypeName,
      boundSkuIds: uniqueBoundSkuIds,
    });
  }

  return {
    cursor,
    total,
    products,
  };
}

/**
 * 将商品列表结合预售房型快照展开为 1:N 产品映射候选并按复合主键去重
 */
export function expandDouyinProductsByPhysicalRoom(
  products: DouyinParsedProduct[],
  snapshotBindings: DouyinSaleProductRoomBinding[],
  extUnitCode: string
): DiscoveredProductCandidate[] {
  const bindingsBySkuId = new Map<string, DouyinSaleProductRoomBinding>();
  for (const binding of snapshotBindings) {
    bindingsBySkuId.set(binding.skuId, binding);
  }

  const candidates: DiscoveredProductCandidate[] = [];
  const seenIdentities = new Set<string>();

  for (const product of products) {
    for (const skuId of product.boundSkuIds) {
      const binding = bindingsBySkuId.get(skuId);
      if (!binding) {
        throw new Error(
          `抖音产品「${product.otaRoomTypeName}」(${product.otaRoomTypeId}) 绑定的销售 SKU「${skuId}」未在当前预售房型快照中出现，请核查预售房型配置。`
        );
      }

      const identityKey = [
        'DOUYIN',
        extUnitCode,
        product.otaRoomTypeId,
        product.otaRoomTypeName,
        binding.otaBasicRoomId,
      ].join('_');

      if (seenIdentities.has(identityKey)) {
        continue;
      }
      seenIdentities.add(identityKey);

      candidates.push({
        otaChannelCode: 'DOUYIN',
        extUnitCode,
        otaRoomTypeId: product.otaRoomTypeId,
        otaRoomTypeName: product.otaRoomTypeName,
        otaBasicRoomId: binding.otaBasicRoomId,
        otaBasicRoomName: binding.otaBasicRoomName,
        otaPayType: 'PP', // 抖音渠道业务合同固定为预付 (PP)
        source: 'douyin-product-network',
      });
    }
  }

  return candidates;
}
