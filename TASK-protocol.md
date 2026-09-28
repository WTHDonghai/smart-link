
## 任务类型:

```ts
export type DutyTaskMessageType =
  | 'OTA_COLLECT_ORDER'
  | 'OTA_IMPORT_ORDER'
  | 'OTA_CANCEL_ORDER'
  | 'OTA_CONFIRM_IMPORT'
  | 'OTA_CONFIRM_CANCEL';
```

## task claims 任务领取

**request**:

```json
{
 stationId: payload.stationId,
 appId: payload.appId,
 direction: 'INBOUND',
}
```

**response:**
```js
export interface DutyClaimedTask {
  id: string;
  businessId: string; // 不能为空，出了 ota_collect_order, 其它任务表示 ota 订单号
  businessType: string; // 固定值: OTA_MIGRATION
  msgType: DutyTaskMessageType;
  stationId: string;
  leaseToken: string;
  data: string; // Base64 encoded JSON
  msgId?: string;
  unitId?: string;
  unitType?: string;
  direction?: string;
  createdTime?: string;
  delaySendTime?: number;
}
```

## OTA_COLLECT_ORDER

payload:
```json
{"otaChannelCode":"MEITUAN","targetMsgTypes":["OTA_IMPORT_ORDER","OTA_CANCEL_ORDER"],"hotels":[{"extUnitCode":"781913923"}],"windowStart":"2026-09-26 23:57:00"}
```