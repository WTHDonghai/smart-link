# Browser Use 适配调研

调研日期：2026-10-15。仅核验官方文档与源码，未安装业务依赖、未调用模型、未操作真实 OTA 页面。本次 Python 基线为官方 tag `0.13.11`，实际提交 `914c59bdd4acd50e9628a97a96a3919313aebc85`；TypeScript 基线为 Browser Use Pi 的提交 `e73c28b87998afddc168951b3f768a3f0e81d640`，其 package version 为 `0.1.0`。在线 Cloud 文档为访问当日版本，可能与固定源码存在差异。

## 结论与范围

**Browser Use 应与 Alibaba Page Agent 一起纳入正式候选，现有资料不足以宣布任一方案在真实 OTA 页面上更可靠。** Browser Use 的截图、CDP、frame 能力值得验证；Page Agent 的浏览器内 DOM 路线也有独立价值。应使用同一批弹窗与同样的权限、追踪要求比较。

需要区分以下产品，不能把整个 Browser Use 生态归结为“仅 Python”或“必须云端”：官方 README 同时列出 Python library、Browser Use Pi、Browser Harness JS 与 Cloud。[1]

| 方案 | 官方能力与接入方式 | 本项目判断 |
| --- | --- | --- |
| Browser Use Python | Python Agent、DOM/截图、模型适配、工具循环；可连接本地 CDP。[2][3] | 浏览器恢复的正式候选；增加独立 Python 运行时与进程通信 |
| Browser Use Pi | 基于 Pi 的 TypeScript Agent，持久 JavaScript REPL、raw CDP、AX 与截图，支持本地现有 Chrome。[9][10] | 同样纳入候选；需验证 Node 版本、执行权限和默认文件日志适配 |
| Browser Harness JS | 官方生态中的 JavaScript 浏览器控制基础设施。[1] | 可用于自建有限循环；不能直接等同完整异常恢复 Agent |
| Browser Use Cloud | 托管 Agent、浏览器、事件与会话 API。[13][14] | 云端路线单列；本次核验的 V4 Create Run 公开参数没有任意本地 `cdpUrl`，不能当作现有客户页面的直接接管方案 |

三项 PMS 映射继续采用结构化数据输入输出：OTA 产品与 PMS 房型、房价码、预订类型候选交给模型，返回候选编码和依据，由应用校验并填入草稿。浏览器 Agent 不需要逐格操作下拉框。其他异常的可读分析和消息发送也应由应用编排；浏览器执行器仅接收明确的页面恢复子任务，不自行取得通用消息权限。这是业务分工建议，不是框架限制。

## Python 本地方案：已确认的能力

- `pyproject.toml` 声明 Python `>=3.11,<4.0`；包含多个模型客户端、CDP、遥测及文件处理依赖。不能用它与 Page Agent 的单个 npm 包大小直接比较；本次没有测量完整安装体积、RSS、冷启动、延迟或成功率。[2]
- `BrowserProfile.cdp_url` 可连接现有浏览器，`BrowserSession.get_or_create_cdp_session(target_id, focus=True)` 可选择具体 target。默认连接初始化可能选择已有页面，项目必须显式绑定故障页的 CDP target，不能仅依据 URL 相似度或第一个标签页。[3][4]
- `use_vision` 默认开启；代码提供按元素索引与坐标点击。坐标能力还受模型名称检测及工具配置影响，不能认为选任意模型都会自动拥有相同操作能力。[5][6]
- 固定版本 `cross_origin_iframes=True`，默认 `max_iframe_depth=5`、`max_iframes=100`。源码通过 CDP 遍历同源内容和跨域 OOPIF；跨域遍历有可见性、尺寸、深度、数量及 target 可用性条件。它具有比单层同源 DOM 更广的实现路径，但没有“任意跨域、嵌套 iframe 必然可识别可点击”的保证。[3][7]
- `keep_alive=True` 用于保留浏览器；`BrowserSession.stop()` 的文档和实现意图是释放 session 资源而保留浏览器。`Agent.close()` 在未设置 keep_alive 时会调用 `kill()`。接入已有客户浏览器时必须明确配置生命周期并验证 CDP 断开后原 Playwright 是否正常，不可照搬默认关闭流程。[4][5]

Windows/macOS 分发需要额外验证 Python 运行时、平台依赖、签名、升级和子进程收尾。建议 Electron 主进程通过受控 stdio/RPC 驱动 sidecar，而不是暴露另一个通用本地 HTTP 服务；这属于本项目架构选择，官方 Python 库没有替本项目完成桌面打包。

## Python 动作权限与追踪

固定源码具有 history、动作输出、页面状态、截图、时间与用量数据；可通过异步 callback/hook 转换为项目追踪事件。支持可选 Laminar 集成，但未安装时对应包装为空操作；不能把“有装饰器”当作已经有持久可查询 trace。[5][8]

