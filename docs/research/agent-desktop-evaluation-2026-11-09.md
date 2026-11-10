# agent-desktop（vercel-labs）适配调研

调研日期：2026-11-09。核验对象：Vercel Labs 官方仓库 `vercel-labs/agent-desktop`（Rust，Apache-2.0），官方文档站 agent-browser.dev/desktop 的内容源（随仓库发布），npm 包 `agent-desktop`。本文只做官方资料与源码评估，未安装业务依赖、未运行模型、未操作真实页面。

## 核验基线

| 项目 | 值 |
| --- | --- |
| 仓库快照 | `git clone --depth 1`（main 分支），快照日期 2026-11-09 |
| Commit | `b43ac4f6e892ef608f8851428613c4009f0e84c7` |
| npm 版本 | `agent-desktop@1.2.0`（registry `time.modified = 2026-11-05T02:46:18Z`；unpackedSize 30,720,645 字节 ≈ 29.3 MB；fileCount 26；Apache-2.0） |
| 文档基线 | 文档站内容源在仓库 `apps/docs/content/docs/`（mdx）；本报告引用即快照内文件，线上站点可能略新 |
| issues 基线 | **本次不含 GitHub issues 独立核验**；文中出现的 issue/PR 链接均出自仓库内 CHANGELOG/文档的内嵌引用 |
| 核验方式说明 | 本次由父会话抓取快照到本地后逐文件阅读核验（researcher 无网络工具）；npm registry 元数据由父会话核验提供 |

引用格式：`[n]` 对应文末来源清单；来源给出仓库相对路径与（可靠的）行号锚点，并附固定 commit 的 GitHub URL 供回溯。个别长文件以 §节名定位，避免行号漂移。

> 与既有调研的关系：[Page Agent](alibaba-page-agent-evaluation-2026-10-15.md) 与 [Browser Use](browser-use-evaluation-2026-10-15.md) 是**浏览器内**页面操作候选；agent-desktop 是**操作系统无障碍树**的桌面表面工具，二者作用层不同。本文按相同方法论核验。

## 结论

**1）agent-desktop 官方明确不做网页自动化**："It does not automate web pages. Use agent-browser for those."[21] 网页内容只有经 `launch --cdp` 开出一个回环 CDP 端口、交给 agent-browser（或 Playwright/Puppeteer 等 CDP 客户端）驱动这一条路，而且"agent-desktop 从不自己说 CDP"，只负责开端口、验端口、保留原生 UI[10]。**因此它不能替代本项目现有 Playwright 主执行器，也与 Page Agent / Browser Use 的页面内弹窗处置几乎不重叠。**

**2）它真正补的短板是「浏览器之外」的系统级表面**：原生菜单、文件对话框与 sheet、窗口管理、系统通知、任务栏/开始菜单/通知中心等 OS shell 表面[10][8][29]，以及任何桌面应用窗口（含抢占焦点的其他应用）。这与本项目「未知弹窗处置/异常恢复」中 Playwright 较弱的非 DOM 场景互补。

**3）工程质量对本项目的 Fail-Fast 纪律高度友好**：无内嵌模型[1]；每命令输出单行 JSON envelope（契约版本 2.6）[5]；16 个结构化错误码 + `error.disposition.delivery/retry` 投递语义——只有 `not_delivered` 才是 `retry: safe`，其余一律"先观察再决定"[4]；headless 默认语义交付，绝不静默切换物理输入[7]。这套"结果可证伪、重试有门槛"的契约与 AGENTS.md 第 5 节红线一致。

**4）Windows 为主的客户分发有两个实际风险**：二进制未签名——SmartScreen 对浏览器下载会警告、杀软可隔离，**全新 Windows 11 的 Smart App Control 会无条件拦截，且无任何安装方式或启动模式可绕过**[12][20]；UIA 驱动要求交互式桌面会话，**锁屏 / UAC 安全桌面 / Session 0 不支持**[12]，无人值守值守若锁屏则失效。macOS 需要给宿主 App 授辅助功能权限[11]；Linux 有 AT-SPI 总线与发行版前提[13]。

**5）定位建议**：**建议纳入候选池，但仅作为「系统级/浏览器原生表面」子场景的受限辅助执行器**（详见 §9），不进入 OTA 页面弹窗处置主线；页面内 DOM 弹窗继续由 Page Agent / Browser Use + Playwright 承担。

---

## 1. 能力与架构

### 1.1 定位与总体结构

- "Computer use for AI agents: see and operate desktop apps on macOS, Windows, and Linux through the OS accessibility tree"；经 AX API（macOS）/ UI Automation（Windows）/ AT-SPI（Linux）读取目标应用[1]。
- "The loop lives in your agent; agent-desktop has no model inside. It ships as a CLI and a C library."——观察-行动-验证循环完全在调用方；无内嵌模型[1]。
- 架构：CLI 或 C 库 → 同一个 `agent-desktop-core` → 仅经 `PlatformAdapter` trait 到达操作系统；每个二进制只为一个 OS 构建[1]。工作区依赖清单仅有 clap/serde/serde_json/thiserror/tracing/tracing-subscriber/base64/libc 等**本地设施，无任何 HTTP 客户端或遥测上报库**[24]。

### 1.2 snapshot / ref 模型

