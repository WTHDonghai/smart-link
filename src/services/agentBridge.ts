/**
 * Agent IPC 网关（渲染进程 -> 主进程）。
 *
 * 依据 docs/architecture/llm-agent-integration-design.md 第 11 节 IPC 契约：
 * - host:log-persisted 由渲染进程在关键追踪事件 IndexedDB 事务提交后回传主进程；
 * - agent:start-product-mapping 携带采集快照启动映射 run，进度经订阅通道推送。
 * Electron IPC 缺失时立即失败，不提供任何本地兜底。
 */

import type {
  AgentCapabilities,
  AgentLogPersistedAck,
  ProductMappingProgressEvent,
  ProductMappingSnapshot,
} from '../types/agent';
import type { HostBridgeApi } from '../types/host';

export interface AgentOperationResult {
  accepted: boolean;
  error?: string;
}

function requireAgentBridge(): HostBridgeApi['agent'] {
  const agentBridge: HostBridgeApi['agent'] | undefined = window.host?.agent;
  if (!agentBridge) {
    throw new Error('Electron 宿主 Agent 桥接缺失，无法执行 Agent 操作');
  }
  return agentBridge;
}

export async function confirmAgentLogPersisted(
  ack: AgentLogPersistedAck
): Promise<AgentOperationResult> {
  return requireAgentBridge().confirmLogPersisted(ack);
}

export async function getAgentCapabilities(): Promise<AgentCapabilities> {
  return requireAgentBridge().getCapabilities();
}

export async function startAgentProductMapping(snapshot: ProductMappingSnapshot): Promise<{
  accepted: boolean;
  runId?: string;
  error?: string;
}> {
  return requireAgentBridge().startProductMapping(snapshot);
}

export async function cancelAgentProductMappingRun(runId: string): Promise<AgentOperationResult> {
  return requireAgentBridge().cancelProductMappingRun(runId);
}

export function subscribeAgentProductMappingProgress(
  callback: (event: ProductMappingProgressEvent) => void
): () => void {
  return requireAgentBridge().onProductMappingProgress(callback);
}
