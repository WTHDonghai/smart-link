import { requestPlatformApi } from './platformApi';
import {
  CulturalTourismChannel,
  OTAChannelMappingRecord,
  SaveChannelMappingPayloadItem,
} from '../types';

export const CHANNEL_ENDPOINTS = {
  RATE_MANAGEMENT_CHANNELS: '/rate-management/channels',
  OTA_CHANNEL_MAPPINGS: '/toolkit/channel-mappings',
  OTA_CHANNEL_MAPPINGS_BATCH: '/toolkit/channel-mappings/batch',
} as const;

/**
 * 安全解包平台返回的数据实体，支持直接数组、{ data: [...] } 或分页 { data: { records: [...] } }
 */
export function extractDataItems(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  // 严格 Fail-Fast 校验业务信封，杜绝将业务错误静默降级为空数组
  const envelope = body as Record<string, unknown>;
  if (
    envelope.success === false ||
    (envelope.code !== undefined &&
      envelope.code !== null &&
      String(envelope.code) !== '0' &&
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
  if ('data' in body && body.data !== undefined && body.data !== null) {
    data = body.data;
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const dataObj = data as Record<string, unknown>;
    if (
      dataObj.success === false ||
      (dataObj.code !== undefined &&
        dataObj.code !== null &&
        String(dataObj.code) !== '0' &&
        String(dataObj.code) !== '200')
    ) {
      const errorMsg =
        (typeof dataObj.msg === 'string' && dataObj.msg) ||
        (typeof dataObj.message === 'string' && dataObj.message) ||
        `业务状态异常 (code: ${dataObj.code})`;
      throw new Error(`平台接口返回业务错误: ${errorMsg}`);
    }
  }

  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const candidateKeys = ['records', 'list', 'items', 'rows', 'results'];
    for (const key of candidateKeys) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as unknown[]).filter(
          (item): item is Record<string, unknown> => !!item && typeof item === 'object'
        );
      }
    }

    // 若不是包装信封且具备渠道领域特征字段，作为单条实体返回
    const hasDomainField =
      'channelCode' in obj ||
      'otaChannelCode' in obj ||
      'channelId' in obj ||
      'mappingId' in obj ||
      'otaChannelMappingId' in obj;
    if (hasDomainField) {
      return [obj];
    }
  }

  return [];
}

/**
 * 规范化文旅渠道（对应接收系统选项）
 */
export function normalizeCulturalTourismChannel(raw: Record<string, unknown>): CulturalTourismChannel | null {
  const channelIdRaw = raw.channelId ?? raw.channelID ?? raw.channel_id ?? raw.id;
  const channelId = channelIdRaw !== undefined && channelIdRaw !== null ? String(channelIdRaw).trim() : '';

  const channelCodeRaw = raw.channelCode ?? raw.channelNo ?? raw.channel ?? raw.code ?? raw.value;
  const channelCode = channelCodeRaw !== undefined && channelCodeRaw !== null ? String(channelCodeRaw).trim() : '';

  if (!channelId || !channelCode) {
    return null;
  }

  const channelNameRaw = raw.channelName ?? raw.name ?? raw.label ?? raw.description ?? channelCode;
  const channelName = String(channelNameRaw).trim();

  const otaChannelCodeRaw = raw.otaChannelCode ?? raw.otaChannel ?? raw.platform;
  const otaChannelCode = otaChannelCodeRaw ? String(otaChannelCodeRaw).trim().toUpperCase() : undefined;

  const statusRaw = raw.status !== undefined && raw.status !== null ? String(raw.status).trim() : 'A';

  return {
    id: channelId,
    channelId,
    channelCode,
    channelName: channelName || channelCode,
    status: statusRaw,
    otaChannelCode,
  };
}

/**
 * 规范化 OTA 渠道映射记录
 */
