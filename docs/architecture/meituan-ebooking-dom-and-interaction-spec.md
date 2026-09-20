# 美团商家后台（E-booking）DOM 结构与自动化交互参考规范

> 本文档基于真实生产环境美团商家后台（E-booking，包含微前端乾坤子应用 `order-gx` 及美团自研 UI 体系 MTD/Xigua）的现场实测取证与自动化工程反思总结编写。
> 详细记录了页面的真实 DOM 拓扑、各关键操作的控件定位标准、常见认知误区与避坑准则。后续对美团订单采集、详情抓取、确认号回填等模块进行代码维护、重构或演进时，必须以此规范为基准，杜绝“脱离真实 DOM 的盲目脑补”。

---

## 1. 页面整体拓扑与分栏架构 (Layout Topology)

### 1.1 容器与微前端宿主
- **顶层页面**：美团商家后台主框架。
- **Iframe 容器**：`#me-iframe-container`，加载 E-booking 订单中心 iframe：
  `https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Forder-gx%2Findex.html%23%2Funhandled`
- **微前端应用**：内部采用阿里乾坤（qiankun）框架托管的子应用 `order-gx`（基于 Vue 2.x + 美团 MTD 组件库开发）。
- **主要内容区域**：`#op-ebhigh-content.content-container`。

### 1.2 左右分栏联动体系 (Master-Detail Layout)
页面交互**绝非弹出层模态弹窗（Modal Dialog）**，而是经典的**左右分栏 Master-Detail** 布局：
- **左侧列表区（Master）**：展示订单摘要卡片流（`.mtd-list-item.list-item-container`）。
- **右侧详情区（Detail）**：展示当前选定订单的完整信息面板（`.detail-container`），包含头部操作栏（`.detail-header`）与详情信息栏。
- **联动逻辑**：鼠标点击左侧某张卡片，右侧详情面板立即刷新渲染该订单，并向后端发送详情网络请求。

---

## 2. 订单列表刷新与 Tab 切换交互 (List Refresh & Tab Switching)

### 2.1 业务场景与痛点
美团商家后台页面上**不存在单独的“一键刷新待处理列表”按钮**。要获取最新的待处理订单，必须通过 Tab 切换触发列表网络重新加载。

### 2.2 真实交互状态机
```
[当前在 待确认/待处理 Tab] ---> 点击「全部订单」Tab ---> [网络生命周期屏障: 等待全部订单响应]
                                                                  |
                                                      [断言全部订单激活态就绪]
                                                                  |
[最终待确认订单列表结果] <--- [网络拦截: 待确认最终响应] <--- 点击「待确认/待处理」Tab
```

### 2.3 关键避坑准则
1. **生命周期网络屏障（Barrier）**：
   - 切换至「全部订单」时，必须挂载网络响应监听作为屏障，确保旧列表请求已完全清空，避免在途网络响应污染后续的待确认列表。
2. **激活态断言防抖**：
   - 点击「全部订单」后，必须显式等待 Tab 激活态可见：
     `.tab-container .mtd-tabs-item.mtd-tab-active:has-text("全部订单")`。
3. **3 秒防抖等待补偿（严禁静默吞单）**：
   - 美团接口有防抖保护。若距离上次刷新不足 3000ms，必须通过拟真延时 `await humanDelay(page, remaining, remaining + 300)` 补齐等待时间，**严禁直接返回空数组 `return []`**（否则会将真实存在的新订单误判为无订单而漏单）。

---

## 3. 订单定位与卡片识别机制 (Order Card Identification)

### 3.1 真实卡片 DOM 结构
```html
<div data-v-a77413d6="" class="mtd-list-item list-item-container">
  <div data-v-a77413d6="" class="list-item-wrap">
    <p data-v-a77413d6="" class="list-item-wrap-row">
      <span>
        <span class="tag tag-new">新订</span>
        <span class="order-status-text text-main">待处理</span>
      </span>
      <span class="price">¥288.00</span>
    </p>
    <p data-v-a77413d6="" class="list-item-wrap-row">豪华大床房 1间</p>
    <p data-v-a77413d6="" class="list-item-wrap-row">入离日期: 2026-09-20 至 2026-09-21</p>
  </div>
</div>
```