需要严格区分扩展点：

1. `on_step_start / on_step_end` 为 awaited 的步骤 hook。前者发生在模型选择动作前，后者发生在本步动作完成后，均不是每一次点击前的授权点。[5]
2. `register_new_step_callback` 在模型输出后、动作执行前调用，异步函数会被等待；同一步可以包含多个动作，callback 不等于每个动作的持久化闸口。[5]
3. `Tools(exclude_actions=...)` 可移除内置动作；自定义动作是 awaited 的异步函数。采用有限工具集合并在真正执行点击之前等待项目的动作审计确认，才能落实“记录失败不执行”。不能只写 prompt 约束关闭弹窗，也不能仅凭域名白名单限制订单业务副作用。[6]
4. `pause / stop` 设置执行状态，循环在步骤和动作之间检查；它们不会撤销已发出的 CDP 点击。取消与超时发生时需要记录是否已发出动作，并重新观察页面确认结果。[5]
5. `done.success`、history 的成功状态与可选 judge 都是 Agent 的报告或模型评价，不能替代弹窗消失、页面可操作以及订单状态的独立核验。[5][8]

首期应关闭导航、输入、下载、文件处理、任意脚本和多标签切换等无关能力，只提供必要的观察与受控关闭动作；每个动作验证故障页面仍存在且身份未变。框架默认能力多，不代表本项目应该全部开放。

## Python 遥测与持久化的版本差异

固定版本 `ANONYMIZED_TELEMETRY` 默认 `true`，遥测事件类型包含 `task`、`action_history`、`urls_visited`、最终回答与错误等字段，不能因名称为 anonymized 就假定没有业务文本。[11]

需要特别避免旧资料误导：虽然仓库仍有 `CloudSync` 类与 `BROWSER_USE_CLOUD_SYNC` 配置，固定版本 `Agent.authenticate_cloud_sync()` 明确报告 cloud sync 已移除，Agent WAL 文件配置也已注释。本次未发现当前 Agent 默认接入该旧 CloudSync 类，**不能据残留代码声称本地 Agent 默认向云端保存完整 history**。[5][12]

本项目应显式设置 `ANONYMIZED_TELEMETRY=false`，并禁用遗留 cloud sync 开关、外部 tracing 导出及 conversation/history/GIF/recording 文件输出，再以实际出站请求和文件写入验证配置。模型服务仍会收到本次提供的页面信息，关闭遥测不等于模型调用留在本地。

追踪事件必须回到 Redux `addLog / addLogs` → `logPersistenceMiddleware` → `SmartLink_LogDB`，不能把 Python history 文件当作第二个业务日志库。记录模型与工具的可观察输入、结果和决策摘要，不要求或宣称拿到模型完整内部思维链。

## Browser Use Pi：TypeScript 路线的价值与适配缺口

固定版本声明 Node `>=22.19`、Bun `>=1.3.14`；可直接选 Node 路线，无需同时引入 Bun。README 另明确 Bun 路线仍需要 Node 执行 V8 worker，不能理解为 Bun 能完全替代 Node。项目当前 Electron 内置 Node 版本需单独核验，源码为 TS 不代表可直接在其主进程运行。它依赖 Pi 的 agent、模型和 coding-agent 包，尚无与其他候选同口径的打包或性能数据。[9]

本地接管已具备实际 API：

- `browser: { cdpUrl, targetId }` 或 `Browser.pending()` 后调用 `connectBrowser(cdpUrl, { targetId })`，可指向已有页面。`Browser.chrome({ cdpUrl })` 可连接显式端点。[10]
- 关闭会清理 SDK 自己新建的标签与其弹出页，并保留调用方原有标签；可用 `keepTabs` 调整清理行为。仍需在现有 Playwright 会话上验证生命周期。[10]
- `beforeToolCall` 为 awaited hook，允许返回 `{ block: true, reason }`；`onEvent` 可等待并形成背压，`observe` 与异步迭代事件不能代替动作前的持久化确认。[9][10]

以下问题阻止我们把它当作已适配的直接替换：

