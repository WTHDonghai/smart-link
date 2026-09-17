import { requestPlatformApi, TOOLKIT_MODULE } from './platformApi';
import { extractDataItems } from './channelApi';
import type {
  HotelMapping,
  SaveHotelMappingPayloadItem,
  PlatformProperty,
} from '../types';

export const HOTEL_ENDPOINTS = {
  HOTEL_MAPPINGS: `/${TOOLKIT_MODULE}/hotel-mappings`,
  HOTEL_MAPPINGS_BATCH: `/${TOOLKIT_MODULE}/hotel-mappings/batch`,
} as const;

export interface FetchHotelMappingsOptions {
  otaChannelCode?: string;
}

/**
 * 纯函数：将远程返回的原始酒店/门店映射对象归一化为标准的 HotelMapping 实体
 * 严格遵照业务术语：酒店 = 门店
 */
export function normalizeRemoteHotelMapping(
  rawItem: Record<string, unknown>,
  defaultChannelCode?: string
): HotelMapping {
  const rawChannelCode = String(
    rawItem.otaChannelCode ||
      rawItem.channelCode ||
      rawItem.otaChannel ||
      rawItem.channel ||
      rawItem.platformCode ||
      rawItem.otaCode ||
      defaultChannelCode ||
      ''
  ).trim().toUpperCase();

  // 规范化渠道代码与统一渠道 ID（支持 MEITUAN、MEITUAN_BIZ、DOUYIN 等主流渠道识别）
  let otaChannelCode = rawChannelCode;
  let otaChannelId = rawChannelCode.toLowerCase();

  const stripped = rawChannelCode.replace(/[-_]/g, '');
  if (stripped === 'MEITUANBIZ' || stripped === 'MEITUANBUSINESS' || stripped === 'MTBIZ') {
    otaChannelCode = 'MEITUAN_BIZ';
    otaChannelId = 'meituanbiz';
  } else if (stripped === 'MEITUAN' || stripped === 'MEITUANHOTEL' || stripped === 'MT') {
    otaChannelCode = 'MEITUAN';
    otaChannelId = 'meituan';
  } else if (stripped === 'DOUYIN' || stripped === 'DOUYINLIFE' || stripped === 'DY') {
    otaChannelCode = 'DOUYIN';
    otaChannelId = 'douyin';
  } else if (stripped === 'CTRIP' || stripped === 'XIECHENG') {
    otaChannelCode = 'CTRIP';
    otaChannelId = 'ctrip';
  } else if (stripped === 'FLIGGY' || stripped === 'FEIZHU') {
    otaChannelCode = 'FLIGGY';
    otaChannelId = 'fliggy';
  } else if (stripped === 'TONGCHENG') {
    otaChannelCode = 'TONGCHENG';
    otaChannelId = 'tongcheng';
  } else if (stripped === 'QUNAR') {
    otaChannelCode = 'QUNAR';
    otaChannelId = 'qunar';
  }

  const otaHotelId = String(
    rawItem.extUnitCode ||
      rawItem.otaHotelCode ||
      rawItem.poiId ||
      rawItem.hotelId ||
      rawItem.hotelID ||
      rawItem.id ||
      ''
  ).trim();

  const otaHotelName = String(
    rawItem.otaHotelName ||
      rawItem.name ||
      rawItem.hotelName ||
      rawItem.poiName ||
      rawItem.shopName ||
      otaHotelId
  ).trim();

  const mappingId = rawItem.mappingId || rawItem.otaHotelMappingId || rawItem.id;
  const unitId = rawItem.unitId != null ? String(rawItem.unitId).trim() : '';
  const unitCode = rawItem.unitCode != null ? String(rawItem.unitCode).trim() : '';
  const pmsHotelId = unitId || unitCode;

  const pmsHotelName = String(
    rawItem.unitName ||
      rawItem.propertyName ||
      rawItem.pmsHotelName ||
      rawItem.pmsUnitName ||
      ''
  ).trim();

  const isMapped = !!pmsHotelId && pmsHotelId !== '0';

  return {
    id: mappingId ? String(mappingId) : `hm-remote-${otaChannelCode}-${otaHotelId}`,
    mappingId: mappingId ? String(mappingId) : undefined,
    otaChannelId,
    otaChannelCode,
    otaHotelId,
    extUnitCode: otaHotelId,
    otaHotelName,
    pmsHotelId,
    pmsHotelName: pmsHotelName || (isMapped ? pmsHotelId : ''),
    unitCode: unitCode || undefined,
    unitType: String(rawItem.unitType || 'Property'),
    city: String(rawItem.city || '').trim(),
    starRating: String(rawItem.starRating || '').trim(),
    status: isMapped ? 'mapped' : 'pending',
    partnerId: rawItem.partnerId != null ? String(rawItem.partnerId).trim() : undefined,
    source: 'remote-platform',
  };
}

/**
 * 查询文旅平台 OTA 酒店/门店映射列表 (GET /toolkit/hotel-mappings)
 * 对应 Apifox 接口ID: 475704117
 */
