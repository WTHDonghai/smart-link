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

---

## 🏛️ 项目最高治理准则
- **开发与 AI 协同治理规范**：[`AGENTS.md`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/AGENTS.md)
  - 规定了本项目的架构分层、技术栈标准、设计系统、Fail-Fast 刚性红线、诚实测试准则与极简设计原则。