### 3.2 核心事实：卡片上没有订单号文本！
- **重要发现**：在美团 E-booking 的常规订单卡片（`.list-item-container`）内部，**默认完全不渲染订单号文本**！
- 订单号文本**仅在右侧详情面板头部（`.detail-header`）展示**：`<span>订单号：5035036069263942766</span>`。

### 3.3 可靠的定位算法 (`locateOrderCard`)
为兼顾单单和多单场景，定位算法分为 5 个阶梯：
1. **单号文本直搜（兼容变体）**：若某些历史版本或定制视图卡片中包含单号文本，优先命中：
   `.list-item-container:has-text("${otaOrderId}")`；
2. **右侧详情已就绪判断**：若右侧 `.detail-header` 已展示该 `otaOrderId`，直接复用当前激活的卡片（`.list-item-container.active, .mtd-list-item-selected`）；
3. **唯一单快速命中**：当列表仅有 1 笔订单时（`items.count() === 1`），直接返回该卡片；
4. **多单点击探查**：当列表中有多笔订单时，依次点击候选卡片，并检测右侧 `.detail-header` 是否包含目标 `otaOrderId`，命中即返回；
5. **首项兜底**：若上述均未返回但列表非空，返回首项。

---

## 4. 订单详情触发交互（无“详情”按钮事实） (Detail Triggering)

### 4.1 核心事实：完全不存在“详情”按钮！
- 在真实 DOM 中，遍历 `.list-item-container` 内所有 `button` 与 `a` 标签，结果其**数量严格为 0 (`buttons: []`)**。
- 卡片内部根本没有任何独立的“详情”、“查看”、“展开”按钮或图标链接。

### 4.2 错误模式 (Anti-Pattern) 审查
```typescript
// ❌ 严重错误：脱离实际的防御性脑补，每次执行白白浪费 800ms 超时等待
const detailBtn = orderCard.locator('button:has-text("详情"), a:has-text("详情")').first();
if (await detailBtn.isVisible({ timeout: 800 }).catch(() => false)) {
  await detailBtn.click();
} else {
  await orderCard.click();
}
```

### 4.3 正确交互范式
整个卡片自身就是可点击元素。直接触发整张卡片的点击：
```typescript
// ✅ 正确范例：直接点击卡片触发详情展示与网络拦截
await visualClickLocator(page, orderCard, `点击订单「${otaOrderId}」卡片展示详情`);
await humanDelay(page, 500, 800);
```

---

## 5. 敏感信息解密交互（姓名与电话） (Sensitive Data Decryption)

美团商家后台对客人姓名与手机号采用脱敏遮罩（如 `王***`、`138****0000`），需要前端模拟人工点击解密，同时触发平台网络解密报文拦截。

### 5.1 客人姓名解密
#### 真实 DOM 结构
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

#### 定位规则
**严禁裸文本匹配 `button:has-text("查看姓名")`**（该元素不是 button，且裸文本容易在说明文案中冲突）。
必须基于 DOM 层级与样式选择：
```typescript
const revealNameBtn = scope.locator(
  '.detail-info-item .guest-name .btn-text, ' +
  '.guest-name .btn-text, ' +
  '.display-name + .btn-text, ' +
  'p.detail-info-item:has(.info-key:has-text("客人姓名")) .btn-text'
).first();
```

#### 核心事实：点击查看姓名无二次确认弹窗！
- **重要事实**：实测美团商家后台在点击「查看姓名」后，**根本不会弹出任何安全确认框或模态对话框**！
- 页面直接向后端发送解密请求并在原位展示真实姓名。
- **严禁**再编写针对 `.mtd-modal`、`.ant-modal`、`.el-dialog` 或 `button:has-text("我已知晓")` 的查找与超时等待逻辑，否则不仅白白耗费超时时间，更会在页面其他区域存在同名文案时引发严重误触。

