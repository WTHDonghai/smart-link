# 美团（MEITUAN）订单网络接口与契约规范

> **渠道代号**：`MEITUAN`  
> **核心原则**：权威网络响应为唯一数据源 (Network Authority)，零 DOM 业务数据拼接，严格执行 Fail-Fast。  
> **解析器实现**：[`src/crawler/duty/channels/meituan/meituanOrderParsers.ts`](../../../src/crawler/duty/channels/meituan/meituanOrderParsers.ts)  
> **单测覆盖**：[`tests/crawler/duty/meituanOrderParsers.test.ts`](../../../tests/crawler/duty/meituanOrderParsers.test.ts)

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
| `data.results[].orderId` | `orderId` | string | 唯一订单主键契约：约定为 string 类型，按美团原始形态直取（仅空白规整）；不使用硬编码正则限制渠道标识，不猜测候选字段；非字符串、空白或缺失视为渠道契约违规，归因为数据提取异常 (Extraction Anomaly) |
| `data.results[].poiId` / `hotelId` | `hotelId` | string | 酒店/门店唯一 ID |
| `data.results[].poiName` / `hotelName` | `hotelName` | string | 门店名称 |
| `data.results[].checkInDateString` | `checkInDate` | string | 经 `fmtDate()` 统一转为 `YYYY-MM-DD` |
| `data.results[].checkOutDateString` | `checkOutDate` | string | 经 `fmtDate()` 统一转为 `YYYY-MM-DD` |
| `data.results[].nights` | `nights` | number | 间夜数（缺失时通过入离日期差值自动派生，保底为 1） |
| `data.results[].totalFee` / `totalPrice` / `price` | `totalAmount` | number | 若存在 `totalFee` 则按**分**除以 100 换算为元；否则取 `totalPrice ?? price ?? 0`。不做“大于 1000 即猜分”的启发式判断 |
| `data.results[].orderDisplayLabel` / `statusText` / `status` | `orderDisplayLabel` | string | 状态展示文本；缺省展示为 `新订` |
| `data.results[].status` / `statusText` / `orderDisplayLabel` | `status` / `orderDisplayLabel` | string | 取消状态不作为渠道实体 RawMeituanDutyOrder 静态字段，而是由纯函数 isMeituanCancelOrder() 以 `status === 'CANCELED'` 为**唯一判定标准**（依据真实取消样本 tests/fixtures/meituanCancelDetail.json；label/statusText 取消文案与 CANCEL/CANCEL_ORDER/CUSTOMER_CANCEL 等未经验证枚举启发式已弃用），并在生成中台通用概要 DutyUnhandledOrderSummary 时赋予其 cancelOrder |

#### 列表 Envelope Fail-Fast 契约
`resolveMeituanOrderItems()` 只接受订单数组、根级已知列表字段或 `data` 内已知列表字段。以下情况必须抛出 `LIST_BUSINESS_FAILED` 且 `retryable=false`，不得伪装为“成功采集 0 笔”：

1. 响应文本不是合法 JSON（由 `MeituanListCollector` 判定）；
2. Payload 不是数组且不是 JSON 对象；
3. `code` 字段存在且不等于 `0`；
4. `data` 存在但不是对象；
5. 已识别到的列表字段不是数组；
6. `data` 或根级缺少全部已知列表字段（`data` 支持 `results/list/orders/orderList/items`，根级支持 `results/orders/list`）。

#### 订单提取与业务分层过滤契约 (两阶段流水线)

失败模型分三层，爆炸半径从严到宽：

| 层 | 机制 | 语义 |
| :--- | :--- | :--- |
| 响应级 | `DutyExecutionError`（抛出，本轮作废） | 信封不可信（code≠0/非 JSON/结构损坏）——整体 abort，绝不降级为「空列表成功」 |
| 条目提取级 | `MeituanOrderExtractionAnomaly`（跳过+WARN） | 信封合法但个别条目坏——跳过该条，其余订单照常处理 |
| 条目业务级 | `OrderFilterResult` rejected（跳过+WARN） | 非错误，业务拦截决策（改签/TMC）——系统行为正确 |

系统严格采用「先提取为数据源，再执行业务过滤」的两阶段流水线：

##### 阶段一：数据提取解析 (Extractor / Data Source)
`extractMeituanOrdersFromPayload()` 负责将原始网络报文解析为标准订单实体 `RawMeituanDutyOrder[]`：
- 订单号约定为 string 类型：直取 `orderId` 原始值（仅空白规整），非字符串或空白即契约违规，归因为提取解析异常；
- `status` 为取消/改签双判定的唯一标准，契约担保恒存在且为字符串（真实接口已确认）：非字符串或空白即条目级契约违规，归因为提取解析异常，绝不以占位值静默推进；
- 若原始条目为空、非对象或缺失有效 `orderId`，在此阶段归因为**提取解析异常 (Extraction Anomaly)**，并通过 `MEITUAN_ORDER_EXTRACTION_ANOMALY` / `WARN` 输出结构化日志，不进入下游业务过滤；
- 成功提取的订单作为纯净的数据源（包含确凿合法的 `orderId` 与规范化字段）输入阶段二。

##### 阶段二：业务规则过滤 (Order Filter)
`filterMeituanOrder()` 接收已提取出的订单实体，专注于业务维度的分流决策：

| `action` | 语义 |
| :--- | :--- |
| `ALLOW` | 允许进入自动化流水线处理（由下游消费方根据 `cancelOrder` 等状态分发执行） |
| `MANUAL_ATTENTION` | 关键分类字段契约异常，或识别为改签/改期订单，转后台人工核对 |
| `CHANNEL_MISMATCH` | 渠道分流拦截：商旅分流开启时，MEITUAN 工位跳过 TMC 订单 / MEITUANBIZ 工位跳过非 TMC 订单（见下方商旅分流开关） |

