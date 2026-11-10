/**
 * 产品采集自动映射工作流（仅主进程，设计第 6 节 P2）。
 *
 * 编排：快照业务校验 -> 分批（默认 20/批）-> 受限并发模型调用（上限 2）->
 * 契约校验 -> 代码评级 -> 汇总结果与精确计数。
 *
 * 刚性约束：
 * - 模型调用零自动重试；批次失败标记该批产品失败原因，不掩盖已完成批次（设计 6.8）；
 * - 总预算（默认 5 分钟）耗尽时停止新批次，已完成结果如实保留；
 * - 关键追踪事件（run 起止、模型调用起止）必须先通过 IndexedDB 提交确认才继续（设计 9.5）；
 * - 取消信号传播到在途模型请求；已完成的批次结果保留；
 * - run 提前终止时，未执行批次的产品显式计入 failedProducts，不静默消失。
 */

import type {
  ProductAutoMapping,
  ProductMappingProgressEvent,
  ProductMappingRunResult,
  ProductMappingSnapshot,
} from '@/src/types/agent';
import {
  callChatCompletion,
  type AgentModelEndpoint,
  type ModelCallInput,
  type ModelCallResult,
} from './agentModelClient';
import { AgentTraceEmitter } from './agentTraceEmitter';
import {
  buildProductMappingMessages,
  buildProductRef,
  describeSnapshotForTrace,
  PRODUCT_MAPPING_PROMPT_VERSION,
} from './prompts/productMappingInstructions';
import { validateModelBatchResponse } from '@/src/utils/agent/productMatchValidation';
import { gradeProductMapping } from '@/src/utils/agent/productMatchGrading';
import { describeErrorMessage } from '@/src/utils/errorCauses';

/** 首期候选规模上限：超出即显式失败提示人工映射，禁止静默截断候选（设计 6.4-2） */
export const MAX_ROOM_TYPE_CANDIDATES = 80;
export const MAX_RATE_CODE_CANDIDATES = 120;
export const MAX_RESERVATION_TYPE_CANDIDATES = 40;
export const MAX_SNAPSHOT_PRODUCTS = 500;

export const DEFAULT_MAPPING_BATCH_SIZE = 20;
export const DEFAULT_MAPPING_CONCURRENCY = 2;
export const DEFAULT_MAPPING_DEADLINE_MS = 5 * 60 * 1000;

export interface ProductMappingWorkflowOptions {
  emitter: AgentTraceEmitter;
  /** 模型端点（baseUrl 已含版本路径）；密钥仅在此使用，绝不进入日志 */
  endpoint: AgentModelEndpoint;
  model: string;
  timeoutMs: number;
  /** 测试注入点：生产为 callChatCompletion；仅替换外部网络 I/O */
  modelCall?: (input: ModelCallInput) => Promise<ModelCallResult>;
  batchSize?: number;
  concurrency?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
  onProgress?: (event: ProductMappingProgressEvent) => void;
}

export type WorkflowRunOutcome =
  | { ok: true; result: ProductMappingRunResult }
  | { ok: false; reason: string };

function validateSnapshotLimits(snapshot: ProductMappingSnapshot): string | null {
  if (snapshot.roomTypes.length > MAX_ROOM_TYPE_CANDIDATES) {
    return `PMS 房型候选 ${snapshot.roomTypes.length} 项超出首期支持上限 ${MAX_ROOM_TYPE_CANDIDATES}，请人工映射`;
  }
  if (snapshot.rateCodes.length > MAX_RATE_CODE_CANDIDATES) {
    return `PMS 房价码候选 ${snapshot.rateCodes.length} 项超出首期支持上限 ${MAX_RATE_CODE_CANDIDATES}，请人工映射`;
  }
  if (snapshot.reservationTypes.length > MAX_RESERVATION_TYPE_CANDIDATES) {
    return `PMS 预订类型候选 ${snapshot.reservationTypes.length} 项超出首期支持上限 ${MAX_RESERVATION_TYPE_CANDIDATES}，请人工映射`;
  }
  if (snapshot.products.length > MAX_SNAPSHOT_PRODUCTS) {
    return `待映射产品 ${snapshot.products.length} 项超出首期支持上限 ${MAX_SNAPSHOT_PRODUCTS}，请分批采集或人工映射`;
  }
  return null;
}

function chunkProducts<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sumUsage(
  total: { promptTokens: number | null; completionTokens: number | null },
  add: { promptTokens: number | null; completionTokens: number | null }
): { promptTokens: number | null; completionTokens: number | null } {
  return {
    promptTokens:
      total.promptTokens === null && add.promptTokens === null
        ? null
        : (total.promptTokens ?? 0) + (add.promptTokens ?? 0),
    completionTokens:
      total.completionTokens === null && add.completionTokens === null
        ? null
        : (total.completionTokens ?? 0) + (add.completionTokens ?? 0),
  };
}

