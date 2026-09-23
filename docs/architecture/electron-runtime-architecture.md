# Electron 原生运行时与桌面工程架构规范 (Electron Runtime Architecture)

> 文档状态：已确立并全面实施
> 核心基线：严格遵循 AGENTS.md 1.3「Electron-Only 运行宿主与日志数据源唯一性」准则

---

## 1. 运行宿主定位与进程拓扑 (Process Topology)

Smart-Link 是一套面向高可靠性、高稳定性场景的企业级跨平台桌面端控制台应用。
系统运行宿主**仅且必须为 Electron**，彻底摒弃独立 Web 宿主与任何形式的本地 HTTP 模拟回退。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Electron Main Process (Node.js)                    │
│                                                                             │
│  ┌───────────────────────┐  ┌────────────────────────────────────────────┐  │
│  │  应用宿主管理          │  │  自动化与值守调度引擎 (src/crawler/)         │  │
│  │  - 单实例锁 (互斥排他) │  │  - HotelCollectionEngine (门店自动化采集) │  │
│  │  - 窗口生命周期与安全 │  │  - DutyOrchestrationEngine (值守长轮询调度)│  │
│  │  - teardown 资源优雅清退│  │  - BrowserManager (Playwright + Stealth)   │  │
│  │  - publishMainLog 暂存│  │  - DutyTaskDispatcher (搬单任务执行回执)   │  │
│  └──────────┬────────────┘  └─────────────────────┬──────────────────────┘  │
│             │                                     │                         │
│             ▼                                     ▼                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                  ipcMain 注册监听与原生调用处理                       │  │
│  │  'crawler:*'  |  'duty:*'  |  'host:pending-logs'  |  'app:teardown'  │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │ IPC (invoke / handle / send)
┌─────────────────────────────────────┼───────────────────────────────────────┐
│  Preload Script (electron/preload.ts)│                                       │
│  ┌──────────────────────────────────▼────────────────────────────────────┐  │
│  │  contextBridge.exposeInMainWorld('host', { crawler, duty, env })      │  │
│  │  严格类型化白名单，杜绝 Node 原生对象与非受信事件泄露                  │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │ window.host
┌─────────────────────────────────────┼───────────────────────────────────────┐
│                        Renderer Process (Chromium Sandbox)                  │
│                                                                             │
│  ┌───────────────────────────┐      │      ┌─────────────────────────────┐  │
│  │  表现呈现层 (React 19)    │      │      │  全局状态层 (Redux Toolkit) │  │
│  │  - HotelSyncView          │      │      │  - hotelSlice               │  │
│  │  - OrderGuardianView      │◄─────┼─────►│  - orderGuardianSlice       │  │
│  │  - SystemLogsView         │      │      │  - systemLogSlice           │  │
│  └─────────────┬─────────────┘      │      └──────────────┬──────────────┘  │
│                │                    ▼                     │                 │
│                │          ┌───────────────────┐           ▼                 │
│                └─────────►│ 桌面 IPC 网关     │  logPersistenceMiddleware   │
│                           │ crawlerBridge.ts  │           │ (唯一落库入口)  │
│                           │ dutyBridge.ts     │           ▼                 │
│                           └───────────────────┘    IndexedDB (唯一持久化)   │
│                                                    (SmartLink_LogDB)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 进程间通信 (IPC) 契约与安全隔离规范

### 2.1 预加载隔离契约 (`electron/preload.ts`)
- **零 Node 原生对象暴露**：严禁在 `window` 对象直接暴露 `ipcRenderer`、`process`、`require` 等 Node.js 核心对象。
- **强类型统一挂载点**：所有桌面端原生交互统一挂载至 `window.host`，其类型契约定义于 `src/types/host.ts`：
  ```typescript
  export interface HostBridgeApi {
    crawler: CrawlerBridgeApi;
    duty: DutyBridgeApi;
    env: AppEnvSnapshot;
  }
  ```
- **监听器精确对齐**：事件订阅（如 `onLog`）必须确保 `ipcRenderer.on` 与 `ipcRenderer.removeListener` 使用完全相同的通道常量（`HOST_LOG_CHANNEL = 'host:log-entry'`），杜绝监听器残留与内存泄漏。

### 2.2 IPC 响应与操作结果契约
所有带操作意图的 IPC 通道（如 `duty:start`、`duty:stop`、`duty:sync-tokens`、`app:teardown`）统一遵循强类型响应契约：
```typescript
export interface DesktopOperationResult {
  success: boolean;
  error?: string;
}
```
- 成功时返回 `{ success: true }`；
- 失败时返回 `{ success: false, error: '详细失败原因' }`；
- 渲染层 Bridge（如 `dutyBridge.ts`）在检测到 `!result.success` 时立即 Fail-Fast 抛出异常，绝不吞错。

---

## 3. 日志唯一数据源架构 (Single Source of Truth for Logs)

### 3.1 核心准则
**桌面控制台运行宿主即数据源边界，严禁出现第二个日志数据源。**
- 持久化唯一数据源为渲染进程的 IndexedDB（库名 `SmartLink_LogDB`）。
- 主进程严禁拥有独立的持久化数据库或写盘文件。

### 3.2 全链路日志回流机制
1. **主进程日志暂存与推送**：
   - 主进程模块调用 `logger.info/warn/error` 或值守引擎产生调度日志时，通过 `publishMainLog` 处理；
   - 窗口就绪前：暂存入 `pendingMainLogs` 环形队列（上限 50 条）；
   - 窗口就绪后：通过 IPC 通道 `'host:log-entry'` 实时推送至渲染进程。
