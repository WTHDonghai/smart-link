# LLM Agent 框架与浏览器工具选型调研

调研日期：2026-10-15。范围：渠道产品与 PMS 房型/房价码匹配、搬单异常诊断、有限的弹窗恢复、执行链路追踪。本文是方案依据，不表示依赖已经安装或功能已经验证。

> 后续选型补充：新增 [Alibaba Page Agent 专项评估](alibaba-page-agent-evaluation-2026-10-15.md)和 [Browser Use 专项评估](browser-use-evaluation-2026-10-15.md)。[主设计文档](../architecture/llm-agent-integration-design.md)当前采用“轻量模型客户端 + 受限浏览器子任务”，Page Agent 与 Browser Use 同轮验证，AI SDK 保留为备选。下文保留最初框架比较与版本核验依据，不代表最终必须引入 AI SDK，也不代表排除 Browser Use。

## 初始建议（当前结论见主设计）

建议采用 **Vercel AI SDK Core 6.x + 项目自有的轻量业务编排 + 现有 Playwright 页面工具**：

- 在现有产品采集流程内，使用结构化输出从真实 PMS 候选集合选择房型、房价码、预订类型，直接填充现有三个选择字段，并提供逐行置信度；保留人工纠正和现有保存动作。通常无需自主工具循环。
- 异常恢复使用 `ToolLoopAgent` 执行有步骤、时间及权限上限的观察与操作；恢复任务的状态、页面占用、去重和最终业务核验仍归项目管理。
- 使用项目领域事件追踪整个过程，SDK 生命周期事件只是补充来源。不得把任一供应商的云端 trace 当作业务日志唯一来源。
- 本轮不引入 LangGraph、独立 MCP 浏览器进程、Python 浏览器 Agent 或多 Agent 调度。若后续出现跨天暂停、跨进程恢复、复杂人工审批，再重新评估 LangGraph。

以上是本项目适配判断，不是官方框架性能或可靠性排名。

## 框架比较

| 选项 | 官方能力与优势 | 本项目需要自行完成的部分 | 建议 |
| --- | --- | --- | --- |
| Vercel AI SDK Core | TypeScript、多供应商适配、结构化输出、工具调用与有界工具循环；可接生命周期和 OpenTelemetry。[1][2][3] | 业务状态、真实页面占用、业务结果核验、领域审计、持久化和通知幂等 | 首选。复用模型协议与工具循环，避免重写 SDK |
| OpenAI Agents SDK TS | Agent、工具、结构化输出、guardrail、运行状态及内置 tracing；可使用非 OpenAI 模型适配面，但功能支持需逐项核验。[4][5][6] | 项目状态边界与审计接入；默认 trace 行为、敏感内容和导出目的地治理 | 如果明确统一 OpenAI 生态，这是可行备选；不能误称只支持 OpenAI |
| LangGraph JS | 图状态、checkpointer、人工中断、历史和重放。[7][8] | 确定图语义、接入持久存储；浏览器副作用的重放隔离及业务幂等 | 当前两条流程较短，引入图与 checkpoint 管理的收益不足 |
| 模型官方 SDK + 完全自写循环 | 接口直接、依赖面小，适合单次结构化调用 | 工具循环、消息拼装、业务取消协调、预算、错误协议、usage、供应商差异和追踪适配均需维护 | 可用作极简 POC；不建议重复实现已有通用能力 |

“采用框架”和“自研”不是二选一：模型调用、schema、工具循环使用 SDK；酒店业务状态机、权限与结果核验由项目实现。不要把模型返回结构通过 schema 校验误认为语义正确或业务成功。

## 版本与追踪行为

官方 AI SDK 默认文档本次显示为 **v7 Latest**。[1] 但本项目 Electron 33 内嵌 Node 20，而不是开发终端的 Node 22。Electron 33.4.11 官方 release 页列出的 Node 为 20.18.3。[14]

