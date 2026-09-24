# [渠道名称] 订单网络接口与契约规范

> **渠道代号**：`[CHANNEL_CODE]`  
> **核心原则**：权威网络响应为唯一数据源 (Network Authority)，DOM 仅作控件定位与断言，严禁 DOM 文本拼接业务数据。

---

## 1. 接口拓扑与业务时序

```text
[进入商户订单中心]
       │
       ▼
1. 列表接口 (待确认/全部) ──► 捕获 JSON ──► parse[Channel]OrderListResponse
       │                                         │
       ▼ (遍历待处理列表)                         │ (提取 orderId)
2. 页面点击订单卡片 ────────► 3. 详情接口 ────────┴─► 4. (按需) 敏感数据解密
                                                           │
                                                           ▼
                                         parse[Channel]OrderDetailResponse
                                                           │
                                                           ▼
                                                 5. 接受接单并回填确认号
```

---

## 2. 订单列表接口 (Order List API)

### 2.1 待处理/待确认订单列表接口
- **接口 URL**：`https://...`
- **请求方式**：`GET` / `POST`
- **触发时机**：进入页面初始加载、点击待处理 Tab、手动列表刷新

#### 请求参数
| 参数名 | 类型 | 必填 | 示例值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `status` | string/number | 是 | `10` | 待确认/待处理状态枚举 |
| `page` | number | 否 | `1` | 页码 |
| `pageSize` | number | 否 | `20` | 每页数量 |

#### 关键响应字段清洗映射
| 渠道原始字段路径 | 目标字段 (`RawDutyOrder`) | 类型 | 清洗与转换规则 |
| :--- | :--- | :--- | :--- |
| `data.list[].orderId` | `orderId` | string | 去除前后空格 |
| `data.list[].status` | `orderDisplayLabel` | string | 状态展示文本（如“新订”、“待处理”） |
| `data.list[].checkInDate` | `checkInDate` | string | 统一转换为 `YYYY-MM-DD` |
| `data.list[].checkOutDate`| `checkOutDate` | string | 统一转换为 `YYYY-MM-DD` |
| `data.list[].totalFee` | `totalAmount` | number | 注意单位换算（分 -> 元） |
| `data.list[].cancelFlag` | `cancelOrder` | boolean | 是否属于客户申请取消订单 |

- **脱敏原始报文存储**：参考 [`samples/list-task-response.json`](./samples/list-task-response.json)

---

## 3. 订单详情接口 (Order Detail API)

### 3.1 详情获取方式
- **获取机制**：[ ] 同页异步详情接口 / [ ] 列表已包含全量数据 / [ ] 新窗口页面加载
- **接口 URL**：`https://.../api/orders/{orderId}/detail`
- **请求方式**：`GET` / `POST`

#### 关键业务字段清洗映射表 (Parsers Specification)
| 渠道原始路径 | 目标字段 (`ExtractedOrderDetail`) | 目标类型 | 提取与校验规则 |
| :--- | :--- | :--- | :--- |
| `data.orderId` | `orderId` | string | 必须与目标单号严格一致 |
| `data.roomTypeName` | `roomTypeName` | string | 房型名称 |
| `data.ratePlanName` | `ratePlanName` | string | 销售政策/价格计划 |
| `data.checkInDate` | `checkInDate` | string | 格式化为 `YYYY-MM-DD` |
| `data.checkOutDate` | `checkOutDate` | string | 格式化为 `YYYY-MM-DD` |
| `data.nightCount` | `nights` | number | 间夜数（若无则根据入离日期计算） |
| `data.roomCount` | `roomCount` | number | 预订间数 |
| `data.totalAmount` | `totalAmount` | number | 总价（单位：元） |
| `data.breakfast` | `breakfast` | string | 早餐规格说明 |
| `data.guestList` | `guests` | Array | 入住人姓名与电话 |
| `data.remark` | `customerRemark` | string | 客人预订备注 |

- **脱敏原始报文存储**：参考 [`samples/order-detail-response.json`](./samples/order-detail-response.json)

---

## 4. 敏感信息解密机制 (Privacy Decrypt)

### 4.1 脱敏现状
- 姓名脱敏表现：如 `张*三`
- 电话脱敏表现：如 `138****0000`

### 4.2 解密接口规范
- **接口 URL**：`https://...`
- **请求方式**：`POST`
- **返回结构**：
  - 核心字段：`data.name`, `data.phone`
- **智能跳过策略**：若姓名解密报文中已包含完整明文手机号，是否可以强制跳过电话解密以规避风控？
  - [ ] 是（推荐） / [ ] 否

- **脱敏原始报文存储**：参考 [`samples/sensitive-decrypt-response.json`](./samples/sensitive-decrypt-response.json)

---

## 5. 接单与确认号回填接口 (Order Confirmation API)

- **接单方式**：[ ] 纯 DOM 驱动提交 / [ ] 前端直接调用网络接口
- **提交请求 URL**：`https://.../api/orders/{orderId}/accept`
- **请求 Payload**：
  ```json
  {
    "orderId": "...",
    "hotelConfirmNo": "...",
    "action": "ACCEPT"
  }
  ```
- **业务响应断言**：
  - 成功判定条件：`code === 0` 或 `success === true`
  - 常见业务失败码（如“房态已变动”、“订单已取消”等）

---

## 6. 渠道异常与错误代码字典

| 错误代码枚举 (`ChannelDutyErrorCode`) | 含义说明 | 是否可重试 (`retryable`) | 调度应对措施 |
| :--- | :--- | :---: | :--- |
| `TARGET_PAGE_NOT_READY` | 未停留在目标商户中心 | `false` | 重新导航并校验当前 URL |
| `RISK_VERIFICATION_REQUIRED` | 命中人机滑块/安全验证 | `false` | 暂停自动化，发出桌面通知人工介入 |
| `ORDER_CARD_NOT_FOUND` | 列表中找不到目标订单卡片 | `false` | 重新刷新列表，若仍无则上报无法处理 |
| `ORDER_DETAIL_TIMEOUT` | 详情网络拦截超时 | `true` | 可重试，检查网络状况 |
| `CONFIRM_VALUE_MISMATCH` | 确认号填入读回比对不一致 | `false` | 阻断流程，防止串单 |
