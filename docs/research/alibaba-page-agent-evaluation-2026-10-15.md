# Alibaba Page Agent 适配调研

调研日期：2026-10-15。核验对象：Alibaba 官方仓库 `v1.12.4`，其 tag 指向提交 `9eb6b6646500264d9034dd466a4270cb9fc1ef1e`。本文只做官方资料与源码评估，未安装业务依赖、未接入真实 OTA 页面。固定提交链接用于保留本次结论的依据，不代表后续版本行为。

> 当前选型：Page Agent 与 Browser Use 均纳入正式候选。本文描述 Page Agent 的适配条件；跨候选比较见[主设计 4.7](../architecture/llm-agent-integration-design.md#47-browser-use-是否纳入以及如何比较)与 [Browser Use 专项评估](browser-use-evaluation-2026-10-15.md)，最终依相同异常样本的验证结果决定。

## 结论

**可以考虑 Page Agent，尤其适合异常发生后对未知 HTML 弹窗进行观察与关闭。当前需求无需强制引入 Vercel AI SDK，也无需用 Page Agent 承载全部业务。**

推荐把两条链路分开：

1. **产品采集映射**：把已采集的 OTA 产品及 PMS 房型、房价码、预订类型候选作为结构化数据交给模型，返回候选 ID、匹配理由、置信等级与歧义。采用轻量模型客户端或已有网关即可；候选关系、酒店范围、人工编辑保护和最终保存由业务代码校验。这里不需要浏览器 Agent 逐格点选。
2. **搬单异常处置**：模型结合异常和现场判断原因；若为页面弹窗，调用 Page Agent 执行一个受限的页面子任务，再由现有 Playwright 与订单流程核验恢复；其他原因生成可读分析后，由项目接入的消息服务发送通知。当前仓库未确认已有业务消息推送接口，仍需新增集成。页面 Agent 不取得订单提交和任意消息发送权限。
3. **执行追踪**：统一由项目维护关联 ID、事件与持久化。Page Agent 的事件、history 和模型调用记录可以作为输入来源，但不是已经完成的业务审计系统。

以上是本项目的设计建议。Page Agent 与 Vercel AI SDK 不在同一抽象层：前者包含面向网页的观察、决策、操作循环；后者提供更通用的模型调用与 Agent 开发能力。应根据需要复用的能力取舍，不能仅按名字视为可直接互换。[1][2][3]

## 包与运行方式

本次 `npm view` 的单包 `dist.unpackedSize`：`ai@6.0.307` 为 7,207,039 字节；`@page-agent/core@1.12.4` 为 108,464 字节，`@page-agent/page-controller@1.12.4` 为 272,522 字节，`@page-agent/llms@1.12.4` 为 52,448 字节。它们不包含相同的内容，且不代表完整传递依赖体积、最终 bundle、内存或执行延迟。Core 还依赖 Controller、LLMs、chalk，Controller 依赖 ai-motion，LLMs 有 Zod peer dependency；不能仅凭上述单包值宣称整个方案运行更快或零依赖。本次没有安装/构建两套方案进行同口径测量。

| 入口 | 官方实现 | 本项目适配判断 |
| --- | --- | --- |
| `page-agent` | `PageAgentCore` + `PageController` + 自带 `Panel`；默认启用操作遮罩。[2] | 适合演示或给网站增加助手。生产接入不必带入其面板，避免新增第二套用户入口 |
| `@page-agent/core` | 无面板的网页 Agent；每步读取页面、调用模型、执行工具；支持自定义、覆盖、移除工具。[3][4] | 优先考察的完整网页子任务执行器；仍需处理第三方页面注入、模型请求中转与主流程边界 |
| `@page-agent/page-controller` | 独立于 LLM 的 DOM 提取、索引、点击、输入、下拉选择、滚动能力。[5] | 若 Core 的宿主与类型约束不适合，可以只复用它，在主进程维护有限业务循环；这属于另一条适配路径，应先比较 POC |
| Chrome 扩展 | 通过远程页面控制器增加跨标签能力；声明 `tabs`、`tabGroups`、`sidePanel`、`storage` 与 `<all_urls>` 权限。[6] | 当前已有 Playwright/CDP 与页面生命周期，不建议首期为单页弹窗处理另引入扩展 |
| `@page-agent/mcp` | Beta；Node 20+、Chrome 扩展和 LLM 配置；通过 stdio → Node HTTP/WS → 扩展 hub tab 执行自然语言任务，工具为 `execute_task / get_status / stop_task`。[7] | 可用于外部 Agent 客户端；本项目内部直接集成不必增加 MCP、hub 和扩展部署链 |

官网称 Core 可在非浏览器环境配合自定义 `PageController` 使用，但这不是现成的官方 Playwright adapter。[8] 源码还有一个必须先解决的类型问题：Core 的配置接收具体的 `PageController` 类，该类含 private 成员；普通远程控制器无法只靠结构匹配满足这一类型，官方扩展接入处实际使用 `as any`。本项目禁止 `any`，不能照抄这个接法，也不能把官网示例当作已通过本项目类型检查的实现。[3][5][6]

可评估的实现路线是：

- Core 与标准控制器一起在目标页面运行，通过受限请求中转把模型调用交回可信宿主；主流程仍在 Electron，需验证页面导航、取消、超时与消息桥隔离。
- 仅在目标页面使用 `page-controller`，模型调用、允许的动作和追踪由 Electron 主进程协调；需要自有的短循环，但无需复刻通用 Agent 平台。

## 与弹窗恢复的匹配程度

官方实现每一步都重新获取页面状态，提取带索引的可交互元素，模型选择工具，随后执行点击等动作。因此不要求预先为每种 HTML 弹窗写选择器，符合“异常触发后，依据当前页面识别并关闭弹窗”的需求。[3][5]

但“未知弹窗”不等于“任意弹窗都能处理”：

- 官方明确只依赖 DOM，不截图、无视觉识别；图片、Canvas、WebGL、SVG 的视觉内容无法理解。单独使用 Page Agent 不提供截图证据，项目可以用 Playwright 采集供审计。[9]
- 官方交互范围包含单层同源 iframe；跨域和嵌套 iframe 不支持。键盘快捷键、坐标操作、悬停、拖拽等也在限制清单中。[9]
- 页面脚本库面向当前页和 SPA；跨标签操作由扩展提供。完整页面导航会替换页面脚本环境，这是接入方案需要处理的生命周期问题，不能把单页 `execute()` 当作跨导航的持久任务。[9]
- 浏览器原生 `alert/confirm/prompt` 不属于页面 HTML DOM。这里对其不适用是根据 DOM 工作方式作出的适配判断，应交由 Playwright 的原生 dialog 能力单独处理。
- 快速变化的控件、缺少语义的图标等会降低成功率；每步重新观察也不能消除观察与点击之间的页面变动。[9]
- 本次没有真实 OTA CSP、Trusted Types、页面反自动化等验证。需在目标站点核验本地打包脚本的注入方式、是否会被样式或脚本策略阻挡，不能承诺“无需权限即可在任何第三方页面工作”。实验性任意 JavaScript 工具使用 `eval`，首期保持关闭。[5]

## 动作权限与失败语义

不能只给模型一句“只关闭弹窗”就认为权限已经受限：

1. `customTools` 可覆盖或移除点击、输入、选择等内置工具。首期只保留确实需要的观察、滚动、受控点击与完成工具，禁用输入、表单选项修改、任意脚本和无关工具。[3][4]
2. `interactiveWhitelist` 的源码语义是“强制把这些元素认作可交互”，**不是“只允许操作这些元素”**。它不排除其他正常交互元素，不能直接作为排他权限白名单。[10]
3. 标准点击工具按任意索引执行，不能区分“关闭广告”与“取消订单”。需要在自定义工具执行器或受控执行层，在实际点击前检查当前页面身份、当前快照、动作范围与取消状态；由模型理解弹窗业务含义，执行层限制允许的副作用。无法确定时明确失败或转人工。
4. 控制器动作会返回 `success / message`，而 Core 内置点击工具只将 `message` 交回模型；最终 `done.success` 是模型提供的任务结论。它不能代替业务端对弹窗消失、页面可操作、订单状态和重复搬单风险的独立核验。[4][5]

这些控制针对操作类型与副作用边界，并不要求枚举所有弹窗样式。

## 追踪能力及缺口

固定版本已有：

- `statuschange`：状态变化；`historychange`：历史变化；`activity`：正在思考、工具执行前后、重试、错误。[3][4]
- 每个 step 的动作名称、参数、输出、模型用量、`rawRequest / rawResponse`；`activity.executed` 还带耗时。`history` 保存于实例内存，每次 `execute()` 都会清空，不是跨重启持久存储。[3][4]
- `onBeforeTask / onBeforeStep / onAfterStep / onAfterTask`，但官方将这些 lifecycle hooks 标记为实验性。[4][8]
- `stop()` 通过 AbortSignal 取消并等待任务结束，工具需要协作响应；取消无法撤销已经发出的浏览器动作。[3][4]

接入时应明确以下限制：

- `activity` 由 `dispatchEvent` 发出，框架不会等待异步监听器完成。不能用一个异步事件监听器实现“动作前日志持久化成功后才准点击”。[3]
- `onBeforeStep` 发生在页面观察与模型决定动作之前，此时还不知道具体动作，也不能作为最终动作审批点。[3]
- Core 没有通用、独立的异步 `beforeTool` 配置。需要覆盖工具执行器，在 `await` 审计确认后执行受控动作；不能只靠步骤后 hook 补记录。项目日志仍经 Redux `addLog / addLogs` 与既有 `logPersistenceMiddleware` 进入唯一 IndexedDB，不另建文件日志库。
- `history` 中的 reflection、memory、next goal 是模型输出的决策摘要，不代表完整内部思维链。向用户展示可观察的调用、依据、动作与结果即可。
- `rawRequest` 包含页面文本和任务，必须按最小必要原则脱敏；失败事件也可能含原始响应。记录应包含 `runId / spanId / parentSpanId / step / pageId / businessId`、模型版本、参数、耗时、用量、执行前后证据、独立核验及通知回执。

## 模型与凭据

固定版本内置客户端使用 OpenAI 兼容的 `/chat/completions` 和 function calling；支持 `baseURL / model / apiKey / customFetch / transformRequestBody`。不应据此推导所有厂商原生 API、模型或结构化输出模式都可无适配使用。[11]

官网的生产鉴权建议是由后端转发模型请求，通过 `customFetch` 携带应用鉴权，避免把长期模型密钥写入前端。[12] 本项目同样不应把密钥注入 OTA 页面。若使用主进程中转，桥接能力必须限定页面和任务、请求大小、模型、预算、取消与超时；不能把通用 HTTP 或 Electron IPC 能力暴露给不受信任的站点脚本。`customFetch` 只是扩展点，官方没有提供本项目的安全桥接实现。

## POC 验收

先做一个窄范围、可追踪的弹窗子任务 POC，再确定完整 Core 或仅 Controller：

1. 本地页面覆盖普通 DOM 弹窗、无文字关闭图标、动态变化、无法关闭、非弹窗异常；验证错误分支和未执行任何危险动作。
2. 在目标 OTA 的真实宿主核验注入、CSP、frame 分布、点击事件兼容、整页导航与页面身份绑定。
3. 验证动作前日志失败阻断动作、取消后无新动作、动作已发出但回执丢失时记录“结果未知”并重新观察。
4. 核验弹窗确实消失且原流程可以继续；不允许依据 `done.success` 直接把订单标记成功。
5. 重启 Electron 后能重建执行时间线；回看历史不重放真实点击与消息发送。

MIT 许可证允许作为候选，但打包时仍需保留适用的许可证与版权声明，单独核查传递依赖；官方也声明其 DOM 与 prompt 源于 MIT 的 browser-use。[1][13]

## 官方来源

以下源码均固定到 `9eb6b6646500264d9034dd466a4270cb9fc1ef1e`：

1. [README：定位、文本 DOM、可选扩展与来源](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/README.md)。
2. [PageAgent：Core、Controller 与 Panel 的组合](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/page-agent/src/PageAgent.ts)。
3. [PageAgentCore：执行循环、事件、hooks、取消、历史、工具执行](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/core/src/PageAgentCore.ts)。
4. [Agent 类型](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/core/src/types.ts)及[内置工具](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/core/src/tools/index.ts)。
5. [PageController：DOM 与动作](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/page-controller/src/PageController.ts)。
6. [扩展 MultiPageAgent](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/extension/src/agent/MultiPageAgent.ts)及[扩展权限](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/extension/wxt.config.js)。
7. [MCP README：要求、工具与架构](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/mcp/README.md)。
8. [Core 官方 API 文档源文件](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/website/src/pages/docs/advanced/page-agent-core/page.tsx)及[Controller 自定义实现文档](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/website/src/pages/docs/advanced/page-controller/page.tsx)。
9. [官方能力限制](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/website/src/pages/docs/introduction/limitations/page.tsx)。
10. [DOM 交互黑白名单实现](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/page-controller/src/dom/dom_tree/index.js#L695-L720)。
11. [OpenAI 兼容客户端实现](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/llms/src/OpenAIClient.ts)。
12. [官方模型文档：生产鉴权、customFetch](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/packages/website/src/pages/docs/features/models/page.tsx)。
13. [MIT LICENSE](https://github.com/alibaba/page-agent/blob/9eb6b6646500264d9034dd466a4270cb9fc1ef1e/LICENSE)。