2. **冷启动日志水合**：
   - 渲染层 `App.tsx` 挂载时，主动调用 `logBridge.takePendingHostLogs()`（对应 IPC `'host:pending-logs'`）一次性取回并清空暂存队列；
   - 随后平滑衔接 `subscribeHostLogs` 实时事件流。
3. **单点收敛持久化**：
   - 所有进入 Redux 的日志条目（本地埋点、主进程推送、暂存水合）**必须且只能**经由 `src/store/logPersistenceMiddleware.ts` 落库；
   - 依赖 `entry.id` 幂等账本与 IndexedDB 主键去重，杜绝重复写入。

---

## 4. 应用生命周期、单实例锁与安全防御

### 4.1 单实例互斥锁 (`SingleInstanceLock`)
为防止操作人员多次双击启动多个实例导致 Playwright Profile 锁冲突与中台并发抢单灾难：
```typescript
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
```

### 4.2 桌面安全纵深防御矩阵 (Defense-in-Depth)
1. **WebPreferences 配置**：
   - `contextIsolation: true`：开启上下文隔离；
   - `nodeIntegration: false`：禁用渲染层 Node 集成；
   - `sandbox: true`：开启 Chromium 原生沙箱。
2. **CSP 标头防护**：
   - 在 `index.html` 中显式声明严格的 `Content-Security-Policy`，限制脚本与外部连接域。
3. **视窗导航拦截 (`will-navigate`)**：
   - 仅允许加载开发服务器（dev）或应用自身入口 `dist/index.html`（built）；
   - 拦截并阻止任何未授权的 URL 重定向或拖拽本地文件导致的视窗导航。
4. **外链与权限**：
   - `will-attach-webview` 统一执行 `event.preventDefault()`；
   - `session.defaultSession.setPermissionRequestHandler` 统一拒绝未授权系统原生权限；
   - `setWindowOpenHandler` 拦截新窗口，外部 HTTP/HTTPS 链接统一唤起系统默认浏览器打开。

### 4.3 资源优雅清退机制 (`teardownApplicationResources`)
- 拦截 `app.on('before-quit')`、`SIGINT`、`SIGTERM` 以及前端触发的 `'app:teardown'`；
- 具备幂等性防护与 2.5 秒超时熔断保护；
- 按序执行：
  1. 停止全部值守任务并向中台发送工位离线报文；
  2. 并发安全关闭所有活跃的 Playwright BrowserContext 并释放 Profile 物理锁文件；
  3. 彻底退出应用。

---

## 5. 构建、运行与打包工程标准

| 模式 / 脚本 | 职责与行为说明 |
| :--- | :--- |
| **`npm run dev`** | 由 `scripts/devRunner.mjs` 调度：先编译主进程与预加载脚本，再启动 Vite 本地资源服务，待探测就绪后拉起 Electron 窗口。 |
| **`npm run build:electron`** | 使用 `esbuild` 快速编译 `electron/main.ts` (ESM) 与 `electron/preload.ts` (CJS)。 |
| **`npm run build`** | 使用 `vite build` 打包渲染进程纯静态前端产物至 `dist/`。 |
| **`npm run start:built`** | 完整构建后以生产打包态 (`--start-mode=built --mode=production`) 启动 Electron，直接加载本地 `dist/index.html`。 |
| **`npm run build:package`** | 构建渲染层静态产物与 Electron 主进程/预加载脚本，是桌面打包前的统一入口。 |
| **`npm run desktop:pack:win`** | 构建 Windows x64 目录包，用于检查安装形态；不要求配置更新源，因此不生成可用更新元数据。 |
| **`npm run desktop:dist:win`** | 构建 Windows x64 NSIS 安装器、`.blockmap` 与 `latest.yml`；必须提供 `SMARTLINK_UPDATE_FEED_URL`。 |
| **`npm run lint`** | 双环境严格类型检查：同时执行根目录 `tsc --noEmit` 与主进程 `tsc -p electron/tsconfig.json --noEmit`。 |

### 5.1 桌面安装与更新边界

正式发布包是 Windows x64 NSIS 安装器，不使用直接替换 `app.asar` 的更新方式。`https://updates.invalid/` 只是 electron-builder 生成 `latest.yml` 和 `app-update.yml` 的构建占位地址；构建始终使用 `--publish never`，打包钩子会移除占位 provider，真实更新地址由平台描述符在运行时提供。

运行时更新由主进程 `DesktopUpdateService` 统一编排：打包态且存在 `app-update.yml` 才允许应用内更新；应用启动后立即检查一次，随后每 60 分钟检查一次。版本发现继承文旅中台平台更新描述符接口 `GET /toolkit/toolbox/apps/{appId}/updates`，使用注册工位 `stationId`、平台授权和当前版本请求 `platform/windows/currentVersion` 等参数；仅接受 `updateType=NSIS`、`latestVersion` 高于当前版本且 `downloadDirectory` 为以版本目录结尾的无凭证 HTTPS 目录。服务随后动态切换 generic feed，并校验 `latest.yml` 版本与平台描述符一致。状态经 IPC 单向同步到 Redux；安装前必须完成值守任务和浏览器会话回收。开发态、缺少更新元数据、检查失败或资源回收失败都会显式呈现失败或不可用，不进入假进度流程。侧边栏在检查中和无更新时只显示版本号，发现更新或进入下载/安装阶段后才显示更新图标。
