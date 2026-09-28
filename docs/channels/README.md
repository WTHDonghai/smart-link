# Smart-Link 渠道接入与调研规范索引 (Channel Integration Index)

> 本目录集中维护 Smart-Link 系统接入各 OTA 渠道的调研文档、网络契约规范、真实 DOM 拓扑交互规范以及脱敏样本报文。
> 所有新渠道接入或既有渠道维护，必须严格以此目录的文档和规范为基线。

---

## 📊 渠道支持与接入状态矩阵

| 渠道代码 (`channelCode`) | 渠道名称 | 商户后台系统 | 订单列表接口 | 订单详情接口 | 敏感数据解密 | 接单与确认号回填 | 接入状态 | 对应文档目录 |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`MEITUAN`** | 美团酒店/民宿 | 美团商家中心 (E-booking) | ✅ 已接入 | ✅ 已接入 | ✅ 已接入 | ✅ 已接入 | 🟢 **生产运行中** | [`docs/channels/meituan/`](./meituan/) |
| **`DOUYIN`** | 抖音来客/生活服务 | 抖音商家后台 / 罗盘 | ✅ 已接入 | 🔄 采集对接 | ⚠️ 调研中 | ⏳ 规划中 | 🟡 **对接实施中** | 待建目录 (实施中) |
| **`CTRIP`** | 携程/去哪儿 (E-booking) | 携程商家中心 | ⏳ 规划中 | ⏳ 规划中 | ⏳ 规划中 | ⏳ 规划中 | ⚪ **待调研** | 待建目录 |
| **`FLIGGY`** | 飞猪旅行 | 阿里飞猪商家后台 | ⏳ 规划中 | ⏳ 规划中 | ⏳ 规划中 | ⏳ 规划中 | ⚪ **待调研** | 待建目录 |

---

## 📁 渠道文档目录组织规范

每个渠道使用大写规范代码设立独立子目录，固定划分为 **3 份核心文档 + 1 个脱敏样本库**：

```text
docs/channels/<channel_name>/
├── 01-survey-and-overview.md     # 渠道概况、商户后台体系、账号权限与会话维持
├── 02-order-api-spec.md          # 订单网络接口契约、清洗字典、解密机制与错误码（核心）
├── 03-dom-interaction-spec.md    # 真实页面 DOM 拓扑、控件定位标准与自动化交互避坑
└── samples/                      # 真实网络响应脱敏 JSON 报文库（单测数据源基准）
    ├── list-task-response.json
    ├── order-detail-response.json
    └── sensitive-decrypt-response.json
```

---

## 🏛️ 渠道接入四大核心工程准则

所有渠道在进行调研、设计与代码实现时，必须无条件遵循以下红线准则（详见 [`AGENTS.md`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/AGENTS.md)）：

1. **权威网络响应为唯一数据源 (Network Authority & Fail-Fast)**：
   - 订单列表数据、订单详情数据与敏感信息**必须 100% 来源于渠道网络响应（JSON Payload）**；
   - 页面 DOM 仅用于控件定位（点击、输入、Tab 切换）与状态断言（元素可见性、风控提示检查），**绝对禁止从 DOM 文本提取或拼接业务字段**；
   - 接口超时、非 200 状态码、业务返回失败或核心字段缺失时，立即阻断并抛出确定错误码。
2. **公共基类下沉 + 领域子模块解耦 (Base Runner & Modular Domain Handlers)**：
   - **公共会话与并发基类 (`BaseChannelDutyRunner`)**：
     - 位于 `src/crawler/duty/dutyContracts.ts`，统一托管 `session`、`Page` 查找/创建、单页面任务互斥锁 `runWithMutex`、`stop`、以及浏览器窗口关闭安全监听 `waitForBrowserClose`；
   - **轻量渠道实现**：如 `DouyinDutyRunner` 直接继承 `BaseChannelDutyRunner`，共享互斥锁与会话管理，仅关注页面导航与数据提取；
   - **复杂渠道实现**：如 `MeituanDutyRunner` 采用门面模式（Facade），继承 `BaseChannelDutyRunner` 并将具体逻辑委托给高内聚低耦合的子模块：
     - `*CardLocator.ts`：卡片查找与作用域解析；
     - `*ListCollector.ts`：Tab 切换与网络屏障；
     - `*DetailInspector.ts`：详情嗅探、监听预注册与解密；
     - `*ActionExecutor.ts`：接单确认与取消操作执行；
     - `*Guard.ts`：安全风控探测与通知弹窗清理；
   - **纯函数解析层 (`*OrderParsers.ts`)**：纯函数清洗与验证（100% 独立单测覆盖，无网络与 DOM 依赖）；
   - **领域契约层 (`*DutyContracts.ts`)**：错误码枚举、轻量任务回执与 `DutyExecutionError` 结构化异常。
3. **真实脱敏报文驱动诚实单测 (Honest & Rigorous Testing)**：
   - 所有的解析函数必须基于 `samples/` 中的真实抓包脱敏报文编写单测，绝不允许凭空脑补字段或编写无断言的伪测试。
4. **终端去技术暴露 (Zero Technical Leakage)**：
   - 终端用户界面严禁暴露网络 URL、HTTP 状态码、JSON 原始报文或 DOM 选择器，错误信息必须转换为清晰的人文关怀提示。


---

## 🚀 新渠道接入脚手架

接入新渠道时，请先直接复制 [`_template/`](./_template/) 目录到目标渠道文件夹，按照模板指引逐步完成调研、抓包取证与契约梳理。