- `snapshot` 读取一次无障碍树，为每个可操作元素分配形如 `@<snapshot_id>:eN` 的 ref；裸 `@eN` 一律 `INVALID_ARGS`[3]。ref 按 DFS 文档序分配；可获 ref 的角色为 18 个交互角色（button/textfield/checkbox/link/menuitem/tab/slider/combobox/treeitem/cell/radiobutton/incrementor/menubutton/switch/colorwell/dockitem/listbox/option）或宣告主行动作（scrollarea/disclosure）的元素[3][21]。
- ref 存的是"再识别证据"而非活对象（pid + process_instance、role/name/value/description/native_id、`unique_at_capture`、来源窗口与 surface、path/root_ref）[3]。每次带 ref 的命令都先严格重识别：macOS 携带元素自身地址可精确回指；Windows/Linux（及 macOS 无地址元素）要求**捕获时唯一 + 当前全窗口恰好一个匹配**，否则 `AMBIGUOUS_TARGET`（`identity_not_unique`/`saved_ref_ambiguous`）或 `STALE_REF`（`saved_ref_absent`/`retained_object_stale`），"宁可拒绝绝不猜"[3]。这是 envelope 2.6（v1.1.0）引入的破坏性收紧[22]。
- 存储：`snapshots/<snapshot_id>/refmap.json`，单 refmap 上限 1 MB（超限 `INTERNAL`）；每命名空间 128 份快照，超出裁到 96[3]。
- 密集 UI（Electron/IDE 等数千节点）：`snapshot --skeleton`（深度钳到 3，截断容器带 `children_count`）→ `snapshot --root @ref` 对单区域钻取；钻取是全有或全无（读不完 `TIMEOUT`、不写半份快照）[9]。部分观察返回 `ok:true + complete:false + truncated/nodes_observed/subtree_truncated`，调用方必须读 `data.complete`[3][5]。

### 1.3 命令集（60 个名字 / 56 个可操作）

README 与命令总表一致：**60 个命令名，56 个可操作命令**；`key-down`/`key-up`/`mouse-down`/`mouse-up` 四个"按住类"命令在守护式 held-input 落地前**失败关闭**（refuse to run）[1][2]。commands/index.mdx 划 11 组[2]，README 给出分组明细[1]：Observe（snapshot/find/get/is/screenshot/list-surfaces）、ref 动作（click/type/set-value/check/toggle/expand/scroll 等 16）、键鼠（press/hover/drag/mouse-*）、应用与窗口（launch/close-app/list-windows/focus-window/resize/minimize/maximize/restore）、通知（list/dismiss/dismiss-all/action）、剪贴板、wait、会话（session/trace/cursor-overlay）、系统（status/permissions/version/batch/skills）。

### 1.4 headless 默认与 `--headed`

- headless 是默认：ref 动作走无障碍语义调用，**不夺焦点、不动真实光标、不合成按键、不碰剪贴板**；语义路径缺失时**结构化报错（`ACTION_NOT_SUPPORTED`/`POLICY_DENIED`）失败关闭，绝不静默改走物理输入**[7]。
- `--headed` 是"允许物理输入"的显式授权（夺焦点/移光标/合成事件），不强制使用；`check`/`set-value`/`expand` 在任何平台都保持语义[7]。每平台需要 `--headed` 的命令不同：全平台 triple-click/hover/drag/mouse-* 必须；Windows 上 `right-click`/`type`/`focus` 必须（headless 写文本用 `set-value`）；Linux Wayland 指针类直接 `ACTION_NOT_SUPPORTED`[7][12][13]。
- `POLICY_DENIED` 的恢复策略是 `request_explicit_policy_then_retry_original`："永远不要为了绕过错误自行切到 headed 模式"[4][7]——与本项目"显式授权、禁止静默降级"原则同构。

### 1.5 会话（session）与持久化

- session 是状态根（默认 `~/.agent-desktop`，可用绝对路径 `AGENT_DESKTOP_HOME` 迁移；macOS/Linux 以 0700 创建，权限放宽会 `INTERNAL` 拒写）下的磁盘命名空间：独立 `snapshots/`、manifest、trace 目录[6][14]。
- **新会话默认开 trace**；`--no-trace` 建无 trace 命名空间[14]。refmap/快照跨命令持久在盘，"旧快照的 ref 在元素仍匹配时仍可解析，但 UI 变化后不得依赖"[3]。
- **常驻进程问题（对 Electron 集成重要）**：v1.1.0 已"移除 macOS command host，每次 CLI 调用都是独立进程（与 Windows/Linux 一致）"；npm 安装和 CLI 调用会清掉旧版本遗留的 command host（安装后跑一次 `agent-desktop version`）[22]。即当前版本无守护进程，"四个 held-input 命令等待未来 daemon"只是预留接口[1]。

### 1.6 batch

`batch` 在**单进程内顺序**执行 JSON 命令数组：非事务；运行前整批校验（JSON/命令名/参数/ref 语法/权限），一处失败整批不跑[28]。返回 `ok:true` 时逐条读 `results[].ok`；默认失败条目不中断（后续条目仍会跑！），`--stop-on-error` 才中断；整批默认 60 s 超时；每条带自己的 disposition，batch 从不自动重试[28]。官网明确"下一步依赖上一步输出的步骤不要 batch"[28]。

### 1.7 MCP server

`agent-desktop mcp` 经 stdio 把每个命令映射为一个 `desktop_*` 工具，返回同一 JSON envelope（`structuredContent` + 文本）[16]。工具不能逐调用改全局 flag（`--headed`/`--session` 只能在 server 命令行给定）；官方安全定性："把它当作已登录用户的 shell"——`desktop_launch` 可启动 PATH 上任意程序，屏幕文本是进入模型的不可信输入[16]。并发上限 8 个工具调用、单消息 4 MiB、取消先 SIGTERM 后 3 s 杀（Windows 直接杀）[16]。MCP 于 v1.2.0（2026-11-05）加入，是最新功能[22]。

### 1.8 C 库（FFI）

