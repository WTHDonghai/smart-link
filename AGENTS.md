# 开发者与 AI 代理协同开发规范 (AGENTS.md)

> 本文档是项目的最高协同治理指引与工程实践基线。所有参与本项目的开发者与 AI 代理（Agents）在编写、修改代码或进行架构设计时，必须严格遵守本文档所规定的工程规范、设计规范及核心刚性约束。

---

## 1. 架构分层与工程定位 (Architecture & Layering)

### 1.1 系统定位
本系统是一套面向高可靠性、高稳定性场景的企业级跨平台桌面端控制台应用。
系统基于 **Electron + React 19 + TypeScript + Redux Toolkit + Playwright + Vite + Tailwind CSS v4** 现代技术栈构建。

### 1.2 通用架构分层
系统采用扁平、清晰、低耦合的分层架构，各模块职责严格隔离：
- **表现呈现层 (`src/components/`)**：
  - `common/`：通用原子与交互组件（Modal、StatusBadge、SearchableSelect、Toast、EmptyState 等）。
  - 功能面板组件：各功能工作区主视图，仅负责交互触发与视图渲染，业务计算与数据加工必须提取至工具函数或 Hooks。
- **全局状态层 (`src/store/`)**：
  - 基于 Redux Toolkit 统一维护全局单一可信数据源（Single Source of Truth）。
  - 领域状态切片 (`slices/`) 保持扁平化设计与单一职责，统一通过类型化 Hooks 访问。
- **契约与领域模型 (`src/types/`)**：
  - 集中维护跨模块共享的全局实体契约、接口规范与状态枚举。禁止在组件内部重复或私自定义同名类型。
- **计算与纯工具函数 (`src/utils/`)**：
  - 承载数据清洗、转换、派生计算与格式化工具函数。全部遵循纯函数原则，保证 100% 独立单测覆盖。
- **外部集成与自动化引擎 (`src/crawler/` 及集成模块)**：
  - 隔离管理外部进程、后台无感自动化、网络监听及会话生命周期调度。
- **客户端通信与服务调用层 (`src/services/`)**：
  - 承载前端对外部网络或本地中转网关的异步请求，面向前端调用的 Client SDK 统一采用 `*Api.ts` 命名（如 `channelApi.ts`、`hotelApi.ts`、`crawlerApi.ts`）。
  - 跨进程或双模（Electron IPC / Web HTTP）通信抹平网关，统一采用 `*Bridge.ts` 命名（如 `crawlerBridge.ts`）。
- **本地服务与中间件宿主层 (`src/server/`)**：
  - 承载 Vite 开发/预览服务器的原生 Node.js 中间件或本地路由，统一采用 `*Middleware.ts` 命名（如 `crawlerMiddleware.ts`），严禁与客户端 Client API 同名混淆。
- **系统遥测与审计 (`src/components/logs/`)**：
  - 全链路运行日志流收集、级别过滤与异常可视化控制台。

---

## 2. 技术栈标准与环境要求 (Tech Stack & Environment)

| 领域 / 工具 | 选型与版本 | 规范约束 |
| :--- | :--- | :--- |
| **运行时环境** | Node.js v22+ / Bun | 统一包管理与脚本执行，保障跨平台一致性 |
| **核心框架** | React `^19.0.1` | 函数式组件范式，严禁使用已废弃的旧生命周期或类组件 |
| **开发语言** | TypeScript `~5.8.2` | 严格模式 (`strict: true`)，强制强类型，**严禁使用 `any`** |
| **状态管理** | Redux Toolkit `^2.12.0` + React-Redux `^9.3.0` | 单一可信数据源，强类型 Slice，统一通过类型化 hooks 访问 |
| **样式与动效** | Tailwind CSS `^4.1.14` (`@tailwindcss/vite`) | 原生 CSS 导入，遵循 Utility-First 现代规范，CSS Transitions 驱动桌面微动效 |
| **图标体系** | Lucide React `^0.546.0` | 统一图标库，规范图标尺寸（通常为 `w-3.5 h-3.5` 至 `w-4 h-4`） |
| **构建工具** | Vite `^6.2.3` | 高速 HMR，配置路径别名 `@/*` 对应源码根目录 |
| **自动化集成** | Playwright (Headless Chromium) | 后台自动化调度、会话维持与上下文嗅探 |

