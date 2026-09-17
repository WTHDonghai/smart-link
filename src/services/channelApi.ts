import { requestPlatformApi, PLATFORM_MODULES, TOOLKIT_MODULE } from './platformApi';
import {
  CulturalTourismChannel,
  OTAChannelMappingRecord,
  SaveChannelMappingPayloadItem,
} from '../types';

// 重新导出供已有调用方保持兼容
export { PLATFORM_MODULES, TOOLKIT_MODULE };

export const CHANNEL_ENDPOINTS = {
  RATE_MANAGEMENT_CHANNELS: `/${PLATFORM_MODULES.RATE_MANAGEMENT}/channels`,
  OTA_CHANNEL_MAPPINGS: `/${PLATFORM_MODULES.TOOLKIT}/channel-mappings`,
  OTA_CHANNEL_MAPPINGS_BATCH: `/${PLATFORM_MODULES.TOOLKIT}/channel-mappings/batch`,
  CHANNEL_REMARK_TEMPLATES: `/${PLATFORM_MODULES.TOOLKIT}/channel-remark-templates`,
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

export interface SaveChannelRemarkTemplatePayload {
  remarkTemplate: string;
}

export interface SaveChannelRemarkTemplateResult {
  ok: boolean;
  message: string;
  otaChannelCode: string;
  remarkTemplate: string;
}

/**
 * 保存 OTA 渠道备注模板
 * PUT /toolkit/channel-remark-templates/{otaChannelCode}
 * 接口ID：506024742
 */
export async function saveChannelRemarkTemplate(
  otaChannelCode: string,
  payload: SaveChannelRemarkTemplatePayload
): Promise<SaveChannelRemarkTemplateResult> {
  const code = encodeURIComponent(String(otaChannelCode || '').trim().toUpperCase());
  if (!code) {
    throw new Error('保存渠道备注模板缺少必填参数: otaChannelCode');
  }

  if (typeof payload?.remarkTemplate !== 'string') {
    throw new Error('保存渠道备注模板缺少必填字段: remarkTemplate');
  }

  const endpoint = `${CHANNEL_ENDPOINTS.CHANNEL_REMARK_TEMPLATES}/${code}`;

  const response = await requestPlatformApi<{
    code?: number | string;
    msg?: string;
    message?: string;
    success?: boolean;
    data?: unknown;
  }>(endpoint, {
    method: 'PUT',
    body: JSON.stringify({
      remarkTemplate: payload.remarkTemplate,
    }),
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
    throw new Error(`保存渠道备注模板失败: ${errorMsg}`);
  }

  const message =
    response?.msg ||
    response?.message ||
    `「${otaChannelCode}」备注模板已保存`;

  return {
    ok: true,
    message,
    otaChannelCode,
    remarkTemplate: payload.remarkTemplate,
  };
}

export interface FetchChannelRemarkTemplateResult {
  otaChannelCode: string;
  remarkTemplate: string | null;
}

/**
 * 根据 OTA 渠道编码查询备注模板
 * GET /toolkit/channel-remark-templates/{otaChannelCode}
 * 接口ID：507972669
 * 
 * 规则：若后台未配置或资源不存在 (404/空)，返回 remarkTemplate: null，由调用方回退展示默认模板
 */
export async function fetchChannelRemarkTemplate(
  otaChannelCode: string
): Promise<FetchChannelRemarkTemplateResult> {
  const code = encodeURIComponent(String(otaChannelCode || '').trim().toUpperCase());
  if (!code) {
    throw new Error('查询渠道备注模板缺少必填参数: otaChannelCode');
  }

  const endpoint = `${CHANNEL_ENDPOINTS.CHANNEL_REMARK_TEMPLATES}/${code}`;

  try {
    const response = await requestPlatformApi<unknown>(endpoint, {
      method: 'GET',
    });

    let template: string | null = null;
    if (typeof response === 'string') {
      template = response;
    } else if (response && typeof response === 'object') {
      const respObj = response as Record<string, unknown>;

      // 业务信封失败 Fail-Fast 阻断，避免业务异常被静默误判为未配置模板
      if (
        respObj.success === false ||
        (respObj.code !== undefined &&
          respObj.code !== null &&
          String(respObj.code) !== '0' &&
          String(respObj.code) !== '200')
      ) {
        const errorMsg =
          typeof respObj.msg === 'string'
            ? respObj.msg
            : typeof respObj.message === 'string'
            ? respObj.message
            : `业务状态异常 (code: ${String(respObj.code)})`;
        throw new Error(`获取渠道备注模板失败: ${errorMsg}`);
      }

      const data = respObj.data !== undefined ? respObj.data : respObj;

      if (typeof data === 'string') {
        template = data;
      } else if (data && typeof data === 'object') {
        const dataObj = data as Record<string, unknown>;
        if (typeof dataObj.remarkTemplate === 'string') {
          template = dataObj.remarkTemplate;
        }
      }
    }

    return {
      otaChannelCode,
      remarkTemplate: template && template.trim() ? template : null,
    };
  } catch (error) {
    // 若服务端返回 404 (资源/模板不存在) 或明确包含未配置相关描述，按设计返回 null 触发默认模板回退
    const status =
      error && typeof error === 'object' && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : error && typeof error === 'object' && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : undefined;

    const msg = error instanceof Error ? error.message : String(error);

    if (
      status === 404 ||
      msg.includes('404') ||
      msg.includes('NOT_FOUND') ||
      msg.includes('No static resource') ||
      msg.includes('未找到') ||
      msg.includes('不存在')
    ) {
      return {
        otaChannelCode,
        remarkTemplate: null,
      };
    }

    // 其他真实网络/服务器异常 (如 500/网络中断/401) 遵循 Fail-Fast 抛出
    throw error;
  }
}