本次执行 `npm view ai dist-tags engines --json` 和 `npm view ai@6.0.307 engines dependencies --json` 得到：`latest = 7.0.141`，`ai-v6 = 6.0.307`；7.0.141 的 engines 为 `node >=22`，6.0.307 为 `node >=18`。因此首期候选应锁定 `ai@6.0.307`，而不是直接装 latest。这个 engines 范围仅排除了已知版本冲突，不能替代 Electron 打包与运行验证。

官方 `ai@6.0.307` tag 的文档确认支持 `ToolLoopAgent`、`stepCountIs`、`Output.object`、`prepareStep` 和 `onStepFinish`。[15] 不要把默认官网 v7 的 `isStepCount` 或 `onStepEnd` 写法混入 v6。工具执行器仍须自行实施权限检查、取消和业务验证。provider、Zod 等依赖的确切版本、peerDependencies 和全量依赖 engines 必须一起锁定核验。

6.0.307 tag 文档的遥测配置是 `experimental_telemetry`，需要显式启用；启用后输入/输出默认记录。[16] 首期显式关闭 SDK 遥测，使用业务执行器与 `onStepFinish` 投递领域事件。该 tag 还说明 telemetry integration 内部错误会被捕获，故不能依赖 integration 写入承担“记录失败即阻止危险动作”的审计要求，动作审计必须在业务执行器内直接等待确认。

作为未来升级注意：v7 telemetry 文档改为 opt-out。[3] 升级时必须逐调用检查 `telemetry: { isEnabled: false }` 等配置，不能假定旧默认行为仍成立。

OpenAI 官方说明 Agents SDK 正常服务端路径默认启用 tracing，记录模型、工具和自定义 span，并可在 Traces dashboard 查看。[5] 选用它时，必须在 POC 核验关闭默认导出或替换 processor 的实际 TS API，不要假定默认日志只留在本地。

本项目建议先使用自有 `runId / spanId / parentSpanId / sequence` 领域事件。记录输入快照标识、模型版本、工具参数摘要、动作结果、耗时、usage、错误、核验结论和通知回执。追踪的是可观察执行与决策依据摘要，不承诺获得或存储模型内部完整思维链。

## LangGraph 的边界

LangGraph checkpointer 能保存线程状态，但 `MemorySaver` 是内存实现，不能当作跨应用重启的持久化保证。[7][8] 官方也区分 `exit / async / sync` 的耐久性，并说明 replay 会重新执行 checkpoint 之后的节点，包括模型调用和 API 请求。[8]

因此，即使后续采用 LangGraph，也不能让 graph replay 自动重放“点击确认”“搬单提交”“发送通知”等副作用。恢复仍需重新观察当前页面、核验订单状态，并由业务执行器决定可执行动作。checkpoint 是工作流状态，不应变成第二套业务日志。

## 浏览器工具比较

| 路径 | 事实依据 | 适配判断 |
| --- | --- | --- |
| 现有 Playwright + 项目 function tools | Playwright 提供 locator/page ARIA snapshot 等观察能力。[9] | 首选；在既有页面所有权中执行，观察→候选操作→权限检查→执行→重新观察。模型不需要预知每种弹窗，但工具能力和操作范围必须明确 |
| Playwright MCP | 官方服务器提供 accessibility snapshot、浏览器操作，可通过 CDP 接入；官方明确它不是安全边界。[10] | 适合跨 Agent/跨应用统一工具协议；本地同进程函数工具更简单。不得因使用 MCP 假定已实现页面隔离和权限控制 |
| Stagehand | 官方 v3 文档提供 `act / extract` 与 Playwright/CDP 集成，示例由 Stagehand 初始化浏览器。[11] | 可作为后续对照 POC；不能把该示例等同于已无缝接管本项目现有浏览器生命周期。先验证已有页面接入、关闭语义及版本兼容 |
| Browser Use | 官方区分 Python 本地 Agent、Cloud API；另有 Browser Use Pi 等 TS 路线。Cloud TS SDK 与本地 TS Agent 是不同产品。[12][13] | 已纳入正式对比候选。此前只关注 Python/Cloud 的分类不完整；具体版本、CDP、视觉、iframe 与交付成本见 [专项评估](browser-use-evaluation-2026-10-15.md) |

