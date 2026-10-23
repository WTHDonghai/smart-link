# 抖音（DOUYIN）页面 DOM 拓扑与自动化交互规范

> **渠道代号**：`DOUYIN`  
> **核心原则**：杜绝脱离实际的伪脑补。必须基于真实后台现场取证，明确定位器、层级拓扑与操作避坑准则。  
> **组件库基线**：字节 `byted-design`（`byted-btn` / `byted-tab-bar` / `byted-popover-confirm` / `byted-modal` 等）。

---

## 1. 页面整体布局与容器拓扑 (Layout Topology)

### 1.1 容器与框架嵌套
- **顶层 Window**：`https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list?...`
- **Iframe / 微前端**：**无**。履约工作台运行于顶层 SPA 主文档，`getDouyinOrderScope(page)` 直接返回 `Page`。
- **页面骨架就绪锚点**：`#core-layout-outlet` / `.byted-tab-bar` / `#filterSection`，附加 3~8 秒冷启动沉淀缓冲。

### 1.2 页面布局模型
- ✅ **左右分栏联动 (Master-Detail)**：左侧订单卡片流，右侧详情面板 `#detailSection`，点击卡片刷新右侧详情。
- 列表顶部为 Tab 栏：「新订/变更」与「取消/退款」。

---

## 2. 列表刷新与 Tab 切换交互 (List Refresh Standard)

- **无独立「刷新」按钮**：标准刷新路径为**点击目标 Tab**（新订/变更 / 取消/退款）；**重复点击同一 Tab 亦可触发列表接口请求**。
- **防抖与等待补偿**：两次刷新之间存在平台防抖窗口，采集端做防抖等待补偿与在途请求合并（`DouyinListCollector`），严禁防抖期内直接返回空数组误报 `VERIFIED_EMPTY`。
- **网络屏障**：列表数据 100% 来源于 Tab 触发的列表接口响应拦截，DOM 仅用于 Tab 定位与点击。

---

## 3. 元素定位标准 (Strict Selectors)

> **注意**：禁止依赖随机哈希类名（如 `hideStroke-VRjAsE` 仅作图标旁证）与臆造 `:has-text()` 猜测卡片；卡片定位必须使用埋点属性 `data-form-insight-meta`。

| 目标控件 | 推荐选择器 (Selector) | 定位依据 | 交互动作 |
| :--- | :--- | :--- | :--- |
| **新订/变更 Tab** | `.byted-tab-bar-item:has-text("新订/变更")` | 生产 DOM 取证 | `click()` 触发列表接口 |
| **取消/退款 Tab** | `.byted-tab-bar-item:has-text("取消/退款")` | 生产 DOM 取证 | `click()` 触发列表接口 |
| **订单卡片** | `.hotel-book-list-order-card[data-form-insight-meta="<单号>"]`（备选 `aria-label`） | 单号仅存在于埋点属性，卡片文本不渲染单号 | `visualClickLocator()` 展开详情 |
| **详情面板容器** | `#detailSection` | 工作台详情区权威锚点 | 作用域限定 |
| **「一键复制」按钮** | `#detailSection button:has-text("一键复制")` | 详情区订单摘要复制入口（真实手机号通道触发器） | `visualClickLocator()` 触发 `get_secret_num` |
| ~~电话图标（虚拟号，已废弃）~~ | ~~`svg.hideStroke-*` / `svg path[d^="M4.385 7.368"]` / `[data-sub-type="SecretNumV2"] svg`~~ | 返回隐私虚拟号，通道已下线 | ❌ 禁止点击 |
| **接单按钮** | `button:has-text("接单")`（详情区，待接单状态） | 状态操作按钮 | `visualClickLocator()` 弹出气泡 |
| **「填写确认号」触发按钮** | `.byted-popper-trigger:has-text("填写确认号")`（必须含文案，防误匹配接单按钮） | 生产 DOM 取证 | `visualClickLocator()` 弹出气泡表单 |
| **确认号输入框** | `.byted-popover-confirm-container input.byted-input[placeholder*="确认号"]` | 气泡作用域内定位 | `pressSequentially()` 拟人输入 |
| **气泡确定/取消按钮** | `.byted-popover-confirm-container .byted-confirm-ok` / `.byted-confirm-cancel` | byted 气泡标准结构 | `visualClickLocator()` |
| **「我知道了」按钮** | `button:has-text("我知道了")`（取消单确认） | 真实 DOM 确定性文案 | `visualClickLocator()` |
| **已填确认号状态** | `#detailSection .max-w-\[200px\]` | 幂等核对与防串单 | `innerText()` 比对 |

---

## 4. 「一键复制」与真实手机号获取（生产通道）⭐

### 4.1 按钮真实 DOM 参考
```html
<button type="button"
        class="byted-btn byted-btn-size-md byted-btn-type-primary byted-btn-shape-angle byted-btn-plain byted-btn-text byted-can-input-grouped flex items-center gap-[4px] bg-transparent flex-shrink-0"
        elementtiming="element-timing">
  <svg ...><!-- 复制图标 --></svg> 一键复制
</button>
```

