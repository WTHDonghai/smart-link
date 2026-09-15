# Smart Link - 西软智能 OTA 搬单后台系统

> 面向高星级酒店与连锁酒店集团的跨平台 OTA 智能搬单、房态映射与数据采集值守管理系统。

---

## 📖 系统定位与核心功能

Smart Link 致力于打通主流 OTA 渠道（携程、美团、飞猪、抖音生活服务、同程等）与西软 PMS 之间的实时数据屏障，提供全流程自动化搬单、异常拦截治理与全链路采集日志跟踪能力。

- **渠道接入与映射 (Channel Mapping)**：主流 OTA 渠道直连对接、目标 PMS 接入系统参数与多渠道订单备注模版配置。
- **酒店数据匹配 (Hotel Sync)**：OTA 渠道酒店与 PMS 内部酒店的多对一精准映射与房态同步监控。
- **房型与产品映射 (Product Mapping)**：物理房型/产品代码与内部房型、Rate Code、预订类型的双向映射及加价规则（Markup Rules）管理。
- **订单守护与流转 (Order Guardian)**：全天候自动化拦截、字段校验、清洗并转入 PMS，支持批量重推、直接强制导入、异常告警与利润核算。
- **自动化采集调度与日志 (Crawler Engine & Logs)**：基于 Playwright 的会话 Cookie 保活、滑块验证码解析、网络请求嗅探及系统全链路日志控制台。

---

## 🛠️ 技术栈与架构

- **核心框架**：React 19 (`^19.0.1`) + Vite 6
- **开发语言**：TypeScript 5.8 (Strict Mode)
- **状态流转**：Redux Toolkit (`^2.12.0`) + React-Redux (`^9.3.0`)
- **样式体系**：Tailwind CSS v4 (`@tailwindcss/vite`)
- **设计规范**：西软科技蓝（`#004ac6` / `#003ea8` / `#eff4ff`）、桌面高密度无边框风格
- **图标与组件**：Lucide React (`^0.546.0`)
- **自动化采集**：Playwright Headless Chromium 集群与多会话调度

---

## 🚀 快速开始

### 前置要求
- **Node.js**：`v22.0.0+` (推荐 LTS) 或 **Bun** `v1.2+`
- **npm**：`v10.0+`

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
复制配置示例文件并按需调整：
```bash
cp .env.example .env
```

### 3. 本地启动开发服务器
```bash
npm run dev
```
默认开发服务将运行于：`http://localhost:3000`

### 4. 生产环境构建与类型检查
```bash
# 执行严格 TypeScript 类型检查
npm run lint

# 构建生产包至 dist/ 目录
npm run build

# 本地预览生产产物
npm run preview
```

---

## 📁 核心项目目录结构

```text
Smart-Link/
├── AGENTS.md                 # 协同开发规范与治理指引 (Fail-Fast 与测试准则)
├── README.md                 # 项目文档与快速指南
├── package.json              # 依赖与脚本
├── vite.config.ts            # Vite 6 + Tailwind CSS v4 配置
├── src/
│   ├── main.tsx              # 应用挂载入口
│   ├── App.tsx               # 桌面主框架与 Tab 导航
│   ├── types/                # 全局领域类型定义 (GuardianOrder, OTAChannel 等)
│   ├── utils/                # 领域工具函数 (orderHelpers 等)
│   ├── mocks/                # 初始与测试 Mock 数据 (mockOrders 等)
│   ├── store/                # Redux Toolkit 全局状态管理中心
│   │   ├── index.ts          # Store 配置与 Typed Hooks (useAppDispatch, useAppSelector)
│   │   └── slices/           # 状态切片 (channel, hotel, product, orderGuardian, systemLog, app)
│   └── components/           # 业务视图组件体系
│       ├── common/           # 通用原子组件 (Modal, StatusBadge, EmptyState 等)
│       ├── orders/           # 订单守护模块 (Table, Filter, BatchBar, Pagination, Modal)
│       ├── channels/         # 渠道映射模块
│       ├── hotels/           # 酒店匹配模块
│       ├── products/         # 房型与价格规则映射
│       ├── desktop/          # Playwright 采集引擎抽屉与会话监控
│       └── logs/             # 系统运行与全链路日志
```

---

## 🛡️ 开发准则

所有参与开发的人员与 AI 代理均需严格遵守 `AGENTS.md` 规范：
1. **严格类型安全**：全面启用 Strict TypeScript，严禁使用 `any`。
2. **禁止静默兜底 (Fail-Fast)**：遇到异常绝不静默捕获或伪造假数据，必须直面暴露并置为失败/待人工核对状态。
3. **诚实与严密的测试**：禁止无实质断言的假性测试，确保数据流真实可靠。
4. **统一设计规范**：严格遵循西软品牌科技蓝色彩系统，杜绝未经统筹的第三方色系。