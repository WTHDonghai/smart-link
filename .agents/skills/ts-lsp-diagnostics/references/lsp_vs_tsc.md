# TypeScript Language Service (LSP) vs CLI tsc 深度对比与机制原理

本文档详细阐述为何 CLI `tsc --noEmit` 容易漏报 IDE 编辑器（LazyVim `vtsls`、VSCode 等）中的红色下划线与警告，以及本技能背后的诊断原理。

---

## 1. 核心差异对比矩阵

| 维度 | CLI 模式 (`tsc --noEmit`) | LSP / Language Service 模式 (`tsserver` / `vtsls`) |
| :--- | :--- | :--- |
| **底层引擎** | 批处理全量编译驱动 | 内存虚拟文件系统 (VFS) + 增量语言服务 |
| **诊断范围** | 仅输出阻塞构建的 Compile Errors | 语法 (Syntactic)、语义 (Semantic)、建议与废弃 (Suggestion / Deprecated) |
| **桶文件类型擦除** | 在全量上下文下可能因全量索引掩盖类型导出缺失 | 对按需加载的模块/文件进行精确符号查表，模糊 `export *` 极易报 `no exported member` |
| **废弃 API 捕获** | 默认不报错，不中断流程 | 针对 `@deprecated` 输出波浪线/删除线 (Suggestion TS6385) |
| **未使用变量/导入** | 受 `tsconfig` 局部开关限制 | 实时生成浅灰色置灰/波浪线诊断 (TS6133) |
| **开发者体验感知** | 命令行绿色退出码，造成“代码完全没问题”的虚假安全感 | 开发者打开 LazyVim / VSCode 立即看到刺眼的红线或黄色告警 |

---

## 2. 常见漏报场景深度解析

### 场景一：桶文件 (Barrel File) 模糊重导出导致符号擦除
**典型代码**：
```typescript
// src/types/template.ts
export interface CleanOrderContext { ... }

// src/types/index.ts
export * from './template'; // ❌ 仅使用通配重导出

// 消费组件
import type { CleanOrderContext } from '../../types';
```
- **LSP 表现**：在 LazyVim 的 `vtsls` 或 VSCode 中，由于语言服务在内存缓存增量构建，未能将 `CleanOrderContext` 纯类型 interface 挂载至聚合模块符号表中，直接报红：`Module "../../types" has no exported member 'CleanOrderContext'`。
- **最佳修复实践**：在聚合桶文件中必须显式具名类型重导出：
  ```typescript
  export type { CleanOrderContext } from './template';
  ```

### 场景二：React 19 及第三方库的 `@deprecated` 废弃警告
**典型代码**：
- Lucide React `^0.546.0` 标记 `Sliders`、`AlertTriangle`、`AlertCircle` 为 `@deprecated`。
- React 19 标记 `React.FormEvent` 为 `@deprecated`（建议使用 `React.SyntheticEvent` 或 `React.SubmitEvent`）。
- **LSP 表现**：编辑器中立即出现波浪线与删除线标记。
- **CLI 表现**：`tsc --noEmit` 视而不见，0 报错退出。

---

## 3. 本技能的解决方案架构

本技能封装的探针脚本 `scripts/lsp_diagnostics.cjs` 直接调用 `typescript` 官方包的 `ts.createLanguageService(host, registry)`：

```
[Target Files]
      │
      ▼
[LanguageServiceHost (VFS)] ───► [TypeScript Language Service Engine]
                                                │
       ┌────────────────────────────────────────┼────────────────────────────────────────┐
       ▼                                        ▼                                        ▼
getSyntacticDiagnostics              getSemanticDiagnostics                  getSuggestionDiagnostics
 (语法结构/JSX闭合)                    (类型契约/模块符号导出)                    (@deprecated/代码建议)
       │                                        │                                        │
       └────────────────────────────────────────┴────────────────────────────────────────┘
                                                │
                                                ▼
                         [格式化控制台输出 + 结构化 JSON 报告 + 退出码控制]
```

通过这一架构，AI 代理在审查与交付代码时，拥有与开发者本地 IDE 完全对称的“火眼金睛”。
