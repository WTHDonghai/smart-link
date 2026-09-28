# 美团（MEITUAN）渠道概况与运行环境调研规范

> **渠道代号**：`MEITUAN`  
> **适用业务**：美团民宿 / 美团酒店（国内住宿业务）  
> **商户系统**：美团商家中心（E-booking 综合订单处理中心）  
> **实施状态**：🟢 **生产运行中 (Production Ready)**  
> **维护代码位置**：
> - 统一导出入口：[`src/crawler/duty/channels/meituan/index.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/index.ts)
> - 门面执行器：[`src/crawler/duty/channels/meituan/meituanDutyRunner.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanDutyRunner.ts) (继承 `BaseChannelDutyRunner`)
> - 领域子模块：
>   - 卡片定位：[`src/crawler/duty/channels/meituan/meituanCardLocator.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanCardLocator.ts)
>   - 列表收集与屏障：[`src/crawler/duty/channels/meituan/meituanListCollector.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanListCollector.ts)
>   - 详情嗅探与解密：[`src/crawler/duty/channels/meituan/meituanDetailInspector.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanDetailInspector.ts)
>   - 业务动作执行：[`src/crawler/duty/channels/meituan/meituanActionExecutor.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanActionExecutor.ts)
>   - 安全风控探针：[`src/crawler/duty/channels/meituan/meituanRiskGuard.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanRiskGuard.ts)
>   - 提示弹窗清理：[`src/crawler/duty/channels/meituan/meituanModalGuard.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanModalGuard.ts)
> - 纯函数解析层：[`src/crawler/duty/channels/meituan/meituanOrderParsers.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanOrderParsers.ts)
> - 渠道领域契约：[`src/crawler/duty/channels/meituan/meituanDutyContracts.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanDutyContracts.ts)


---

## 1. 渠道后台定位与入口拓扑

### 1.1 访问入口
- **商户中心首页**：`https://eb.meituan.com/`
- **E-booking 订单中心 URL**：
  `https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Forder-gx%2Findex.html%23%2Funhandled`
- **后台架构形态**：
  - **外层宿主**：美团商家中心顶层框架，包含顶部导航栏、商家信息与侧边菜单。
  - **Iframe 容器**：`#me-iframe-container`，加载独立的 E-booking 业务 Iframe。
  - **微前端架构**：Iframe 内部采用阿里乾坤（qiankun）微前端沙箱托管订单核心子应用 `order-gx`（技术栈为 Vue 2.x + 美团 MTD/Xigua 桌面组件库）。

### 1.2 账号权限体系
- **推荐账号角色**：门店操作员账号 / 业务接单账号（具备接单、改单、查看真实入住人信息权限）。
- **自动化操作权限清单**：
  - 待处理订单列表查看权限
  - 订单详情查看权限
  - 客人真实姓名与电话查看/解密权限
  - 订单确认接受（接单）与酒店确认号录入回填权限
- **多端登录特征**：美团 E-booking 支持同一商户多子账号操作，但单个账号在不同 IP 登录可能触发“异地登录”安全短信验证。

---

## 2. 会话生命周期与登录态维持

### 2.1 鉴权凭据与存储机制
- **凭据类型**：基于浏览器 Cookie 进行会话维持。
- **持久化方案**：系统在 Electron 主进程中为美团渠道分配专有的持久化 Profile 目录（`userDataDir: <AppData>/profiles/meituan`）。
  - 会话中保留的所有 LocalStorage、SessionStorage 与 Cookie 均自动落盘；
  - 重启客户端后能够自动恢复登录态，无需每次重新扫码。
- **会话失效判定**：当页面发生重定向至 `passport.meituan.com` 或返回带有未登录错误码（如 `401` 或 `TARGET_PAGE_NOT_READY`）时，系统抛出确定性异常并提醒重新登录。

### 2.2 登录交互形式
- **主要登录方式**：美团商家手机 App / 微信扫码快速授权登录，或手机号+短信验证码登录。
- **免密续期**：只要商户不主动在网页端“退出登录”，Cookie 有效期通常可持续 7~14 天。

---

## 3. 安全风控与反爬防护特征 (Risk & Anti-Scraping)

### 3.1 美团 Yoda (美团自研风控) 与验证码挑战
- **风控拦截特征**：
  - 页面出现滑块或拼图验证码弹窗：`#yodaBox`, `#yodaContainer`, `.yoda-captcha`, `.secsdk-captcha-drag-wrapper`, `.geetest_holder`。
  - URL 重定向至 `verify.meituan.com`、`captcha.meituan.com` 或参数携带 `yodaReady`、`csecplatform`。
  - 页面特征提示语：`安全验证`、`操作频繁`、`稍后再试`、`请完成验证`、`人机`。
- **系统应对规范**：
  - Runner 与各子模块中置入全局与 Frame 级别的 `assertNoMeituanPageRisk()` 探针（位于 [`meituanRiskGuard.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanRiskGuard.ts)）；
  - 一旦嗅探到风控挑战，**立即阻断作业**，通过 HUD VisualTracker 提示并在桌面弹出警告：“美团提示安全验证，需要人工在浏览器中完成验证”，严禁盲目静默重试。

### 3.2 敏感数据双重解密 1 秒风控 (Critical Risk)
- **痛点发现**：美团对高频点击“解密客人姓名”和“解密联系电话”设有严格的短时间阈值监控。若在 1 秒内连续发起“查看姓名”与“查看电话”两个解密请求，极易立即触发 Yoda 人机滑块风控。
- **工程解决对策（智能跳过电话解密）**：
  - 实测取证发现：在点击“查看姓名”接口返回的报文（`/sensitiveData`）中，通常已经同时包含了未脱敏的真实手机号；
  - 系统通过纯函数 `hasPlainMobileNumber()` 与 `isPlainPhoneNumber()` 进行严格校验（要求匹配 `^1[3-9]\d{9}$`，排除含 `*` 及 `暂无`、`未获取` 等占位符，并递归检查顶层及 `contacts`/`guests` 数组）；
  - 若已获取到真实明文手机号，**强制跳过点击“查看电话”按钮**，规避双重解密风险。

### 3.3 列表刷新防抖与冷却机制
- **冷却时间**：美团列表接口对调用频次有防抖保护，最短安全间隔为 **3000ms**。
- **高精度等待补偿机制**：列表收集模块（[`meituanListCollector.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/channels/meituan/meituanListCollector.ts)）基于 `performance.now()` 高精度时钟计算距离上次刷新的时间差。若不足 3 秒，通过 `humanDelay` 动态补齐差额后才触发网络请求，**严禁直接返回空数组 `[]`**（防止漏单）。
- **在途请求合并 (Request Coalescing)**：在进入页面互斥锁之前，若存在未完成的列表刷新 Promise（`inFlightListPromise`），直接复用同一在途请求，避免并发调用重复轰炸美团接口。

