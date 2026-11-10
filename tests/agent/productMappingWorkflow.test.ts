import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import type { AgentLogPersistedAck } from '../../src/types/agent';
import type { LogEventType } from '../../src/types';
import type { TrackOptions } from '../../src/services/logger';
import {
  runProductMappingWorkflow,
  MAX_SNAPSHOT_PRODUCTS,
  DEFAULT_MAPPING_CONCURRENCY,
} from '../../src/agent/productMappingWorkflow';
import { AgentTraceEmitter } from '../../src/agent/agentTraceEmitter';
import { agentTraceLedger } from '../../src/agent/agentTraceLedger';
import { logger } from '../../src/services/logger';
import {
  buildProductKey,
  type ProductMappingSnapshot,
  type SnapshotProduct,
} from '../../src/types/agent';
import type { SystemLogEntry } from '../../src/types';
import type { ModelCallInput, ModelCallResult } from '../../src/agent/agentModelClient';
import type { ProductMappingProgressEvent } from '../../src/types/agent';

/**
 * 产品映射工作流：真实编排/校验/评级/追踪逻辑，
 * 仅注入外部 I/O（模型调用）与跨进程确认等待（账本）。
 */

const ROOM_TYPES = [
  { code: 'DLX_K', name: '豪华大床房' },
  { code: 'TWN', name: '双床房' },
];
const RATE_CODES = [
  { code: 'ADV_BF2', name: '提前订含双早' },
  { code: 'STD', name: '标准价' },
];
const RESERVATION_TYPES = [
  { code: 'OTA', name: '渠道预订' },
  { code: 'DIRECT', name: '直接预订' },
];

function buildSnapshot(productCount: number, overrides?: Partial<ProductMappingSnapshot>): ProductMappingSnapshot {
  const products: SnapshotProduct[] = Array.from({ length: productCount }, (_, i) => ({
    productKey: buildProductKey(`goods-${i}`, `real-${i % 2}`),
    otaRoomTypeId: `goods-${i}`,
    otaRoomTypeName: `产品${i}`,
    otaBasicRoomId: `real-${i % 2}`,
    otaBasicRoomName: i % 2 === 0 ? '豪华大床房' : '双床房',
    otaRateCodeId: '',
    otaPayType: 'PP',
  }));

  return {
    snapshotId: 'snap-1',
    collectionRunId: 'coll-1',
    capturedAt: '2026-11-02T10:00:00.000Z',
    scope: {
      channelCode: 'MEITUAN',
      extUnitCode: 'EXT-1',
      unitId: '1001',
      unitType: 'Property',
      hotelName: '青山酒店',
    },
    products,
    roomTypes: ROOM_TYPES,
    rateCodes: RATE_CODES,
    reservationTypes: RESERVATION_TYPES,
    ...overrides,
  };
}

/** 构造覆盖整批产品的合法模型输出 */
function buildValidModelResponse(batchSize: number): { mappings: Array<Record<string, unknown>> } {
  return {
    mappings: Array.from({ length: batchSize }, (_, i) => ({
      productRef: `P${String(i + 1).padStart(3, '0')}`,
      roomType: { code: 'TWN', confidence: 'high', reason: '物理房型名称一致' },
      rateCode: { code: 'STD', confidence: 'medium', reason: '名称语义匹配' },
      reservationType: { code: 'OTA', confidence: 'medium', reason: '渠道单语义' },
    })),
  };
}

function buildModelResult(parsedJson: unknown, usage?: ModelCallResult['usage']): ModelCallResult {
  return {
    content: JSON.stringify(parsedJson),
    parsedJson,
    usage: usage ?? { promptTokens: 100, completionTokens: 20 },
    model: 'test-model',
    durationMs: 5,
  };
}

function buildHarness(options?: {
  productCount?: number;
  modelCall?: (input: ModelCallInput) => Promise<ModelCallResult>;
  signal?: AbortSignal;
  batchSize?: number;
  concurrency?: number;
  deadlineMs?: number;
}) {
  const progressEvents: ProductMappingProgressEvent[] = [];
  const emitter = new AgentTraceEmitter({ traceId: 'trace-1', runId: 'run-1' });

  const run = () =>
    runProductMappingWorkflow(buildSnapshot(options?.productCount ?? 2), {
      emitter,
      endpoint: { baseUrl: 'https://gateway.example.com/v1', apiKey: 'sk-x' },
      model: 'test-model',
      timeoutMs: 5000,
      batchSize: options?.batchSize,
      concurrency: options?.concurrency,
      deadlineMs: options?.deadlineMs,
      signal: options?.signal,
      modelCall: options?.modelCall,
      onProgress: (event) => progressEvents.push(event),
    });

  return { progressEvents, run, emitter };
}

