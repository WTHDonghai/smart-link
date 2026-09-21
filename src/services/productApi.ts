import { requestPlatformApi, TOOLKIT_MODULE } from './platformApi';
import { extractDataItems } from './channelApi';
import type {
  ProductMapping,
  SaveProductMappingPayloadItem,
  RoomTypeOption,
  RatePlanOption,
  ReservationTypeOption,
} from '../types';

export const PRODUCT_ENDPOINTS = {
  CHANNEL_PRODUCT: `/${TOOLKIT_MODULE}/channel-product`,
  CHANNEL_PRODUCT_BATCH: `/${TOOLKIT_MODULE}/channel-product/batch`,
  ROOM_TYPES: '/product-management/room-types',
  RATE_PLANS: '/product-management/rate-plans',
  RESERVATION_TYPES: '/configuration/entities/RES_TYPES',
} as const;

export interface FetchProductMappingsQuery {
  channelCode: string;
  unitId?: string | number;
  unitType?: string;
  extUnitCode?: string;
}

export interface FetchProductOptionsScope {
  unitId: string | number;
  unitType?: string;
}

/**
 * 纯函数：将远程返回的原始产品映射对象归一化为标准的 ProductMapping 实体
 */
export function normalizeRemoteProductMapping(
  rawItem: Record<string, unknown>,
  defaultScope?: Partial<FetchProductMappingsQuery>
): ProductMapping {
  const mappingId = rawItem.id != null && String(rawItem.id).trim() !== ''
    ? String(rawItem.id).trim()
    : rawItem.mappingId != null && String(rawItem.mappingId).trim() !== ''
      ? String(rawItem.mappingId).trim()
      : undefined;

  const channelCode = String(
    rawItem.channelCode ||
      defaultScope?.channelCode ||
      ''
  ).trim();

  const extUnitCode = String(
    rawItem.extUnitCode ||
      defaultScope?.extUnitCode ||
      ''
  ).trim();

  const unitId = String(
    rawItem.unitId != null
      ? rawItem.unitId
      : defaultScope?.unitId != null
        ? defaultScope.unitId
        : ''
  ).trim();

  const unitType = String(
    rawItem.unitType ||
      defaultScope?.unitType ||
      'Property'
  ).trim();

  const otaRoomTypeId = String(
    rawItem.otaRoomTypeId ||
      rawItem.productId ||
      rawItem.roomId ||
      ''
  ).trim();

  const otaRoomTypeName = String(
    rawItem.otaRoomTypeName ||
      rawItem.productName ||
      rawItem.roomName ||
      otaRoomTypeId
  ).trim();

  const otaBasicRoomId = rawItem.otaBasicRoomId != null && String(rawItem.otaBasicRoomId).trim() !== ''
    ? String(rawItem.otaBasicRoomId).trim()
    : undefined;

  const otaBasicRoomName = rawItem.otaBasicRoomName != null && String(rawItem.otaBasicRoomName).trim() !== ''
    ? String(rawItem.otaBasicRoomName).trim()
    : undefined;

  const otaRateCodeId = rawItem.otaRateCodeId != null && String(rawItem.otaRateCodeId).trim() !== ''
    ? String(rawItem.otaRateCodeId).trim()
    : undefined;

  const otaPayType = String(rawItem.otaPayType || 'PP').trim();

  const roomType = String(rawItem.roomType || rawItem.mappedRoomType || '').trim();
  const rateCode = String(rawItem.rateCode || '').trim();
  const payType = String(rawItem.payType || '').trim();

  const statusRaw = String(rawItem.status || '').toUpperCase();
  const isInactive = ['I', 'D', 'INACTIVE', 'DISABLED', 'DELETED'].includes(statusRaw);

  const hasMappings = Boolean(roomType || rateCode || payType);
  const status: ProductMapping['status'] = isInactive ? 'inactive' : hasMappings ? 'completed' : 'pending';

  return {
    id: mappingId,
    mappingId,
    channelCode,
    extUnitCode,
    unitId,
    unitType,
    otaRoomTypeId,
    otaRoomTypeName,
    otaBasicRoomId,
    otaBasicRoomName,
    otaRateCodeId,
    otaPayType,
    // 视图兼容字段
    otaProductName: otaRoomTypeName,
    otaProductCode: otaRoomTypeId,
    otaPhysicalRoomName: otaBasicRoomName,
    otaPhysicalRoomCode: otaBasicRoomId,
    internalRoomType: roomType,
    bookingType: payType,
    roomType,
    rateCode,
    payType,
    status,
    source: 'remote-platform',
    otaProductPresent: rawItem.otaProductPresent === true,
  };
}