1. **执行粒度**：核心工具执行的是 JavaScript REPL cell，cell 内可发送多条 raw CDP 命令，并具有文件系统与网络能力。`beforeToolCall` 限制的是整个工具调用，不是其中每次点击。官方明确 hooks 不是 sandbox；关闭额外 `researchTools` 仍不等于取消 REPL 的文件系统、网络及任意 CDP 权限。有限恢复动作需要独立的执行边界，不能通过检查自然语言或随意匹配脚本文本解决。[9][10]
2. **页面丢失行为**：`worker.ts` 中目标 target 不存在时会选择/新开页面。恢复任务必须在该行为前显式失败，不能用新标签代替故障现场。[10]
3. **域名策略边界**：官方域名策略限制文档导航与相关 frame/popups，但明确不是网络隔离；子资源、页面 fetch、任意 Node 代码及另建 CDP 连接不在该边界内。[10]
4. **日志唯一性**：`src/index.ts` 的 `performRun()` 默认创建工作目录下 `.browser-use/runs/{runId}.json` history 和 `.jsonl` 事件日志。公开配置未见关闭这套磁盘日志的明确选项，`log:false` 仅不能证明磁盘写入关闭。需要可替换持久化 sink、上游支持或受控适配后，才能满足本项目唯一 IndexedDB 日志数据源要求。不能把两套日志长期并存当作最终方案。[10]
5. **数据处理**：可设 `telemetry:false` 或 `DO_NOT_TRACK=1` 关闭计数遥测；文本脱敏不会隐藏截图像素。截图、页面文本、保存历史均需按照业务范围处理。[9][10]

Pi 已提供 AX/frame/CDP 等底层能力，但本次没有证明其对真实 OTA 嵌套跨域 frame 的成功率，不能将 Python DOM 引擎的具体 frame 能力直接移植为 Pi 的保证。

## Cloud 方案的独立取舍

Cloud V4 提供有序、带游标的事件读取，覆盖生命周期、模型、工具、产物和完成；具有托管会话、录制和浏览器基础设施，适合独立云端任务。[13][14]

本次公开 Create Run schema 提供托管 browser settings，未见允许传入任意本地 CDP URL 的参数。客户本地 `127.0.0.1` 端点不会自动成为云端可访问的故障页面；同步 cookie 也不能迁移原页面 DOM、弹窗和进行中的订单现场。因此当前本地恢复候选优先比较 Python/Pi 与 Page Agent，Cloud 不应被混为直接接管的实现。[13]

使用 Cloud 还需单独确认数据驻留、会话保留、ZDR、截图、费用和 API 事件与本地审计的关系。官方说明 API 浏览器录制默认关闭，ZDR 项目始终不录制；不代表所有账户默认零保留，也不代表本地客户日志策略已自动满足。[13][14]

## 统一 POC 验收

Page Agent、Python Browser Use、Pi 使用同一份匿名化异常样本与页面夹具，分别测量成功率、错误动作率、取消后的新增动作、耗时、用量及运行资源。至少覆盖普通 DOM 弹窗、无文字图标、同源/跨域/嵌套 iframe、页面导航或关闭、原生 dialog、无法判断的业务确认和非弹窗异常。

必须独立验证：只操作绑定故障页；日志确认失败时不执行动作；停止后无新动作；动作回执丢失时返回结果未知；已有浏览器保持运行；主流程无重复提交；重启后能从唯一日志源重建时间线。通过这些验收后再决定框架，不能以文档能力或单次演示宣布生产可用。

## 官方来源

Python 固定提交 `914c59bdd4acd50e9628a97a96a3919313aebc85`：

1. [README 与官方生态入口](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/README.md)。
2. [Python 版本、依赖与平台条件](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/pyproject.toml)。
3. [BrowserProfile：CDP、keep_alive、iframe 与录制配置](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/browser/profile.py)。
4. [BrowserSession：target 选择与 stop/kill/close 生命周期](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/browser/session.py)。
5. [Agent：模型、回调顺序、动作循环、停止、关闭与移除 cloud sync](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/agent/service.py)。
6. [Tools：动作注册、禁用、坐标点击与异步执行](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/tools/service.py)。
7. [DOM：跨域 iframe/OOPIF 遍历及限制](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/dom/service.py)。
8. [History 与用量数据](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/agent/views.py)；[可选 tracing 包装](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/observability.py)。
9. [Browser Use Pi README](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/README.md)；[package.json](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/package.json)；[公开配置类型](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/src/types.ts)。
10. Pi 固定提交：[sessions](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/docs/sessions.md)、[API/hooks](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/docs/api.md)、[worker](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/src/worker.ts)、[runtime 清理](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/src/runtime.ts)、[工具 hook 实现](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/src/agent.ts)、[默认文件持久化](https://github.com/browser-use/browser-use-pi/blob/e73c28b87998afddc168951b3f768a3f0e81d640/src/index.ts)。
11. [遥测默认配置](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/config.py)；[遥测事件字段](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/telemetry/views.py)；[遥测发送实现](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/telemetry/service.py)。
12. [保留的旧 CloudSync 实现](https://github.com/browser-use/browser-use/blob/914c59bdd4acd50e9628a97a96a3919313aebc85/browser_use/sync/service.py)；须与来源 5 的当前 Agent 接线共同判断。
13. [Cloud V4 Create Run 公开参数](https://docs.browser-use.com/cloud/api-v4/runs/create-run.md)。
14. [Cloud V4 可观察事件](https://docs.browser-use.com/cloud/agent/observability.md)；[官方产品区分](https://docs.browser-use.com/cloud/which-product.md)。
