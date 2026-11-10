import { describe, it, expect, vi, beforeEach } from 'vitest';
import productReducer, {
  setProductDraft,
  clearProductDraftsForKeys,
  setAutoMappingRunStarted,
  setAutoMappingProgress,
  applyAutoMappingResult,
  runAutoMappingThunk,
  crawlOtaProductsThunk,
  getProductIdentityKey,
  type ProductState,
  type ProductAutoMappingRunContext,
} from '../../../src/store/slices/productSlice';
import { getAgentCapabilities, startAgentProductMapping } from '../../../src/services/agentBridge';
import type { ProductMappingRunResult } from '../../../src/types/agent';
import type { ProductMapping } from '../../../src/types';

/**
 * P2b 渲染层自动匹配状态机：草稿唯一源、人工编辑保护、版本校验丢弃、
 * 结果应用与进度回流。仅 Mock 外部 I/O（Agent IPC 网关），Reducer 全部为真实逻辑。
 */

vi.mock('../../../src/services/agentBridge', () => ({
  getAgentCapabilities: vi.fn(),
  startAgentProductMapping: vi.fn(),
  cancelAgentProductMappingRun: vi.fn(),
  subscribeAgentProductMappingProgress: vi.fn(() => () => undefined),
  confirmAgentLogPersisted: vi.fn(),
}));

const capabilitiesMock = vi.mocked(getAgentCapabilities);
const startMock = vi.mocked(startAgentProductMapping);

function buildProduct(overrides?: Partial<ProductMapping>): ProductMapping {
  return {
    channelCode: 'MT01',
    extUnitCode: 'POI-1',
    unitId: '1001',
    unitType: 'Property',
    otaRoomTypeId: 'G-1',
    otaRoomTypeName: '豪华大床房·双早',
    otaBasicRoomId: 'R-1',
    otaBasicRoomName: '豪华大床房',
    roomType: '',
    rateCode: '',
    payType: '',
    status: 'pending',
    ...overrides,
  };
}

function buildScopedState(products: ProductMapping[], overrides?: Partial<ProductState>): ProductState {
  return {
    ...productReducer(undefined, { type: '@@INIT' }),
    filterChannel: 'MEITUAN',
    filterExtUnitCode: 'POI-1',
    filterHotelName: '青山酒店',
    filterUnitId: '1001',
    products,
    roomTypes: [{ id: '1', code: 'DLX_K', name: '豪华大床房', displayLabel: 'DLX' }],
    rateCodes: [{ id: '1', rateCode: 'ADV_BF2', rateName: '提前订含双早', displayLabel: 'ADV' }],
    reservationTypes: [{ id: '1', code: 'OTA', label: '渠道预订', displayLabel: 'OTA' }],
    ...overrides,
  };
}

function buildRunContext(overrides?: Partial<ProductAutoMappingRunContext>): ProductAutoMappingRunContext {
  return {
    runId: 'run-1',
    snapshotId: 'snap-1',
    collectionRunId: 'coll-1',
    extUnitCode: 'POI-1',
    unitId: '1001',
    draftRevision: 0,
    ...overrides,
  };
}

function fieldMatch(code: string | null, grade: 'high' | 'medium' | 'low' | 'undetermined', reason: string) {
  return { selectedCode: code, grade, reason, alternatives: [] };
}

function buildResult(mappings: ProductMappingRunResult['mappings'], overrides?: Partial<ProductMappingRunResult>): ProductMappingRunResult {
  return {
    runId: 'run-1',
    snapshotId: 'snap-1',
    collectionRunId: 'coll-1',
    outcome: 'completed',
    mappings,
    failedProducts: [],
    counts: { total: mappings.length, mapped: mappings.length, partial: 0, unmatched: 0, conflict: 0, failed: 0 },
    usage: { promptTokens: 10, completionTokens: 5 },
    ...overrides,
  };
}