---

## 3. 设计系统与界面工程规范 (Design System & Presentation Engineering)

系统定位为高可靠、高效率的企业级桌面操作控制台，界面必须呈现出**低视觉疲劳、高信息密度、极简利落、即时响应**的专业体验。

### 3.1 色彩系统规范 (Color Palette)
- **背景底色**：主工作区统一使用科技灰蓝 `bg-[#f8f9ff]`，面板和卡片使用纯白 `bg-white`。
- **边框与分割线**：常规边框 `border-[#e2e8f0]`，高亮/选中边框 `border-[#dce9ff]`。
- **主品牌色 (Primary)**：标准主色 `#004ac6`，悬浮/激活态 `#003da6`，浅色伴随底色 `bg-[#eff4ff]`。
- **中性文本阶梯**：
  - 标题与正文主要文字：`text-[#0b1c30]`（Deep Slate Navy，高对比度）。
  - 次级辅助说明文字：`text-[#737686]`（Muted Slate）。
  - 失效应弱化文字：`text-[#94a3b8]`。
- **语义状态色彩 (Semantic Status)**：
  - **成功 (Success / Active)**：祖母绿 `bg-emerald-50 text-emerald-700 border-emerald-200`
  - **失败 / 错误 (Failed / Error)**：玫瑰红 `bg-rose-50 text-rose-700 border-rose-200`
  - **警告 / 待处理 (Warning / Pending)**：琥珀橙 `bg-amber-50 text-amber-800 border-amber-200`
  - **自动化引擎 (Automation Context)**：极客紫 `bg-purple-50 text-purple-700 border-purple-200`
  - **信息提示 (Info / Blue)**：品牌蓝 `bg-blue-50 text-blue-700 border-blue-200`

### 3.2 字体与排版规范 (Typography)
- **字体栈**：正文使用 `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`；标题使用 `font-headline`。
- **等宽数字与单号展示**：流水单号、金额指标、时间戳等关键数据必须使用等宽字体（`font-mono` 或 `JetBrains Mono`），确保垂直对齐与快速核对。
- **字阶控制**：
  - 表格元数据/标签：`text-xs` (12px) 或 `text-[11px]`
  - 正文、表单项与输入框：`text-sm` (14px)
  - 模块级主标题：`text-xl font-bold` (20px)
  - 弹窗与抽屉标题：`text-base font-bold` (16px)

### 3.3 桌面级交互与布局准则
1. **视窗防误选**：全局应用 `user-select: none;`，仅在需要用户复制单号/数据的特定容器显式开启 `select-text`。
2. **定制紧凑滚动条**：全局使用纤细滚动条样式（宽 6px，圆角 9999px，滑块默认 `#c3c6d7`，悬浮 `#737686`），禁止出现浏览器原生粗糙滚动条。
3. **表格规范 (Table Standard)**：
   - 表头必须配置 `sticky top-0 z-20 bg-[#f9fafb]`，确保滚动时不遮挡。
   - 采用 `border-separate border-spacing-0`，并设定最小保障宽度。
   - 数据行悬浮态统一使用 `hover:bg-[#f8faff]`。
4. **弹窗与抽屉行为规范**：
   - 必须响应 `Escape` 快捷键按下自动关闭。
   - 弹窗激活时必须锁定底层滚动 (`document.body.style.overflow = 'hidden'`)。
   - 统一遵循 `role="dialog"` 与 `aria-modal="true"` 无障碍语义。
5. **空状态与全局通知**：
   - 列表过滤或无数据时必须使用统一的 `EmptyState` 组件展示明确提示与清空筛选入口。
   - 系统全局提示统一经由状态切片的 `showToast` 分发，严禁使用原生 `alert()` 或 `confirm()`。

### 3.4 终端去技术暴露与体验工程规范 (Zero Technical Leakage)
> **【核心准则】客户端面向一线最终操作人员设计，界面的一切呈现必须以业务价值为中心，彻底消除开发调试冗余信息与技术心智负担。**