- 每个 release 附 `libagent_desktop_ffi`（dylib/so/dll）；与 CLI 同 core、同平台 adapter、同 envelope、同 ref、同安全规则与跨进程交互锁（同一用户的所有调用串行）[17]。
- 两层 API：JSON 入口（`ad_snapshot`/`ad_execute_by_ref`/`ad_wait`/`ad_status` 等，返回与 CLI 相同的 envelope 字符串）与 `*_exact` 结构化 API[17]。ABI major 当前为 **7**；`ad_init(7)` 版本不匹配即 `INVALID_ARGS`；ABI 6→7 破坏性变更：C 调用方不能再用 `*_exact` 直解析 ref（`ACTION_NOT_SUPPORTED`），必须走 snapshot ref[17][22]。
- 所有权/线程：每指针配对 free 函数；入口可任意线程调用，native handle 必须线程内闭环（跨线程传 qualified ref）；mutation×mutation 经同一用户级交互锁串行[18]。只有 `release-ffi` profile 在边界捕获 panic 为 `AD_RESULT_ERR_INTERNAL`（普通 `--release` 不会）[17][21]。

### 1.9 JSON envelope 与错误恢复（值守流程的核心契约）

- 每命令 stdout 输出**恰好一行** JSON envelope（`version`/`ok`/`command`/`data`|`error`），日志走 stderr；退出码 0/1（结构化错误）/2（解析错误）[5]。当前契约版本 2.6，官方提供 2.1→2.6 逐版迁移表（如 2.2 起超预算快照返回 `complete:false` 而非 `TIMEOUT`；2.5 移除 OperationReport 命令的 `clicked/moved/...` 之类"证明不了任何事"的成功旗标）[5]。
- **16 个错误码**，`message/suggestion` 明确声明"不是稳定接口，必须按 `error.code`/`error.disposition` 分支"[4]。关键码：`STALE_REF`（ref 不再匹配活元素→新快照新 ref）、`AMBIGUOUS_TARGET`（多窗口/孪生元素→拒绝猜测，`details.candidates` 给窗口候选）、`ACTION_FAILED`（动作被拒或结果与请求矛盾，**永不携带 recovery**）、`POLICY_DENIED`（headless 拦截物理路径）[4]。
- **`error.disposition.retry` 语义**（值守流程直接可用）[4]：

| delivery | retry | 含义 |
| --- | --- | --- |
| `not_delivered` | `safe` | 输入从未到达应用，重复不可能产生重复效果 |
| `delivery_uncertain` | `unsafe` | 可能已落地且无法证明任何一边 |
| `delivered_unverified` | `unsafe` | 已派发，效果未确认 |
| `delivered_verified` | `unsafe` | 已派发且效果已读回，重复会双重应用 |
| `unknown` | `unknown` | 对投递一无所知 |

  "仅在 `retry: safe` 时重试或替代动作；否则先观察"——重复 click 可能提交两次、重复 toggle 会自我反转[4]。三种 recovery 策略：`refresh_snapshot_then_retry_original`（STALE_REF/SNAPSHOT_NOT_FOUND）、`inspect_state_then_retry_original`（TIMEOUT/APP_UNRESPONSIVE，含 `retry_after_ms` 250ms）、`request_explicit_policy_then_retry_original`（POLICY_DENIED）[4]。
- 动作结果带 `data.disposition`、`steps`（`semantic_api` vs `physical_synthetic` 机制）、动作后 `data.surfaces`（弹出 menu/sheet/alert 即"应用在等待该覆盖层"）[5][8]。`--wait-for`/`--wait-for-gone`（选择器 `role:text`，默认 30 s）把"等 UI 生效"内建进命令；等待超时**不改变动作自身的投递语义**（超时不等于可重试）[6]。
- 状态型 ref 动作（set-value/check/toggle 等）投递后回读状态，观察到矛盾即 `ACTION_FAILED + details.kind:"post_action_verification"`（envelope 2.4 起）[5]。

---

## 2. 对浏览器网页内容的覆盖

**官方事实：**

- 经 OS 无障碍树读到 Chromium/Electron 的**网页内容**是成立的，但"web contents 可能又密又慢"；官方对可新启动的 Chromium/Electron 应用的方案是 `launch --cdp` 开回环 CDP 端口给 agent-browser/其他 CDP 客户端驱动网页，原生 UI（菜单、文件对话框、sheet、窗口管理、通知、截图）留在 agent-desktop[10]。**已在运行或非它启动的应用只有无障碍树一条路**——CDP 端口只存在于由它启动的进程上[10]。
- 渲染器无障碍树的开启条件因平台而异[11][12][13]：macOS——agent-desktop 需要时会自动打开 Chromium renderer 的 web accessibility[11]；Windows——Chromium 138+ 无需 flag 暴露完整 UIA 树，但**冷启动首次读取要 10–25 秒才稳定**，"树很薄"应加 `--timeout-ms` 重拍而非断定页面空[12]；Linux——浏览器需要 `--force-renderer-accessibility`（裸会话另加 `ACCESSIBILITY_ENABLED=1`），Electron 无需 flag（`--no-sandbox` 视情况）[13]。
- 可见内容粒度：无障碍树节点含 `role/name/value/description/native_id/states/available_actions`，bounds 默认省略（`--include-bounds` 才有）[3]。**"发布不了无障碍树的应用对 agent-desktop 不可见"**[21]；macOS 排障表把"节点少/无 ref"归因于"自绘 UI 或 Chromium renderer 尚未稳定"[11]。
- Windows 上 `sheet` surface 定义为"a Chromium modal"——即浏览器模态对话框可作为 surface 单独观察[12]。
- **网络拦截：不存在。** 用户文档中 "network"/"intercept" 零命中（父会话 grep 已核验）；命令总表无任何网络类命令[1][2]；`launch --cdp` 只开端口并验证，"agent-desktop never speaks CDP itself"[10]。与 Playwright `waitForResponse`/`route` 的能力差异是**根本性**的。

**粒度对比 Playwright DOM/CDP（本项目判断，非官方对比）：**