function withRunStarted(state: ProductState, context: ProductAutoMappingRunContext): ProductState {
  return productReducer(
    state,
    setAutoMappingRunStarted({ runId: context.runId, totalProducts: 2, runContext: context })
  );
}

beforeEach(() => {
  capabilitiesMock.mockReset().mockResolvedValue({ productMappingEnabled: true, exceptionRecoveryEnabled: false });
  startMock.mockReset();
});

describe('草稿唯一源 reducer', () => {
  it('setProductDraft 写入草稿、递增修订号并标记评级「已人工修改」', () => {
    let state = withRunStarted(buildScopedState([buildProduct()]), buildRunContext());
    state = productReducer(
      state,
      applyAutoMappingResult(
        buildResult([
          {
            productKey: 'G-1\u001fR-1',
            snapshotId: 'snap-1',
            roomType: fieldMatch('DLX_K', 'high', '物理房型一致'),
            rateCode: fieldMatch('ADV_BF2', 'medium', '语义匹配'),
            reservationType: fieldMatch('OTA', 'medium', '渠道语义'),
            outcome: 'matched',
            overallGrade: 'medium',
          },
        ])
      )
    );
    expect(state.insights['G-1\u001fR-1'].manuallyEdited).toBe(false);

    state = productReducer(state, setProductDraft({ key: 'G-1\u001fR-1', field: 'rateCode', value: 'STD' }));
    expect(state.drafts['G-1\u001fR-1'].rateCode).toBe('STD');
    expect(state.draftRevision).toBe(1);
    expect(state.insights['G-1\u001fR-1'].manuallyEdited).toBe(true);
  });

  it('clearProductDraftsForKeys 清除指定草稿并递增修订号', () => {
    let state = buildScopedState([buildProduct()]);
    state = productReducer(state, setProductDraft({ key: 'k1', field: 'roomType', value: 'DLX_K' }));
    state = productReducer(state, clearProductDraftsForKeys(['k1']));
    expect(state.drafts['k1']).toBeUndefined();
    expect(state.draftRevision).toBe(2);
  });
});

