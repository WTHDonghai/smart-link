# 抖音（DOUYIN）渠道概况与运行环境调研规范

> **渠道代号**：`DOUYIN`  
> **适用业务**：抖音来客 / 生活服务 酒旅业务（酒店预售券 + 客房预约履约）  
> **商户系统**：抖音来客商家后台 · 酒店履约工作台 (fulfillment-workbench)  
> **实施状态**：🟢 **核心链路已接入生产**（订单列表采集 / 详情抓取 / 真实手机号获取 / 确认号回填 / 取消确认）  
> **调研基准**：基于生产环境真实 DOM 取证与接口抓包（样例见 [`samples/`](./samples/)；原始调研存档见项目根目录 `douyin-order-list-analysis.md`、`douyin-order-detail-analysis.md`）  
> **维护代码位置**：
> - 门面执行器：[`src/crawler/duty/channels/douyin/douyinDutyRunner.ts`](../../../src/crawler/duty/channels/douyin/douyinDutyRunner.ts) (继承 `BaseChannelDutyRunner`)
> - 领域子模块：
>   - 卡片定位：[`src/crawler/duty/channels/douyin/douyinCardLocator.ts`](../../../src/crawler/duty/channels/douyin/douyinCardLocator.ts)
>   - 列表收集与屏障：[`src/crawler/duty/channels/douyin/douyinListCollector.ts`](../../../src/crawler/duty/channels/douyin/douyinListCollector.ts)
>   - 详情嗅探与敏感号码获取：[`src/crawler/duty/channels/douyin/douyinDetailInspector.ts`](../../../src/crawler/duty/channels/douyin/douyinDetailInspector.ts)
>   - 业务动作执行：[`src/crawler/duty/channels/douyin/douyinActionExecutor.ts`](../../../src/crawler/duty/channels/douyin/douyinActionExecutor.ts)
>   - 安全风控探针：[`src/crawler/duty/channels/douyin/douyinRiskGuard.ts`](../../../src/crawler/duty/channels/douyin/douyinRiskGuard.ts)
>   - 提示弹窗清理：[`src/crawler/duty/channels/douyin/douyinModalGuard.ts`](../../../src/crawler/duty/channels/douyin/douyinModalGuard.ts)
> - 纯函数解析层：[`src/crawler/duty/channels/douyin/douyinOrderParsers.ts`](../../../src/crawler/duty/channels/douyin/douyinOrderParsers.ts)
> - 渠道领域契约：[`src/crawler/duty/channels/douyin/douyinDutyContracts.ts`](../../../src/crawler/duty/channels/douyin/douyinDutyContracts.ts)

---

## 1. 渠道后台定位与入口拓扑

### 1.1 访问入口
- **订单履约工作台 URL**（酒店预约单列表，`status=waiting` 为待处理视图）：
  `https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list?groupid=...&life_account_biz_ids=&life_biz_view_id=22&status=waiting`
- **后台架构形态**：
  - **顶层单页应用 (SPA)**：运行于顶层 `window`，**无 Iframe 嵌套、无微前端沙箱**（与美团 E-booking 的 iframe + qiankun 结构不同）。
  - **技术栈**：React + 字节 `byted-design` 组件库（`byted-btn` / `byted-tab-bar` / `byted-popover-confirm` / `byted-modal` 等）。
  - **布局模型**：**左右分栏联动 (Master-Detail)** —— 左侧订单卡片流，右侧 `#detailSection` 详情面板，点击卡片刷新详情（详见 [`03-dom-interaction-spec.md`](./03-dom-interaction-spec.md)）。
- **Scope 解析结论**：`getDouyinOrderScope(page)` 直接返回主页面 `Page`，所有选择器均在主文档生效。

### 1.2 账号权限体系
- **账号类型**：抖音来客商家主账号 / 门店子账号（具备酒旅履约权限）。
- **自动化操作所需最小权限**：
  - 待处理订单列表查看（新订/变更、取消/退款两个 Tab）；
  - 订单详情查看（含购买人手机号「一键复制」能力）；
  - 接单确认与酒店确认号录入回填；
  - 已取消订单的「我知道了」确认操作。