let trackSpy: MockInstance<(event: LogEventType | string, options?: TrackOptions) => SystemLogEntry>;
let ackSpy: MockInstance<
  (entryId: string, options?: { timeoutMs?: number }) => Promise<AgentLogPersistedAck>
>;
let entryIdCounter = 0;

beforeEach(() => {
  entryIdCounter = 0;
  trackSpy = vi.spyOn(logger, 'track').mockImplementation(() => {
    entryIdCounter += 1;
    return { id: `log-${entryIdCounter}` } as SystemLogEntry;
  });
  ackSpy = vi
    .spyOn(agentTraceLedger, 'waitForLogCommitAck')
    .mockResolvedValue({ entryId: 'log-1', runId: 'run-1', sequence: 1, status: 'committed' });
});

afterEach(() => {
  trackSpy.mockRestore();
  ackSpy.mockRestore();
});

describe('runProductMappingWorkflow 快照业务校验', () => {
  it('产品数超出首期上限：ok:false 且不产生任何执行', async () => {
    const modelCall = vi.fn();
    const snapshot = buildSnapshot(MAX_SNAPSHOT_PRODUCTS + 1);
    const emitter = new AgentTraceEmitter({ traceId: 't', runId: 'r' });

    const outcome = await runProductMappingWorkflow(snapshot, {
      emitter,
      endpoint: { baseUrl: 'https://g/v1', apiKey: 'k' },
      model: 'm',
      timeoutMs: 1000,
      modelCall,
    });

    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining('超出首期支持上限') });
    expect(modelCall).not.toHaveBeenCalled();
    expect(trackSpy).not.toHaveBeenCalled();
  });
});

