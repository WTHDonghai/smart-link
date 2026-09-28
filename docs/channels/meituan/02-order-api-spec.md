# 美团（MEITUAN）订单网络接口与契约规范

> **渠道代号**：`MEITUAN`  
> **核心原则**：权威网络响应为唯一数据源 (Network Authority)，零 DOM 业务数据拼接，严格执行 Fail-Fast。  
> **解析器实现**：[`src/crawler/duty/channels/meituan/meituanOrderParsers.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanOrderParsers.ts)  
> **单测覆盖**：[`tests/crawler/duty/meituanOrderParsers.test.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/tests/crawler/duty/meituanOrderParsers.test.ts)

---

## 1. 接口拓扑与业务流转时序

```text
[打开美团 E-booking 订单中心]
       │
       ▼
1. 待处理任务列表 ────────────────► 监听拦截: /api/v1/ebooking/orders/task/list
       │                                     │
       │ (提取待处理订单列表与 orderId)           ▼
       ▼                             parseMeituanOrderListResponse()
2. 页面点击目标订单卡片
       │
       ├──► 3. 详情接口 ──────────► 监听拦截: /api/v1/ebooking/orders/{orderId}
       │                                     │
       └──► 4. 姓名解密 ──────────► 监听拦截: /sensitiveData 或 /confirmPhone
                                             │
                                             ▼
                                     mergeSensitiveDataIntoRawDetail()
                                             │
                                             ▼
                                     parseMeituanOrderDetailResponse()
                                             │
                                             ▼
5. 头部点击「接受」并回填确认号 ──► 弹窗内录入 ──► 读回校验 ──► 提交完成
```

---

## 2. 订单列表接口 (Order List API)

### 2.1 待确认订单列表接口 (Task List)
- **接口 URL 路径**：`/api/v1/ebooking/orders/task/list`
- **常量定义**：`MEITUAN_ORDER_LIST_URL_PATH`
- **请求方式**：`GET`
- **触发时机**：进入订单中心待确认 Tab，或点击 Tab 切换/列表刷新时触发。
- **URL 判定谓词**：`isMeituanListUrl(url: string): boolean`

#### 关键请求 Query 参数
| 参数名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `scenario` | number | 场景标识（默认 `0` 为待处理/待确认） |
| `yodaReady` | string | 美团风控上下文参数（如 `h5`） |
| `csecplatform` | string | 平台风控版本信息 |

#### 关键响应字段与解析清洗字典
由纯函数 `extractMeituanOrdersFromPayload()` 统一清洗：

| 美团原始字段路径 | 目标字段 (`RawMeituanDutyOrder`) | 类型 | 清洗与标准化规则 |
| :--- | :--- | :--- | :--- |
| `data.results[].orderId` / `otaOrderId` | `orderId` | string | 去除首尾空格，作为唯一订单主键 |
| `data.results[].poiId` / `hotelId` | `hotelId` | string | 酒店/门店唯一 ID |
| `data.results[].poiName` / `hotelName` | `hotelName` | string | 门店名称 |
| `data.results[].checkInDateString` | `checkInDate` | string | 经 `fmtDate()` 统一转为 `YYYY-MM-DD` |
| `data.results[].checkOutDateString` | `checkOutDate` | string | 经 `fmtDate()` 统一转为 `YYYY-MM-DD` |
| `data.results[].nights` | `nights` | number | 间夜数（缺失时通过入离日期差值自动派生，保底为 1） |
| `data.results[].totalFee` / `price` | `totalAmount` | number | 若含 `totalFee` 或大于 1000 则判定为**分**，统一换算为**元** |
| `data.results[].orderDisplayLabel` | `orderDisplayLabel` | string | 状态展示文本（如 `新订`、`待处理`） |
| `data.results[].cancelOrder` | `cancelOrder` | boolean | 为 `true` 或状态包含 `CANCEL` 时标记为取消单 |

- **真实脱敏样例**：参考 [`samples/list-task-response.json`](./samples/list-task-response.json)

---

### 2.2 全部订单列表接口 (All Orders List)
- **接口 URL 路径**：`/api/v1/ebooking/orders/list`
- **常量定义**：`MEITUAN_ALL_ORDERS_LIST_URL_PATH`
- **用途定位**：**仅作为 Tab 切换时的网络生命周期屏障（Barrier）**。在切换至「全部订单」再切回「待确认」时，通过等待该接口返回，确保旧请求彻底清空，防止网络响应竞态污染。