| 维度 | agent-desktop（经无障碍树） | Playwright（DOM/CDP） |
| --- | --- | --- |
| 元素语义 | role/name/value/states/动作（同 ARIA 语义层） | 完整 DOM：selector/class/attribute/任意查询 |
| 隐藏元素 | 无障碍树外的节点不可见（display:none/aria-hidden 等按平台语义剔除） | 可见性可选，DOM 全量 |
| 网络 | 无 | 请求/响应/路由拦截 |
| JS 执行 | 无 | `evaluate` 等 |
| iframe | 官方未区分 iframe 呈现规则；跨域 OOPIF 是否完整进入 UIA 树**未找到官方说明** | 显式 frame 遍历 |
| Canvas/自绘 | 无语义即不可见（"无无障碍树的应用不可见"[21]）——纯 Canvas 弹窗只能看到容器节点 | 同样无语义，但可坐标/截图/JS 兜底 |
| 虚拟滚动列表 | 树中只有已渲染行（推断：无障碍树按当前呈现，官方未专门讨论虚拟列表） | 同样只拿到已渲染 DOM，但有滚动/等待等配套 |

以上 agent-desktop 列中"推断"两条为本项目研究者推断，官方未逐一声明；iframe 与虚拟列表均列为待实测项（§残余风险）。

---

## 3. 与本项目「弹窗处置 / 异常恢复」场景的匹配度

先分清两层：**页面内 DOM 弹窗**（OTA 页面的 `.mtd-modal` 类浮层、业务确认框）与**系统级/浏览器原生表面**（文件选择器、打印对话框、beforeunload、系统通知、其他应用窗口抢焦点、Electron 宿主自身原生 UI）。

| 弹窗/异常类型 | 现有候选池（Page Agent / Browser Use + Playwright） | agent-desktop | 判断 |
| --- | --- | --- | --- |
| 页面内 DOM 弹窗 | 已覆盖（DOM 观察 + 语义关闭 + 独立验证） | 看得到渲染后的 a11y 节点，但官方定位不做网页[21] | **不适用**；不要用它替代页面执行器 |
| 原生 `alert/confirm/beforeunload` | Playwright 原生 dialog 事件 + Page Agent 明确不处理 | Windows 上 Chromium 模态可作 `sheet` surface 观察[12]；beforeunload 的原生对话框可见性**待实测** | 潜在补位，先实测再定 |
| 文件选择器 / 打印对话框 | Playwright 可拦截 filechooser（headless 不弹原生框）；已"逃逸"成原生对话框则无能为力 | 原生文件对话框/sheet 在其职责表内[10]，OS 窗口可观察/操作 | **核心补位场景**（发生率低但致命） |
| 系统通知横幅/通知中心 | 无 | `list/dismiss/dismiss-all/notification-action`（变更类需 `--headed`）+ `wait --notification`[29] | 补位场景（Windows 通知抢占类干扰） |
| 其他应用窗口抢占焦点/遮挡 | 无 | `list-windows`/`focus-window`/任意 app 的 snapshot；`--surface` 覆盖 taskbar/start-menu/action-center 等[8][12] | 补位场景 |
| Smart-Link 自身 Electron 原生 UI 异常 | 无（Playwright 只管 BrowserWindow 内网页） | 原生窗口/菜单/对话框均可观察（Chromium 138+ 完整 UIA，注意 10–25 s 冷启动[12]） | 潜在场景，价值中等 |
| OTA 页面内嵌跨域 iframe 中的弹窗 | Browser Use 有 CDP OOPIF 遍历路径；Page Agent 不支持 | **未找到官方说明**（§2） | 不作为理由纳入 |

**关键现场约束（本项目判断）**：本项目 OTA 页跑在 **Playwright 无头 Chromium** 里。无头浏览器通常不在桌面会话中呈现窗口，OS 无障碍树**大概率看不到它**（官方文档的所有 Chromium/Electron 场景均以"可见窗口应用"为前提）。因此 agent-desktop 对本项目的独特价值集中在：Electron 宿主原生表面 + OS shell + 同机其他应用，而不是 OTA 页面本身。此判断需在目标机实测确认（无头进程是否出现在 `list-apps`）。

---

## 4. Electron 集成形态

| 形态 | 官方事实 | 适配性（本项目判断） |
| --- | --- | --- |
| **CLI 子进程**（主进程 spawn，逐命令解析单行 JSON envelope） | 每命令一进程（v1.1.0 起三平台一致，无常驻 host[22]）；stdout 单行 JSON、日志走 stderr、退出码 0/1/2[5]；session 以 env `AGENT_DESKTOP_SESSION` 传递，`session start` 直接打印激活行[14]；PowerShell 需给 ref 加引号（`@` 是 splatting 操作符）[12] | **首选**。与现有 `src/crawler/` 进程编排风格一致；envelope 稳定契约（2.6 + 迁移表）适合强类型解析；进程spawn 开销对低频弹窗处置可接受。npm 12 默认拦 postinstall 时每次调用经 Node 启动器多 ~125 ms（见 §7） |
| **C 库 in-process** | `ad_*` JSON 入口返回同 envelope；同锁同安全规则[17]；ABI major 7，且 1.0→1.1 间发生 5→7 破坏性变更（`*_exact` 直解析被砍）[22]；须 `release-ffi` profile 才有 panic 边界捕获[17] | **不首选**。ABI 破坏性演进节奏（半年内两次 major bump）+ per-platform Rust dylib 进 electron-builder 的打包/加载成本 > 收益；低频调用场景省不下进程 spawn |
| **MCP stdio** | 每命令一工具；全局 flag 固定在 server 启动参数（`--headed` 不能逐调用给）[16]；安全定性=用户 shell；8 并发/4 MiB/取消语义明确[16] | **不首选**。内部单租户集成不需要为 MCP 增加常驻进程与第二协议面；"工具不能传全局 flag"反而让按 incident 决定 headed 的策略变别扭 |

集成时的纪律（本项目判断，按现有架构约束）：只由 Electron 主进程 spawn；每个 incident 用独立 session（或 `AGENT_DESKTOP_HOME=mktemp` 隔离状态根[6]）；默认 `--no-trace`，如需 trace 只把**脱敏后的事件摘要**经 `addLog → logPersistenceMiddleware → SmartLink_LogDB` 落库，trace 文件本身不构成第二日志源（见 §8）；headed 动作与 `--force` 类旁路一律禁止自动启用，只能作为显式人工授权项。

