/**
 * 抖音预售房型与物理房型映射清洗器 (Douyin Sale Product Room Mapper)
 * 职责：严格解析 /life/hotel/query_sale_product 接口响应，构建 skuId ↔ 物理房型绑定快照
 */

export const DOUYIN_SALE_PRODUCT_ENDPOINT_PATH = '/life/hotel/query_sale_product';

export interface DouyinSaleProductRoomBinding {
  skuId: string;
  otaBasicRoomId: string;
  otaBasicRoomName: string;
  saleProductId: string;
  saleProductName: string;
}

function text(value: unknown): string {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function identifier(value: unknown, fieldName: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`抖音预售房型 ${fieldName} 使用了不安全的 numeric ID。`);
    }
  } else if (typeof value !== 'string') {
    throw new Error(`抖音预售房型 ${fieldName} 必须是字符串或安全的 numeric ID。`);
  }
  const normalized = text(value);
  if (!normalized) {
    throw new Error(`抖音预售房型缺少必须的 ${fieldName}。`);
  }
  return normalized;
}

function isSameBinding(left: DouyinSaleProductRoomBinding, right: DouyinSaleProductRoomBinding): boolean {
  return (
    left.skuId === right.skuId &&
    left.otaBasicRoomId === right.otaBasicRoomId &&
    left.otaBasicRoomName === right.otaBasicRoomName &&
    left.saleProductId === right.saleProductId &&
    left.saleProductName === right.saleProductName
  );
}

/**
 * 判断 URL 是否为预售房型接口端点
 */
export function isDouyinSaleProductResponseUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  let pathname = text(rawUrl);
  try {
    pathname = new URL(pathname).pathname;
  } catch {
    pathname = pathname.split('?')[0] || pathname;
  }
  return pathname.replace(/\/+$/, '') === DOUYIN_SALE_PRODUCT_ENDPOINT_PATH;
}

/**
 * 严格解析抖音预售房型接口网络响应 (GET /life/hotel/query_sale_product)
 */
export function parseDouyinSaleProductResponse(value: unknown): DouyinSaleProductRoomBinding[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('抖音预售房型接口返回非对象数据包。');
  }

  const payload = value as Record<string, unknown>;

  // 1. 业务状态校验
  if (Object.hasOwn(payload, 'status_code')) {
    const statusCode = payload.status_code;
    if (statusCode !== 0 && statusCode !== '0') {
      const msg = text(payload.status_msg) || `status_code=${String(statusCode)}`;
      throw new Error(`抖音预售房型接口返回业务错误: ${msg}`);
    }
  }

  // 2. 结构校验
  if (!Array.isArray(payload.sale_product_group)) {
    throw new Error('抖音预售房型接口缺少 sale_product_group 分组数组。');
  }

  const bindingsBySkuId = new Map<string, DouyinSaleProductRoomBinding>();

  for (const groupValue of payload.sale_product_group) {
    if (!groupValue || typeof groupValue !== 'object' || Array.isArray(groupValue)) {
      throw new Error('抖音预售房型 sale_product_group 包含非对象项。');
    }
    const group = groupValue as Record<string, unknown>;
    if (!Array.isArray(group.product_list)) {
      throw new Error('抖音预售房型 sale_product_group[].product_list 无效。');
    }

    for (const productValue of group.product_list) {
      if (!productValue || typeof productValue !== 'object' || Array.isArray(productValue)) {
        throw new Error('抖音预售房型 product_list[] 包含非对象项。');
      }
      const product = productValue as Record<string, unknown>;

      const skuId = identifier(product.sku_id, 'sku_id');
      const otaBasicRoomId = identifier(product.physical_room_id, 'physical_room_id');
      const otaBasicRoomName = text(product.physical_room_name);
      const saleProductId = identifier(product.sale_product_id, 'sale_product_id');
      const saleProductName = text(product.sale_product_name);

      if (!otaBasicRoomName || !saleProductName) {
        throw new Error('抖音预售房型缺少 physical_room_name 或 sale_product_name。');
      }

      if (
        Object.hasOwn(product, 'pruduct_id') &&
        identifier(product.pruduct_id, 'pruduct_id') !== saleProductId
      ) {
        throw new Error('抖音预售房型 pruduct_id 与 sale_product_id 不一致。');
      }

      const binding: DouyinSaleProductRoomBinding = {
        skuId,
        otaBasicRoomId,
        otaBasicRoomName,
        saleProductId,
        saleProductName,
      };

      const existing = bindingsBySkuId.get(skuId);
      if (existing && !isSameBinding(existing, binding)) {
        throw new Error(`抖音预售房型 SKU ${skuId} 对应多个不同的物理房型或销售产品。`);
      }

      if (!existing) {
        bindingsBySkuId.set(skuId, binding);
      }
    }
  }

  return Array.from(bindingsBySkuId.values());
}
