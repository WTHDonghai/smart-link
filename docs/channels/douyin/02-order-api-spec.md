# 抖音（DOUYIN）订单网络接口与契约规范

> **渠道代号**：`DOUYIN`  
> **核心原则**：权威网络响应为唯一数据源 (Network Authority)，DOM 仅作控件定位与断言，严禁 DOM 文本拼接业务数据。

---

## 1. 接口拓扑与业务时序

```text
[进入酒店履约工作台]
       │
       ▼
1. 列表接口（新订/变更 Tab 或 取消/退款 Tab，点击 Tab 触发）
       │  捕获 JSON ──► extractDouyinOrdersFromPayload（root.data.data 为序列化 JSON 字符串数组）
       │                      │
       ▼ (遍历待处理订单)      │ (提取 orderId)
2. 页面点击订单卡片 ──────► 3. 详情接口 (book/query/detail，监听前置 + 目标单号循环匹配)
                                   │
                                   ▼
              4. 点击详情区「一键复制」──► get_secret_num 接口（可被调用多次）
                                   │        └─► 循环收集响应，提取真实手机号
                                   ▼
                    5. 接单（气泡二次确认）＋「填写确认号」回填（气泡表单提交）
```

- **列表与详情接口响应外层结构一致**：业务数据在 `data.data` 中以**独立序列化的 JSON 字符串**承载（抖音接口特色，解析层必须二次反序列化）。
- **业务状态码双写**：`status_code`（新风格）与 `BaseResp.StatusCode`（旧风格）同时存在，任一非 0 即业务失败（Fail-Fast）。

---

## 2. 订单列表接口 (Order List API)

### 2.1 新订/变更订单列表
- **接口路径**：`/life/trade_view/v1/workbench/book/query/list`
- **请求方式**：`POST`（注意过滤 `OPTIONS` 预检）
- **触发时机**：进入页面初始加载、点击「新订/变更」Tab（重复点击同一 Tab 亦可触发刷新）
- **样例报文**：[`samples/book-order-list-response.json`](./samples/book-order-list-response.json)

### 2.2 取消/退款订单列表
- **接口路径**：`/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list`
- **请求方式**：`POST`
- **触发时机**：点击「取消/退款」Tab
- **样例报文**：[`samples/refund-order-list-response.json`](./samples/refund-order-list-response.json)

### 2.3 列表字段清洗映射表

对 `root.data.data[]` 反序列化后的单条订单实体：

| 渠道原始字段路径 | 目标字段 (`RawDouyinDutyOrder`) | 类型 | 清洗与转换规则 |
| :--- | :--- | :--- | :--- |
| `order_base_info.order_id` | `mainOrderId` | string | 交易主单号（「订单编号」） |
| `book_detail_info.book_order_id` | `bookId` | string | 预约单号（界面展示值，优先于 `book_id`） |
| `book_detail_info.book_id` | `bookId` 兜底 | string | 预约实例底层主键 |
| `after_sale_info_v2.after_sale_info.after_sale_id` | `afterSaleId` | string | 存在即取消/退款单 |
| `play_methods_v2.is_hotel_presale` | `isVoucher` | boolean | 权威预售券标识（`=== true`） |
| `book_detail_info.poi_life_account_id` | `hotelId` | string | 门店生活服务账号 ID |
| `book_detail_info.hotel_name` | `hotelName` | string | 门店名称 |
| `status_info_v2.title` | `orderDisplayLabel` | string | 状态展示文本（新订/已取消等） |
| `order_base_info.pay_time` | `orderTime` | string | 秒级时间戳 → `YYYY-MM-DD HH:mm:ss` |
| `book_detail_info.book_start_time` / `book_end_time` | `checkInDate` / `checkOutDate` | string | 秒级时间戳 → `YYYY-MM-DD` |
| `book_detail_info.book_night_count` | `nights` | number | 间夜数 |
| `book_detail_info.book_room_count` | `quantity` | number | 预订间数（缺省 1） |
| `amount_info.pay_amount`（正常单）<br>`after_sale_info.refund_amount`（取消单） | `totalAmount` | number | **分 → 元**（`/100` 浮点收敛） |
| `guest_info.user_list[*].name` / `.phone` | `contacts[]` | Array | 电话为脱敏形态（`*******3150`），真实号获取见 §4 |
| `sale_product_info.physical_room_name` | `roomName` | string | 物理房型名 |
| `sale_product_info.product_name` / `.product_id` | `productName` / `productId` | string | 售卖商品（SKU）维度信息 |
| `meta_data.view_type === 'hotel_after_sale'` 等 | `cancelOrder` | boolean | 多信号合并判定取消单 |