/**
 * 查询文旅单位下已有产品映射 (GET /toolkit/channel-product)
 */
export async function fetchProductMappings(
  query: FetchProductMappingsQuery
): Promise<ProductMapping[]> {
  const channelCode = query.channelCode?.trim();
  if (!channelCode) {
    throw new Error('查询产品映射必须提供有效渠道编码 channelCode');
  }

  const queryParams = new URLSearchParams();
  queryParams.set('channelCode', channelCode);

  if (query.unitId != null && String(query.unitId).trim() !== '') {
    queryParams.set('unitId', String(query.unitId).trim());
  }
  if (query.unitType) {
    queryParams.set('unitType', query.unitType.trim());
  }
  if (query.extUnitCode) {
    queryParams.set('extUnitCode', query.extUnitCode.trim());
  }

  const requestPath = `${PRODUCT_ENDPOINTS.CHANNEL_PRODUCT}?${queryParams.toString()}`;
  const responseBody = await requestPlatformApi<unknown>(requestPath, {
    method: 'GET',
  });

  const rawItems = extractDataItems(responseBody);
  return rawItems
    .map((item) => normalizeRemoteProductMapping(item, query))
    .filter((item) => item.otaRoomTypeId);
}

/**
 * 安全解包文旅平台返回的字典选项集合，覆盖各种微服务和聚合接口的包装键名：
 * records, list, items, rows, results, roomTypes, ratePlans, entities, options
 */
export function extractProductOptionItems(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const envelope = body as Record<string, unknown>;
  if (
    envelope.success === false ||
    (envelope.code !== undefined &&
      envelope.code !== null &&
      String(envelope.code) !== '0' &&
      String(envelope.code) !== '0000' &&
      String(envelope.code) !== '200')
  ) {
    const errorMsg =
      (typeof envelope.msg === 'string' && envelope.msg) ||
      (typeof envelope.message === 'string' && envelope.message) ||
      (typeof envelope.error === 'string' && envelope.error) ||
      `业务状态异常 (code: ${envelope.code})`;
    throw new Error(`平台接口返回业务错误: ${errorMsg}`);
  }

  let data: unknown = body;
  if ('data' in envelope && envelope.data !== undefined && envelope.data !== null) {
    data = envelope.data;
  }

  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const candidateKeys = [
      'records',
      'list',
      'items',
      'rows',
      'results',
      'roomTypes',
      'ratePlans',
      'entities',
      'options',
    ];
    for (const key of candidateKeys) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[]).filter(
          (item): item is Record<string, unknown> => !!item && typeof item === 'object'
        );
      }
    }
  }

  return [];
}

/**
 * 校验字典项是否为启用状态
 */
function isActiveProductOption(item: Record<string, unknown>): boolean {
  const status = String(item.status || item.state || item.statusCode || '').toUpperCase();
  if (['I', 'D', 'INACTIVE', 'DISABLED', 'DELETED', 'ARCHIVED', 'INVALID'].includes(status)) {
    return false;
  }
  return !['active', 'enabled', 'available'].some((field) => item[field] === false);
}

/**
 * 提取并归一化内部房型选项列表 (优先 GET /product-management/room-types，兼容聚合 options)
 */
