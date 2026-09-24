# 美团（MEITUAN）页面 DOM 拓扑与自动化交互规范

> **渠道代号**：`MEITUAN`  
> **商户系统**：美团商家中心 (E-booking)  
> **执行器实现**：[`src/crawler/duty/meituanDutyRunner.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/meituanDutyRunner.ts)  
> **核心原则**：基于真实生产环境 DOM 结构实测取证，坚决杜绝“脱离真实 DOM 的盲目脑补”。

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

---

## 2. 列表刷新与 Tab 切换交互 (List Refresh & Tab Switching)

### 2.1 业务痛点
美团商家后台页面上**不存在单独的“一键刷新列表”按钮**。要获取最新待处理订单，必须通过 Tab 切换触发列表网络请求重新加载。

### 2.2 真实交互状态机与网络屏障 (Lifecycle Barrier)
```text
[停留在 待确认 Tab] ──► 1. 点击「全部订单」Tab ──► 2. 等待全部订单接口 (/orders/list) 响应
                                                             │
                                                  3. 断言全部订单激活态就绪
                                                             │
[待确认列表就绪] ◄── 5. 拦截待确认列表响应 ◄── 4. 点击「待确认/待处理」Tab
```

### 2.3 3 秒防抖等待补偿
- 美团后端对频繁切换 Tab 有防抖限制；
- 若距离上次列表刷新不足 3000ms，必须通过拟真延时 `await humanDelay(page, remaining, remaining + 300)` 补齐等待时间后再触发刷新；
- **刚性红线**：严禁在防抖期内直接返回空数组 `return []`，否则会把刚到达的真实新订单误判为无订单。

---

## 3. 严格控件定位选择器标准 (Strict Selectors)

### 3.1 订单列表与卡片定位
- **订单卡片容器**：
  ```css
  .mtd-list-item.list-item-container, .list-item-container, .list-item-wrap
  ```
- **核心事实：卡片自身即整体可点击项**：
  - 左侧卡片上**不存在独立的“详情”按钮**；
  - 只要使用 `visualClickLocator(page, orderCard)` 点击卡片本身，右侧详情即可同步加载；
  - 严禁寻找不存在的 `button:has-text("详情")`。

---

### 3.2 敏感信息解密定位标准

#### A. 客人姓名解密
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

#### B. 联系电话解密
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
- **智能避让**：若点击查看姓名后返回的报文中已包含完整电话，**强制跳过点击此按钮**，规避双重解密风控。

---

### 3.3 接单与确认号回填标准

#### A. 点击详情头部「接受」按钮
- **真实 DOM 结构**：
  ```html
  <div class="detail-container">
    <div class="detail-header">
      <div class="header-container">
        <div class="btn-wrap">
          <div class="btn-container">
            <button type="button" class="mtd-btn op-btn mtd-btn-primary">
              <span> 接受 </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  ```
- **精准定位器**：
  ```css
  .detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受"),
  .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受")
  ```

#### B. 接单弹窗与确认号输入
- **弹窗识别**：必须限定在包含“酒店确认号”的 MTD 弹窗：
  ```css
  .mtd-modal-wrapper:not([style*="display: none"]) .modal-container:has-text("酒店确认号")
  ```
- **输入框定位**：
  ```css
  .modal-container-content div:has(span:has-text("酒店确认号")) input.mtd-input
  ```
- **录入操作规范**：
  1. 检查当前输入框内容，若已有其他确认号，立即终止防串单；
  2. 使用 `pressSequentially()` 模拟真实打字速度录入；
  3. 录入后立即使用 `inputValue()` 读回比对，若不一致则阻断抛错；
  4. 点击弹窗底部 `.modal-container-footer button.mtd-btn.btn-item.mtd-btn-primary:has-text("确认接受")` 完成接单。

---

## 4. 非业务提示弹窗自动清理机制 (`dismissMeituanNoticeModals`)

- **背景**：在操作过程中，美团后台经常弹出“联系客人（虚拟号说明）”、“服务须知”或“系统公告”等提示弹窗，遮挡页面操作控件；
- **清理规则**：
  - 定位 `.mtd-modal-wrapper, .mtd-modal`；
  - **核心安全红线**：若弹窗文本包含“酒店确认号”或“确认接受”，**严禁关闭**（属于业务接单弹窗）；
  - 对非业务提示弹窗，自动点击其右上角关闭图标或“我知道了”按钮清理。

---

## 5. 自动化交互速查避坑表

| 场景 | 常见错误脑补 (Anti-Patterns) | 真实规范标准 (Correct Practice) |
| :--- | :--- | :--- |
| **触发详情** | 在卡片内寻找带有“详情”文本的按钮并报错找不到 | 卡片整体即为可点击项，直接点击卡片元素即可 |
| **详情呈现** | 假设点击后弹出模态弹窗，并在接单后试图关闭弹窗 | 详情直接在右侧面板展示，无弹窗遮罩，无需关闭 |
| **确认号回填** | 在页面全局查找第一个 `input` 进行 `fill` | 必须严格限定在 `.modal-container:has-text("酒店确认号")` 内部输入并做读回比对 |
| **敏感解密** | 无论何种情况都连续点击“查看姓名”与“查看电话” | 智能跳过电话解密：若姓名报文中已带电话，强制跳过电话点击，规避 Yoda 风控 |