describe('applyAutoMappingResult 结果应用', () => {
  const mappingFor = (key: string, overrides?: Partial<ProductMappingRunResult['mappings'][number]>) => ({
    productKey: key,
    snapshotId: 'snap-1',
    roomType: fieldMatch('DLX_K', 'high', '物理房型一致'),
    rateCode: fieldMatch('ADV_BF2', 'medium', '语义匹配'),
    reservationType: fieldMatch('OTA', 'medium', '渠道语义'),
    outcome: 'matched' as const,
    overallGrade: 'medium' as const,
    ...overrides,
  });

  it('仅向空字段写入草稿：已配置房型保持不动，只补房价码与预订类型', () => {
    const state = withRunStarted(
      buildScopedState([buildProduct({ roomType: 'TWN_EXISTING' })]),
      buildRunContext()
    );

    const next = productReducer(
      state,
      applyAutoMappingResult(buildResult([mappingFor('G-1\u001fR-1')]))
    );

    expect(next.drafts['G-1\u001fR-1']).toEqual({ rateCode: 'ADV_BF2', payType: 'OTA' });
    expect(next.products[0].roomType).toBe('TWN_EXISTING');
    expect(next.insights['G-1\u001fR-1'].appliedFields).toEqual(['rateCode', 'payType']);
    expect(next.insights['G-1\u001fR-1'].overallGrade).toBe('medium');
    expect(next.autoMapping.status).toBe('completed');
    expect(next.autoMapping.counts?.mapped).toBe(1);
  });

  it('人工草稿行受保护：不覆盖人工值，标记 manualProtected 且不写入任何字段', () => {
    let state = buildScopedState([buildProduct()]);
    state = productReducer(state, setProductDraft({ key: 'G-1\u001fR-1', field: 'roomType', value: 'TWN' }));
    // 以人工编辑后的修订号启动 run（编辑发生在 run 之前）
    state = withRunStarted(state, buildRunContext({ draftRevision: state.draftRevision }));

    const next = productReducer(state, applyAutoMappingResult(buildResult([mappingFor('G-1\u001fR-1')])));

    expect(next.drafts['G-1\u001fR-1']).toEqual({ roomType: 'TWN' });
    expect(next.insights['G-1\u001fR-1'].manualProtected).toBe(true);
    expect(next.insights['G-1\u001fR-1'].appliedFields).toEqual([]);
  });

  it('重新匹配刷新 Agent 自有草稿：上一轮自动填入且未人工编辑的旧建议值被新结果替换（设计 6.7）', () => {
    let state = withRunStarted(buildScopedState([buildProduct()]), buildRunContext());
    state = productReducer(state, applyAutoMappingResult(buildResult([mappingFor('G-1\u001fR-1')])));
    expect(state.drafts['G-1\u001fR-1']).toEqual({ roomType: 'DLX_K', rateCode: 'ADV_BF2', payType: 'OTA' });

    // 重新匹配：新结果给出不同的建议值，未被人工编辑过的旧建议应被刷新
    const next = productReducer(
      state,
      applyAutoMappingResult(
        buildResult([
          mappingFor('G-1\u001fR-1', {
            roomType: fieldMatch('TWN_NEW', 'high', '物理房型一致'),
            rateCode: fieldMatch('STD_NEW', 'medium', '语义匹配'),
            reservationType: fieldMatch('PMS_NEW', 'medium', '渠道语义'),
          }),
        ])
      )
    );

    expect(next.drafts['G-1\u001fR-1']).toEqual({ roomType: 'TWN_NEW', rateCode: 'STD_NEW', payType: 'PMS_NEW' });
    expect(next.insights['G-1\u001fR-1'].manualProtected).toBe(false);
    expect(next.insights['G-1\u001fR-1'].appliedFields).toEqual(['roomType', 'rateCode', 'payType']);
    expect(next.insights['G-1\u001fR-1'].manuallyEdited).toBe(false);
  });

  it('人工编辑过的行重新匹配仍受保护，且「已人工修改」标记不被重置', () => {
    let state = withRunStarted(buildScopedState([buildProduct()]), buildRunContext());
    state = productReducer(state, applyAutoMappingResult(buildResult([mappingFor('G-1\u001fR-1')])));
    state = productReducer(
      state,
      setProductDraft({ key: 'G-1\u001fR-1', field: 'rateCode', value: 'STD' })
    );
    expect(state.insights['G-1\u001fR-1'].manuallyEdited).toBe(true);
    // 重新匹配：以人工编辑后的修订号启动新 run（编辑发生在新 run 之前）
    state = withRunStarted(state, buildRunContext({ draftRevision: state.draftRevision }));

    const next = productReducer(
      state,
      applyAutoMappingResult(
        buildResult([
          mappingFor('G-1\u001fR-1', {
            roomType: fieldMatch('TWN_NEW', 'high', '物理房型一致'),
          }),
        ])
      )
    );

    // 人工值不动，其余 Agent 旧建议也不被覆盖（整行人工保护）
    expect(next.drafts['G-1\u001fR-1']).toEqual({ roomType: 'DLX_K', rateCode: 'STD', payType: 'OTA' });
    expect(next.insights['G-1\u001fR-1'].manualProtected).toBe(true);
    expect(next.insights['G-1\u001fR-1'].appliedFields).toEqual([]);
    expect(next.insights['G-1\u001fR-1'].manuallyEdited).toBe(true);
  });

  it('run 期间人工修改导致修订号过期：整体丢弃写入并显式记录原因', () => {
    let state = buildScopedState([buildProduct()]);
    state = withRunStarted(state, buildRunContext({ draftRevision: state.draftRevision }));
    // run 启动后人工编辑
    state = productReducer(state, setProductDraft({ key: 'other-key', field: 'roomType', value: 'X' }));

    const next = productReducer(state, applyAutoMappingResult(buildResult([mappingFor('G-1\u001fR-1')])));

    expect(next.drafts['G-1\u001fR-1']).toBeUndefined();
    expect(next.insights['G-1\u001fR-1']).toBeUndefined();
    expect(next.autoMapping.staleDiscardReason).toContain('自动填入已丢弃');
    expect(next.autoMapping.status).toBe('completed');
  });

  it('作用域变化（切换门店）：丢弃写入', () => {
    let state = buildScopedState([buildProduct()]);
    state = withRunStarted(state, buildRunContext());
    state = { ...state, filterExtUnitCode: 'POI-OTHER' };

    const next = productReducer(state, applyAutoMappingResult(buildResult([mappingFor('G-1\u001fR-1')])));
    expect(next.autoMapping.staleDiscardReason).toContain('自动填入已丢弃');
  });

  it('非当前 run 的迟到结果被完全忽略', () => {
    const state = withRunStarted(buildScopedState([buildProduct()]), buildRunContext());

    const next = productReducer(state, applyAutoMappingResult(buildResult([mappingFor('G-1\u001fR-1')], { runId: 'run-stale' })));

    expect(next.drafts['G-1\u001fR-1']).toBeUndefined();
    expect(next.autoMapping.status).toBe('running');
  });

  it('失败/取消终态：更新状态但不写草稿', () => {
    const state = withRunStarted(buildScopedState([buildProduct()]), buildRunContext());

    const failed = productReducer(
      state,
      applyAutoMappingResult(
        buildResult([], { outcome: 'failed', failureReason: '模型服务不可用', counts: { total: 1, mapped: 0, partial: 0, unmatched: 0, conflict: 0, failed: 1 } })
      )
    );
    expect(failed.autoMapping.status).toBe('failed');
    expect(failed.autoMapping.error).toBe('模型服务不可用');
    expect(failed.drafts).toEqual({});
  });

  it('结果中包含失败产品时不写入其草稿（仅有失败原因记录于计数）', () => {
    const state = withRunStarted(buildScopedState([buildProduct()]), buildRunContext());

    const next = productReducer(
      state,
      applyAutoMappingResult(
        buildResult([], {
          outcome: 'completed',
          failedProducts: [{ productKey: 'G-1\u001fR-1', reason: '模型调用失败: 超时' }],
          counts: { total: 1, mapped: 0, partial: 0, unmatched: 0, conflict: 0, failed: 1 },
        })
      )
    );

    expect(next.drafts['G-1\u001fR-1']).toBeUndefined();
    expect(next.insights['G-1\u001fR-1']).toBeUndefined();
    expect(next.autoMapping.counts?.failed).toBe(1);
  });
});