1. **基础设施静默托管 (Zero Infrastructure Exposure)**：
   - 外部服务接口地址、网关参数、端口等网络配置，必须由系统底层通过配置文件或环境变量静默读取并托管。
   - **严禁要求终端用户手动填写技术网关地址**，严禁在面向最终用户的主界面展示底层网络参数输入框或调试控制板。
2. **零运行环境泄露 (Zero Environment Leakage)**：
   - 严禁在面向用户的界面展示形如 `.env.development`、`.env.production`、Git 分支名、构建哈希等研发专用标签。系统应在后台无感适配不同运行环境。
3. **零底层协议与生涩术语 (Zero Technical Jargon)**：
   - 严禁向普通用户展示生涩的底层协议代号、鉴权 Grant 代号、Token 轮询调度器或原始传输层状态。
   - 界面所有文案必须完全转化为清晰、自然、通俗的人机交互语言。
4. **核心流程一键直达 (One-Click Simplicity & Seamless Feedback)**：
   - 界面设计严禁增加不必要的前置说明与配置障碍。操作入口仅提供明确、单一的核心行动呼吁（CTA）。
   - **异步等待阶段强制使用直观 Loading 动效替代协议细节**：在发起鉴权或等待远程服务响应时，**严禁展示协议中间码、握手轮询倒计时等底层细节**。必须统一采用沉浸式的加载动效与亲和的状态说明，并仅提供必要的辅助操作（如“重新打开”与“取消”）。
5. **错误信息的人性化转换**：
   - 在遵循 Fail-Fast 原则暴露真实异常的同时，面向用户的错误提示必须转化为清晰的人文指导语言，严禁直接将原始网络堆栈或底层 HTTP 错误码倾倒给用户。

---

## 4. 编码规范与类型治理 (Coding Standards & Type Governance)

### 4.1 TypeScript 强类型规范
1. **绝对禁止 `any`**：
   - 代码中严禁出现任何形式的 `any`，包括显式 `any`、`as any`、`Promise<any>` 或隐式推导 `any`。
   - 对不确定结构的外部输入，必须使用 `unknown` 并通过自定义类型守卫 (Type Guards) 进行结构收敛。
2. **统一领域类型维护**：
   - 所有跨模块共享的数据实体、枚举和状态契约统一声明在 `src/types/`，禁止在业务组件内私自随意定义同名重复类型。
3. **组件 Props 与回调显式定义**：
   - 每个 React 组件必须具有清晰命名的 Props Interface。
   - 事件回调必须严格标明入参和返回类型，禁止松散的无约束回调。

### 4.2 React 19 与组件编写规范
1. **关注点分离与函数式组件**：
   - 统一使用函数式组件：`export const MyComponent: React.FC<MyProps> = ({ ... }) => { ... };`。
   - 组件仅负责交互与视图渲染，复杂的业务计算、数据加工与派生转换必须抽取为独立纯函数或自定义 Hook。
2. **严谨的 Hooks 依赖**：
   - 严禁违背 React Hooks 依赖规则，`useEffect`、`useCallback`、`useMemo` 必须显式声明所有依赖项。
   - 涉及大数据量过滤计算或复杂派生时，必须使用 `useMemo` 避免无意义的二次计算。
3. **列表 Key 的唯一性与稳定性**：
   - 列表渲染严禁直接使用数组 index 作为 `key`，必须使用唯一的实体业务主键。

### 4.3 Redux Toolkit (RTK) 状态工程规范
1. **统一类型化 Hooks**：
   - 全局严格使用导出的类型化 `useAppDispatch` 与 `useAppSelector`，禁止直接从 `react-redux` 导入无类型 Hook。
2. **扁平化设计与单一职责**：
   - 状态切片保持扁平化设计，避免层层深层嵌套。派生状态优先通过简明 Selector 或组件级 `useMemo` 计算得出，严禁在多个 Slice 维护重复或相互依赖的冗余状态。
3. **Action Payload 强类型与纯函数 Reducer**：
   - Reducer 中的每个 action 必须显式标注 `PayloadAction<T>` 类型。
   - Reducer 必须严格保持纯函数特性，严禁在 Reducer 内部引发副作用（如异步网络请求或操作原生 DOM）。

---