### 4.2 交互时序与契约
1. **作用域必须限定 `#detailSection`**：防止误点列表卡片或其他区域的复制控件；
2. 按钮不可见（订单类型无此入口）→ 记录 warn「无一键复制入口」，联系电话按空值策略置空（见 [02 §4.4](./02-order-api-spec.md)）；
3. **监听前置**：先注册 `get_secret_num` 响应收集循环，再点击按钮；
4. 实测点击后接口**连续调用两次、仅一次携带手机号**（首次 `secret_nums` 可为空）→ 循环丢弃空响应继续等待；
5. 每个响应先过风控断言再提取；提取规则 `/^1[3-9]\d{9}$/`（真实号判定详见 [02 §4.3](./02-order-api-spec.md)）。

### 4.3 附带副作用
点击「一键复制」会同时将订单摘要写入系统剪贴板（内容含真实手机号、订单号、预约单号，格式见 [`samples/copy-button-clipboard-text.txt`](./samples/copy-button-clipboard-text.txt)）。值守机器剪贴板被覆盖属可接受副作用；**生产数据源为接口拦截，禁止改用剪贴板读取**（权限/焦点/残留数据串单风险）。

---

## 5. 接单与确认号回填交互 (Confirm Import)

**四步硬规范（防串单核心）**：

1. **激活详情**：点击订单卡片展开详情；若处于「待接单」状态，先点「接单」→ 气泡内点「确定」完成接单，轮询等待「填写确认号」按钮出现（列表重绘失焦时重新激活卡片）；
2. **幂等核对**：检查 `#detailSection .max-w-\[200px\]` 已填确认号——相同则跳过；**不同则立即阻断**（`CONFIRM_INPUT_ALREADY_FILLED`），严禁覆盖；
3. **气泡表单录入**：在 `.byted-popover-confirm-container` 作用域内定位输入框，`pressSequentially()` 逐字拟人输入，**读回校验**不一致立即阻断（`CONFIRM_VALUE_MISMATCH`）；
4. **提交**：点击 `.byted-confirm-ok` 提交；安全演练模式（`dryRun`）则点 `.byted-confirm-cancel` 或 `Escape` 安全关闭，杜绝真实提交。

---

## 6. 取消订单确认交互 (Confirm Cancel)

1. 以「取消/退款」Tab 刷新并定位目标卡片，点击展开详情；
2. 状态断言：详情状态文本必须属于已取消/已退款集合；命中「待接单/已确认/已接待/待处理」等活跃状态立即阻断（`ORDER_STATUS_NOT_MATCHED`）；
3. 点击详情区确定性文案按钮**「我知道了」**完成取消确认。

---

## 7. 风控防卫与弹窗清理 (Risk Guard & Modal Guard)

- **风控断言**：页面内容与接口报文双重探测（`douyinRiskGuard`），命中 `安全验证`/`访问频繁` 等特征立即抛 `RISK_VERIFICATION_REQUIRED` 并保留风险证据（脱敏摘要 + 命中字段路径）；
- **通知弹窗清理**：`douyinModalGuard` 自动关闭常规通知浮层（公告、引导等），**必须避开接单/确认号等业务气泡**，严禁误关业务确认框；
- **真实操作完成后整页刷新**：确认号回填与取消确认执行完毕后主动 `page.reload()` 清理 Detached DOM 与 V8 堆内存，并重新走页面就绪门禁。

---

## 8. 自动化交互避坑与错误脑补清单 (Pitfalls & Anti-Patterns)

| 场景 | 常见错误脑补 (Anti-Patterns) | 真实 DOM/契约规范标准 (Truth) |
| :--- | :--- | :--- |
| **详情触发** | 寻找独立「详情」按钮等待超时 | 卡片根节点 `.hotel-book-list-order-card` 整体 `cursor-pointer`，点击卡片任意区域即展开详情 |
| **卡片定位** | 用卡片可见文本/单号 `:has-text()` 猜测 | 卡片文本**不渲染单号**；单号仅在 `data-form-insight-meta` 埋点属性与 `aria-label` |
| **手机号获取** | 点击电话图标拦截 `get_secret_num` 当作联系电话 | 图标通道返回**隐私虚拟号**（`转` 分机）；必须走「一键复制」触发，且接口连续两次调用仅一次有值，需循环收集 |
| **手机号兜底** | 拿不到真实号时用脱敏号/虚拟号填充 | **置空**：真实号用于联系/溯源/统计，宁缺毋滥（Fail-Fast） |
| **详情响应竞态** | 捕获首个详情响应即使用 | 列表刷新/预取会产生非目标单响应；必须**丢弃非目标响应继续等待**目标单号命中 |
| **确认号回填** | 定位全局唯一 input 直接 fill | 必须气泡作用域内定位；先幂等核对已填值，逐字输入后读回校验 |
| **接单确认按钮误判** | 用 `.byted-confirm` 容器裸匹配「填写确认号」 | 接单气泡同样使用 `.byted-confirm` 包裹；触发按钮选择器**必须包含文案** |
| **业务数据采集** | `page.innerText()` 抓取页面文本拼接字段 | 业务数据 100% 来源于网络接口 JSON 响应；DOM 仅用于点击与可见性断言 |
