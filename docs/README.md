# Smart-Link 架构设计与工程技术文档索引 (Documentation Index)

> 本目录集中维护 Smart-Link 系统的系统级架构设计规范、核心业务流转契约与工程治理指南。
> 所有参与本项目的开发者与 AI Agents 在新增特性、重构模块或编写代码前，必须先查阅并遵循相关设计文档。

---

## 📚 核心设计与架构文档

### 1. 桌面原生运行时与工程架构
- **文档路径**：[`docs/architecture/electron-runtime-architecture.md`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/docs/architecture/electron-runtime-architecture.md)
- **核心内容**：
  - **Electron-Only 进程拓扑**：Main 进程、Preload 脚本、Renderer 沙箱的分层职责与通信拓扑。
  - **安全隔离与 IPC 契约**：`window.host` 挂载标准、`DesktopOperationResult` 强类型响应规范与通道命名约束。
  - **唯一日志数据源流水线**：主进程日志暂存 (`pendingMainLogs`)、实时推送与渲染层 Redux + IndexedDB (`SmartLink_LogDB`) 唯一持久化机制。
  - **生命周期与安全纵深防御**：单实例互斥锁 (`SingleInstanceLock`)、导航拦截 (`will-navigate`)、CSP 与优雅清退 (`teardownApplicationResources`)。

### 2. 全栈统一采集与值守架构
- **文档路径**：[`docs/architecture/unified-crawler-and-duty-architecture.md`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/docs/architecture/unified-crawler-and-duty-architecture.md)
- **核心内容**：
  - **五层同心圆原生架构**：表现层、状态层、服务与网关层、预加载层、主进程自动化引擎层。
  - **端层职责与命名刚性契约**：严格区分 `*Api.ts`（前端网络请求）与 `*Bridge.ts`（桌面 IPC 网关），彻底杜绝跨层同名冲突。
  - **全链路渠道标识归一化**：大写 `channelCode`（`MEITUAN`, `DOUYIN`, `CTRIP` 等）统一规范。
  - **浏览器会话与反爬规避**：按渠道独立持久化 Profile、物理锁自动清理、Stealth 反爬指纹伪造与 HUD 视觉指示器。

### 3. 订单值守业务流程与流转契约
- **文档路径**：[`docs/architecture/order-guardian-design.md`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/docs/architecture/order-guardian-design.md)
- **核心内容**：
  - **业务双重视角流程图**：渠道值守控制（IPC 驱动）与文旅中台订单运维（REST 驱动）全景流转。
  - **订单操作状态矩阵**：`FAILED`（编辑/导入/删除）、`SUCCESS`（取消）、`PENDING` / `IMPORTING` / `CANCEL`（禁用）状态机规则。
  - **关键数据与报文契约**：实际状态上报 (`POST /toolbox/actual-state/report`) 与任务回执 (`PUT /toolbox/tasks/:id/result`) 强契约定义。

### 4. 美团订单采集、详情抓取与确认号回填技术方案
- **文档路径**：[`docs/architecture/meituan-order-collection-trust-plan.md`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/docs/architecture/meituan-order-collection-trust-plan.md)
- **文档状态**：生产级架构基线（v2.1.0 已评审通过，待实施）
- **核心内容**：
  - **权威网络响应为唯一数据源**：列表与详情 100% 来源于接口 JSON 响应，DOM 仅作交互与就绪断言，零 DOM 业务数据拼接（Fail-Fast）。
  - **KISS 极简 3 核心模块**：收敛为契约层（`meituanDutyContracts.ts`）、纯函数层（`meituanOrderParsers.ts`）与执行层（`meituanDutyRunner.ts`）。
  - **卡片内联流式交互**：基于美团真实 E-booking 卡片内联展开与卡片内回填，彻底废除模态弹窗（Modal）伪假设。
  - **请求合并与防抖等待补偿**：在途 Promise 复用门禁位于互斥锁之前，防抖期内拟真等待补齐，杜绝误报 `VERIFIED_EMPTY`。
  - **重试透传与边缘触发 Toast**：全链路结构化异常透传 `retryable: false` 杜绝无效重推，渲染层边缘触发避免 Toast 轰炸。

---

## 🏛️ 项目最高治理准则
- **开发与 AI 协同治理规范**：[`AGENTS.md`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/AGENTS.md)
  - 规定了本项目的架构分层、技术栈标准、设计系统、Fail-Fast 刚性红线、诚实测试准则与极简设计原则。
