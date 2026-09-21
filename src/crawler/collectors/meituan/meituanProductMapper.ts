import type { DiscoveredProductCandidate } from '../../types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function normalizePayType(value: unknown): string {
  if (value == null || value === '') return 'PP';
  const num = Number(value);
  if (num === 0) return 'PP';
  if (num === 1) return 'PS';
  const text = String(value).trim().toUpperCase();
  if (text === 'PP' || text === 'PS') return text;
  return 'PP';
}

/**
 * 从美团真实房型关联树结构 (realRoomRelations) 解析商品与物理房型
 */
export function extractProductsFromRealRoomRelations(
  responseBody: unknown,
  extUnitCode: string,
  channelCode = 'MEITUAN'
): DiscoveredProductCandidate[] | null {
  const body = isRecord(responseBody) ? responseBody : null;
  if (!body) return null;

  const data = isRecord(body.data) ? (body.data as UnknownRecord) : body;
  const realRoomRelations = Array.isArray(data.realRoomRelations) ? data.realRoomRelations : null;
  if (!realRoomRelations || realRoomRelations.length === 0) return null;

  const results: DiscoveredProductCandidate[] = [];

  for (const realRoom of realRoomRelations) {
    if (!isRecord(realRoom)) continue;
    const realRoomId = firstText(realRoom.realRoomId, realRoom.roomId, realRoom.roomID);
    const realRoomName = firstText(realRoom.realRoomName, realRoom.roomName);
    const logicRelations = Array.isArray(realRoom.logicRoomRelations) ? realRoom.logicRoomRelations : [];

    for (const logicRoom of logicRelations) {
      if (!isRecord(logicRoom)) continue;
      const goodsList = Array.isArray(logicRoom.goodsList) ? logicRoom.goodsList : [];

      for (const goods of goodsList) {
        if (!isRecord(goods)) continue;
        const goodsId = firstText(goods.goodsId, goods.goodsID, goods.productId, goods.id);
        const goodsName = firstText(goods.goodsName, goods.productName, goods.name);
        if (!goodsId) continue;

        const rateCodeId = firstText(goods.rateCodeId, goods.rateCodeID, goods.rpId, goods.rpID, goods.rpCustomName);
        const otaPayType = normalizePayType(goods.paymentType ?? goods.payType);

        results.push({
          otaChannelCode: channelCode,
          extUnitCode,
          otaRoomTypeId: goodsId,
          otaRoomTypeName: goodsName || goodsId,
          otaBasicRoomId: realRoomId || undefined,
          otaBasicRoomName: realRoomName || undefined,
          otaRateCodeId: rateCodeId || undefined,
          otaPayType,
          source: 'meituan-catalog-tree',
          raw: goods,
        });
      }
    }
  }

  return results;
}

/**
 * 遍历并收集响应包中的所有平铺商品对象 (Fallback)
 */
export function extractProductsFromFlatList(
  responseBody: unknown,
  extUnitCode: string,
  channelCode = 'MEITUAN'
): DiscoveredProductCandidate[] {
  if (!responseBody) return [];

  const candidates: DiscoveredProductCandidate[] = [];
  const visited = new Set<unknown>();

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (!isRecord(node)) return;

    // 检查是否具备美团商品特征（严禁将 roomId / roomName 作为商品字段候选，防止混淆物理房型为商品）
    const goodsId = firstText(node.goodsId, node.goodsID, node.productId, node.productID);
    const goodsName = firstText(node.goodsName, node.productName);

    if (goodsId && goodsName) {
      const basicRoomId = firstText(node.realRoomId, node.basicRoomId, node.basicRoomTypeId, node.roomId);
      const basicRoomName = firstText(node.realRoomName, node.basicRoomName, node.basicRoomTypeName, node.roomName);
      const rateCodeId = firstText(node.rateCodeId, node.rpId, node.ratePlanId, node.rpCustomName);
      const otaPayType = normalizePayType(node.paymentType ?? node.payType);

      candidates.push({
        otaChannelCode: channelCode,
        extUnitCode,
        otaRoomTypeId: goodsId,
        otaRoomTypeName: goodsName,
        otaBasicRoomId: basicRoomId || undefined,
        otaBasicRoomName: basicRoomName || undefined,
        otaRateCodeId: rateCodeId || undefined,
        otaPayType,
        source: 'meituan-catalog-flat',
        raw: node,
      });
    }

    for (const child of Object.values(node)) {
      if (Array.isArray(child) || isRecord(child)) {
        walk(child);
      }
    }
  }

  walk(responseBody);
  return candidates;
}

/**
 * 统一解析美团响应，返回去重后的产品候选列表
 */
export function parseMeituanProductCandidates(
  responsePayloads: unknown[],
  extUnitCode: string,
  channelCode = 'MEITUAN'
): DiscoveredProductCandidate[] {
  const allCandidates: DiscoveredProductCandidate[] = [];

  for (const payload of responsePayloads) {
    if (isRecord(payload) && 'code' in payload && payload.code !== null && payload.code !== undefined) {
      const codeStr = String(payload.code).trim();
      if (codeStr !== '10000') {
        const errorMsg =
          firstText(payload.msg, payload.message, payload.error) || `错误代码 ${codeStr}`;
        throw new Error(`美团产品接口返回业务错误: ${errorMsg}`);
      }
    }

    const fromTree = extractProductsFromRealRoomRelations(payload, extUnitCode, channelCode);
    if (fromTree && fromTree.length > 0) {
      allCandidates.push(...fromTree);
      continue;
    }

    const fromFlat = extractProductsFromFlatList(payload, extUnitCode, channelCode);
    if (fromFlat.length > 0) {
      allCandidates.push(...fromFlat);
    }
  }

  // 依据 otaRoomTypeId 与 otaBasicRoomId 唯一去重
  const byKey = new Map<string, DiscoveredProductCandidate>();
  for (const item of allCandidates) {
    const key = `${item.otaRoomTypeId}\u001f${item.otaBasicRoomId || ''}`;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}