describe('runProductMappingWorkflow 正常执行', () => {
  it('快照携带参考示例：模型输入包含 referenceMappings 与参考规则（提示词 v2）', async () => {
    const modelCall = vi.fn(async (_input: ModelCallInput) => buildModelResult(buildValidModelResponse(1)));
    const snapshot = buildSnapshot(1, {
      referenceMappings: [
        {
          productName: '豪华大床房·双早（历史）',
          physicalRoomName: '豪华大床房',
          otaRateCodeId: '',
          otaPayType: 'PP',
          roomType: 'DLX_K',
          rateCode: 'ADV_BF2',
          payType: 'OTA',
        },
      ],
    });
    const emitter = new AgentTraceEmitter({ traceId: 't-ref', runId: 'r-ref' });

    const outcome = await runProductMappingWorkflow(snapshot, {
      emitter,
      endpoint: { baseUrl: 'https://gateway.example.com/v1', apiKey: 'sk-x' },
      model: 'test-model',
      timeoutMs: 5000,
      modelCall,
    });

    expect(outcome.ok).toBe(true);
    expect(modelCall).toHaveBeenCalledTimes(1);
    const input = modelCall.mock.calls[0][0];
    const [systemMessage, userMessage] = input.messages;
    // 系统指令说明参考示例的定位与硬约束（仍只能选本次候选）
    expect(systemMessage.content).toContain('referenceMappings');
    expect(systemMessage.content).toContain('既往的映射习惯');
    // 用户载荷携带已保存映射示例
    expect(userMessage.content).toContain('豪华大床房·双早（历史）');
    expect(userMessage.content).toContain('ADV_BF2');
  });

  it('单批全链路：追踪事件齐备、计数精确、进度事件有序、结果可回填', async () => {
    const modelCall = vi.fn(async () => buildModelResult(buildValidModelResponse(2)));
    const { progressEvents, run } = buildHarness({ modelCall, batchSize: 20 });
    const outcome = await run();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { result } = outcome;

    expect(result.outcome).toBe('completed');
    expect(result.counts).toEqual({ total: 2, mapped: 2, partial: 0, unmatched: 0, conflict: 0, failed: 0 });
    expect(result.mappings).toHaveLength(2);
    expect(result.mappings[0].roomType.selectedCode).toBe('TWN');
    expect(result.mappings[0].rateCode.grade).toBe('medium');
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 20 });
    expect(result.failedProducts).toEqual([]);

    // 进度：快照就绪 -> 批次完成 -> run 完成
    expect(progressEvents.map((event) => event.phase)).toEqual([
      'snapshot-validated',
      'batch-completed',
      'completed',
    ]);
    expect(progressEvents[progressEvents.length - 1].result).toBe(result);

    // 追踪事件：run.started -> snapshot.completed -> model.started -> model.completed -> validation.completed -> run.completed
    const eventNames = trackSpy.mock.calls.map((call) => call[0]);
    expect(eventNames).toEqual([
      'AGENT_RUN_STARTED',
      'AGENT_SNAPSHOT_COMPLETED',
      'AGENT_MODEL_STARTED',
      'AGENT_MODEL_COMPLETED',
      'AGENT_VALIDATION_COMPLETED',
      'AGENT_RUN_COMPLETED',
    ]);
  });

  it('并发默认上限为 2，多批次逐批调用模型', async () => {
    expect(DEFAULT_MAPPING_CONCURRENCY).toBe(2);

    const snapshot = buildSnapshot(25);
    const modelCall = vi.fn(async (input: ModelCallInput) => {
      // 从消息体推算本批产品数（mock 依据实际输入返回覆盖整批的合法输出）
      const userPayload = JSON.parse(input.messages[input.messages.length - 1].content.split('\n').slice(1).join('\n')) as {
        products: unknown[];
      };
      return buildModelResult(buildValidModelResponse(userPayload.products.length));
    });
    const progressEvents: ProductMappingProgressEvent[] = [];
    const emitter = new AgentTraceEmitter({ traceId: 't', runId: 'r' });

    const outcome = await runProductMappingWorkflow(snapshot, {
      emitter,
      endpoint: { baseUrl: 'https://g/v1', apiKey: 'k' },
      model: 'test-model',
      timeoutMs: 5000,
      batchSize: 20,
      modelCall,
      onProgress: (event) => progressEvents.push(event),
    });

    expect(outcome.ok).toBe(true);
    expect(modelCall).toHaveBeenCalledTimes(2);
    if (!outcome.ok) return;
    expect(outcome.result.counts).toEqual({
      total: 25,
      mapped: 25,
      partial: 0,
      unmatched: 0,
      conflict: 0,
      failed: 0,
    });
  });
});

describe('runProductMappingWorkflow 批次失败不掩盖', () => {
  it('模型调用失败的批次计入 failedProducts，其余批次继续', async () => {
    let callIndex = 0;
    const modelCall = vi.fn(async () => {
      callIndex += 1;
      if (callIndex === 1) {
        throw new Error('模型服务返回 HTTP 503');
      }
      return buildModelResult(buildValidModelResponse(5));
    });
    const snapshot = buildSnapshot(25);
    const emitter = new AgentTraceEmitter({ traceId: 't', runId: 'r' });

    const outcome = await runProductMappingWorkflow(snapshot, {
      emitter,
      endpoint: { baseUrl: 'https://g/v1', apiKey: 'k' },
      model: 'test-model',
      timeoutMs: 5000,
      batchSize: 20,
      modelCall,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.counts).toEqual({ total: 25, mapped: 5, partial: 0, unmatched: 0, conflict: 0, failed: 20 });
    expect(outcome.result.failedProducts).toHaveLength(20);
    expect(outcome.result.failedProducts[0].reason).toContain('模型调用失败: 模型服务返回 HTTP 503');
    expect(outcome.result.outcome).toBe('completed');
  });

  it('输出校验失败的批次按契约违规原因失败', async () => {
    const invalidResponse = { mappings: [{ productRef: 'P001', roomType: { code: 'FORGED', confidence: 'high', reason: 'x' } }] };
    const modelCall = vi.fn(async () => buildModelResult(invalidResponse));
    const { run } = buildHarness({ modelCall, batchSize: 20 });

    const outcome = await run();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.counts.failed).toBe(2);
    expect(outcome.result.failedProducts[0].reason).toContain('候选外编码: FORGED');
  });
});