## 5. 核心刚性约束一：可靠性与 Fail-Fast 原则 (Reliability & Fail-Fast Principle)

> **【红线规则】严禁在系统主要处理流水线中编写任何形式的隐式兜底降级（Silent Fallback / Graceful Degradation）逻辑。任何错误都必须直面暴露，绝不能绕过主要流程设计！**

### 5.1 坚决杜绝隐式降级的工程必然性
在关键数据处理、解析校验与外部状态推进的流水线中，任何“容错兜底”（例如：解析失败就塞入默认占位符、数值缺失就赋 0、外部接口失败就假装成功并生成伪单号、网络超时就静默捕获吞掉）都会带来致命后果：
- **数据污染与不可逆状态破坏**：用伪造默认值推进流程会导致脏数据持久化并引发后续业务级溃败。
- **系统隐患被长期掩盖**：开发或运维无法感知上游数据协议变动或配置丢失，主流程缺陷被静默短路。
- **状态失真与技术信任崩塌**：系统日志报告“全部成功”，实际后端根本未建立正确状态。

### 5.2 严禁的行为清单 (Anti-Patterns)
1. **严禁静默吞掉异常 (Swallowing Errors)**：
   ```typescript
   // ❌ 严重违规：捕获异常后不处理，静默返回空或默认假数据
   try {
     const data = parseIncomingPayload(raw);
     return data;
   } catch (e) {
     console.warn('解析失败，走兜底默认值', e);
     return DEFAULT_FALLBACK_DATA; // 绝对禁止！
   }
   ```
2. **严禁在关键字段缺失时擅自填充业务默认值强行推进流程**：
   - 若输入数据缺少必须的关键标识或业务核心字段，**绝不允许**兜底硬编码值强行进入后续流转。
3. **严禁在外部服务调用失败时返回伪造的成功**：
   - 若外部接口超时、拒绝或返回失败，**绝不能**擅自生成一个假单号/凭证并将本地状态标记为成功。
4. **严禁静默降级为“模拟模式”**：
   - 底层自动化引擎无法启动或服务不可用时，系统必须明确报错并阻断作业，绝不能悄悄启动伪造计时器吐出虚假数据。

### 5.3 正确的 Fail-Fast 工程范式
1. **立即阻断与显式状态流转 (Immediate Interruption)**：
   遇到任何不匹配、校验失败或外部异常，流水线必须立即阻断，将实体状态确切置为失败或待人工核对状态（如 `failed` 或 `manual_review`）。
2. **保留完整的错误上下文 (Context Preservation)**：
   必须将具体的错误原因写入结构化 `failureReason` 字段，并完整保留原始未清洗报文以供溯源与事后排查。
3. **显式结构化遥测与告警 (Explicit Telemetry)**：
   向系统日志分发 `level: 'ERROR'` 结构化日志，包含完整调用堆栈与元数据；同时在 UI 给出清晰的失败状态标识，引导明确的处理动作。

---

## 6. 核心刚性约束二：严密诚实的测试工程规范 (Honest & Rigorous Testing)

> **【红线规则】测试代码绝不能为了追求“测试通过”而编写假性的 pass。测试必须客观、诚实、具有严密的实质性断言！**

### 6.1 杜绝形式化测试与虚假安全感
为了让自动化流水线变绿或刷高覆盖率指标而编写没有实际断言约束力的测试，是极其危险的欺骗行为。虚假的安全感比没有测试危害更大。

### 6.2 严禁的测试恶习清单 (Anti-Patterns)
1. **严禁无实质内容的伪断言 (Vacuous Assertions)**：
   ```typescript
   // ❌ 严重违规：形式化 pass，对业务结果无任何实质性验证
   it('should process pipeline state', () => {
     const result = executePipeline(mockInput);
     expect(true).toBe(true); // 绝对禁止！
     expect(result).toBeDefined(); // 绝对禁止仅断言非空而不校验具体状态值！
   });
   ```
2. **严禁在测试中吞掉异常 (Swallowing Test Exceptions)**：
   ```typescript
   // ❌ 严重违规：测试中捕获异常后空置，强行让用例通过
   it('should validate identifier', () => {
     try {
       validateIdentifier('');
     } catch (e) {
       // 空 catch 掩盖缺陷，绝对禁止！
     }
   });
   ```