**唯一订单编号规则**：条目携带预约单号 `book_order_id` 时一律以**预约单号**为唯一订单编号（即工作台卡片埋点键与中台复查核验单号）；无预约单号的日历房条目回退交易单号 `order_id`；两者均无的条目直接丢弃。**严禁**依赖 `play_methods_v2.is_hotel_presale` 券判定切换单号（生产事故 2026-10-23：列表报文缺失该字段时误报订单编号，下游卡片定位 `ORDER_CARD_NOT_FOUND`）；券判定仅作 `isVoucher` 遥测字段保留。

### 2.4 抖音三单号体系（领域知识）

| 字段 | 商家后台显示名称 | 角色 | 说明 |
| :--- | :--- | :--- | :--- |
| `order_base_info.order_id` | 「订单编号」 | 交易/支付单号（电商层，管钱） | 付款时间、实付金额等资金流信息 |
| `book_detail_info.book_order_id` | 「预约单号」 | 履约业务单号（酒旅层，管住） | 一张预售券可多次预约，每次产生新预约单号 |
| `book_detail_info.book_id` | -（不展示） | 预约实例主键（底层） | 抖音数据库预约记录全局主键，日历房/套餐直接以此标识 |

---

## 3. 订单详情接口 (Order Detail API)

- **接口路径**：`/life/trade_view/v1/workbench/book/query/detail`
- **请求方式**：`POST`（过滤 `OPTIONS` 预检）
- **触发时机**：点击订单卡片展开详情抽屉
- **响应结构**：`data.data` 为**序列化 JSON 字符串**（单条订单全量实体）；另含 `dito_data.dito_schema` / `dito_data.meta_data`（页面渲染 DSL，含 `SecretNumV2` 组件的密文与 `requestScene`，仅作旁证，不作物源）
- **样例报文**：[`samples/order-detail-response.json`](./samples/order-detail-response.json)

### 3.1 详情字段权威性校验 (Fail-Fast)
1. HTTP 状态码必须 `200`；
2. 业务状态码 `status_code === 0`（缺失或非 0 立即阻断）；
3. **响应体必须包含目标订单单号**（防串单核心断言）；
4. 监听前置（先 `waitForResponse` 再点击卡片，消除迟到竞态）；
5. **非目标单号响应必须丢弃并继续等待**：工作台列表刷新/后台预取会产生其他订单的在途详情响应，循环等待直到命中目标单号或预算耗尽（超时为可重试错误，交由中台重派）。

---

## 4. 联系电话获取机制（get_secret_num 双语义）⭐ 核心调研成果

> **产品决策**：手机号用于联系客人、订单溯源与统计，**全链路不脱敏**；获取不到真实号时**置空**，绝不使用脱敏号、绝不使用虚拟号。

### 4.1 报文脱敏现状
- 详情报文中 `guest_info.user_list[*].phone` 为脱敏形态（如 `*******3150`），同结构 `phone_ciphertext` 为加密密文；
- 页面提供两条还原通路，**同一接口、不同触发入口、返回语义完全不同**：

| 触发入口 | 返回内容 | `show_type` | 生产策略 |
| :--- | :--- | :---: | :--- |
| 电话图标（`SecretNumV2` 组件） | **隐私虚拟号**：`15782987061转3308`（带 `转` 分机） | `1` | ❌ **已废弃**：无法满足联系/溯源/统计诉求，通道整体下线 |
| 详情区「一键复制」按钮 | **真实手机号**：`18082151396`（纯 11 位） | `2` | ✅ **生产通道** |

- **接口路径**：`/life/trade_view/v1/common/get_secret_num?root_life_account_id=...&life_biz_view_id=22&life_account_biz_ids=`
- **样例报文**：
  - 虚拟号（图标触发，已废弃）：[`samples/get-secret-num-virtual-response.json`](./samples/get-secret-num-virtual-response.json)
  - 真实号（一键复制触发，生产通道）：[`samples/get-secret-num-real-phone-response.json`](./samples/get-secret-num-real-phone-response.json)

### 4.2 标准采集时序（真实手机号）
1. 详情权威报文捕获完成后，在 `#detailSection` 内定位「一键复制」按钮；
2. **监听前置**：先启动 `get_secret_num` 响应收集循环，再拟人化点击（消除迟到竞态）；
3. **循环收集**：实测点击后该接口**会被连续调用两次，仅一次携带手机号信息**（首次响应 `secret_nums` 可能为空）——必须丢弃空响应继续等待，直到提取到真实号或预算耗尽；
4. 每个到达响应先过风控断言（命中验证特征立即阻断），再尝试提取；
5. 提取成功后回写：详情根级 `decryptedPhone` + `guest_info.user_list[0].phone` + `guest_info.buyer.phone` + 嵌套 `data.data` 字符串同步回写。