- 业务过滤跳过的记录输出 `MEITUAN_ORDER_FILTER_SKIPPED` / `WARN`，包含 `orderNo`、`meta.action`、`meta.orderType`、`meta.reason` 与 `meta.evidence`。
- `evidence` 保留人工在美团后台核对必需的客人姓名 (`guestName`)、房型 (`roomName`) 及命中规则的特征实际值，拒绝过度技术脱敏，为前台运营排查提供清晰可读的事实上下文。
- TMC 识别以 `reversePriceTmcOrderTag` 非空为**唯一判定标准**（企业名称 `enterpriseName`、协议标志 `signInboundTmcAgreement`、发票标志 `tmcInvoiceLabel`、标签文案等启发式已弃用）。
- 改签识别以列表实体 `status === 'RESCHEDULED'` 为**唯一判定标准**。依据真实改签样本（`tests/fixtures/meituanRescheduleDetail.json`）调研：改签单的 `orderDisplayLabel` 仍为「新订」、`originOrRescheduled` 为 100，文案与历史枚举启发式均不可靠，已弃用。

##### 过滤规则配置与表达式 DSL

过滤规则以 **单文件多渠道 JSON** 声明：顶层 `channels` 映射以规范渠道码（`MEITUAN` / `MEITUANBIZ`）为键，每个渠道节持有独立 `rules` 数组。运行时按数组顺序求值，首条命中即止并返回其 `action`；`enabled: false` 的规则跳过；全部未命中则 `ALLOW`。规则字段：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | string | 规则唯一标识 |
| `name` | string | 人类可读规则名（可选） |
| `condition` | string | 表达式，对订单实体字段求值 |
| `action` | `MANUAL_ATTENTION` \| `CHANNEL_MISMATCH` | 命中后的处置动作 |
| `orderType` | `RESCHEDULED` \| `TMC` | 命中归因分类（可选） |
| `reason` | string | 人类可读跳过原因，支持 `{{orderId}}` 占位符 |
| `enabled` | boolean | 置 `false` 时禁用该规则（可选，默认启用） |

`condition` 表达式 DSL（由 `src/utils/template/evaluator.ts` 纯 AST 求值，零 eval / new Function）：

| 运算符 | 语义 |
| :--- | :--- |
| `==` / `!=` | 宽松相等（一侧为数字、另一侧为可转数字的字符串时先转换再比对） |
| `===` / `!==` | 严格相等 |
| `>` `>=` `<` `<=` | 数值比较 |
| `contains` | 左侧为字符串时右侧必须为字符串（包含判断）；左侧为数组时任一元素字符串化后包含。注意 `contains` 为保留关键字，无法引用同名数据字段 |
| `=~` | 左侧字符串匹配右侧正则字面量；任一操作数非字符串时视为不匹配（不报错）；正则字面量非法时求值异常，阻断并转 `MANUAL_ATTENTION`，绝不静默放行 |
| `&&` `||` `!` | 逻辑与 / 或 / 非 |

- 标识符即订单实体字段点路径（如 `totalAmount`、`originOrRescheduled`），支持通配符数组投影 `tags.*.title`；
- 路径内支持多候选回退 `a.b || a.c`（取首个非空）；
- 字面量：单/双引号字符串、数字、`true`/`false`、`null`/`undefined`。

规则文件优先级与 Fail-Fast 约束：

1. `<userDataDir>/filter-rules/meituan.json`（运营侧持久化定制，**承载全部渠道节**；保存为读-改-写，仅替换目标渠道节、其余渠道节原样保留；每轮采集前重载，修改后下一轮即生效）；
2. 随包默认 `meituanFilterRules.json`（仅当持久化文件不存在时启用，首启场景）；
3. 持久化文件存在但读取/解析失败或结构无效（顶层缺 `channels` 映射或渠道节缺 `rules` 数组，含旧单渠道格式）时，立即抛出含文件路径的异常中断本轮采集，绝不静默回退默认规则；请求渠道节缺失同样 Fail-Fast，绝不回退其他渠道。

##### 商旅分流开关（按映射存在性决定过滤行为）

过滤行为以**用户是否配置了有效 `MEITUANBIZ` 渠道映射**为唯一事实源（运行时开关，非规则文件内容）：

- **未配置商旅映射**：MEITUAN 渠道在配置解析时**剥离全部 `orderType === 'TMC'` 规则**（含运营自定义 TMC 规则），TMC 订单照常 ALLOW 走散客渠道，杜绝无人承接的丢单；改签 (`RESCHEDULED`) 安全规则与渠道分流无关，始终保留；MEITUANBIZ 渠道不受开关影响（未配置映射时其值守无从启动）。
- **配置了商旅映射**：双侧互斥分流（MEITUAN 拒 TMC、MEITUANBIZ 拒非 TMC）。
- 同步链路：启动值守时强制同步；映射拉取/保存时 best-effort 即时推送。机制详见架构文档 §3.7/§3.8。

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
- **并发与时序安全**：执行层（[`meituanDetailInspector.ts`](../../../src/crawler/duty/channels/meituan/meituanDetailInspector.ts)）采用**先注册网络监听器、后触发卡片点击**的刚性时序，并在获取 Payload 后二次比对 `payloadOrderId === otaOrderId`，防范网络竞态。

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

- **提交方式**：基于订单详情头部「接受」按钮与弹窗内表单提交（由 [`meituanActionExecutor.ts`](../../../src/crawler/duty/channels/meituan/meituanActionExecutor.ts) 驱动）。
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