export async function fetchRoomTypes(
  scope: FetchProductOptionsScope
): Promise<RoomTypeOption[]> {
  const unitId = String(scope.unitId || '').trim();
  if (!unitId) {
    throw new Error('加载内部房型字典必须提供酒店 unitId');
  }

  const queryParams = new URLSearchParams();
  queryParams.set('unitId', unitId);
  if (scope.unitType) {
    queryParams.set('unitType', scope.unitType.trim());
  }

  const requestPath = `${PRODUCT_ENDPOINTS.ROOM_TYPES}?${queryParams.toString()}`;
  const seenCodes = new Set<string>();
  const options: RoomTypeOption[] = [];

  const responseBody = await requestPlatformApi<unknown>(requestPath, {
    method: 'GET',
    headers: { 'App-Property-Id': unitId },
  });

  const rawItems = extractProductOptionItems(responseBody);
  for (const item of rawItems) {
    if (!isActiveProductOption(item)) continue;
    const id = item.id != null ? String(item.id).trim() : undefined;
    const code = String(
      item.roomType ||
        item.roomTypeCode ||
        item.roomCode ||
        item.code ||
        item.value ||
        id ||
        ''
    ).trim();

    const name = String(
      item.roomTypeName ||
        item.roomName ||
        item.name ||
        item.label ||
        item.description ||
        code
    ).trim();

    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);

    options.push({
      id,
      code,
      name,
      displayLabel: name && code && name !== code ? `${name}（${code}）` : name || code,
    });
  }

  return options;
}

/**
 * 提取并归一化内部房价码选项列表 (GET /product-management/rate-plans)
 */
export async function fetchRatePlans(
  scope: FetchProductOptionsScope
): Promise<RatePlanOption[]> {
  const unitId = String(scope.unitId || '').trim();
  if (!unitId) {
    throw new Error('加载内部房价码字典必须提供酒店 unitId');
  }

  const queryParams = new URLSearchParams();
  queryParams.set('unitId', unitId);
  if (scope.unitType) {
    queryParams.set('unitType', scope.unitType.trim());
  }

  const requestPath = `${PRODUCT_ENDPOINTS.RATE_PLANS}?${queryParams.toString()}`;
  const seenCodes = new Set<string>();
  const options: RatePlanOption[] = [];

  const responseBody = await requestPlatformApi<unknown>(requestPath, {
    method: 'GET',
    headers: { 'App-Property-Id': unitId },
  });

  const rawItems = extractProductOptionItems(responseBody);
  for (const item of rawItems) {
    if (!isActiveProductOption(item)) continue;
    const id = item.id != null ? String(item.id).trim() : undefined;
    const rateCode = String(
      item.rateCode ||
        item.ratePlanCode ||
        item.code ||
        item.value ||
        id ||
        ''
    ).trim();

    const rateName = String(
      item.rateName ||
        item.ratePlanName ||
        item.name ||
        item.label ||
        item.description ||
        rateCode
    ).trim();

    if (!rateCode || seenCodes.has(rateCode)) continue;
    seenCodes.add(rateCode);

    options.push({
      id,
      rateCode,
      rateName,
      displayLabel: rateName && rateCode && rateName !== rateCode
        ? `${rateName}（${rateCode}）`
        : rateName || rateCode,
    });
  }

  return options;
}

/**
 * 提取并归一化内部预订类型选项列表 (GET /configuration/entities/RES_TYPES)
 */