---

## 5. 终端用户部署负担（客户以 Windows 为主）

| 平台 | 权限/前提 | 官方出处 |
| --- | --- | --- |
| **macOS 13+** | 宿主 App（启动 agent-desktop 的那个 App）需**辅助功能**授权；`screenshot`/`--screenshots` 另需屏幕录制；部分通知操作需 System Events 自动化授权。`permissions` 无提示地报告状态；`permissions --guide` 打开系统设置对应面板引导授权；`--request` 才会弹系统提示[11] | [11] |
| **Windows 10 1809+ / Server 2019+** | **无授权对话框**：同完整性级别即 `granted`；UIPI 使"管理员运行的目标可读不可驱动"（比较进程 token，先比较后发送，`PERM_DENIED + E_ACCESSDENIED`），需同级提权终端；提权与非提权**不能共享状态根**[12] | [12] |
| **Linux（Ubuntu 24.04+）** | AT-SPI 总线可达是全部前提（`status` 检查四类总线故障）；glibc 2.35 下限（Ubuntu 22.04 桥接器会 abort）；X11 按键走 XTEST、Wayland 走 Mutter RemoteDesktop；Wayland 剪贴板需 `wl-clipboard`；私有状态根强制[13] | [13] |

对以 Windows 为主的酒店终端分发，意味着（前两条为官方事实，后三条为本项目判断）：

1. **免授权是真实优势**：标准用户会话内驱动同完整性应用无需任何 UAC/管理员操作，安装负担比 macOS 低一个量级[12]。
2. **未签名二进制是硬风险**：SmartScreen 对浏览器下载警告、杀软可隔离；**全新 Win11 的 Smart App Control 无条件拦截且"没有下载方式或启动模式可以避免"**（文档原话），只能关闭该系统功能；npm 安装不触发 SmartScreen[12][20]。若随 Smart-Link 安装包捆绑分发，可规避 SmartScreen 下载路径，但 SAC/杀软策略仍需目标机实测。
3. **锁屏即失效**：仅支持已登录用户的交互式桌面会话；锁屏、UAC 安全桌面、Session 0（服务/SYSTEM）均不支持[12]。本项目值守流水线若在终端锁屏状态下运行，agent-desktop 无法处置任何系统级弹窗——而 Playwright 无头浏览器不受此影响。这是"补位执行器"定位的重要边界。
4. UIPI 提权组合需与 Smart-Link 自身提权策略对齐（若控制台以管理员运行，目标非提权应用反而不可驱动，且状态根隔离要求提权实例单独 `AGENT_DESKTOP_HOME`[12]）。
5. 首次运行建议把 `agent-desktop status`/`permissions` 作为安装自检项（官方亦如此建议[26]）。

---

## 6. 确定性 / 可靠性 / 成本

- **无模型内嵌**[1]：工具本身零 token 成本、零模型延迟；LLM 循环的每步 = 一次观察（快照 JSON）+ 一次模型调用 + 一次动作，成本由调用方掌控。
- **单命令延迟（官方口径，无系统性基准）**：官方 trace 示例中 `snapshot` 单命令 `duration_ms: 109`（Linux）；点击后 `wait --predicate value` 命中耗时 286 ms[15][27]；Node 启动器路径每次调用 +~125 ms[19][20]；`launch --cdp` 全程默认上限 30 s[30]；Windows 上 Chromium/Electron 网页树冷启动稳定需 10–25 s[12]。**未找到官方 P50/P95 延迟或吞吐基准**——对无人值守值守的每步耗时只能定性：低频弹窗处置下"spawn + 快照 + 模型轮次"的主导项是模型调用而非工具。
- **token 成本量级（定性）**：snapshot 输出即 token 输入；`-i`（只留可交互）、`--compact`、`--skeleton`+`--root`、`find` 单点查询是官方给出的缩量手段（"A larger read costs more time and tokens, and its refs go stale sooner"[26]）。官方未提供 token 估算数据。
- **ref 失效重试模型与值守流程**：`STALE_REF → refresh_snapshot_then_retry_original`、`disposition.retry=safe` 才可重试、`delivered_unverified` 一律先重新观察[4]——这与本设计"动作后独立验证、结果未知不重放、预算内显式新尝试"的恢复契约直接对齐[设计文档 §7]。`--wait-for-gone`（等弹窗消失）+ 动作后 `data.surfaces`（菜单/sheet/alert 出现即"应用在等待覆盖层"）[8][6]恰好覆盖"关闭弹窗→验证消失→恢复原流程"三段式。
- **并发确定性**：同一用户的 mutation 经跨进程交互锁串行（CLI 与 FFI 共享）[17][18]；batch 默认失败不中断，必须显式 `--stop-on-error`[28]——接入时若并行处置多 incident，动作仍串行排队，等待者得到结构化超时而非错误状态污染。

---

## 7. 打包与分发

