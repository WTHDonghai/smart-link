# [渠道名称] 页面 DOM 拓扑与自动化交互规范

> **渠道代号**：`[CHANNEL_CODE]`  
> **核心原则**：杜绝脱离实际的伪脑补。必须基于真实后台现场取证，明确定位器、层级拓扑与操作避坑准则。

---

## 1. 页面整体布局与容器拓扑 (Layout Topology)

### 1.1 容器与框架嵌套
- **顶层 Window**：`https://...`
- **Iframe / Shadow DOM**：是否存在 Iframe 嵌套？（记录容器选择器，如 `#main-iframe`）
- **微前端架构**：是否存在微前端沙箱（如乾坤、MicroApp）？

### 1.2 页面布局模型
- **布局形式**：
  - [ ] **左右分栏联动 (Master-Detail)**：左侧卡片列表，右侧详情面板，点击卡片刷新详情。
  - [ ] **传统表格列式 (Table Grid)**：每行为一个订单，操作列包含“查看”、“接单”按钮。
  - [ ] **流式卡片内联 (Card Flow)**：卡片内直接展示全部信息或内联折叠展开。
  - [ ] **弹窗模态 (Modal Dialog)**：点击弹出覆盖全屏的详情对话框。

---

## 2. 列表刷新与 Tab 切换交互 (List Refresh Standard)

### 2.1 触发机制
- **是否存在“刷新列表”按钮**：[ ] 是 / [ ] 否
- **无刷新按钮时的标准交互路径**：
  例如：通过切换至其他 Tab（如“全部订单”）再切回“待处理订单”触发网络请求。

### 2.2 防抖与等待补偿
- **平台防抖机制**：若距离上次刷新不足冷却时间，必须调用 `humanDelay` 补齐等待时间。
- **严禁行为**：**严禁在防抖期内直接返回空数组 `return []`**，避免误报为无新单。

---

## 3. 元素定位标准 (Strict Selectors)

> **注意**：禁止依赖不稳定的随机哈希属性（如 `data-v-a77413d6`），必须采用具有明确语义的稳定属性与层级结构。

| 目标控件 | 推荐选择器 (Selector) | 备选定位策略 | 交互动作 |
| :--- | :--- | :--- | :--- |
| **待处理订单 Tab** | `.tab-container .tab-item:has-text("待处理")` | 属性匹配 | `click()` |
| **订单卡片/行容器** | `.order-card-container` | `.list-item-wrap` | `click()` (激活详情) |
| **姓名解密按钮** | `.guest-name .btn-text:has-text("查看姓名")` | 结构级邻近匹配 | `visualClickLocator()` |
| **电话解密按钮** | `.detail-info-item:has(.info-key:has-text("联系客人")) a` | 按钮类名 | `visualClickLocator()` |
| **接单按钮** | `button.op-btn-primary:has-text("接受")` | 详情头部定位 | `visualClickLocator()` |
| **确认号输入框** | `.modal-container:has-text("确认号") input` | 弹窗作用域内查找 | `pressSequentially()` |
| **确认提交按钮** | `.modal-container button:has-text("确认接受")` | 弹窗底部定位 | `visualClickLocator()` |

---

## 4. 自动化交互避坑与错误脑补清单 (Pitfalls & Anti-Patterns)

| 场景 | 常见错误脑补 (Anti-Patterns) | 真实 DOM 规范标准 (Truth) |
| :--- | :--- | :--- |
| **详情触发** | 盲目寻找独立的“详情”按钮并等待超时 | 列表卡片本身即为整体可点击项，直接点击卡片即可刷新详情 |
| **输入框防串单** | 定位全局唯一的 `input` 盲目填入确认号 | 必须严格限制在接单弹窗作用域内，检查是否已有旧单号，填入后必须读回校验 |
| **非业务提示弹窗** | 被平台“虚拟号说明”、“系统公告”遮挡导致点击失败 | 编写独立的自动清理探针，自动关闭提示弹窗，同时必须避开接单确认业务弹窗 |
| **数据采集** | 使用 Playwright `page.innerText()` 抓取页面文本拼接 | 业务数据 100% 来源于网络接口 JSON 响应，DOM 仅用于点击和状态断言 |