export async function fetchRemoteHotelMappings(
  options: FetchHotelMappingsOptions = {}
): Promise<HotelMapping[]> {
  const queryParams = new URLSearchParams();
  if (options.otaChannelCode) {
    queryParams.set('otaChannelCode', options.otaChannelCode.toUpperCase());
  }

  const queryString = queryParams.toString();
  const requestPath = queryString
    ? `${HOTEL_ENDPOINTS.HOTEL_MAPPINGS}?${queryString}`
    : HOTEL_ENDPOINTS.HOTEL_MAPPINGS;

  const responseBody = await requestPlatformApi<unknown>(requestPath, {
    method: 'GET',
  });

  const rawItems = extractDataItems(responseBody);
  return rawItems
    .map((item) => normalizeRemoteHotelMapping(item, options.otaChannelCode))
    .filter((item) => item.otaHotelId && item.otaHotelName);
}

/**
 * 批量导入 / 保存 OTA 酒店/门店映射信息 (POST /toolkit/hotel-mappings/batch)
 * 对应 Apifox 接口ID: 475704116
 */
export async function saveHotelMappingsBatch(
  items: SaveHotelMappingPayloadItem[]
): Promise<{ success: boolean; count: number }> {
  if (!items || items.length === 0) {
    throw new Error('没有可保存的门店/酒店映射数据');
  }

  const payload = items.map((item) => {
    const otaChannelCode = String(item.otaChannelCode || '').trim().toUpperCase();
    const extUnitCode = String(item.extUnitCode || '').trim();
    const otaHotelName = String(item.otaHotelName || '').trim();

    if (!otaChannelCode) {
      throw new Error('门店映射必须包含渠道代码 otaChannelCode');
    }
    if (!extUnitCode) {
      throw new Error(`门店「${otaHotelName || '未知'}」缺少 OTA 门店编码 extUnitCode`);
    }
    if (!otaHotelName) {
      throw new Error(`门店编码「${extUnitCode}」缺少 OTA 门店名称 otaHotelName`);
    }

    const payloadItem: Record<string, unknown> = {
      otaChannelCode,
      extUnitCode,
      otaHotelName,
      unitType: item.unitType || 'Property',
    };

    if (item.unitId !== undefined && item.unitId !== null && String(item.unitId).trim() !== '') {
      payloadItem.unitId = item.unitId;
    }

    return payloadItem;
  });

  await requestPlatformApi<unknown>(HOTEL_ENDPOINTS.HOTEL_MAPPINGS_BATCH, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    success: true,
    count: payload.length,
  };
}

/**
 * 删除 OTA 酒店/门店映射记录 (DELETE /toolkit/hotel-mappings)
 * 对应 Apifox 接口ID: 475704118
 */
export async function deleteRemoteHotelMappings(
  mappingIds: (string | number)[]
): Promise<{ success: boolean; deletedCount: number }> {
  const ids = mappingIds
    .map((id) => String(id).trim())
    .filter((id) => id.length > 0);

  if (ids.length === 0) {
    throw new Error('缺少要删除的酒店/门店映射记录 ID');
  }

  await requestPlatformApi<unknown>(HOTEL_ENDPOINTS.HOTEL_MAPPINGS, {
    method: 'DELETE',
    body: JSON.stringify(ids),
  });

  return {
    success: true,
    deletedCount: ids.length,
  };
}

export const STRUCTURE_ENDPOINTS = {
  PROPERTIES: '/configuration/structure-management/properties',
  UNITS_ME: '/configuration/unit-structure/units/me/list',
} as const;

/**
 * 查询文旅中台组织单位/酒店列表 (GET /configuration/structure-management/properties)
 * 供用户在门店映射下拉框中关联真实中台酒店
 */
export async function fetchPlatformProperties(): Promise<PlatformProperty[]> {
  try {
    const responseBody = await requestPlatformApi<unknown>(
      `${STRUCTURE_ENDPOINTS.PROPERTIES}?showAll=true`,
      { method: 'GET' }
    );
    const rawItems = extractDataItems(responseBody);
    return rawItems
      .map((item) => {
        const id = String(item.id || item.unitId || item.propertyId || '').trim();
        const name = String(item.name || item.unitName || item.propertyName || item.code || id).trim();
        const code = String(item.code || item.unitCode || '').trim();
        return {
          id,
          name,
          code: code || undefined,
          type: String(item.type || item.unitType || 'Property'),
        };
      })
      .filter((p) => p.id && p.name);
  } catch (error) {
    try {
      const fallbackBody = await requestPlatformApi<unknown>(
        `${STRUCTURE_ENDPOINTS.UNITS_ME}?showAll=true`,
        { method: 'GET' }
      );
      const rawItems = extractDataItems(fallbackBody);
      return rawItems
        .map((item) => {
          const id = String(item.id || item.unitId || item.propertyId || '').trim();
          const name = String(item.name || item.unitName || item.propertyName || item.code || id).trim();
          const code = String(item.code || item.unitCode || '').trim();
          return {
            id,
            name,
            code: code || undefined,
            type: String(item.type || item.unitType || 'Property'),
          };
        })
        .filter((p) => p.id && p.name);
    } catch {
      throw error;
    }
  }
}