### 4.3 真实号判定规则（纯函数契约）
- 仅接受**纯大陆手机号格式**：`/^1[3-9]\d{9}$/`；
- 虚拟号天然携带 `转xxxx` 分机后缀，被格式校验天然排除；
- 混合条目（`secret_nums` 多密文并存，虚拟条目在前）必须**跳过虚拟取真实**；
- 状态码非 0、结构非法、无合格条目 → 返回 `null`（Fail-Fast，不做任何兜底填充）。

### 4.4 空值与融合策略（协议层）
```text
if (详情携带 decryptedPhone)        → guestPhone = decryptedPhone（真实号优先）
else if (guestPhone 为空或含 '*')    → guestPhone = ''（置空：不用脱敏号、不用虚拟号）
```

### 4.5 调研旁证：「一键复制」剪贴板文本
点击「一键复制」同时会把订单摘要写入系统剪贴板（格式见 [`samples/copy-button-clipboard-text.txt`](./samples/copy-button-clipboard-text.txt)），其中 `手机号 18082151396` 即真实号。**生产实现采用接口拦截而非剪贴板读取**（无剪贴板权限/焦点依赖、无残留数据串单风险）；剪贴板文本作为同源旁证留存。

---

## 5. 接单与确认号回填 (Order Confirmation)

- **提交方式**：**纯 DOM 驱动**（气泡确认框内表单提交，无独立的权威网络契约消费；操作规范见 [`03-dom-interaction-spec.md`](./03-dom-interaction-spec.md) §5）。
- **防串单硬约束**：
  - 回填前校验订单已存在的确认号，不同值立即阻断（`CONFIRM_INPUT_ALREADY_FILLED`）；
  - 逐字拟人输入后**读回校验**，不一致立即阻断（`CONFIRM_VALUE_MISMATCH`）。

---

## 6. 渠道异常与错误代码字典 (`DouyinDutyErrorCode`)

| 错误代码 | 含义说明 | 是否可重试 (`retryable`) | 调度应对措施 |
| :--- | :--- | :---: | :--- |
| `TARGET_PAGE_NOT_READY` | 未处于抖音履约工作台页面 | `false` | 重新导航并校验当前 URL |
| `RISK_VERIFICATION_REQUIRED` | 命中人机滑块/安全验证 | `false` | 暂停自动化，桌面通知人工介入 |
| `LIST_TRIGGER_UNAVAILABLE` | 列表刷新 Tab 不可用 | `false` | 检查页面就绪状态 |
| `LIST_RESPONSE_TIMEOUT` | 列表网络响应超时 | `true` | 可重试 |
| `LIST_HTTP_ERROR` | 列表请求返回非 200 | `false` | 记录诊断证据 |
| `LIST_BUSINESS_FAILED` | 列表接口业务状态码失败 | `false` | 记录业务码与 `status_msg` |
| `ORDER_CARD_NOT_FOUND` | 列表中未找到目标订单卡片 | `false` | 刷新列表二次查找，仍无则上报 |
| `ORDER_DETAIL_TIMEOUT` | 详情网络拦截超时（含非目标响应丢弃后预算耗尽） | `true` | 可重试，交由中台重派自愈 |
| `ORDER_DETAIL_HTTP_ERROR` | 详情接口返回非 200 | `false` | 记录诊断证据 |
| `ORDER_DETAIL_FIELD_MISSING` | 详情关键业务字段缺失/解析失败 | `false` | 保留原始报文溯源 |
| `GUEST_NAME_DECRYPT_FAILED` | 客人姓名解密失败 | `false` | 上报人工核对 |
| `CONFIRM_INPUT_NOT_FOUND` | 未找到确认号输入框/气泡 | `false` | 检查页面状态 |
| `CONFIRM_INPUT_ALREADY_FILLED` | 输入框已存在不同确认号 | `false` | 阻断防串单，人工核对 |
| `CONFIRM_VALUE_MISMATCH` | 确认号填入读回比对不一致 | `false` | 阻断防串单 |
| `CONFIRM_SUBMIT_NOT_FOUND` | 未找到确认提交/触发按钮 | `false` | 检查订单状态 |
| `CONFIRM_RESPONSE_TIMEOUT` | 确认接口网络响应超时 | `true` | 可重试 |
| `CONFIRM_RESULT_UNVERIFIED` | 确认接口返回失败或未通过校验 | `false` | 记录诊断证据 |
| `ORDER_STATUS_NOT_MATCHED` | 订单状态不匹配/不可操作 | `false` | 上报人工核对 |
| `ACCEPT_ORDER_FAILED` | 接单确认操作失败 | `false` | 记录诊断证据 |