3. **严禁过度 Mock 导致测试脱离现实 (Over-Mocking)**：
   - **禁止 Mock 待测主体自身 (SUT)**：严禁将待测的业务函数、Reducer 状态机或转换器内部逻辑全部替换为 Mock 函数。
4. **严禁随意放宽断言以粉饰失败用例**：
   - 当用例失败时，必须严查是实现逻辑存在 Bug 还是设计需要重构。**绝不允许**通过将精确比对断言（如 `toBe('failed')`）退化为模糊匹配（如 `not.toBeNull()`）来逃避问题。

### 6.3 诚实测试的具体实践准则
1. **精准结果断言 (Precise Value Assertion)**：
   - 必须针对状态机流转后的确切状态字段、失败原因、派生数值及统计指标变更做强类型精准比对。
   ```typescript
   // ✅ 正确范例：真实诚实的严格断言
   it('should fail and capture failureReason when contract mapping is missing', () => {
     const initialState = createTestState();
     const nextState = stateReducer(initialState, retryPipelineTask('task-unmapped'));
     
     // 严密断言：确切核对状态枚举、错误原因与状态统计
     expect(nextState.records[0].status).toBe('failed');
     expect(nextState.records[0].failureReason).toBe('映射配置缺失: CODE_404');
     expect(nextState.stats.failed).toBe(initialState.stats.failed + 1);
     expect(nextState.stats.succeeded).toBe(initialState.stats.succeeded);
   });
   ```
2. **真实验证异常抛出 (Asserting Thrown Errors)**：
   - 针对异常分支，必须断言抛出了预期的具体错误类型与错误文案：
   ```typescript
   // ✅ 正确范例：断言异常类型与精确文案
   expect(() => calculateMetrics(100, 'invalid_rule' as unknown as RuleType))
     .toThrow('不支持的计算规则: invalid_rule');
   ```
3. **最小化 Mock 边界 (Minimize Mock Boundaries)**：
   - 仅允许 Mock 无法在纯单测环境中运行的不可控外部 I/O（如底层操作系统进程、真实网络请求、本地硬件驱动）。
   - **所有的 Reducer、Selector、纯函数工具、解析算子、数据清洗函数，必须运行 100% 真实的源码逻辑。**
4. **敬畏失败的测试**：
   - 每一个失败的测试（Red）都是系统的宝贵资产，说明发现了真实潜在漏洞。只有在源码真实满足所有约束后才被允许点亮（Green）。

---

## 7. 核心刚性约束三：代码极简与反过度设计 (KISS & Simplicity Principle)

> **【红线规则】始终保持代码简单直观，坚信“简单即是可靠 (Keep It Simple, Stupid)”。严禁不必要的过度设计与抽象膨胀！**

### 7.1 为什么必须坚持极简原则？
在复杂的状态流转与高并发数据系统中，代码的**可读性、直接性与可维护性**是系统稳定运行的生命线。过度设计会导致：
- **心智负担剧增**：定位排查线上 Bug 时，排查链路被层层无意义的抽象接口与类割裂。
- **隐藏深层缺陷**：不透明的隐式封装与多层透传最容易掩盖并发竞态条件与状态泄露。
- **死代码膨胀**：未使用的类型、过渡分支与僵尸代码污染工程纯洁性。

### 7.2 极简工程规范准则
1. **直接优于抽象 (Explicit & Direct over Abstract)**：
   - 用最平实、直观的代码实现逻辑。如果一个 20 行的简单纯函数能清晰解决问题，**坚决不要**为了“设计模式”拆解出多个接口、工厂类或高阶透传。
2. **零死代码法则 (Zero Dead Code Policy)**：
   - 严禁在工程中保留任何未使用的导入 (`unused imports`)、未使用的变量 (`unused variables`)、废弃的常量定义、或者不再被调用的孤立导出。
   - 调试用的 `console.log`、注释掉的代码块在提交前必须一律清理。
3. **扁平透明的状态设计 (Flat & Transparent State)**：
   - Redux 状态切片保持扁平，避免深层对象嵌套。
   - 依赖单一可信数据源，派生状态使用简明纯函数或 `useMemo` 计算，严禁在多个 Slice 维护相互冗余的状态。
