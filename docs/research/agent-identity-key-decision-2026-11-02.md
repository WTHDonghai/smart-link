# Agent 产品映射身份键决策记录（P0-①）

> 状态：已决策（P0 契约与兼容验证产出）。
>
> 日期：2026-11-02。
>
> 结论对象：[LLM Agent 集成设计 §6.2 身份与数据范围](../architecture/llm-agent-integration-design.md#62-身份与数据范围) 中的待确认项——「当前界面使用 `otaRoomTypeId + otaBasicRoomId`，需核实其是否覆盖所有渠道的 SKU/房价维度；如 `otaRateCodeId` 可区分不同产品，必须先统一 UI、合并、模型输入和保存端的身份规则」。

## 结论

**现有身份键 `otaRoomTypeId + otaBasicRoomId`（作用域内）在当前两渠道的采集粒度下是充分且正确的，不需要为 P2 产品映射引入 `otaRateCodeId` 作为身份维度。** Agent 映射输入的 `productKey` 沿用：

```text
channelCode + extUnitCode + unitId + otaRoomTypeId + otaBasicRoomId（+ collectionRunId 作为批次）
```

## 证据（当前源码事实）

### 美团：goodsId 已内嵌价格方案，rateCodeId 是属性而非维度

- `src/crawler/collectors/meituan/meituanProductMapper.ts`：`otaRoomTypeId = goodsId`（取自 `goods.goodsId/goodsID/productId/id`），`otaRateCodeId` 从**同一个 goods 对象内部**提取（`goods.rateCodeId/rpId/rpCustomName`）。一个 goods 与其 rateCodeId 天然 1:1，不存在「同一 goodsId 在同一物理房型下携带多个 rateCodeId」的数据形态。
- 同一 `(goodsId, realRoomId)` 若因挂载在多个逻辑房型下而重复出现，两行的全部字段来自同一 goods 对象，合并去重不丢失信息。
- `otaBasicRoomId = realRoomId`（物理房型）参与消歧：同一商品挂多个物理房型时按二元组分行，符合「一行映射 = 一个渠道商品在一个物理房型上的映射」业务语义。

### 抖音：行粒度就是 (product_id, physical_room_id)，rateCodeId 不参与

- `src/crawler/collectors/douyin/douyinProductMapper.ts` 的 `expandDouyinProductsByPhysicalRoom`：商品按预售房型绑定 1:N 展开，显式以 `(DOUYIN, extUnitCode, productId, productName, physicalRoomId)` 去重——多个销售 SKU 绑定同一 (商品, 物理房型) 时**有意收敛为一行**，这是既有业务语义。
- 抖音渠道不产出 `otaRateCodeId`。

### 保存端

- `src/services/productApi.ts` 的 `saveProductMappingsBatch` 强制校验 `channelCode/extUnitCode/unitId/unitType/otaRoomTypeId/otaRoomTypeName`，`otaBasicRoomId` 随负载提交，与上述身份键一致。

## 残余风险（记录在案，不阻塞 P1/P2）

1. **美团接口形态变化**：若未来同一 goodsId 在同一物理房型下出现不同 rateCodeId，当前身份键会静默合并。当前采集结构上不可能发生（rateCodeId 取自 goods 自身）；若采集器重构时形态变化，必须在入口显式报错而非静默合并。
2. **历史映射回退匹配**：`mergeCandidatesWithHistoricalMappings` 存在仅按 `otaRoomTypeId` 匹配缺 `otaBasicRoomId` 历史行的回退路径（`roomIdMap`），在「一个商品多物理房型且历史行缺基础房型 ID」时可能错配。属既有边缘行为，Agent 自动映射填入草稿时必须以精确键命中为前提，不得走该回退路径。
3. **后端保存幂等性未确认**：批量保存按此复合键是否原子 upsert 仍属设计文档 §16.2 待确认项，不因本决策关闭。

## 对 P2 契约的影响

- `ProductAutoMapping.productKey` 直接采用上述复合键，模型输入中的产品行不得仅以名称或单一 `otaRoomTypeId` 定位。
- 匹配结果回填产品表格时按同一复合键定位行；未命中精确键的结果一律按契约错误处理（该批次失败），不得回退到模糊匹配。
