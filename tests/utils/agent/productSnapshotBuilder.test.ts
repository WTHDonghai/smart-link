import { describe, it, expect } from 'vitest';
import {
  buildProductMappingSnapshot,
  hasIncompleteMapping,
} from '../../../src/utils/agent/productSnapshotBuilder';
import type { ProductMapping } from '../../../src/types';

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

const SCOPE = {
  channelCode: 'MT01',
  extUnitCode: 'POI-1',
  unitId: '1001',
  unitType: 'Property',
  hotelName: '青山酒店',
};

function buildOptions() {
  return {
    scope: SCOPE,
    roomTypes: [{ id: '1', code: 'DLX_K', name: '豪华大床房', displayLabel: '豪华大床房(DLX_K)' }],
    rateCodes: [{ id: '1', rateCode: 'ADV_BF2', rateName: '提前订含双早', displayLabel: '提前订含双早(ADV_BF2)' }],
    reservationTypes: [{ id: '1', code: 'OTA', label: '渠道预订', displayLabel: '渠道预订(OTA)' }],
  };
}

describe('hasIncompleteMapping', () => {
  it('任一字段为空即需要映射', () => {
    expect(hasIncompleteMapping(buildProduct())).toBe(true);
    expect(hasIncompleteMapping(buildProduct({ roomType: 'DLX_K', rateCode: 'ADV_BF2', payType: '' }))).toBe(true);
    expect(hasIncompleteMapping(buildProduct({ roomType: 'DLX_K', rateCode: 'ADV_BF2', payType: 'OTA' }))).toBe(false);
  });
});

describe('buildProductMappingSnapshot Fail-Fast 校验', () => {
  it('三类字典任一为空即构建失败并指明字典（空候选不得伪装权威数据）', () => {
    const base = buildOptions();

    const noRoom = buildProductMappingSnapshot({ ...base, products: [buildProduct()], roomTypes: [] });
    expect(noRoom.ok).toBe(false);
    if (noRoom.ok) return;
    expect(noRoom.reason).toContain('PMS 房型字典为空或加载失败');

    const noRate = buildProductMappingSnapshot({ ...base, products: [buildProduct()], rateCodes: [] });
    expect(noRate.ok).toBe(false);
    if (noRate.ok) return;
    expect(noRate.reason).toContain('PMS 房价码字典为空或加载失败');

    const noRes = buildProductMappingSnapshot({ ...base, products: [buildProduct()], reservationTypes: [] });
    expect(noRes.ok).toBe(false);
    if (noRes.ok) return;
    expect(noRes.reason).toContain('PMS 预订类型字典为空或加载失败');
  });

  it('全部产品已配置完整时显式跳过，不发起空 run', () => {
    const outcome = buildProductMappingSnapshot({
      ...buildOptions(),
      products: [buildProduct({ roomType: 'DLX_K', rateCode: 'ADV_BF2', payType: 'OTA' })],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('无需自动匹配');
  });
});

describe('buildProductMappingSnapshot 快照构建', () => {
  it('仅纳入待映射产品并按复合键构建，三类候选转换为 code/name 契约', () => {
    const outcome = buildProductMappingSnapshot({
      ...buildOptions(),
      products: [
        buildProduct({ otaRoomTypeId: 'G-1', otaBasicRoomId: 'R-1' }),
        buildProduct({
          otaRoomTypeId: 'G-2',
          otaBasicRoomId: 'R-2',
          otaRoomTypeName: '双床房',
          roomType: 'TWN',
          rateCode: 'STD',
          payType: 'OTA',
        }),
      ],
      collectionRunId: 'coll-fixed',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { snapshot } = outcome;

    expect(snapshot.collectionRunId).toBe('coll-fixed');
    expect(snapshot.snapshotId).toMatch(/^snap-/);
    expect(snapshot.capturedAt).toBeTruthy();
    expect(snapshot.scope).toEqual(SCOPE);

    // 只包含存在缺失字段的产品
    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.products[0]).toEqual({
      productKey: 'G-1\u001fR-1',
      otaRoomTypeId: 'G-1',
      otaRoomTypeName: '豪华大床房·双早',
      otaBasicRoomId: 'R-1',
      otaBasicRoomName: '豪华大床房',
      otaRateCodeId: '',
      otaPayType: '',
    });

    expect(snapshot.roomTypes).toEqual([{ code: 'DLX_K', name: '豪华大床房' }]);
    expect(snapshot.rateCodes).toEqual([{ code: 'ADV_BF2', name: '提前订含双早' }]);
    expect(snapshot.reservationTypes).toEqual([{ code: 'OTA', name: '渠道预订' }]);
  });

  it('已完成映射的前 10 条进入 referenceMappings（只读参考），待映射产品不进入示例', () => {
    const completed = (id: string) =>
      buildProduct({
        otaRoomTypeId: id,
        otaBasicRoomId: 'R-9',
        otaRoomTypeName: `产品${id}`,
        roomType: 'DLX_K',
        rateCode: 'ADV_BF2',
        payType: 'OTA',
      });
    const outcome = buildProductMappingSnapshot({
      ...buildOptions(),
      products: [buildProduct({ otaRoomTypeId: 'G-PENDING' }), ...Array.from({ length: 11 }, (_, i) => completed(`G-DONE-${i}`))],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // 快照主体仍只含待映射产品
    expect(outcome.snapshot.products).toHaveLength(1);
    // 参考示例上限截取前 10 条，字段投影为已保存映射
    expect(outcome.snapshot.referenceMappings).toHaveLength(10);
    expect(outcome.snapshot.referenceMappings?.[0]).toEqual({
      productName: '产品G-DONE-0',
      physicalRoomName: '豪华大床房',
      otaRateCodeId: '',
      otaPayType: '',
      roomType: 'DLX_K',
      rateCode: 'ADV_BF2',
      payType: 'OTA',
    });
  });

  it('无已完成映射时快照不携带 referenceMappings 字段', () => {
    const outcome = buildProductMappingSnapshot({ ...buildOptions(), products: [buildProduct()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.referenceMappings).toBeUndefined();
  });

  it('未提供 collectionRunId 时自动生成', () => {
    const outcome = buildProductMappingSnapshot({
      ...buildOptions(),
      products: [buildProduct()],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.collectionRunId).toMatch(/^coll-/);
  });
});
