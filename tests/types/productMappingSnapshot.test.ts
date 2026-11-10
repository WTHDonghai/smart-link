import { describe, it, expect } from 'vitest';
import { isProductMappingSnapshot, buildProductKey, PRODUCT_KEY_SEPARATOR } from '../../src/types/agent';
import type { ProductMappingSnapshot } from '../../src/types/agent';

function buildSnapshot(overrides?: Partial<ProductMappingSnapshot>): ProductMappingSnapshot {
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
    products: [
      {
        productKey: buildProductKey('goods-1', 'real-1'),
        otaRoomTypeId: 'goods-1',
        otaRoomTypeName: '豪华大床房·双早',
        otaBasicRoomId: 'real-1',
        otaBasicRoomName: '豪华大床房',
        otaRateCodeId: '',
        otaPayType: 'PP',
      },
    ],
    roomTypes: [{ code: 'DLX_K', name: '豪华大床房' }],
    rateCodes: [{ code: 'ADV_BF2', name: '提前订含双早' }],
    reservationTypes: [{ code: 'OTA', name: '渠道预订' }],
    ...overrides,
  };
}

describe('isProductMappingSnapshot 参考示例校验（2026-11-09 只读上下文决策）', () => {
  const example = {
    productName: '豪华大床房·双早',
    physicalRoomName: '豪华大床房',
    otaRateCodeId: '',
    otaPayType: 'PP',
    roomType: 'DLX_K',
    rateCode: 'ADV_BF2',
    payType: 'OTA',
  };

  it('合法参考示例通过；缺省该字段亦通过', () => {
    expect(isProductMappingSnapshot(buildSnapshot({ referenceMappings: [example] }))).toBe(true);
    expect(isProductMappingSnapshot(buildSnapshot())).toBe(true);
  });

  it('PMS 编码为空、非数组或超出 10 条上限即拒绝', () => {
    expect(isProductMappingSnapshot(buildSnapshot({ referenceMappings: [{ ...example, rateCode: '  ' }] }))).toBe(false);
    expect(
      isProductMappingSnapshot(
        buildSnapshot({ referenceMappings: Array.from({ length: 11 }, () => example) })
      )
    ).toBe(false);
    expect(
      isProductMappingSnapshot(
        buildSnapshot({ referenceMappings: 'nope' as unknown as ProductMappingSnapshot['referenceMappings'] })
      )
    ).toBe(false);
  });
});

describe('buildProductKey 复合键（P0-① 决策）', () => {
  it('以单元分隔符拼接房型 ID 与物理房型 ID，空物理房型 ID 归一为空串', () => {
    expect(buildProductKey('goods-1', 'real-1')).toBe(`goods-1${PRODUCT_KEY_SEPARATOR}real-1`);
    expect(buildProductKey(' goods-1 ', 'real-1')).toBe(`goods-1${PRODUCT_KEY_SEPARATOR}real-1`);
    expect(buildProductKey('goods-1', '')).toBe(`goods-1${PRODUCT_KEY_SEPARATOR}`);
  });
});

describe('isProductMappingSnapshot IPC 入口结构校验', () => {
  it('接受完整合法快照', () => {
    expect(isProductMappingSnapshot(buildSnapshot())).toBe(true);
  });

  it('拒绝非对象与缺失标识/时间/作用域', () => {
    expect(isProductMappingSnapshot(null)).toBe(false);
    expect(isProductMappingSnapshot('snapshot')).toBe(false);
    expect(isProductMappingSnapshot(buildSnapshot({ snapshotId: '' }))).toBe(false);
    expect(isProductMappingSnapshot(buildSnapshot({ collectionRunId: ' ' }))).toBe(false);
    expect(isProductMappingSnapshot(buildSnapshot({ capturedAt: 'not-a-date' }))).toBe(false);

    const brokenScope = buildSnapshot();
    brokenScope.scope.channelCode = '';
    expect(isProductMappingSnapshot(brokenScope)).toBe(false);
  });

  it('拒绝空产品列表与空候选集合（不允许空候选伪装成权威数据）', () => {
    expect(isProductMappingSnapshot(buildSnapshot({ products: [] }))).toBe(false);
    expect(isProductMappingSnapshot(buildSnapshot({ roomTypes: [] }))).toBe(false);
    expect(isProductMappingSnapshot(buildSnapshot({ rateCodes: [] }))).toBe(false);
    expect(isProductMappingSnapshot(buildSnapshot({ reservationTypes: [] }))).toBe(false);
  });

  it('拒绝复合键与原始 ID 字段不一致的行（防止键值错位串行）', () => {
    const mismatched = buildSnapshot();
    mismatched.products[0].productKey = buildProductKey('goods-other', 'real-1');
    expect(isProductMappingSnapshot(mismatched)).toBe(false);
  });

  it('拒绝重复复合键', () => {
    const duplicated = buildSnapshot({
      products: [
        {
          productKey: buildProductKey('goods-1', 'real-1'),
          otaRoomTypeId: 'goods-1',
          otaRoomTypeName: '产品A',
          otaBasicRoomId: 'real-1',
          otaBasicRoomName: '豪华大床房',
          otaRateCodeId: '',
          otaPayType: 'PP',
        },
        {
          productKey: buildProductKey('goods-1', 'real-1'),
          otaRoomTypeId: 'goods-1',
          otaRoomTypeName: '产品B',
          otaBasicRoomId: 'real-1',
          otaBasicRoomName: '豪华大床房',
          otaRateCodeId: '',
          otaPayType: 'PP',
        },
      ],
    });
    expect(isProductMappingSnapshot(duplicated)).toBe(false);
  });

  it('拒绝缺失产品名或候选编码/名称的行', () => {
    const noName = buildSnapshot();
    noName.products[0].otaRoomTypeName = ' ';
    expect(isProductMappingSnapshot(noName)).toBe(false);

    const badCandidate = buildSnapshot();
    badCandidate.roomTypes = [{ code: '', name: '豪华大床房' }];
    expect(isProductMappingSnapshot(badCandidate)).toBe(false);
  });
});
