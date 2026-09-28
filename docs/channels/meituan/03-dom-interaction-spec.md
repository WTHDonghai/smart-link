# 美团（MEITUAN）页面 DOM 拓扑与自动化交互规范

> **渠道代号**：`MEITUAN`  
> **商户系统**：美团商家中心 (E-booking)  
> **执行器架构**：
> - 统一门面：[`src/crawler/duty/channels/meituan/meituanDutyRunner.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanDutyRunner.ts) (继承 `BaseChannelDutyRunner`)
> - 领域子模块：
>   - 作用域与卡片定位：[`src/crawler/duty/channels/meituan/meituanCardLocator.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanCardLocator.ts)
>   - 列表流转与防抖：[`src/crawler/duty/channels/meituan/meituanListCollector.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanListCollector.ts)
>   - 详情嗅探与网络拦截：[`src/crawler/duty/channels/meituan/meituanDetailInspector.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanDetailInspector.ts)
>   - 接单与取消执行：[`src/crawler/duty/channels/meituan/meituanActionExecutor.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanActionExecutor.ts)
>   - 风控与弹窗防护：[`src/crawler/duty/channels/meituan/meituanRiskGuard.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanRiskGuard.ts), [`src/crawler/duty/channels/meituan/meituanModalGuard.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanModalGuard.ts)  
> > **核心原则**：基于真实生产环境 DOM 结构实测取证，坚决杜绝“脱离真实 DOM 的盲目脑补”。


---

## 1. 页面整体拓扑与分栏架构 (Layout Topology)

### 1.1 容器与微前端宿主
- **顶层宿主页面**：美团商家中心主框架 (`https://eb.meituan.com/`)
- **Iframe 业务容器**：`#me-iframe-container`
  - 内部加载 E-booking 订单中心页面：
    `https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Forder-gx%2Findex.html%23%2Funhandled`
- **乾坤子应用**：`order-gx` (基于 Vue 2.x + 美团 MTD 组件库)
- **主要内容区域**：`#op-ebhigh-content.content-container`

### 1.2 左右分栏联动体系 (Master-Detail Layout)
页面交互**绝非模态弹窗（Modal Dialog）**，而是标准的**左右分栏 Master-Detail 联动**：
- **左侧列表区（Master）**：流式展示待处理订单卡片（`.mtd-list-item.list-item-container`）；
- **右侧详情区（Detail）**：展示当前激活订单的详情面板（`.detail-container`），包含头部操作栏（`.detail-header`）与详情信息区；
- **联动行为**：点击左侧卡片，右侧详情面板即刻刷新渲染，并向美团后端异步触发详情请求。

### 1.3 微前端与 Iframe 作用域穿透 (`getMeituanOrderScope`)
- 由 [`meituanCardLocator.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanCardLocator.ts) 统一提供 `getMeituanOrderScope(page: Page): Page | FrameLocator`；
- **探测逻辑**：自动探测顶层页面中是否存在有效 `#me-iframe-container` 或 `iframe[src*="ebooking"]`；若存在且内部已有订单容器，返回子 FrameLocator，否则回退为顶层 Page；
- 所有子模块（定位、列表、详情、执行）统一以此 Scope 进行元素检索，保障在不同宿主嵌套层级下的穿透鲁棒性。

---

## 2. 列表刷新与 Tab 切换交互 (List Refresh & Tab Switching)

### 2.1 业务痛点
美团商家后台页面上**不存在单独的“一键刷新列表”按钮**。要获取最新待处理订单，必须通过 Tab 切换触发列表网络请求重新加载。由 [`meituanListCollector.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanListCollector.ts) 独立负责。

### 2.2 真实交互状态机与网络屏障 (Lifecycle Barrier)
```text
[停留在 待确认 Tab] ──► 1. 点击「全部订单」Tab ──► 2. 等待全部订单接口 (/orders/list) 响应
                                                             │
                                                  3. 断言全部订单激活态就绪
                                                             │
[待确认列表就绪] ◄── 5. 拦截待确认列表响应 ◄── 4. 点击「待确认/待处理」Tab
```

### 2.3 3 秒防抖高精度等待补偿
- 美团后端对频繁切换 Tab 有防抖限制；
- 模块通过 `performance.now()` 高精度时钟记录上次刷新成功的时间戳；
- 若距离上次列表刷新不足 3000ms，必须通过拟真延时 `await humanDelay(page, remaining, remaining + 300)` 动态补齐等待时间后再触发刷新；
- **刚性红线**：严禁在防抖期内直接返回空数组 `return []`，否则会把刚到达的真实新订单误判为无订单。

### 2.4 在途请求合并门禁 (Request Coalescing)
- 在进入单页面任务互斥锁之前，若检测到已有在途列表刷新任务（`inFlightListPromise`），直接复用该 Promise；
- 彻底避免外层轮询或并发任务造成重复触发 Tab 切换与网络请求风暴。


---

## 3. 严格控件定位选择器标准 (Strict Selectors)

### 3.1 订单列表与卡片定位 (`meituanCardLocator.ts`)
- **订单卡片容器**：
  ```css
  .mtd-list-item.list-item-container, .list-item-container, .list-item-wrap
  ```
- **核心事实：卡片自身即整体可点击项**：
  - 左侧卡片上**不存在独立的“详情”按钮**；
  - 只要使用 `visualClickLocator(page, orderCard)` 点击卡片本身，右侧详情即可同步加载；
  - 严禁寻找不存在的 `button:has-text("详情")`。
- **多阶梯定位算法 (`locateMeituanOrderCard`)**：
  1. **输入单号校验**：自动 `trim()` 清洗；若入参为空，抛出 `ORDER_CARD_NOT_FOUND` 立即短路，杜绝全表盲目匹配；
  2. **单号文本直搜**：查找 `.list-item-container:has-text("${cleanOrderId}")`；
  3. **右侧详情联动判定**：若右侧 `.detail-header` 已处于该订单上下文，直接复用当前激活态卡片（`.mtd-list-item-selected` 或 `.active`）；
  4. **唯一单快速命中**：若列表总计仅有 1 笔待处理订单，直接返回该卡片；
  5. **多单点击探查**：若列表中有多笔订单，依次点击候选卡片，检测右侧头部是否展示该单号，命中即返回；
  6. **严格 Fail-Fast 判定**：若上述探查均未匹配目标单号，严格返回 `null` 并抛出 `ORDER_CARD_NOT_FOUND`，坚决不进行任何无依据的首项或盲选兜底。

---

### 3.2 订单详情嗅探与敏感解密标准 (`meituanDetailInspector.ts`)

#### A. 详情拦截并发与时序安全准则
1. **先注册监听器，后点击卡片**：
   - 必须先完成 `page.waitForResponse(...)` 监听器的挂载，再触发卡片点击；
   - 严禁先点击后再异步挂载监听器，否则在快速网络环境下必然发生丢包超时；
2. **已激活卡片消除重复点击**：
   - 若右侧 `.detail-header` 已经展示目标订单号且网络已就绪，跳过卡片点击动作，避免多余网络重载与界面闪烁；
3. **单号强比对防串单防线**：
   - 获取详情 Payload 后，必须严格断言 `payloadOrderId === otaOrderId`；
   - 若单号不一致，抛出 `ORDER_ID_MISMATCH` 阻断，杜绝把相邻订单的数据保存入库。

#### B. 客人姓名解密
- **真实 DOM 结构**：
  ```html
  <p class="detail-info-item">
    <span class="info-key">客人姓名</span>
    <span class="info-content">
      <span class="guest-name">
        <span class="display-name">王***</span>
        <span class="btn-text" style="cursor: pointer;">查看姓名</span>
      </span>
    </span>
  </p>
  ```
- **精准定位器**：
  ```css
  .detail-info-item .guest-name .btn-text,
  .guest-name .btn-text,
  .display-name + .btn-text,
  p.detail-info-item:has(.info-key:has-text("客人姓名")) .btn-text
  ```
- **交互注意**：点击后无需二次确认弹窗，前端直接发起 `/sensitiveData` 异步请求。

#### C. 联系电话解密与智能避让
- **真实 DOM 结构**：
  ```html
  <p class="detail-info-item">
    <span class="info-key">联系客人</span>
    <span class="info-content">
      <a href="javascript:;">查看电话</a>
    </span>
  </p>
  ```
- **精准定位器**：
  ```css
  p.detail-info-item:has(.info-key:has-text("联系客人")) a,
  .detail-info-item:has(.info-key:has-text("联系客人")) a
  ```
- **智能避让**：通过纯函数 `hasPlainMobileNumber()` 严格校验；若姓名返回报文或详情中已包含 11 位有效明文手机号，**强制跳过点击此按钮**，规避双重解密风控。

---

### 3.3 接单与确认号回填标准 (`meituanActionExecutor.ts`)

#### A. 点击详情头部「接受」按钮
- **精准定位器**：
  ```css
  .detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受"),
  .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受")
  ```

#### B. 接单弹窗与确认号输入
- **弹窗限定**：必须限定在包含“酒店确认号”的 MTD 弹窗：
  ```css
  .mtd-modal-wrapper:not([style*="display: none"]) .modal-container:has-text("酒店确认号")
  ```
- **输入框定位**：
  ```css
  .modal-container-content div:has(span:has-text("酒店确认号")) input.mtd-input
  ```
- **四步严格录入规范**：
  1. **防覆盖校验**：读取当前输入框内容，若已有其他确认号，抛出 `CONFIRM_INPUT_ALREADY_FILLED` 立即终止防串单；
  2. **拟真打字录入**：使用 `pressSequentially()` 模拟真实键盘敲击录入；
  3. **读回二次校验**：录入后立即使用 `inputValue()` 读回比对，若不一致抛出 `CONFIRM_VALUE_MISMATCH` 阻断提交；
  4. **提交确认**：
     - 若为 `dryRun: true`（演练模式）：点击弹窗底部取消按钮安全退出，绝不提交；
     - 若为生产模式：点击 `.modal-container-footer button.mtd-btn.btn-item.mtd-btn-primary:has-text("确认接受")` 完成提交。

---

### 3.4 取消订单（我已知晓）交互规范 (`confirmCancel`)

- **业务场景**：对于客人已发起取消或平台已取消的订单，美团详情头部展示主要操作按钮「我已知晓」。
- **精准定位器**：
  ```css
  .detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓")
  ```
- **操作规范**：
  - 确认右侧头部单号匹配后，点击「我已知晓」按钮；
  - 若为 `dryRun: true`，仅完成定位与断言，不执行实际点击。

---

## 4. 非业务提示弹窗自动清理与模态穿透 (`meituanModalGuard.ts`)

- **非业务弹窗自动清理 (`dismissMeituanNoticeModals`)**：
  - 定位 `.mtd-modal-wrapper, .mtd-modal`；
  - **核心安全红线**：若弹窗文本包含“酒店确认号”或“确认接受”，**严禁关闭**（属于业务接单弹窗）；
  - 对非业务提示弹窗（如“虚拟号说明”、“服务须知”、“系统公告”），自动点击其右上角关闭图标或“我知道了”按钮清理。
- **模态遮挡穿透执行器 (`clickWithModalBypass`)**：
  - 当尝试点击目标控件时，若因弹窗遮挡引发点击超时或异常，自动触发一次 `dismissMeituanNoticeModals()` 清除非业务弹窗，然后自动重试点击，保障交互鲁棒性。

---

## 5. 自动化交互速查避坑表

| 场景 | 常见错误脑补 (Anti-Patterns) | 真实规范标准 (Correct Practice) |
| :--- | :--- | :--- |
| **触发详情** | 在卡片内寻找带有“详情”文本的按钮并报错找不到 | 卡片整体即为可点击项，直接点击卡片元素即可 |
| **时序控制** | 先点击卡片，再去调用 `waitForResponse` 监听详情 | **先注册监听器，再点击卡片**，规避高速网络丢包 |
| **重复点击** | 每次抓取都盲目点击卡片，引发多余请求 | 若详情面板已处于目标订单上下文，直接复用已激活状态 |
| **详情呈现** | 假设点击后弹出模态弹窗，并在接单后试图关闭弹窗 | 详情直接在右侧面板展示，无遮罩弹窗，无需关闭 |
| **串单防御** | 截获详情 URL 即认为成功，未比对 Payload 内部单号 | 必须严格断言 `payloadOrderId === otaOrderId`，不符立即阻断 |
| **确认号回填** | 在页面全局查找第一个 `input` 进行 `fill` | 必须严格限定在 `.modal-container:has-text("酒店确认号")` 内部输入并做读回比对 |
| **敏感解密** | 无论何种情况都连续点击“查看姓名”与“查看电话” | 智能跳过电话解密：若姓名报文中已带 11 位有效手机号，强制跳过电话点击，规避 Yoda 风控 |
| **提示弹窗干扰** | 遇到遮挡直接抛错超时 | 使用 `clickWithModalBypass` 自动识别并清理非业务通知弹窗后重试 |