describe('runProductMappingWorkflow 取消与预算', () => {
  it('模型在途被取消：run 判定 cancelled，未执行批次显式计入失败', async () => {
    const controller = new AbortController();
    const modelCall = vi.fn(async () => {
      controller.abort();
      throw new Error('模型请求已被业务取消信号中止');
    });
    const snapshot = buildSnapshot(25);
    const emitter = new AgentTraceEmitter({ traceId: 't', runId: 'r' });

    const outcome = await runProductMappingWorkflow(snapshot, {
      emitter,
      endpoint: { baseUrl: 'https://g/v1', apiKey: 'k' },
      model: 'test-model',
      timeoutMs: 5000,
      batchSize: 20,
      concurrency: 1,
      signal: controller.signal,
      modelCall,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.outcome).toBe('cancelled');
    // 批次 1（20 项）模型取消失败 + 批次 2（5 项）未领取显式失败，无产品静默消失
    expect(outcome.result.counts).toEqual({ total: 25, mapped: 0, partial: 0, unmatched: 0, conflict: 0, failed: 25 });
    const reasons = outcome.result.failedProducts.map((item) => item.reason);
    expect(reasons.filter((r) => r.includes('模型调用失败'))).toHaveLength(20);
    expect(reasons.filter((r) => r.includes('本批未执行'))).toHaveLength(5);
  });

  it('总预算耗尽：新批次不发起模型调用，显式失败', async () => {
    const modelCall = vi.fn(async () => buildModelResult(buildValidModelResponse(1)));
    const { run } = buildHarness({ modelCall, deadlineMs: -1 });

    const outcome = await run();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(modelCall).not.toHaveBeenCalled();
    expect(outcome.result.counts.failed).toBe(2);
    expect(outcome.result.failedProducts[0].reason).toContain('总预算（时间）耗尽');
  });
});

describe('runProductMappingWorkflow 追踪确认闸门', () => {
  it('首条关键事件确认失败：run 整体 ok:false，绝不发起模型调用', async () => {
    ackSpy.mockRejectedValue(new Error('等待 Agent 日志提交确认超时（entryId=log-1）'));
    const modelCall = vi.fn();
    const { run } = buildHarness({ modelCall });

    const outcome = await run();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('关键追踪事件持久化确认失败，Agent 动作已停止');
    expect(modelCall).not.toHaveBeenCalled();
  });

  it('终态事件确认失败：结果仍返回但显式标注追踪不完整', async () => {
    ackSpy.mockImplementation(() => {
      // 2 产品单批共 4 次关键确认：run.started / model.started / model.completed / run 终态；最后一次失败
      const calls = ackSpy.mock.calls.length;
      if (calls >= 4) {
        return Promise.reject(new Error('等待 Agent 日志提交确认超时'));
      }
      return Promise.resolve({ entryId: 'log-x', runId: 'run-1', sequence: calls, status: 'committed' as const });
    });
    const modelCall = vi.fn(async () => buildModelResult(buildValidModelResponse(2)));
    const { run } = buildHarness({ modelCall });

    const outcome = await run();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.outcome).toBe('completed');
    expect(outcome.result.failureReason).toContain('终态追踪确认失败');
  });
});

describe('runProductMappingWorkflow usage 汇总', () => {
  it('多批次 usage 相加；供应商缺失时保持 null', async () => {
    const snapshot = buildSnapshot(25);
    let callIndex = 0;
    const modelCall = vi.fn(async () => {
      callIndex += 1;
      return buildModelResult(buildValidModelResponse(callIndex === 1 ? 20 : 5), {
        promptTokens: callIndex === 1 ? 100 : null,
        completionTokens: callIndex === 1 ? 40 : 10,
      });
    });
    const emitter = new AgentTraceEmitter({ traceId: 't', runId: 'r' });

    const outcome = await runProductMappingWorkflow(snapshot, {
      emitter,
      endpoint: { baseUrl: 'https://g/v1', apiKey: 'k' },
      model: 'test-model',
      timeoutMs: 5000,
      batchSize: 20,
      modelCall,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 批次 1: 100/40；批次 2: null/10 -> 100+0 / 40+10（缺失按 0 计入求和，不伪造）
    expect(outcome.result.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
  });
});