describe('setAutoMappingProgress 进度回流', () => {
  it('匹配 runId 的批次进度更新处理数；不匹配的进度被忽略', () => {
    let state = withRunStarted(buildScopedState([]), buildRunContext());

    state = productReducer(
      state,
      setAutoMappingProgress({ runId: 'run-1', phase: 'batch-completed', processedProducts: 5, totalProducts: 20 })
    );
    expect(state.autoMapping.processedProducts).toBe(5);

    state = productReducer(
      state,
      setAutoMappingProgress({ runId: 'run-other', phase: 'batch-completed', processedProducts: 9, totalProducts: 20 })
    );
    expect(state.autoMapping.processedProducts).toBe(5);
  });

  it('无结果的终态事件（主进程兑底路径）直接置终态', () => {
    const state = withRunStarted(buildScopedState([]), buildRunContext());

    const next = productReducer(
      state,
      setAutoMappingProgress({ runId: 'run-1', phase: 'failed', processedProducts: 0, totalProducts: 3, error: '工作流异常终止' })
    );
    expect(next.autoMapping.status).toBe('failed');
    expect(next.autoMapping.error).toBe('工作流异常终止');
  });
});

describe('runAutoMappingThunk 启动编排', () => {
  it('功能开启且有待映射产品：构建快照、登记 run 上下文并返回 started', async () => {
    startMock.mockResolvedValue({ accepted: true, runId: 'run-99' });

    const state = buildScopedState([buildProduct()]);
    const actions: Array<{ type: string }> = [];
    const dispatch = vi.fn((action: unknown) => {
      actions.push(action as { type: string });
      return action;
    });

    const finalAction = (await runAutoMappingThunk({ pmsChannelCode: 'MT01' })(
      dispatch as never,
      () => ({ product: state }),
      undefined
    )) as { type: string; payload: unknown };

    expect(finalAction.type).toBe('product/runAutoMapping/fulfilled');
    expect(finalAction.payload).toEqual({ started: true, runId: 'run-99', totalProducts: 1 });
    expect(startMock).toHaveBeenCalledTimes(1);
    const snapshot = startMock.mock.calls[0][0];
    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.scope.hotelName).toBe('青山酒店');

    // setAutoMappingRunStarted 在启动成功后被派发且上下文正确
    const startedAction = actions.find((action) => action.type === 'product/setAutoMappingRunStarted');
    expect(startedAction).toBeTruthy();
  });

  it('功能未开启：started=false 携带可读原因返回，由界面显式反馈，不构建快照、不派发启动动作', async () => {
    capabilitiesMock.mockResolvedValue({ productMappingEnabled: false, exceptionRecoveryEnabled: false });

    const state = buildScopedState([buildProduct()]);
    const dispatch = vi.fn();

    const finalAction = (await runAutoMappingThunk({ pmsChannelCode: 'MT01' })(
      dispatch as never,
      () => ({ product: state }),
      undefined
    )) as { type: string; payload: unknown };

    expect(finalAction.type).toBe('product/runAutoMapping/fulfilled');
    expect(finalAction.payload).toEqual({ started: false, reason: '产品自动映射功能未开启' });
    expect(startMock).not.toHaveBeenCalled();
    // 仅 pending + fulfilled：跳过原因经返回值交界面显式反馈，无额外副作用
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('字典为空：rejected 携带明确失败原因', async () => {
    const state = buildScopedState([buildProduct()], { roomTypes: [] });

    const finalAction = (await runAutoMappingThunk({ pmsChannelCode: 'MT01' })(
      vi.fn() as never,
      () => ({ product: state }),
      undefined
    )) as { type: string; payload: unknown };

    expect(finalAction.type).toBe('product/runAutoMapping/rejected');
    expect(String(finalAction.payload)).toContain('PMS 房型字典为空或加载失败');
  });
});

describe('草稿修订与重置', () => {
  it('重新采集 fulfilled 递增修订号（在途自动填入作废），保留人工草稿', () => {
    let state = buildScopedState([buildProduct()]);
    state = productReducer(state, setProductDraft({ key: 'G-1\u001fR-1', field: 'roomType', value: 'DLX_K' }));

    const next = productReducer(
      state,
      {
        type: crawlOtaProductsThunk.fulfilled.type,
        payload: {
          candidates: [],
          request: { channelCode: 'MEITUAN', pmsChannelCode: 'MT01', extUnitCode: 'POI-1' },
        },
      } as never
    );

    expect(next.draftRevision).toBe(2);
    expect(next.drafts['G-1\u001fR-1']).toEqual({ roomType: 'DLX_K' });
  });

  it('删除产品同时清除其草稿与评级元数据', () => {
    let state = buildScopedState([buildProduct()]);
    const key = getProductIdentityKey(buildProduct());
    state = productReducer(state, setProductDraft({ key, field: 'roomType', value: 'DLX_K' }));
    state = productReducer(
      state,
      applyAutoMappingResult(buildResult([]))
    );

    const next = productReducer(
      state,
      { type: 'product/deleteProduct', payload: { otaRoomTypeId: 'G-1', otaBasicRoomId: 'R-1' } } as never
    );

    expect(next.drafts[key]).toBeUndefined();
    expect(next.products).toHaveLength(0);
  });
});