4. **拒绝无意义的外部依赖 (Dependency Pruning)**：
   - 仅引入真正为系统提供不可替代核心价值的高质量依赖库。
   - 严禁引入项目未实际使用或已有轻量原生方案的重型依赖包（例如能用 Tailwind 原生 transition 实现的桌面微交互，不要额外引入沉重的动画运行时库）。
5. **文件命名与端层职责隔离规范 (File Naming & Boundary Discipline)**：
   - **彻底杜绝跨层同名文件 (Zero Cross-Layer Filename Collision)**：严禁在不同分层目录中创建相同文件名的模块（例如：**严禁同时存在 `src/server/crawlerApi.ts` 与 `src/services/crawlerApi.ts`**）。同名文件不仅会在 IDE 全局搜索和文件跳转时带来极大的认知混淆，还会引发关于“代码重复或未清理”的技术怀疑。
   - **分层命名后缀语义严谨**：
     - 前端向外发起请求的客户端 SDK 位于 `src/services/`，统一以 `*Api.ts` 结尾（如 `channelApi.ts`、`hotelApi.ts`、`crawlerApi.ts`）；
     - 抹平运行环境（Electron IPC 与 Web HTTP）的网关位于 `src/services/`，统一以 `*Bridge.ts` 结尾（如 `crawlerBridge.ts`）；
     - 服务端与原生 Node.js / Vite 宿主中间件位于 `src/server/`，统一以 `*Middleware.ts` 结尾（如 `crawlerMiddleware.ts`）；
     - 自动化采集器与调度器位于 `src/crawler/`，统一以 `*Collector.ts`、`*Engine.ts` 等领域模型命名。

---

## 8. AI 代理与工程交付自检矩阵 (Engineering Compliance Matrix)

在提交任何代码变更或方案前，AI 代理必须在思考过程中逐条对照以下矩阵进行自检：

- [ ] **技术栈与架构基线**：是否严格基于 React 19 + TypeScript + Redux Toolkit + Tailwind CSS v4？是否无未经批准的第三方冗余依赖引入？
- [ ] **强类型与类型治理**：是否杜绝了所有显式与隐式 `any`？跨模块领域实体是否在 `src/types/` 中集中定义与维护？
- [ ] **分层架构与无同名冲突**：是否存在跨目录同名文件（如 `server/xxxApi.ts` 与 `services/xxxApi.ts`）？命名后缀是否严格契合分层定位（`*Api.ts` vs `*Middleware.ts` vs `*Bridge.ts`）？
- [ ] **代码极简与零死代码**：
  - 代码是否直观易读？是否存在为了模式而模式的过度抽象？
  - 是否已彻底清理所有未使用的 import、未使用的变量/常量与废弃导出？是否无遗留注释代码与调试日志？
- [ ] **可靠性与无兜底降级 (Fail-Fast)**：
  - 核心处理流中是否存在 `catch { return fallback; }`？（若有，坚决删除）
  - 当数据缺失或外部调用失败时，是否通过显式错误状态阻断流转，而不是私自伪造假数据或跳过校验？
  - 是否保留了完整的错误上下文（`failureReason` 及原始数据）供追溯？
- [ ] **严密诚实的测试工程**：
  - 编写的测试用例是否具有具体的状态与数值断言？是否存在 `expect(true).toBe(true)` 或仅断言非空的伪用例？
  - 是否真实执行了待测源码，而不是将核心待测逻辑全部 Mock 掉？
- [ ] **终端去技术暴露与体验纯粹性**：
  - 是否彻底消除了面向普通用户的底层网关 URL 输入框、端口与底层参数展示区？
  - 是否杜绝了开发环境标识（如 `.env` / `dev` / `prod`）与底层协议技术代号的界面暴露？
  - 核心操作是否做到了一键直达？在异步等待中，是否杜绝展示协议中间码，全面采用优雅 Loading 动效与亲和说明？
- [ ] **设计系统与交互契约**：色彩、字阶、单号等宽排版、自定义滚动条、Sticky 表头与模态弹窗规范是否严格一致？

---
*(项目架构治理委员会制定，所有代理与工程师严格遵照执行)*