---

## 3. 订单详情接口 (Order Detail API)

- **接口 URL 匹配规则**：`isMeituanDetailUrl(url: string, targetOrderId?: string): boolean`
  - **显式协议版本锁定（`/api/v1/`）与 Fail-Fast 原则**：
    - 精确匹配 `/api/v1/ebooking/orders/${cleanTargetId}?` 或以该路径结尾；
    - 绝不使用模糊黑名单排除（无需手动排除 `/task/list` 或 `/sensitiveData`，由路径自然拒绝）；
    - 若美团升级至 `/api/v2/`，立即拒绝匹配并触发 Fail-Fast 告警，彻底杜绝跨版本协议变更导致脏数据解析。
- **请求方式**：`GET`
- **触发动作**：在美团后台页面点击左侧订单卡片时自动由前端异步发起。
- **并发与时序安全**：执行层（[`meituanDetailInspector.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanDetailInspector.ts)）采用**先注册网络监听器、后触发卡片点击**的刚性时序，并在获取 Payload 后二次比对 `payloadOrderId === otaOrderId`，防范网络竞态。

### 3.1 核心业务字段清洗字典 (Detail Parsers)
由纯函数 `parseMeituanOrderDetailResponse()` 负责清洗：

| 美团原始路径 (兼容多层嵌套) | 统一目标字段 | 类型 | 清洗与校验规则 |
| :--- | :--- | :--- | :--- |
| `data.orderDetail.orderId` | `orderId` | string | 强校验：必须与目标单号严格一致，否则返回 `null` (Fail-Fast) |
| `data.orderDetail.roomTypeName` / `roomName` | `roomTypeName` | string | 预订房型名称 |
| `data.orderDetail.ratePlanName` / `rpInfo` | `ratePlanName` | string | 价格计划/销售政策代码 |
| `data.orderDetail.checkInDateString` / `checkInDate` | `checkInDate` | string | 经 `fmtDate()` 格式化为 `YYYY-MM-DD` |
| `data.orderDetail.checkOutDateString` / `checkOutDate` | `checkOutDate` | string | 经 `fmtDate()` 格式化为 `YYYY-MM-DD` |
| `data.orderDetail.roomCount` / `quantity` | `roomCount` | number | 预订间数（默认 1） |
| `data.orderDetail.totalPrice` / `totalFee` | `totalAmount` | number | 订单总金额（单位：元） |
| `data.orderDetail.breakfastInfo[].breakfastDesc` | `breakfast` | string | 提取如 `不含早`、`单早`、`双早` |
| `data.orderDetail.contacts` / `guests` | `guestNames` | string[] | 入住人姓名数组 |
| `data.orderDetail.customerRemark` / `memo` | `customerRemark`| string | 客人预订特殊要求备注 |

- **真实脱敏样例**：参考 [`samples/order-detail-response.json`](./samples/order-detail-response.json)

---

## 4. 敏感信息解密机制 (Privacy Decrypt & Smart Skip)

### 4.1 接口特征
- **URL 匹配规则**：`isMeituanSensitiveUrl(url: string)` 匹配 `/sensitiveData/` 或 `/confirmPhone`
- **请求方式**：`POST` 或 `GET`
- **响应解析函数**：`parseMeituanSensitiveResponse(payload: unknown)`
- **响应体核心节点**：
  ```json
  {
    "code": 0,
    "data": {
      "sensitiveDataList": [
        {
          "guestInfos": [
            { "name": "张三", "phone": "13800138000" }
          ]
        }
      ]
    }
  }
  ```

### 4.2 智能跳过电话解密策略 (Smart Skip Phone Privacy)
1. **背景**：在 1 秒内连续点击“查看姓名”与“查看电话”，属于极高危操作，必触发 Yoda 滑块挑战。
2. **机制与函数**：
   - 纯函数 `isPlainPhoneNumber(val: unknown): boolean`：严格要求为 11 位有效手机号正则（`^1[3-9]\d{9}$`），排除包含 `*` 及占位符（如“暂无”、“未获取”、“none”、“null”等）；
   - 纯函数 `hasPlainMobileNumber(record: unknown): boolean`：深入递归校验目标记录中的顶层 `phone`/`mobile`/`guestMobile` 以及内部 `contacts` 与 `guests` 数组元素；
   - 当点击“查看姓名”并拦截到 `/sensitiveData` 响应后，执行器调用 `hasPlainMobileNumber()` 校验响应报文或现有详情报文；
   - 若手机号已取得（非脱敏且符合真实手机号规范），**执行器强制跳过寻找与点击“查看电话”按钮**，规避双重解密风控；
   - 通过 `mergeSensitiveDataIntoRawDetail` 将明文信息反向融合至原始详情报文，保持上层数据契约完全透明。

- **真实脱敏样例**：参考 [`samples/sensitive-decrypt-response.json`](./samples/sensitive-decrypt-response.json)

---

## 5. 接单与确认号回填接口与校验规范

- **提交方式**：基于订单详情头部「接受」按钮与弹窗内表单提交（由 [`meituanActionExecutor.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanActionExecutor.ts) 驱动）。
- **校验原则**：
  1. **防串单校验**：若输入框中已有不同于本系统的旧确认号，抛出 `CONFIRM_INPUT_ALREADY_FILLED` 立即中止。
  2. **读回比对校验**：写入后通过 `inputValue()` 读回，若读回值与待写入值不匹配，抛出 `CONFIRM_VALUE_MISMATCH` 阻断提交。
  3. **弹窗作用域限定**：必须限定在包含“酒店确认号”的 `.modal-container` 内部操作，禁止使用全局模糊选择器。
  4. **演练安全保障 (`dryRun`)**：在 CLI 或演练测试模式下，完成表单填入与读回比对后，点击弹窗底部的「取消」按钮安全退出，绝不触碰生产提交。