具体工具建议只暴露观察、选择当前快照中的候选控件、有限关闭动作与核验结果。不要向模型开放任意 `evaluate`、任意 JS、任意页面跳转、任意网络请求或任意通知接收人。页面文本是待分析数据，不能覆盖系统约束。

仅依赖 ARIA/DOM 无法保证覆盖所有图形或跨域弹窗；可按模型与隐私策略补充裁剪截图。是否允许坐标点击应单独评测；首期无法确定控件或弹窗业务含义时进入人工处理。

## POC 必须验证

1. 先在 Electron 实际内嵌 Node 中核验 SDK、provider、Zod 和传递依赖 engines、ESM/CJS 及打包 external 依赖，不以 shell Node 通过作为兼容结论。在主进程执行 SDK 调用，renderer 不持有模型长期密钥；供应商请求、超时、取消、usage、schema 和工具错误均能输出完整可关联事件。
2. 检查依赖实际版本的默认网络访问和遥测配置；关闭 SDK 自动 trace 后，领域链路仍完整。
3. 模型只可返回候选中的房型/房价码 ID；不存在、过期、跨酒店或属性冲突必须被代码拒绝。
4. 弹窗恢复只能占用异常所属的物理页面；旧快照、页面切换和任务取消后不得继续点击。
5. 工具超时发生于动作提交后时，记为结果未知并核验现场，不能直接重试。
6. 对 trace 展示进行历史记录重建，对真实浏览器动作禁止一键历史重放；截图、订单及个人信息按最小必要原则处理。

## 官方来源

1. AI SDK 简介及供应商支持：<https://ai-sdk.dev/docs/introduction>
2. ToolLoopAgent、结构化输出及生命周期：<https://ai-sdk.dev/docs/agents/building-agents>
3. Telemetry 默认行为及内容采集控制：<https://ai-sdk.dev/docs/ai-sdk-core/telemetry>
4. OpenAI Agents SDK 概览：<https://developers.openai.com/api/docs/guides/agents/sdk>
5. OpenAI SDK 工具集成与可观测性：<https://developers.openai.com/api/docs/guides/agents/integrations-observability>
6. OpenAI SDK 模型与输出契约：<https://developers.openai.com/api/docs/guides/agents/models>；<https://developers.openai.com/api/docs/guides/agents/define-agents>
7. LangGraph JS persistence：<https://docs.langchain.com/oss/javascript/langgraph/persistence>
8. LangGraph JS checkpointers、durability 与 replay：<https://docs.langchain.com/oss/javascript/langgraph/checkpointers>
9. Playwright ARIA snapshots：<https://playwright.dev/docs/aria-snapshots>
10. Microsoft Playwright MCP README：<https://github.com/microsoft/playwright-mcp>
11. Stagehand v3 Playwright 集成：<https://docs.stagehand.dev/v3/integrations/playwright>
12. Browser Use Cloud quickstart：<https://docs.browser-use.com/cloud/quickstart>
13. Browser Use local quickstart：<https://docs.browser-use.com/open-source/quickstart>
14. Electron 33.4.11 内嵌版本：<https://releases.electronjs.org/release/v33.4.11>
15. AI SDK `ai@6.0.307` 固定 tag 的 Agent 文档：<https://github.com/vercel/ai/blob/ai%406.0.307/content/docs/03-agents/02-building-agents.mdx>
16. AI SDK `ai@6.0.307` 固定 tag 的 telemetry 文档：<https://github.com/vercel/ai/blob/ai%406.0.307/content/docs/03-ai-sdk-core/60-telemetry.mdx>