- **npm 包内容与体积**：`agent-desktop@1.2.0` unpackedSize 30.7 MB / 26 文件；`files` 白名单 bin/lib/scripts；engines `node>=18`；os/cpu 覆盖 darwin/win32/linux × arm64/x64[19]。README："It includes native binaries and platform helpers for x64 and ARM64"[1]；CHANGELOG 1.0.0："Bundle native CLI executables and platform helpers in npm installations, **including installations with lifecycle scripts disabled**"[22]——即原生二进制随 npm tarball 捆绑分发，postinstall 被阻止时由 Node 启动器直接执行包内二进制（启动器只检查包内 `bin/<platformKey>` 二进制存在性，缺失时报"安装不完整"）[19]。六平台 release 档案与 helper 矩阵见 `npm/lib/platform.js`[19]。
- **postinstall 行为**：校验捆绑二进制 sha256 并把 bin 入口硬链到原生二进制（去掉 Node 启动器 ~125 ms 开销）；捆绑文件缺失/摘要不匹配时的**回退路径**才是从 GitHub Releases 下载（curl 重试 3 次 + checksums.txt 校验 + 档案条目白名单校验）[19]。npm 12 默认阻止 install scripts——此时功能完整但每次调用慢 ~125 ms，需 `--allow-scripts=agent-desktop`（全局）或 `npm install-scripts approve`（项目）[20]。
- **electron-builder 兼容性**：**未找到官方说明**（文档无 electron-builder 相关内容）。本项目判断：随安装包捆绑 `agent-desktop-<platformKey>` 原生二进制 + 运行期 `AGENT_DESKTOP_BINARY_PATH`/`AGENT_DESKTOP_SKIP_DOWNLOAD=1` 跳过下载逻辑是可行方向，但二进制放置路径、Smart App Control/杀软行为、DPI 感知（官方提示宿主进程 DPI 策略不兼容会导致 headed 坐标偏移，建议优先用 ref 而非 `--xy`[12]）均需打包实测。
- **升级机制**：Cargo workspace 版本变更触发 Release workflow 自动发布 npm（trusted publishing/OIDC）与 GitHub 档案+校验和+构建溯源[23]；macOS/Linux Homebrew 主目录公式自动跟进（可能滞后于 npm）[20]；自定义 tap/Scoop bucket 已废弃，旧安装被钉在已装版本[20]。
- **代码签名**：Windows 二进制**未签名**（SmartScreen/SAC/杀软风险，见 §5）[12][20]；macOS 侧文档未讨论公证/签名状态（**未找到官方说明**）；release 档案提供 checksums.txt 与 `gh attestation verify` 构建溯源[20]。
- **版本破坏性节奏（升级纪律）**：半年内 envelope 2.3→2.6、ABI 5→7、移除 macOS command host 等破坏性变更多次发生[22]。随应用捆绑时必须锁版本，升级视为显式事件并回归 envelope/错误码解析。

---

## 8. 隐私与合规

**官方声明的事实：**

- README 顶部警告："快照、剪贴板读取、截图、命令输出与调试产物可能包含私有桌面内容，须防止进入公共日志与上传"[1]。FAQ 列举：快照、窗口标题、剪贴板读取、通知、截图、命令结果均含所读桌面内容；`--debug --screenshot` 生成含截图与无障碍数据的本地 HTML；"脱敏不等于截图可以公开"[21]。FFI 的 `ad_last_error_details()` 结构化 JSON "可能包含用户屏幕文本，勿入共享日志"[18]。
- **trace 脱敏**：trace 行把 `text/value/name/title/url/label/description/password` 等敏感字段替换为 `{"redacted": true}`；命令名/应用名/ref/错误码/耗时保留可读；**会话截图、内嵌截图的导出 HTML、可视化调试文件不做脱敏**；`--trace PATH` 文件以私有权限创建；trace 写失败默认不失败命令（除非 `--trace-strict`）；会话录制预算 32 MiB / 10 万事件 / 4096 目录项，耗尽后静默停录[15]。通知的 title/body **原样返回、不脱敏**[29]。
- 状态根强制私有（0700；群组/他人可读写直接 `INTERNAL` 拒写）[6][13]。
- **遥测核验（本次专项验证）**：用户可见文档（README、apps/docs、顶层 docs）中 "telemetry" **零命中**（父会话 grep）；源码中 telemetry 字样仅命中 5 处，经阅读确认均为 **Rust `tracing` 本地日志框架的文档注释与 `tracing::debug!` 调用**（如 Windows 窗口标题漂移"logged as telemetry"实为一条本地 debug 日志[25]），无外发语义；工作区依赖清单无任何 HTTP/遥测上报库[24]；FAQ 明确"原生 CLI 不需要远程模型服务"，唯一会把目标与屏幕描述发给模型的是**可选的 JEV helper 技能**（需自行配置模型 provider，本项目不得启用）[21]。postinstall 仅在修复回退时访问 GitHub Releases 下载（校验和验证），非运行期外联[19]。**残余保留：本次未做运行期出站流量实测**（任务禁止安装/运行），以依赖清单 + 文档零命中 + 源码阅读为证据上限。

**落地为本项目的日志纪律（本项目判断，对齐现有治理）：**

- agent-desktop 的 session trace/refmap 是磁盘文件，属**潜在第二数据源**。接入时：默认 `--no-trace`；确需 trace 时只把脱敏后的关键事件（工具意图/结果/错误码/disposition）作为输入经 `addLog → logPersistenceMiddleware → SmartLink_LogDB` 落库；trace 目录按 incident 结束即 `session gc` 清理，不作为审计依据。原始 envelope 中 error.details 可能含屏幕文本[18]，进入 Redux 日志前必须走现有脱敏规则。
- 截图类能力（`screenshot`、`--screenshots`、`--debug --screenshot`）默认不开启；如需截图证据，按设计文档的"脱敏+大小上限+同一 logs store 事件"约束处理，不走 trace/screens 目录旁路[15]。
- 屏幕文本是进入模型的不可信输入[16][21]——与设计文档 §7.4 的提示注入防线一致，须由工具权限（只允许观察与受控关闭）而非提示词承担。

---

## 9. 结论性定位

### 9.1 三方对比