---

### 5.2 客人电话解密与双重风控规避
#### 真实 DOM 结构
```html
<p class="detail-info-item">
  <span class="info-key">联系客人</span>
  <span class="info-content">
    <a href="javascript:;" style="margin-right: 12px;">查看电话</a>
    <a href="javascript:;" style="display: inline-block; width: 56px;">短信联系</a>
  </span>
</p>
```

#### 智能跳过电话解密风控原则 (Smart Skip)
- **痛点与风险**：在 1 秒内连续请求姓名解密与电话解密，极其容易触发美团的“操作频繁”敏感数据探针与滑块验证（Yoda 验证码）。
- **工程应对**：
  在触发“查看电话”前，检查**姓名解密响应报文**或**初始网络详情报文**中是否已携带有完整手机号：
  ```typescript
  const plainSensitivePhone = sensitiveData?.guestMobile && !sensitiveData.guestMobile.includes('*')
    ? sensitiveData.guestMobile : '';

  if (plainSensitivePhone) {
    // 强制跳过点击“查看电话”，避免触发平台敏感风控！
    return;
  }
  ```

---

## 6. 订单“接受”接单与确认号回填 (Order Accept & Confirmation Number)

### 6.1 详情头部操作区真实 DOM
```html
<div class="detail-container">
  <div class="detail-header">
    <div class="header-container">
      <div class="order-info-wrap">
        <span>订单号：5035036069263942766</span>
      </div>
      <div class="btn-wrap">
        <div class="btn-container">
          <!-- 普通操作按钮：mtd-btn-default -->
          <button type="button" class="mtd-btn op-btn mtd-btn-default"><span> 打印 </span></button>
          <button type="button" class="mtd-btn op-btn mtd-btn-default"><span> 操作记录 </span></button>
          <button type="button" class="mtd-btn op-btn mtd-btn-default"><span> 拒绝 </span></button>
          <!-- 核心接单按钮：唯一的高亮主要按钮 mtd-btn-primary -->
          <button type="button" class="mtd-btn op-btn mtd-btn-primary"><span> 接受 </span></button>
        </div>
      </div>
    </div>
  </div>
</div>
```

### 6.2 为什么必须使用 DOM 结构 + CSS 样式定位？
1. **文字冲突高发**：页面中存在“全部/待处理/已接受”等 Tab 文字、服务协议中的“点击即代表接受”、甚至订单备注中的“客人接受安排”，使用裸文本 `button:has-text("接受")` 极易误触非目标控件；
2. **唯一的主按钮特征**：在 `.btn-wrap .btn-container` 内部，只有「接受」按钮带有 `mtd-btn-primary` 类名，其余均为 `mtd-btn-default`。

#### 正确的选择器标准
```typescript
const acceptBtn = scope.locator(
  '.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary, ' +
  '.detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary, ' +
  '.header-container .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary, ' +
  '.detail-container button.mtd-btn.op-btn.mtd-btn-primary, ' +
  '.btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary'
).first();
```

### 6.3 确认号回填模态框（Modal Dialog）真实 DOM 与四步交互规范
在美团商家后台（E-booking）中，待确认订单的确认号并非直接展示在卡片或详情表面，而是采用**点击「接受」触发「确认号回填 / 确认接受」模态弹窗**的交互设计：