export function normalizeOTAChannelMappingRecord(
  raw: Record<string, unknown>,
  fallbackOtaChannelCode = ''
): OTAChannelMappingRecord | null {
  const mappingIdRaw = raw.mappingId ?? raw.otaChannelMappingId ?? raw.id;
  const mappingId = mappingIdRaw !== undefined && mappingIdRaw !== null ? String(mappingIdRaw).trim() : '';

  const otaChannelCodeRaw =
    raw.otaChannelCode ?? raw.otaChannel ?? raw.platform ?? fallbackOtaChannelCode;
  const otaChannelCode = otaChannelCodeRaw ? String(otaChannelCodeRaw).trim().toUpperCase() : '';

  const channelCodeRaw =
    raw.channelCode ??
    raw.channelNo ??
    raw.channel ??
    raw.pmsChannelCode ??
    raw.shijiChannelCode ??
    raw.rateChannelCode;
  const channelCode = channelCodeRaw !== undefined && channelCodeRaw !== null ? String(channelCodeRaw).trim() : '';

  const channelIdRaw =
    raw.channelId ?? raw.pmsChannelId ?? raw.rateChannelId ?? raw.channelID ?? raw.channel_id;
  const channelId = channelIdRaw !== undefined && channelIdRaw !== null ? String(channelIdRaw).trim() : '';

  if (!otaChannelCode || !channelCode || !channelId) {
    return null;
  }

  const channelNameRaw = raw.channelName ?? raw.name ?? raw.label ?? raw.description ?? channelCode;
  const channelName = String(channelNameRaw).trim();

  const otaChannelNameRaw = raw.otaChannelName ?? raw.name ?? otaChannelCode;
  const otaChannelName = String(otaChannelNameRaw).trim();

  const statusRaw = raw.status !== undefined && raw.status !== null ? String(raw.status).trim() : 'A';

  return {
    id: mappingId || `${otaChannelCode}_${channelCode}`,
    mappingId,
    otaChannelCode,
    otaChannelName: otaChannelName || otaChannelCode,
    channelId,
    channelCode,
    channelName: channelName || channelCode,
    status: statusRaw,
  };
}

/**
 * 读取文旅平台已配置渠道列表（下拉候选）
 * GET /rate-management/channels?showAll=true
 */
export async function fetchCulturalTourismChannels(): Promise<CulturalTourismChannel[]> {
  const response = await requestPlatformApi<unknown>(
    `${CHANNEL_ENDPOINTS.RATE_MANAGEMENT_CHANNELS}?showAll=true`
  );

  const rawItems = extractDataItems(response);
  const channels: CulturalTourismChannel[] = [];
  const seenCodes = new Set<string>();

  for (const raw of rawItems) {
    const normalized = normalizeCulturalTourismChannel(raw);
    if (!normalized || normalized.status === 'I') continue;

    if (!seenCodes.has(normalized.channelCode)) {
      seenCodes.add(normalized.channelCode);
      channels.push(normalized);
    }
  }

  return channels;
}

/**
 * 查询已配置的 OTA 渠道映射
 * GET /toolkit/channel-mappings
 */
export async function fetchChannelMappings(otaChannelCode?: string): Promise<OTAChannelMappingRecord[]> {
  const query = otaChannelCode ? `?otaChannelCode=${encodeURIComponent(otaChannelCode)}` : '';
  const response = await requestPlatformApi<unknown>(
    `${CHANNEL_ENDPOINTS.OTA_CHANNEL_MAPPINGS}${query}`
  );

  const rawItems = extractDataItems(response);
  const mappings: OTAChannelMappingRecord[] = [];

  for (const raw of rawItems) {
    const normalized = normalizeOTAChannelMappingRecord(raw, otaChannelCode);
    if (!normalized || normalized.status === 'I') continue;
    mappings.push(normalized);
  }

  return mappings;
}

/**
 * 校验并构造渠道映射保存 Payload (Fail-Fast)
 */