| 维度 | agent-desktop | Browser Use（本地 Python 主库） | Alibaba Page Agent |
| --- | --- | --- | --- |
| 作用层 | OS 无障碍树（桌面表面），**明确不做网页**[21] | 浏览器内（DOM/视觉/CDP） | 浏览器内（DOM 文本） |
| 观察模型 | snapshot/ref + 严格重识别（拒绝猜测）[3] | DOM 树 + 元素索引 + 截图视觉 | DOM 文本 + 可交互元素索引 |
| 模型内嵌 | 无[1] | 无（循环在 Agent 库内） | 无（循环在 Core 内） |
| 接入方式 | CLI 子进程 / C 库 / MCP（Rust 原生二进制，Node≥18 仅启动器）[1][17][16] | Python worker（Python≥3.11，CDP 附着） | TS/TS（npm 包，页面内或 Controller） |
| 页面网络监听 | **无**（CDP 都不自己说[10]） | CDP 具备 | 无（官方未提供） |
| 系统级弹窗（文件/打印/通知/他窗） | **原生覆盖**（surfaces + 通知命令 + 任意窗口）[8][10][29] | 无 | 无 |
| 部署负担 | Win 免授权但有未签名/SAC/锁屏限制[12]；macOS 需辅助功能授权[11]；Linux 需 AT-SPI 前提[13] | Python 运行时打包、签名、升级、子进程收尾 | npm 包轻量；页面注入/CSP/frame 适配 |
| 失败语义 | 16 码 + delivery/retry 投递语义 + 3 种 recovery 策略[4] | history/hooks，动作级投递语义需自建 | 工具 success/message + `done.success`（不等于业务成功） |
| 对"弹窗消失验证"的内建支持 | `--wait-for-gone` + 动作后 `data.surfaces`[6][8] | 需自建观察验证 | 需自建（Core 每步重观察） |
| 与唯一日志源治理的摩擦 | trace 文件需隔离/清理（可 `--no-trace`）[14] | `.browser-use/runs` 磁盘日志未确认可关（前次调研结论） | 内存 history（无落盘冲突） |

### 9.2 是否纳入、适用于哪个子场景

**建议：纳入候选池，作为第三类执行器（系统表面执行器）保留，明确不参与 OTA 页面弹窗处置主线。** 依据（均为上文官方事实的推论）：

1. 官方边界决定它**不可能**替代 Playwright 或与 Page Agent/Browser Use 在页面内竞争（"does not automate web pages"[21]，无网络监听）。
2. 它与现有候选池是**互补而非重叠**：Playwright/Page Agent/Browser Use 全部无法处置"浏览器窗口之外"的阻挡——原生文件对话框、打印对话框、系统通知、其他应用窗口抢焦点、Electron 宿主自身原生 UI。这些低频但致命的场景正是 agent-desktop 的官方职责表[10][8][29]。
3. 其失败契约（`retry:safe` 才重试、`delivered_unverified` 先观察、POLICY_DENIED 须显式授权）与本设计文档的 Fail-Fast/预算/验证约束**同构**，接入的治理成本低[4][7]。

**适用子场景（若纳入，首期只开放）**：同机系统级阻挡的"观察 → 受限关闭/最小动作 → `--wait-for-gone` 验证 → 交还原流程"；触发条件限于现有 Playwright 链路已判定"页面外阻挡"（如原生对话框逃逸、窗口失焦）。动作权限沿用设计文档 §7.3 的工具表思路：只暴露观察与关闭类 ref 动作，禁 `launch`/`clipboard-set`/`mouse-click --xy`/`press`（组合键有旁路面）/`--headed` 除非显式人工授权。

**明确不适用场景**：OTA 页面内 DOM 弹窗（候选池已覆盖且官方不做网页）；任何需要网络响应证据的流程（协议解析必须用权威网络响应的现有约束不可松动）；无人值守锁屏值守（Windows 锁屏不支持[12]）；无头浏览器进程内部的页面现象（OS 树不可见，待实测确认）；纯图形/Canvas 弹窗（无语义不可见[21]）；坐标类物理交互（Wayland 不支持、Windows 需 headed 且绕过 ref 安全模型[13][7]）。

---

## 残余风险与待验证项

1. **issues 未独立核验**：本次基线不含 GitHub issues/discussions 阅读；已知踩坑面（如真实站点的 UIA 树完整性、杀软误报案例）只能来自 CHANGELOG 内嵌引用，实施前应补一轮 issues 排查。
2. **无头 Chromium 可见性**：Playwright 无头浏览器进程是否出现在 `list-apps`/无障碍树中，官方未说明——决定"系统级弹窗遮挡无头浏览器"这一关键场景能否成立，需目标机实测。
3. **electron-builder 打包**：捆绑原生二进制的放置路径、SAC/杀软在客户机行为、DPI 感知交互，均无官方指引，需 Windows 打包实测；npm 离线安装（捆绑二进制 + postinstall 被阻止）建议做一次断网安装验证。
4. **跨域 iframe / 虚拟滚动列表的网页树覆盖**：官方未区分说明（§2），如未来用 agent-desktop 观察 Smart-Link 自身 Electron 渲染层中的跨域内容，需实测。
5. **beforeunload/打印对话框的原生呈现形态**：Windows `sheet`=Chromium modal 已有定义[12]，但 beforeunload 与打印对话框在各平台是否都作为可观察 surface 呈现，未逐项验证。
6. **运行期零外联**：遥测结论基于依赖清单 + 文档零命中 + 源码阅读[24][25]；按本项目隐私标准，接入前应以实际出站请求复核一次。
7. **版本破坏性节奏**：envelope/ABI 半年内多次 major 变更[22]；锁定版本后每次升级都要回归 16 错误码与 envelope 解析测试。
8. **官方无延迟/成功率基准**：§6 的延迟均为示例值与定性；接入 POC 必须按设计文档 §13 的口径自测（P50/P95、错误动作率、取消后无新动作）。
9. **macOS 签名/公证状态、锁屏下的 FFI 行为**：未找到官方说明。

## 官方来源

以下路径均位于仓库快照 `vercel-labs/agent-desktop @ b43ac4f6e892ef608f8851428613c4009f0e84c7`；URL 为对应固定 commit 的回溯链接（内容核验以本地快照为准）。行号为快照状态，个别长文件以 §节名定位。