function countOutcome(result: ProductMappingRunResult, mapping: ProductAutoMapping): void {
  switch (mapping.outcome) {
    case 'matched':
      result.counts.mapped += 1;
      break;
    case 'partial':
      result.counts.partial += 1;
      break;
    case 'unmatched':
      result.counts.unmatched += 1;
      break;
    case 'conflict':
      result.counts.conflict += 1;
      break;
  }
}

/**
 * 执行一次完整映射 run。快照已通过 IPC 结构守卫；此处再做业务上限校验与执行编排。
 * run 级失败（快照超限、首条关键追踪确认失败）返回 ok:false，不产生半程结果。
 */
export async function runProductMappingWorkflow(
  snapshot: ProductMappingSnapshot,
  options: ProductMappingWorkflowOptions
): Promise<WorkflowRunOutcome> {
  const limitViolation = validateSnapshotLimits(snapshot);
  if (limitViolation) {
    return { ok: false, reason: limitViolation };
  }

  const total = snapshot.products.length;
  const runId = options.emitter.runId;
  const batchSize = options.batchSize ?? DEFAULT_MAPPING_BATCH_SIZE;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_MAPPING_CONCURRENCY, DEFAULT_MAPPING_CONCURRENCY)
  );
  const deadlineMs = options.deadlineMs ?? DEFAULT_MAPPING_DEADLINE_MS;
  const modelCall = options.modelCall ?? ((input: ModelCallInput) => callChatCompletion(options.endpoint, input));
  const deadline = Date.now() + deadlineMs;

  const result: ProductMappingRunResult = {
    runId,
    snapshotId: snapshot.snapshotId,
    collectionRunId: snapshot.collectionRunId,
    outcome: 'completed',
    mappings: [],
    failedProducts: [],
    counts: { total, mapped: 0, partial: 0, unmatched: 0, conflict: 0, failed: 0 },
    usage: { promptTokens: null, completionTokens: null },
  };

  const emitProgress = (event: {
    phase: ProductMappingProgressEvent['phase'];
    processedProducts: number;
    error?: string;
    result?: ProductMappingRunResult;
  }): void => {
    options.onProgress?.({ runId, totalProducts: total, ...event });
  };

  try {
    await options.emitter.emitCritical({
      kind: 'run',
      phase: 'started',
      summary: `产品自动映射启动：${total} 项产品，候选 房型${snapshot.roomTypes.length}/房价码${snapshot.rateCodes.length}/预订类型${snapshot.reservationTypes.length}`,
      payload: describeSnapshotForTrace(snapshot),
    });
  } catch (error) {
    return { ok: false, reason: describeErrorMessage(error) };
  }

  options.emitter.emit({
    kind: 'snapshot',
    phase: 'completed',
    summary: `输入快照就绪 ${snapshot.snapshotId}`,
    payload: describeSnapshotForTrace(snapshot),
  });
  emitProgress({ phase: 'snapshot-validated', processedProducts: 0 });

  const batches = chunkProducts(snapshot.products, batchSize);
  let processed = 0;
  let nextBatchIndex = 0;
  let stopped = false;
  let stopReason = '';

  const stopRun = (outcome: 'failed' | 'cancelled', reason: string): void => {
    if (!stopped) {
      stopped = true;
      result.outcome = outcome;
      stopReason = reason;
    }
  };

  const failBatch = (batch: SnapshotBatch, reason: string): void => {
    for (const product of batch) {
      result.failedProducts.push({ productKey: product.productKey, reason });
      result.counts.failed += 1;
    }
    processed += batch.length;
  };

  const worker = async (): Promise<void> => {
    while (!stopped && !options.signal?.aborted) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      if (batchIndex >= batches.length) return;
      const batch = batches[batchIndex];

      // 预算检查：到达截止时间后，本批显式失败，已完成结果如实保留
      if (Date.now() > deadline) {
        failBatch(batch, '映射总预算（时间）耗尽，本批未执行');
        emitProgress({ phase: 'batch-failed', processedProducts: processed, error: '映射总预算（时间）耗尽' });
        continue;
      }

      const batchLabel = `批次 ${batchIndex + 1}/${batches.length}`;
      const refs = batch.map((_, i) => buildProductRef(i));

      try {
        await options.emitter.emitCritical({
          kind: 'model',
          phase: 'started',
          summary: `${batchLabel} 模型调用开始（${batch.length} 项）`,
          payload: {
            batchIndex,
            productCount: batch.length,
            promptVersion: PRODUCT_MAPPING_PROMPT_VERSION,
            model: options.model,
          },
        });
      } catch (error) {
        // 关键追踪确认失败：立即终止整个 run，不允许无审计的模型调用
        failBatch(batch, '追踪确认失败，run 终止');
        stopRun('failed', describeErrorMessage(error));
        emitProgress({ phase: 'batch-failed', processedProducts: processed, error: stopReason });
        return;
      }

      let modelResult: ModelCallResult;
      try {
        const messages = buildProductMappingMessages({
          products: batch.map((product, i) => ({ ref: refs[i], product })),
          roomTypes: snapshot.roomTypes,
          rateCodes: snapshot.rateCodes,
          reservationTypes: snapshot.reservationTypes,
          referenceMappings: snapshot.referenceMappings ?? [],
        });
        modelResult = await modelCall({
          model: options.model,
          messages,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        });
      } catch (error) {
        const reason = describeErrorMessage(error);
        failBatch(batch, `模型调用失败: ${reason}`);
        if (options.signal?.aborted) {
          stopRun('cancelled', `已取消：${reason}`);
          emitProgress({ phase: 'batch-failed', processedProducts: processed, error: stopReason });
          return;
        }
        emitProgress({ phase: 'batch-failed', processedProducts: processed, error: `${batchLabel} 模型调用失败: ${reason}` });
        options.emitter.emit({
          kind: 'model',
          phase: 'failed',
          level: 'ERROR',
          summary: `${batchLabel} 模型调用失败: ${reason}`,
          payload: { batchIndex },
        });
        continue;
      }

      try {
        await options.emitter.emitCritical({
          kind: 'model',
          phase: 'completed',
          summary: `${batchLabel} 模型返回（${modelResult.durationMs}ms）`,
          payload: {
            batchIndex,
            model: modelResult.model,
            durationMs: modelResult.durationMs,
            usage: modelResult.usage,
          },
        });
      } catch (error) {
        // 模型结果事件的持久化确认失败：结果不可无审计地进入草稿，终止 run
        failBatch(batch, '模型结果追踪确认失败');
        stopRun('failed', describeErrorMessage(error));
        emitProgress({ phase: 'batch-failed', processedProducts: processed, error: stopReason });
        return;
      }

      result.usage = sumUsage(result.usage, modelResult.usage);

      const validation = validateModelBatchResponse(modelResult.parsedJson, batch, refs, {
        roomTypes: snapshot.roomTypes,
        rateCodes: snapshot.rateCodes,
        reservationTypes: snapshot.reservationTypes,
      });

      if (!validation.ok) {
        failBatch(batch, `输出校验失败: ${validation.reason}`);
        emitProgress({ phase: 'batch-failed', processedProducts: processed, error: `${batchLabel} ${validation.reason}` });
        options.emitter.emit({
          kind: 'validation',
          phase: 'failed',
          level: 'WARN',
          summary: `${batchLabel} 输出校验失败: ${validation.reason}`,
          payload: { batchIndex },
        });
        continue;
      }

      for (const selection of validation.selections) {
        const mapping = gradeProductMapping(
          selection,
          {
            roomTypes: snapshot.roomTypes,
            rateCodes: snapshot.rateCodes,
            reservationTypes: snapshot.reservationTypes,
          },
          snapshot.snapshotId
        );
        result.mappings.push(mapping);
        countOutcome(result, mapping);
      }
      processed += batch.length;

      options.emitter.emit({
        kind: 'validation',
        phase: 'completed',
        summary: `${batchLabel} 校验与评级完成`,
        payload: { batchIndex, validated: validation.selections.length },
      });
      emitProgress({ phase: 'batch-completed', processedProducts: processed });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, () => worker())
  );

  // run 提前终止时，未被任何 worker 领取的批次显式计入失败，不静默消失
  while (nextBatchIndex < batches.length) {
    failBatch(batches[nextBatchIndex], `run 已${result.outcome === 'cancelled' ? '取消' : '终止'}，本批未执行`);
    nextBatchIndex += 1;
  }
  if (result.failureReason === undefined && stopReason) {
    result.failureReason = stopReason;
  }
  if (result.outcome === 'completed' && options.signal?.aborted) {
    result.outcome = 'cancelled';
  }

  try {
    await options.emitter.emitCritical({
      kind: 'run',
      phase:
        result.outcome === 'completed' ? 'completed' : result.outcome === 'cancelled' ? 'cancelled' : 'failed',
      level: result.outcome === 'completed' ? 'INFO' : 'ERROR',
      outcomeCode:
        result.outcome === 'completed'
          ? 'mapping_completed'
          : result.outcome === 'cancelled'
            ? 'mapping_cancelled'
            : 'mapping_failed',
      summary: `产品自动映射结束: ${result.outcome}；成功 ${result.counts.mapped} / 部分 ${result.counts.partial} / 无法判断 ${result.counts.unmatched} / 冲突 ${result.counts.conflict} / 失败 ${result.counts.failed}`,
      payload: { counts: result.counts, usage: result.usage, failureReason: result.failureReason },
    });
  } catch (error) {
    // 终态事件确认失败：结果仍然返回，但必须显式标注追踪不完整
    const reason = describeErrorMessage(error);
    result.failureReason = `${result.failureReason ? `${result.failureReason}；` : ''}终态追踪确认失败: ${reason}`;
  }

  emitProgress({
    phase: result.outcome,
    processedProducts: result.mappings.length + result.failedProducts.length,
    error: result.failureReason,
    result,
  });

  return { ok: true, result };
}

type SnapshotBatch = ProductMappingSnapshot['products'];