export async function fetchReservationTypes(
  scope: { unitId: string | number }
): Promise<ReservationTypeOption[]> {
  const unitId = String(scope.unitId || '').trim();
  if (!unitId) {
    throw new Error('加载预订类型字典必须提供酒店 unitId');
  }

  const queryParams = new URLSearchParams();
  queryParams.set('showAll', 'false');
  queryParams.set('unitId', unitId);

  const requestPath = `${PRODUCT_ENDPOINTS.RESERVATION_TYPES}?${queryParams.toString()}`;
  const seenCodes = new Set<string>();
  const options: ReservationTypeOption[] = [];

  const responseBody = await requestPlatformApi<unknown>(requestPath, {
    method: 'GET',
    headers: { 'App-Property-Id': unitId },
  });

  const rawItems = extractProductOptionItems(responseBody);
  for (const item of rawItems) {
    if (!isActiveProductOption(item)) continue;
    const id = item.id != null ? String(item.id).trim() : undefined;
    const code = String(
      item.code ||
        item.value ||
        item.entityCode ||
        item.typeCode ||
        item.resType ||
        item.resTypeCode ||
        id ||
        ''
    ).trim();

    const label = String(
      item.name ||
        item.label ||
        item.entityName ||
        item.typeName ||
        item.resTypeName ||
        item.description ||
        code
    ).trim();

    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);

    options.push({
      id,
      code,
      label,
      displayLabel: label && code && label !== code ? `${label}（${code}）` : label || code,
    });
  }

  return options;
}

/**
 * 批量保存或停用产品映射 (POST /toolkit/channel-product/batch)
 * 允许用户不选择内部房型、房价码或预订类型 (为空提交 "")
 */
export async function saveProductMappingsBatch(
  items: SaveProductMappingPayloadItem[]
): Promise<{ success: boolean; count: number }> {
  if (!items || items.length === 0) {
    throw new Error('没有可保存的产品映射数据');
  }

  const payload = items.map((item) => {
    const channelCode = String(item.channelCode || '').trim();
    const extUnitCode = String(item.extUnitCode || '').trim();
    const unitId = String(item.unitId || '').trim();
    const unitType = String(item.unitType || 'Property').trim();
    const otaRoomTypeId = String(item.otaRoomTypeId || '').trim();
    const otaRoomTypeName = String(item.otaRoomTypeName || '').trim();
    const otaPayType = String(item.otaPayType || 'PP').trim();

    if (!channelCode) throw new Error('产品映射缺少渠道代码 channelCode');
    if (!extUnitCode) throw new Error('产品映射缺少外部门店编码 extUnitCode');
    if (!unitId) throw new Error('产品映射缺少文旅酒店 unitId');
    if (!unitType) throw new Error('产品映射缺少文旅酒店单位类型 unitType');
    if (!otaRoomTypeId) throw new Error('产品映射缺少 OTA 产品编码 otaRoomTypeId');
    if (!otaRoomTypeName) throw new Error('产品映射缺少 OTA 产品名称 otaRoomTypeName');

    const payloadItem: Record<string, unknown> = {
      channelCode,
      extUnitCode,
      unitId,
      unitType,
      otaRoomTypeId,
      otaRoomTypeName,
      otaPayType,
      // 允许为空字符串提交
      roomType: item.roomType != null ? String(item.roomType).trim() : '',
      rateCode: item.rateCode != null ? String(item.rateCode).trim() : '',
      payType: item.payType != null ? String(item.payType).trim() : '',
      otaProductPresent: item.otaProductPresent ?? true,
    };

    if (item.id) payloadItem.id = item.id;
    if (item.otaBasicRoomId) payloadItem.otaBasicRoomId = item.otaBasicRoomId;
    if (item.otaBasicRoomName) payloadItem.otaBasicRoomName = item.otaBasicRoomName;
    if (item.otaRateCodeId) payloadItem.otaRateCodeId = item.otaRateCodeId;
    if (item.status) payloadItem.status = item.status;

    return payloadItem;
  });

  await requestPlatformApi<unknown>(PRODUCT_ENDPOINTS.CHANNEL_PRODUCT_BATCH, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    success: true,
    count: payload.length,
  };
}

/**
 * 单条删除产品映射记录 (DELETE /toolkit/channel-product/:id)
 */
export async function deleteProductMapping(mappingId: string): Promise<{ success: boolean }> {
  const id = String(mappingId || '').trim();
  if (!id) {
    throw new Error('缺少要删除的产品映射记录 ID');
  }

  await requestPlatformApi<unknown>(`${PRODUCT_ENDPOINTS.CHANNEL_PRODUCT}/${id}`, {
    method: 'DELETE',
  });

  return { success: true };
}
