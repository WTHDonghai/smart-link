import type { DiscoveredHotelCandidate } from '../../types';

export const DEFAULT_MEITUAN_CATALOG_URL = 'https://me.meituan.com/ebooking/merchant/product/batch-price';
export const MEITUAN_CATALOG_PATH = '/ebooking/merchant/product/batch-price';

export interface RawMeituanStoreItem {
  poiId: string;
  partnerId: string;
  name: string;
  city?: string;
  starRating?: string;
  source?: string;
  raw?: Record<string, unknown>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...candidates: unknown[]): string {
  for (const item of candidates) {
    if (item !== null && item !== undefined) {
      const text = String(item).trim();
      if (text) return text;
    }
  }
  return '';
}

function extractPartnerId(record: UnknownRecord): string {
  return firstString(
    record.partnerId,
    record.partnerID,
    record.partnerPoiId,
    record.partnerPoiID,
    record.ebHotelId,
    record.ebHotelID,
    record.vendorId,
    record.vendorID
  );
}

function looksLikeMeituanStore(record: UnknownRecord): boolean {
  const poiId = firstString(
    record.poiId,
    record.poiID,
    record.mtPoiId,
    record.mtPoiID,
    record.hotelId,
    record.hotelID
  );
  const name = firstString(
    record.poiName,
    record.hotelName,
    record.name,
    record.shopName,
    record.partnerName,
    record.poi_name,
    record.hotel_name
  );
  return !!poiId && !!name;
}

/**
 * 递归深度提取对象或数组中的所有美团门店候选数据
 */
function scanStoresFromObject(
  value: unknown,
  byKey: Map<string, RawMeituanStoreItem>,
  inheritedPartnerId = '',
  seen = new Set<unknown>()
): void {
  if (!value || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      scanStoresFromObject(item, byKey, inheritedPartnerId, seen);
    }
    return;
  }

  if (!isRecord(value)) return;

  const currentPartnerId = extractPartnerId(value) || inheritedPartnerId;

  if (looksLikeMeituanStore(value)) {
    const poiId = firstString(
      value.poiId,
      value.poiID,
      value.mtPoiId,
      value.mtPoiID,
      value.hotelId,
      value.hotelID
    );
    const name = firstString(
      value.poiName,
      value.hotelName,
      value.name,
      value.shopName,
      value.partnerName,
      value.poi_name,
      value.hotel_name
    );
    const city = firstString(value.cityName, value.city, value.city_name);
    const starRating = firstString(value.starRating, value.hotelStar, value.categoryName);

    const key = currentPartnerId ? `${currentPartnerId}:${poiId}` : `${poiId}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        poiId,
        partnerId: currentPartnerId,
        name,
        city: city || undefined,
        starRating: starRating || undefined,
        source: 'network-response',
        raw: value,
      });
    }
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child) || isRecord(child)) {
      scanStoresFromObject(child, byKey, currentPartnerId, seen);
    }
  }
}

/**
 * 从捕获的网络响应体集合中提取美团门店实体
 */
export function extractMeituanStoresFromResponses(responses: unknown[]): RawMeituanStoreItem[] {
  const byKey = new Map<string, RawMeituanStoreItem>();
  for (const res of responses) {
    scanStoresFromObject(res, byKey);
  }
  return Array.from(byKey.values());
}

/**
 * 将美团原始门店候选格式化并归一化为系统的 DiscoveredHotelCandidate 集合
 */
export function normalizeMeituanHotelCandidates(
  items: RawMeituanStoreItem[],
  channelCode = 'MEITUAN'
): DiscoveredHotelCandidate[] {
  const byKey = new Map<string, DiscoveredHotelCandidate>();
  const code = channelCode.toUpperCase();

  for (const item of items) {
    if (!item.poiId || !item.name) continue;
    const key = item.partnerId ? `${item.partnerId}:${item.poiId}` : item.poiId;
    if (byKey.has(key)) continue;

    byKey.set(key, {
      otaChannelId: code,
      otaChannelCode: code,
      otaHotelId: item.poiId,
      otaHotelName: item.name,
      partnerId: item.partnerId || undefined,
      city: item.city,
      starRating: item.starRating,
      source: item.source || code,
      raw: item.raw,
    });
  }

  return Array.from(byKey.values());
}

export interface MeituanDropdownItemInput {
  fullText?: string;
  nameText?: string;
  poiId?: string;
  partnerId?: string;
}

/**
 * 从美团前端门店下拉项的属性和文本中健壮解析门店实体
 * 优先从属性与类名提取，避免正则对合法含数字店名（如 10086 号店）的误删
 */
export function parseMeituanDropdownItem(input: MeituanDropdownItemInput): RawMeituanStoreItem | null {
  const fullText = (input.fullText || '').trim();
  const rawNameText = (input.nameText || '').trim();

  // 1. 优先从属性获取 poiId，若无则从 fullText 提取数字 ID
  let poiId = (input.poiId || '').trim();
  if (!poiId && fullText) {
    const idMatch = fullText.match(/\b\d{5,}\b/);
    if (idMatch) {
      poiId = idMatch[0];
    }
  }

  if (!poiId) {
    return null;
  }

  // 2. 提取店名：优先使用具体的 nameText，仅剔除特定的 poiId，避免误删店名本身的合法数字
  let name = rawNameText || fullText;
  if (poiId) {
    // 仅精准剔除当前匹配到的 poiId（支持带括号形式或独立单词）
    name = name.replace(new RegExp(`[\\(（]\\s*${poiId}\\s*[\\)）]`, 'g'), '');
    name = name.replace(new RegExp(`\\b${poiId}\\b`, 'g'), '');
  }

  name = name
    .replace(/授权|已经到底了/g, '')
    .replace(/[\(（]\s*[\)）]/g, '')
    .trim();

  if (!name) {
    return null;
  }

  return {
    poiId,
    partnerId: (input.partnerId || '').trim(),
    name,
    source: 'store-dropdown-dom',
  };
}

/**
 * 规范化美团目标 URL，确保定位到正确的门店调价/中心路由
 * 遵循 Fail-Fast 原则：当传入非空但非法的 URL 时，必须显式抛出 Error
 */
export function resolveMeituanTargetUrl(channelUrl?: string): string {
  if (!channelUrl || !channelUrl.trim()) {
    return DEFAULT_MEITUAN_CATALOG_URL;
  }
  try {
    const url = new URL(channelUrl.trim());
    url.pathname = MEITUAN_CATALOG_PATH;
    url.hash = '';
    url.searchParams.delete('iUrl');
    return url.toString();
  } catch (err) {
    throw new Error(`非法的美团目标渠道 URL: ${channelUrl} (${err instanceof Error ? err.message : String(err)})`);
  }
}