---

## 6. 美团值守核心错误代码字典 (`MeituanDutyErrorCode`)

| 错误代码 (`errorCode`) | 阶段链路 | 说明与含义 | 是否允许调度重试 (`retryable`) |
| :--- | :--- | :--- | :---: |
| `TARGET_PAGE_NOT_READY` | 环境状态 | 页面未处于美团订单中心或被导航至非预期页面 | `false` |
| `RISK_VERIFICATION_REQUIRED` | 环境状态 | 命中安全验证/滑块/Yoda 人机风控，需人工在浏览器完成 | `false` |
| `LIST_TRIGGER_UNAVAILABLE` | 列表采集 | 待确认/全部订单 Tab 按钮不可见或无法点击 | `false` |
| `LIST_RESPONSE_TIMEOUT` | 列表采集 | 刷新待确认列表网络响应超时 (超出 10s) | `true` |
| `LIST_HTTP_ERROR` | 列表采集 | 列表网络请求返回 HTTP 状态码非 200 | `true` |
| `LIST_BUSINESS_FAILED` | 列表采集 | 列表接口返回业务状态码错误 | `false` |
| `ORDER_CARD_NOT_FOUND` | 详情抓取 | 待确认列表中未找到目标订单卡片（可能已被外部接单） | `false` |
| `ORDER_DETAIL_TIMEOUT` | 详情抓取 | 详情网络接口拦截超时 (超出 8s) | `true` |
| `ORDER_DETAIL_HTTP_ERROR` | 详情抓取 | 详情接口网络请求返回 HTTP 状态码非 200 | `true` |
| `ORDER_DETAIL_FIELD_MISSING` | 详情抓取 | 详情接口返回数据中核心业务字段缺失 | `false` |
| `GUEST_NAME_DECRYPT_FAILED` | 详情抓取 | 点击查看姓名后未拦截到有效敏感数据或解析失败 | `false` |
| `CONFIRM_INPUT_NOT_FOUND` | 接单回填 | 接单弹窗未弹出或未找到确认号输入框 | `false` |
| `CONFIRM_INPUT_ALREADY_FILLED`| 接单回填 | 输入框已存在不同确认号，停止覆盖防串单 | `false` |
| `CONFIRM_VALUE_MISMATCH` | 接单回填 | 确认号填入后读回比对不一致 | `false` |
| `CONFIRM_SUBMIT_NOT_FOUND` | 接单回填 | 接单弹窗内未找到「确认接受」提交按钮 | `false` |
| `CONFIRM_RESPONSE_TIMEOUT` | 接单回填 | 确认接口网络响应超时 | `true` |
| `CONFIRM_RESULT_UNVERIFIED` | 接单回填 | 确认接口返回失败或未通过最终校验 | `false` |