#### 模态弹窗与输入控件真实 DOM 结构
```html
<div class="mtd-modal-wrapper mtd-modal-center">
  <div class="mtd-modal">
    <span class="mtd-modal-close"><i class="mtdicon mtdicon-close-thick"></i></span>
    <div class="mtd-modal-content-wrapper">
      <div class="mtd-modal-content">
        <div class="modal-container">
          <div class="modal-container-content">
            <!-- 酒店确认号表单项 -->
            <div style="margin-left: 18px;">
              <span>酒店确认号：</span>
              <div data-v-3fd065c0="" class="mtd-input-wrapper">
                <input type="text" placeholder="非必填" class="mtd-input">
              </div>
              <span class="text-accent">多确认号，用“,”隔开</span>
            </div>
            <!-- 酒店房间号表单项（若有） -->
            <div style="margin-top: 10px; margin-left: 18px;">
              <span>酒店房间号：</span>
              <div class="mtd-input-wrapper">
                <input type="text" placeholder="非必填" class="mtd-input">
              </div>
              <span class="text-accent">多房间号，用“,”隔开</span>
            </div>
          </div>
          <!-- 底部操作按钮组 -->
          <div class="modal-container-footer">
            <div class="btn-group">
              <button type="button" class="mtd-btn btn-item"><span>取消</span></button>
              <button data-v-3fd065c0="" type="button" class="mtd-btn btn-item mtd-btn-primary">
                <span> 确认接受 </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

#### 四步标准化交互时序
1. **激活详情面板**：定位订单卡片，断言右侧 `.detail-header` 已处于该订单上下文；
2. **触发模态弹窗**：点击详情头部主要操作按钮 `button.mtd-btn.op-btn.mtd-btn-primary:has-text("接受")`；
3. **安全回填与校验**：
   - 定位模态弹窗内确认号输入框：`.modal-container div:has(span:has-text("酒店确认号")) input.mtd-input, input.mtd-input[placeholder*="非必填"]`；
   - **防串单校验**：读取现有值，若已存在其他非空确认号立即阻断报错（`CONFIRM_INPUT_ALREADY_FILLED`）；
   - **读回二次校验**：写入后必须 `inputValue()` 读回比对，不一致时立即阻断（`CONFIRM_VALUE_MISMATCH`）；
4. **监听网络并提交确认**：
   - 挂载 `/confirm|order|accept|operate/` 网络响应拦截器；
   - 点击弹窗底部提交按钮：`.modal-container-footer .btn-group button.mtd-btn.btn-item.mtd-btn-primary:has-text("确认接受")`；
   - 响应完成并执行拟真延时，完成接单闭环。

---

## 7. 已取消订单确认（我已知晓）交互规范 (Cancel Confirmation Spec)

### 7.1 业务场景与 DOM 结构
在美团「待确认订单」Tab 中，若客人发起取消或系统已取消，订单详情头部展示「我已知晓」确认取消操作按钮：

```html
<!-- 详情头部操作区域 -->
<div data-v-21a6a984="" class="btn-wrap">
  <div data-v-21a6a984="" class="btn-container">
    <button data-v-21a6a984="" type="button" class="mtd-btn op-btn mtd-btn-primary">
      <span> 我已知晓 </span>
    </button>
  </div>
</div>
```

### 7.2 标准化定位与交互时序
1. **定位订单卡片**：通过 `locateOrderCard(page, scope, otaOrderId)` 找到目标订单；
2. **激活详情面板**：若右侧 `.detail-header` 未处于该订单上下文，点击订单卡片激活详情展示；
3. **精准定位「我已知晓」按钮**：
   - 依赖 DOM 层级结构 + 组件 CSS 样式类 + 文本约束：
     `.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓")`；
4. **点击执行取消确认**：
   - 通过 `visualClickLocator` 点击并执行拟真延时，完成取消确认闭环。

---

## 8. 权威数据源原则与 Fail-Fast (Data Authority & Fail-Fast)

按照项目最高规范 [`AGENTS.md`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/AGENTS.md) 的要求：

1. **100% 依赖网络响应（Single Source of Truth）**：
   - 订单列表数据：**只取网络拦截的 JSON 报文**；
   - 订单详情数据：**只取 `/api/v1/ebooking/orders/${orderId}` 网络拦截报文**；
   - 敏感信息数据：**只取解密网络接口返回的明文报文**。