export function validateAndBuildChannelMappingPayload(
  item: SaveChannelMappingPayloadItem
): SaveChannelMappingPayloadItem {
  const otaChannelCode = String(item.otaChannelCode || '').trim().toUpperCase();
  const channelCode = String(item.channelCode || '').trim();
  const channelId = String(item.channelId || '').trim();
  const otaChannelName = item.otaChannelName ? String(item.otaChannelName).trim() : undefined;
  const status = item.status ? String(item.status).trim() : 'A';

  if (!otaChannelCode) {
    throw new Error('渠道映射缺少必填字段: otaChannelCode');
  }
  if (!channelCode) {
    throw new Error('渠道映射缺少必填字段: channelCode');
  }
  if (!channelId) {
    throw new Error('渠道映射缺少必填字段: channelId');
  }

  return {
    otaChannelCode,
    otaChannelName,
    channelCode,
    channelId,
    status,
  };
}

export interface SaveChannelMappingsBatchResult {
  ok: boolean;
  message: string;
  savedMappings: SaveChannelMappingPayloadItem[];
  records: OTAChannelMappingRecord[];
}

/**
 * 批量保存渠道映射
 * PUT /toolkit/channel-mappings/batch
 */
export async function saveChannelMappingsBatch(
  mappings: SaveChannelMappingPayloadItem[]
): Promise<SaveChannelMappingsBatchResult> {
  if (!mappings || mappings.length === 0) {
    throw new Error('没有可保存的渠道映射。');
  }

  const payload = mappings.map(validateAndBuildChannelMappingPayload);

  const response = await requestPlatformApi<{
    code?: number | string;
    msg?: string;
    message?: string;
    success?: boolean;
    data?: unknown;
  }>(CHANNEL_ENDPOINTS.OTA_CHANNEL_MAPPINGS_BATCH, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  // 严格 Fail-Fast 校验：遇到业务失败立即阻断抛错，绝不返回伪造成功
  if (
    response?.success === false ||
    (response?.code !== undefined &&
      response?.code !== null &&
      String(response.code) !== '0' &&
      String(response.code) !== '200')
  ) {
    const errorMsg =
      response?.msg ||
      response?.message ||
      `业务状态异常 (code: ${response?.code})`;
    throw new Error(`保存渠道映射失败: ${errorMsg}`);
  }

  // 从服务端响应数据中提取保存生成的新映射实体（包含 mappingId 或 id）
  const records: OTAChannelMappingRecord[] = [];
  const rawItems = extractDataItems(response);
  for (const raw of rawItems) {
    const normalized = normalizeOTAChannelMappingRecord(raw);
    if (normalized) {
      records.push(normalized);
    } else {
      // 容错处理：若后端仅回传了主键 ID 与部分关联字段（例如 { mappingId: 'xxx' } 或 { id: 'xxx' }）
      const mappingIdRaw = raw.mappingId ?? raw.otaChannelMappingId ?? raw.id;
      const mappingId = mappingIdRaw !== undefined && mappingIdRaw !== null ? String(mappingIdRaw).trim() : '';

      const otaCodeRaw = raw.otaChannelCode ?? raw.otaChannel ?? (payload.length === 1 ? payload[0].otaChannelCode : '');
      const otaChannelCode = String(otaCodeRaw || '').trim().toUpperCase();

      const channelCodeRaw = raw.channelCode ?? (payload.length === 1 ? payload[0].channelCode : '');
      const channelCode = String(channelCodeRaw || '').trim();

      const channelIdRaw = raw.channelId ?? (payload.length === 1 ? payload[0].channelId : '');
      const channelId = String(channelIdRaw || '').trim();

      if (mappingId && otaChannelCode && channelCode && channelId) {
        const otaChannelName = String(
          raw.otaChannelName ||
            (payload.length === 1 && payload[0].otaChannelName) ||
            otaChannelCode
        ).trim();
        const channelName = String(raw.channelName || channelCode).trim();
        const status = String(raw.status || (payload.length === 1 && payload[0].status) || 'A').trim();

        records.push({
          id: mappingId,
          mappingId,
          otaChannelCode,
          otaChannelName,
          channelId,
          channelCode,
          channelName,
          status,
        });
      }
    }
  }

  const message =
    response?.msg ||
    response?.message ||
    (response?.success ? '渠道映射保存成功' : `渠道映射已保存 ${payload.length} 条`);

  return {
    ok: true,
    message,
    savedMappings: payload,
    records,
  };
}