1. [README.md:3,12,14,24,70,127](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/README.md) — 定位、无模型内嵌、CLI+C 库、隐私警告、捆绑二进制、headless 默认、60/56 命令。
2. [apps/docs/content/docs/commands/index.mdx:5-7 与全表](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/commands/index.mdx) — 60 命令 11 组总表。
3. [apps/docs/content/docs/snapshots-and-refs.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/snapshots-and-refs.mdx) — ref 结构、严格重识别、STALE_REF/AMBIGUOUS_TARGET 语义、1 MB/128 上限。
4. [apps/docs/content/docs/errors-and-recovery.mdx:7,:19-23,:55,:57 及全码表](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/errors-and-recovery.mdx) — 16 错误码、disposition、recovery 策略。
5. [apps/docs/content/docs/json-output.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/json-output.mdx) — envelope 2.6、退出码、OperationReport、契约迁移表。
6. [apps/docs/content/docs/configuration.mdx:36,:80-83 及全文](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/configuration.mdx) — 无配置文件、选择器、等待旗标、状态根 0700。
7. [apps/docs/content/docs/guides/headed-mode.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/guides/headed-mode.mdx) — headless 语义交付、失败关闭、POLICY_DENIED 纪律。
8. [apps/docs/content/docs/surfaces.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/surfaces.mdx) — surface 种类与平台子集、`data.surfaces`、`open-system-surface`。
9. [apps/docs/content/docs/skeleton-and-drill-down.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/skeleton-and-drill-down.mdx) — 密集 UI 两段式、钻取全有或全无、部分观察。
10. [apps/docs/content/docs/guides/chromium-and-electron.mdx:7,:14-16](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/guides/chromium-and-electron.mdx) — CDP 边界与原生/网页分工表。
11. [apps/docs/content/docs/platforms/macos.mdx:12-14,:16-21](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/platforms/macos.mdx) — macOS 权限、`permissions --guide`、Chromium web accessibility。
12. [apps/docs/content/docs/platforms/windows.mdx:11-13,:15-21,:42 及 §Surfaces/§Chromium](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/platforms/windows.mdx) — 未签名二进制、UIPI、会话限制、能力矩阵、Chromium 10–25 s。
13. [apps/docs/content/docs/platforms/linux.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/platforms/linux.mdx) — AT-SPI 前提、X11/Wayland 差异、Electron 原生对话框不在 AT-SPI 树。
14. [apps/docs/content/docs/sessions.mdx:106](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/sessions.mdx) — 会话命名空间、trace 默认 on。
15. [apps/docs/content/docs/guides/traces.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/guides/traces.mdx) — 脱敏字段、截图不脱敏、录制预算、`--trace-strict`。
16. [apps/docs/content/docs/guides/mcp.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/guides/mcp.mdx) — MCP 工具映射、全局 flag 限制、安全定性、并发/取消。
17. [apps/docs/content/docs/ffi/index.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/ffi/index.mdx) — C 库两层 API、ABI 7、同锁同规则。
18. [apps/docs/content/docs/ffi/ownership-and-threading.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/ffi/ownership-and-threading.mdx) — 所有权、线程、交互锁、last-error 隐私。
19. [npm/package.json](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/npm/package.json)、[npm/scripts/postinstall.js](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/npm/scripts/postinstall.js)、[npm/lib/platform.js](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/npm/lib/platform.js)、[npm/bin/agent-desktop](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/npm/bin/agent-desktop) — 打包矩阵、postinstall 校验/回退下载、Node 启动器。
20. [docs/install.md](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/docs/install.md) — 安装方式、npm 12 脚本阻止与 125 ms、SAC 无条件拦截、Homebrew、构建溯源。
21. [docs/faq.md:5,:9,:57-:63](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/docs/faq.md) — 不做网页、无 a11y 树不可见、私有信息清单、无远程模型服务、JEV helper、probes/。
22. [CHANGELOG.md:6,:22-24,:37,:39](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/CHANGELOG.md) — 1.2.0 MCP、1.1.0 envelope 2.6/ABI 7/移除 macOS command host、ref 语义收紧；1.0.0 npm 捆绑声明；[apps/docs/content/docs/changelog.mdx:164-172](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/changelog.mdx) — Windows ACL 加固往返历史。
23. [docs/releasing.md](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/docs/releasing.md) — 版本触发发布、trusted publishing、Homebrew 滞后。
24. [Cargo.toml（workspace）](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/Cargo.toml) — 工作区依赖清单（无网络/遥测库）、`release-ffi` profile。
25. [crates/windows/src/system/window/window_identity.rs](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/crates/windows/src/system/window/window_identity.rs)、[crates/core/src/commands/helpers.rs](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/crates/core/src/commands/helpers.rs) — "telemetry" 命中均为 Rust tracing 本地日志注释/调用。
26. [apps/docs/content/docs/guides/observe-act-verify.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/guides/observe-act-verify.mdx) — 循环纪律、观察最小化、`ok:true` 不等于生效。
27. [apps/docs/content/docs/guides/waiting.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/guides/waiting.mdx) — 等待模式矩阵、超时读法、286 ms 示例。
28. [apps/docs/content/docs/guides/batch.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/guides/batch.mdx) — 非事务、预校验、`--stop-on-error`、逐条 disposition。
29. [apps/docs/content/docs/commands/notifications.mdx](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/commands/notifications.mdx) — 通知命令、`--expected-*` 身份护栏、不脱敏声明。
30. [apps/docs/content/docs/commands/app-window.mdx §launch](https://github.com/vercel-labs/agent-desktop/blob/b43ac4f6e892ef608f8851428613c4009f0e84c7/apps/docs/content/docs/commands/app-window.mdx) — `launch --cdp [PORT]` 旗标与错误表。

npm registry 元数据（版本 1.2.0、unpackedSize、fileCount、license、time.modified）：由父会话于 2026-11-09 直接查询 registry 核验，本文以该元数据为 npm 事实基线。