- **多端登录特征**：同一账号多处登录存在互斥顶号风险；值守浏览器使用独立持久化 Profile，禁止与人工运营浏览器混用登录态。

---

## 2. 会话生命周期与登录态维持

### 2.1 鉴权凭据与存储机制
- **凭据类型**：基于浏览器 Cookie 的会话维持（`life.douyin.com` 域）。
- **持久化方案**：系统为抖音渠道分配专有的持久化 Profile 目录（按 `channelCode: DOUYIN` 隔离），Cookie、LocalStorage 自动落盘，重启客户端后自动恢复登录态。
- **会话失效判定**：页面重定向至登录页、接口返回未登录业务码或命中风控验证时，值守链路抛出确定性异常（`TARGET_PAGE_NOT_READY` / `RISK_VERIFICATION_REQUIRED`），提示人工重新登录。

### 2.2 登录交互形式
- **主要登录方式**：抖音 App / 抖音商家版 App 扫码登录。
- **登录由人工完成**：自动化引擎不做自动登录；首次登录与失效后的重新登录均由运营人员在值守浏览器窗口内人工操作。

---

## 3. 安全风控与反爬防护特征 (Risk & Anti-Scraping)

### 3.1 人机验证与挑战
- **风控特征文本**（`douyinRiskGuard` 命中即阻断，`RISK_VERIFICATION_REQUIRED`）：
  `安全验证`、`滑动拼图`、`访问频繁`、`请完成验证`、`captcha` 等（完整清单见 `DOUYIN_RISK_TEXT_PATTERN`）。
- **触发场景**：
  - 连续高频刷新订单列表；
  - 敏感数据接口（`get_secret_num`）高频调用；
  - 会话环境异常（无头特征、自动化指纹暴露）。
- **应对策略**：命中风控立即暂停自动化并上报人工介入；列表刷新带拟人防抖与请求合并；反爬 Stealth 注入 + 持久化真实 Chrome Profile 降低触发概率。

### 3.2 频控与接口限制
- **列表刷新**：两次主动刷新之间存在平台防抖窗口，采集端以「重复点击 Tab 触发刷新」为标准路径，并做防抖等待补偿，严禁防抖期内误报空列表。
- **敏感数据解密**：`get_secret_num` 接口受频控约束；**严禁再走电话图标「隐私虚拟号」通道**（已废弃），真实手机号获取以单次「一键复制」点击触发，详见 [`02-order-api-spec.md`](./02-order-api-spec.md) 第 4 节。

---

## 4. 已接入能力矩阵

| 能力 | 状态 | 实现入口 | 规范文档 |
| :--- | :---: | :--- | :--- |
| 新订/变更订单列表采集 | ✅ 生产 | `DouyinListCollector` | [02 §2.1](./02-order-api-spec.md) |
| 取消/退款订单列表采集 | ✅ 生产 | `DouyinListCollector` | [02 §2.2](./02-order-api-spec.md) |
| 订单详情抓取（权威网络报文） | ✅ 生产 | `DouyinDetailInspector` | [02 §3](./02-order-api-spec.md) |
| 真实手机号获取（一键复制 → 接口拦截） | ✅ 生产 | `DouyinDetailInspector` | [02 §4](./02-order-api-spec.md) |
| 接单 + 确认号回填 | ✅ 生产 | `DouyinActionExecutor` | [03 §5](./03-dom-interaction-spec.md) |
| 取消订单确认（我知道了） | ✅ 生产 | `DouyinActionExecutor` | [03 §6](./03-dom-interaction-spec.md) |
| 风控探测与通知弹窗清理 | ✅ 生产 | `douyinRiskGuard` / `douyinModalGuard` | [03 §7](./03-dom-interaction-spec.md) |
