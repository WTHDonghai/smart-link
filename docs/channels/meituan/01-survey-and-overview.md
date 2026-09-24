# 美团（MEITUAN）渠道概况与运行环境调研规范

> **渠道代号**：`MEITUAN`  
> **适用业务**：美团民宿 / 美团酒店（国内住宿业务）  
> **商户系统**：美团商家中心（E-booking 综合订单处理中心）  
> **实施状态**：🟢 **生产运行中 (Production Ready)**  
> **维护代码位置**：[`src/crawler/duty/meituanDutyRunner.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/meituanDutyRunner.ts), [`src/crawler/duty/meituanOrderParsers.ts`](file:///Users/daniel-wu/antigravity/Smart-Link-order-guardian/src/crawler/duty/meituanOrderParsers.ts)

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
  - Runner 中置入全局与 Frame 级别的 `checkMeituanPageRisk()` 探针；
  - 一旦嗅探到风控挑战，**立即阻断作业**，通过 HUD VisualTracker 提示并在桌面弹出警告：“美团提示安全验证，需要人工在浏览器中完成验证”，严禁盲目静默重试。

### 3.2 敏感数据双重解密 1 秒风控 (Critical Risk)
- **痛点发现**：美团对高频点击“解密客人姓名”和“解密联系电话”设有严格的短时间阈值监控。若在 1 秒内连续发起“查看姓名”与“查看电话”两个解密请求，极易立即触发 Yoda 人机滑块风控。
- **工程解决对策（智能跳过电话解密）**：
  - 实测取证发现：在点击“查看姓名”接口返回的报文（`/sensitiveData`）中，通常已经同时包含了未脱敏的真实手机号；
  - 系统在点击“查看姓名”后，立即解析响应报文。若已获取到明文手机号，**强制跳过点击“查看电话”按钮**，规避双重解密风险。

### 3.3 列表刷新防抖与冷却机制
- **冷却时间**：美团列表接口对调用频次有防抖保护，最短安全间隔为 **3000ms**。
- **等待补偿机制**：调度引擎每次触发列表刷新前，计算距离上次刷新的时间差。若不足 3 秒，通过 `humanDelay` 补齐差额后才触发网络请求，**严禁直接返回空数组 `[]`**（防止漏单）。