2. **零 DOM 业务数据拼接**：
   - 严禁从页面 DOM 节点的文本（如 `<span class="price">`、`<p>入离日期</p>`）提取、截取或清洗业务核心字段写入订单。
   - DOM 操作在系统中的**唯一合法用途**是：**触发界面交互、选定卡片与就绪状态断言**。
3. **Fail-Fast 刚性阻断**：
   - 当详情网络响应缺失入住人、房型、入离日期等关键字段时，严禁填入默认占位符强行推进，必须立即抛出 `ORDER_DETAIL_FIELD_MISSING` 结构化异常阻断流程。

---

## 9. CLI 诊断与手工核验工具清单 (CLI Diagnostic Tools)

为保证在无测试订单或排查线上问题时能够由开发者或运维人员随时开展可视化实测，系统内置了专用 CLI 工具：

| 命令 | 用途 | 说明 |
| :--- | :--- | :--- |
| `npm run duty:refresh-list` | 美团列表刷新与 Tab 切换交互测试 | 以非无头模式（`headless: false`）启动真实美团页面，执行 Tab 切换、网络响应监听与防抖等待全流程，运行后保留窗口供人工检查。 |
| `npm run duty:inspect-detail` | 美团订单详情定位与抓取测试 | 可指定订单号（或自动选取列表首单），测试卡片定位、点击展开、姓名解密与权威网络详情拦截。 |
| `npm run duty:confirm-import` | 接单与确认号回填测试（默认 Dry-Run） | 演练点击「接受」展开弹窗、填入确认号与读回校验，收尾点击取消，绝不触碰生产提交。 |
| `npm run duty:confirm-cancel` | 取消确认（我已知晓）测试（默认 Dry-Run） | 定位已取消订单、激活详情、精准定位「我已知晓」按钮，演练模式不执行真实点击。 |

---

## 10. 总结：美团自动化操作速查对照表

| 操作意图 | 错误做法（绝对禁止） | 正确做法（规范标准） |
| :--- | :--- | :--- |
| **刷新订单列表** | 循环等待或刷新整个浏览器页面 | 点击「全部订单」-> 拦截屏障响应 -> 断言激活态 -> 延迟后点击「待确认」-> 拦截最终列表响应 |
| **定位列表中的订单** | 仅依赖 `has-text("${orderId}")` 匹配卡片 | 结合唯一单判断、右侧详情单号联动检测与多单点击探查 (`locateOrderCard`) |
| **展开/查看订单详情** | 查找卡片内的“详情/查看”按钮 (`button:has-text("详情")`) | **直接点击整张订单卡片 (`orderCard.click()`)**，卡片内无任何详情按钮 |
| **解密客人真实姓名** | 裸文本匹配或等待不存在的二次确认弹窗 | 基于 DOM 结构与样式定位：`.detail-info-item .guest-name .btn-text` 直接点击（无二次确认弹窗） |
| **解密客人联系电话** | 无脑每次都去点击“查看电话”或等待弹窗 | 若姓名解密或原始报文已有明文手机号，**强制跳过**解密以规避双重敏感风控探针；无二次确认弹窗 |
| **点击「接受」接单** | 裸文本匹配 `button:has-text("接受")` | 基于详情头部操作栏与主要按钮样式定位：`.detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary` |
| **点击「我已知晓」确认取消** | 裸文本匹配或弹窗兜底盲点 | 基于详情头部操作栏层级定位：`.detail-container .detail-header .btn-wrap .btn-container button.mtd-btn.op-btn.mtd-btn-primary:has-text("我已知晓")` |
| **提取业务字段** | 从 DOM 页面文字中正则提取价格/日期/房型 | **100% 依赖网络详情接口与解密接口拦截报文**，DOM 仅作交互触发 |

