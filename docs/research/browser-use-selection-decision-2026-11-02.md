# 浏览器 Agent 选型决策记录（P0-②）

> 状态：已决策（运营方于 2026-11-02 直接选定，跳过与 Page Agent 的并行对比验证）。
>
> 结论对象：[LLM Agent 集成设计 §4.6 / §4.7](../architecture/llm-agent-integration-design.md#47-browser-use-是否纳入以及如何比较) 中的浏览器候选选择。
>
> 关联调研：[Browser Use 专项评估](browser-use-evaluation-2026-10-15.md)、[Page Agent 专项评估](alibaba-page-agent-evaluation-2026-10-15.md)。

## 决策

**选定 Browser Use 作为受限浏览器子任务（阻挡弹窗观察与关闭）的实现路线。** 不再进行 Page Agent 与 Browser Use 的同轮对比，工程验证资源全部投入 Browser Use 接入。

## 路线界定（依 §4.7 的产品区分）

| 路线 | 决策 | 依据 |
| --- | --- | --- |
| `browser-use` Python 主库（固定 0.13.11）本地 Agent | **采用**：由 Electron Main 经 stdio 监督本地 worker，worker 通过 `cdp_url` 附着现有浏览器/指定 target，仅执行受限恢复 | 复用客户当前登录会话与物理页面；DOM+截图辅助判断能力覆盖美团嵌套 frame 场景 |
| Browser Use Pi（`@browser_use/pi`，TS） | **不采用**，除非以下全部解除：README 要求 Node 22.19+ 而本项目 Electron 33.4.11 内置 Node 20.18.3；固定源码在 workspace 写 `.browser-use/runs/` JSON/JSONL 文件形成第二日志源，违反唯一数据源治理且未确认可关闭；Pi 单次 REPL 调用可含多个 CDP 动作，无法认定逐动作经宿主授权 | 设计 §4.7 的硬性约束 |
| Browser Use Cloud / Cloud SDK | **不采用**：托管浏览器不是当前 OTA 现场 | 会话接入与数据处理方式不满足「复用本地现场」前提 |
| Alibaba Page Agent | 转为不再投入验证的备选记录 | 运营方决策；其单层同源 iframe 限制对美团 `#me-iframe-container` 场景本就存疑 |

## 决策不免除的工程硬门槛

选型决策跳过的是「厂商对比」，以下门槛是本项目治理红线，任何候选都必须通过后才能进入 P4 自动关闭试点：

1. **唯一日志源**：关闭 Browser Use 产品遥测与可选的会话文件、录像等自动落盘；领域事件统一进入现有 Redux → `logPersistenceMiddleware` → `SmartLink_LogDB` 链路。框架内存 history 可用，不新增自动文件日志。
2. **逐动作权限与审计**：不依赖域名限制或提示词约束动作；每个真实动作在实际执行器内经过权限判定与 P1 已交付的持久化确认闸门（`waitForEntryCommit` + `agentTraceLedger`）后才执行。
3. **页面所有权**：worker 附着不得切换其他任务的活动页、不得产生新登录会话、不得与原 Runner 并发操作；目标页丢失必须显式报错终止，不接受换页继续。
4. **生命周期**：明确 `keep_alive` 与 stop/detach/kill 语义；worker 取消和退出不得关闭原业务浏览器；动作已发出但结果丢失时标记未知并重新观察，不重放。
5. **交付成本实测**：Windows 安装包内嵌 Python 运行时（>=3.11）与 worker 的打包体积、启动、取消、退出验证。

## 后续动作

- P3（异常诊断与通知）不依赖本决策，可先行。
- P4 前置 POC 清单（依 §13.1-2）：同一批脱敏异常页面上验证 CDP 附着现有会话、受限动作、逐动作持久化确认、worker 退出语义与 Windows 打包成本；POC 不通过则回到设计层面的候选重评，不静默降级。
- Browser Use worker 专属环境变量（如 Python 路径、worker 入口）在 POC 确定具体形态后再预留，不提前抽象。
