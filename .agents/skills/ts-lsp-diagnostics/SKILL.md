---
name: ts-lsp-diagnostics
description: >-
  Perform deep TypeScript Language Server (LSP) semantic, syntactic, and suggestion diagnostics on TypeScript/TSX codebases. Use this skill when conducting code reviews, before committing or finalizing changes, when diagnosing issues where CLI `tsc` passes but IDEs (LazyVim, Neovim, VSCode) show red underlines or missing exports, or when checking for deprecated APIs and types.
---

# TypeScript LSP 深度静态诊断技能 (ts-lsp-diagnostics)

本技能为 AI 代理与工程流水线提供与本地 IDE（LazyVim `vtsls`、VSCode `tsserver`）完全对齐的 1:1 语言服务级别静态诊断能力。

---

## 为什么需要此技能？

普通的命令行 `tsc --noEmit` 仅执行批处理编译，容易漏掉以下致命问题：
1. **桶文件 (Barrel File) 导出丢失**：在 `index.ts` 中使用模糊 `export *` 时，纯 interface 或类型在 LSP 虚拟文件系统中易被擦除，导致编辑器报红：`Module has no exported member '...'`。
2. **废弃 API / 图标调用**：第三方库（如 Lucide React 图标、React 19 事件类型）标记的 `@deprecated`，CLI `tsc` 默不作声，而 IDE 中呈现波浪线或删除线。
3. **未使用的变量与局部导入**：CLI 未严格阻断但 IDE 呈现浅灰色置灰与提示。

通过本技能内置的 LSP 探针脚本，可以直接调用同源 `ts.createLanguageService` 进行全方位语法、语义与建议审查。

---

## 执行步骤与操作指令

### 步骤一：快速诊断（默认检查未提交与暂存文件）
在执行 Code Review 或准备交付代码时，直接运行探针检查改动范围内的所有 `.ts` / `.tsx` 文件：

```bash
node .agents/skills/ts-lsp-diagnostics/scripts/lsp_diagnostics.cjs
```
> 若配置了 npm script，亦可直接运行 `npm run lint:lsp`。

### 步骤二：全工程深度全量扫描
若进行了大范围架构重构、类型重命名或依赖升级，建议执行全工程扫描：

```bash
node .agents/skills/ts-lsp-diagnostics/scripts/lsp_diagnostics.cjs --all
```

### 步骤三：定向诊断指定文件
针对开发者在 IDE 中反馈报错的特定文件进行精准定位：

```bash
node .agents/skills/ts-lsp-diagnostics/scripts/lsp_diagnostics.cjs src/components/channels/RemarkTemplateModal.tsx
```

### 步骤四：严格模式（将废弃 API / @deprecated 也视作错误阻断）
```bash
node .agents/skills/ts-lsp-diagnostics/scripts/lsp_diagnostics.cjs --fail-on-suggestions
```

---

## 诊断结果排查与标准修复指南

### 1. 遇到 `Module "..." has no exported member 'X'`
- **根因**：使用了模糊的 `export * from './module'`，导致增量语言服务符号丢失。
- **修复方案**：在导出的 `index.ts` 聚合文件中使用**显式具名类型重导出**：
  ```typescript
  export type { MyType, MyInterface } from './module';
  ```
- 并在引用方显式使用 `import type { MyType }`。

### 2. 遇到 `[Suggestion TS6385]: 'X' is deprecated`
- **根因**：使用的图标组件、生命周期或事件类型已被上游库标记为弃用。
- **修复方案**：
  - Lucide React：`Sliders` 替换为 `SlidersHorizontal`；`AlertTriangle` 替换为 `TriangleAlert`；`AlertCircle` 替换为 `CircleAlert`。
  - React 19：表单提交事件类型将已废弃的 `React.FormEvent` 替换为 `React.SyntheticEvent` 或 `React.SubmitEvent`。

### 3. 遇到 `TS6133: 'x' is declared but its value is never read`
- **根因**：存在死代码或遗留未使用的局部变量与 import。
- **修复方案**：遵循 `AGENTS.md` 零死代码原则，彻底删除未使用的导入和变量。

---

## 关联参考资料

- [LSP 与 CLI tsc 核心机制与场景深度对比](./references/lsp_vs_tsc.md)
