#!/usr/bin/env node
/**
 * ts-lsp-diagnostics: TypeScript Language Server 深度静态诊断探针
 * 
 * 原理：利用 TypeScript Language Service API (tsserver 同源引擎)，
 * 模拟 LazyVim (vtsls/mason) 与 VSCode 的语言服务诊断机制，
 * 全面捕获 CLI `tsc --noEmit` 容易漏掉的：
 * 1. 语义错误 (Semantic Diagnostics): 如桶文件导出丢失、符号擦除、类型不兼容
 * 2. 语法错误 (Syntactic Diagnostics): JSX 标签不匹配、语句结构异常
 * 3. 建议与废弃告警 (Suggestion Diagnostics): @deprecated 图标/API 调用、未使用变量等
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 终端 ANSI 颜色辅助
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// 动态解析 TypeScript 模块 (优先项目本地 node_modules，其次全局或执行路径)
function resolveTypeScript(cwd) {
  try {
    const localTsPath = path.join(cwd, 'node_modules', 'typescript');
    if (fs.existsSync(localTsPath)) {
      return require(localTsPath);
    }
  } catch {
    // 回退到普通 require
  }
  try {
    return require('typescript');
  } catch (err) {
    console.error(`${colors.red}错误: 未能找到 'typescript' 模块。请确保在项目目录下执行或运行 npm install typescript。${colors.reset}`);
    process.exit(1);
  }
}

// 寻找最近的 tsconfig.json
function findTsConfig(cwd, explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(cwd, explicitPath);
    if (fs.existsSync(resolved)) return resolved;
    throw new Error(`指定的 tsconfig 文件未找到: ${explicitPath}`);
  }
  let cur = path.resolve(cwd);
  while (cur !== path.dirname(cur)) {
    const candidate = path.join(cur, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    cur = path.dirname(cur);
  }
  return null;
}

// 获取 Git 变更或暂存的文件列表
function getGitChangedFiles(cwd) {
  const result = new Set();
  try {
    const statusOut = execSync('git status -s', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = statusOut.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 提取文件路径 (处理重命名等情况)
      const parts = trimmed.split(/\s+/);
      const filePath = parts[parts.length - 1];
      if (filePath && (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))) {
        const abs = path.resolve(cwd, filePath);
        if (fs.existsSync(abs)) {
          result.add(abs);
        }
      }
    }
  } catch {
    // 非 git 目录或 git 命令不可用
  }
  return Array.from(result);
}

// 格式化诊断消息文本 (处理多层嵌套结构)
function flattenDiagnosticMessage(messageText) {
  if (typeof messageText === 'string') return messageText;
  let text = messageText.messageText;
  if (messageText.next && Array.isArray(messageText.next)) {
    for (const sub of messageText.next) {
      text += '\n  ' + flattenDiagnosticMessage(sub);
    }
  }
  return text;
}

function run() {
  const cwd = process.cwd();
  const args = process.argv.slice(2);

  // 参数解析
  let mode = 'changed'; // 'changed' | 'all' | 'explicit'
  let isJson = false;
  let failOnSuggestions = false;
  let explicitTsConfig = null;
  const explicitFiles = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') {
      mode = 'all';
    } else if (arg === '--changed' || arg === '--staged') {
      mode = 'changed';
    } else if (arg === '--json') {
      isJson = true;
    } else if (arg === '--fail-on-suggestions') {
      failOnSuggestions = true;
    } else if (arg === '--project' || arg === '-p') {
      explicitTsConfig = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
TypeScript Language Service (LSP) 深度诊断探针

用法:
  node lsp_diagnostics.cjs [选项] [文件路径...]

选项:
  --changed, --staged      检查所有未提交与暂存的 TS/TSX 变更文件 (默认模式)
  --all                    检查 tsconfig.json 所涵盖的全部源码文件
  --fail-on-suggestions    将废弃 API (@deprecated) 与未使用变量等建议诊断也视作错误阻断
  --project, -p <path>     显式指定 tsconfig.json 路径
  --json                   以 JSON 结构化格式输出诊断结果
  --help, -h               显示此帮助信息
`);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      explicitFiles.push(path.resolve(cwd, arg));
      mode = 'explicit';
    }
  }

  const ts = resolveTypeScript(cwd);
  const tsConfigPath = findTsConfig(cwd, explicitTsConfig);
  if (!tsConfigPath) {
    console.error(`${colors.red}错误: 未能找到 tsconfig.json 配置文件。${colors.reset}`);
    process.exit(1);
  }

  // 加载 tsconfig.json 配置
  const readConfigResult = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  if (readConfigResult.error) {
    const msg = flattenDiagnosticMessage(readConfigResult.error.messageText);
    console.error(`${colors.red}解析 tsconfig.json 失败: ${msg}${colors.reset}`);
    process.exit(1);
  }

  const projectDir = path.dirname(tsConfigPath);
  const parsedCommandLine = ts.parseJsonConfigFileContent(
    readConfigResult.config,
    ts.sys,
    projectDir
  );
  parsedCommandLine.options.declaration = true;

  // 确定待诊断的目标文件
  let targetFiles = [];
  if (mode === 'explicit') {
    targetFiles = explicitFiles.filter(f => fs.existsSync(f));
  } else if (mode === 'all') {
    targetFiles = parsedCommandLine.fileNames.filter(f => {
      if (f.includes('node_modules') || f.includes('/dist/')) return false;
      return f.endsWith('.ts') || f.endsWith('.tsx');
    });
  } else {
    // 默认检查变更文件
    targetFiles = getGitChangedFiles(cwd);
    if (targetFiles.length === 0) {
      // 若没有 git 变更，默认扫描 src/ 目录
      targetFiles = parsedCommandLine.fileNames.filter(f => {
        if (f.includes('node_modules') || f.includes('/dist/')) return false;
        return (f.includes('/src/') || f.includes('/tests/')) && (f.endsWith('.ts') || f.endsWith('.tsx'));
      });
    }
  }

  if (targetFiles.length === 0) {
    if (!isJson) {
      console.log(`${colors.green}✓ 未发现需要检查的 TypeScript 目标文件。${colors.reset}`);
    } else {
      console.log(JSON.stringify({ filesChecked: 0, errors: [], suggestions: [], passed: true }, null, 2));
    }
    process.exit(0);
  }

  // 构建内存 LanguageServiceHost (与 VSCode / vtsls 对齐)
  const fileVersionMap = new Map();
  const serviceHost = {
    getScriptFileNames: () => parsedCommandLine.fileNames,
    getScriptVersion: (fileName) => {
      if (!fileVersionMap.has(fileName)) {
        fileVersionMap.set(fileName, '1');
      }
      return fileVersionMap.get(fileName);
    },
    getScriptSnapshot: (fileName) => {
      if (!fs.existsSync(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
    },
    getCurrentDirectory: () => projectDir,
    getCompilationSettings: () => parsedCommandLine.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const documentRegistry = ts.createDocumentRegistry();
  const service = ts.createLanguageService(serviceHost, documentRegistry);

  const report = {
    checkedFilesCount: targetFiles.length,
    errorCount: 0,
    suggestionCount: 0,
    files: [],
  };

  if (!isJson) {
    console.log(`\n${colors.bold}${colors.cyan}🔍 正在执行 TypeScript Language Service (LSP) 深度诊断...${colors.reset}`);
    console.log(`${colors.gray}配置: ${path.relative(cwd, tsConfigPath)} | 模式: ${mode} | 待检文件数: ${targetFiles.length}${colors.reset}\n`);
  }

  for (const filePath of targetFiles) {
    const relPath = path.relative(cwd, filePath);
    const sourceFile = service.getProgram().getSourceFile(filePath);

    // 1. 获取语法、语义与声明级诊断 (编译器/类型错误/未命名导出)
    const syntactic = service.getSyntacticDiagnostics(filePath);
    const semantic = service.getSemanticDiagnostics(filePath);
    const declaration = sourceFile ? (service.getProgram()?.getDeclarationDiagnostics(sourceFile) || []) : [];
    const errors = [...syntactic, ...semantic, ...declaration];

    // 2. 获取建议诊断 (@deprecated 废弃API、未使用变量等)
    const suggestions = service.getSuggestionDiagnostics(filePath);

    const fileReport = {
      file: relPath,
      errors: [],
      suggestions: [],
    };

    if (errors.length > 0) {
      report.errorCount += errors.length;
      for (const diag of errors) {
        let line = 1;
        let col = 1;
        if (diag.start !== undefined && sourceFile) {
          const pos = ts.getLineAndCharacterOfPosition(sourceFile, diag.start);
          line = pos.line + 1;
          col = pos.character + 1;
        }
        const message = flattenDiagnosticMessage(diag.messageText);
        fileReport.errors.push({
          code: diag.code,
          line,
          col,
          message,
          category: 'error',
        });
      }
    }

    if (suggestions.length > 0) {
      report.suggestionCount += suggestions.length;
      for (const diag of suggestions) {
        let line = 1;
        let col = 1;
        if (diag.start !== undefined && sourceFile) {
          const pos = ts.getLineAndCharacterOfPosition(sourceFile, diag.start);
          line = pos.line + 1;
          col = pos.character + 1;
        }
        const message = flattenDiagnosticMessage(diag.messageText);
        fileReport.suggestions.push({
          code: diag.code,
          line,
          col,
          message,
          category: 'suggestion',
          isDeprecated: Boolean(diag.reportsDeprecated),
        });
      }
    }

    report.files.push(fileReport);

    // 终端实时格式化输出
    if (!isJson) {
      if (fileReport.errors.length > 0) {
        console.log(`${colors.red}✗ ${colors.bold}${relPath}${colors.reset}`);
        for (const err of fileReport.errors) {
          console.log(`  ${colors.red}[Line ${err.line}:${err.col}] TS${err.code}: ${err.message}${colors.reset}`);
        }
        for (const sug of fileReport.suggestions) {
          const tag = sug.isDeprecated ? 'Deprecated' : 'Suggestion';
          console.log(`  ${colors.yellow}[Line ${sug.line}:${sug.col}] [${tag}] TS${sug.code}: ${sug.message}${colors.reset}`);
        }
        console.log('');
      } else if (fileReport.suggestions.length > 0) {
        console.log(`${colors.yellow}⚠ ${colors.bold}${relPath}${colors.reset} (${fileReport.suggestions.length} 项建议/废弃)`);
        for (const sug of fileReport.suggestions) {
          const tag = sug.isDeprecated ? 'Deprecated' : 'Suggestion';
          console.log(`  ${colors.yellow}[Line ${sug.line}:${sug.col}] [${tag}] TS${sug.code}: ${sug.message}${colors.reset}`);
        }
        console.log('');
      } else {
        console.log(`${colors.green}✓ ${relPath}${colors.reset}`);
      }
    }
  }

  // 判定与总结
  const hasErrors = report.errorCount > 0;
  const hasFailingSuggestions = failOnSuggestions && report.suggestionCount > 0;
  const isSuccess = !hasErrors && !hasFailingSuggestions;

  if (isJson) {
    console.log(JSON.stringify({ ...report, passed: isSuccess }, null, 2));
  } else {
    console.log('------------------------------------------------------------');
    if (isSuccess) {
      console.log(
        `${colors.green}${colors.bold}🎉 LSP 深度诊断通过！共扫描 ${report.checkedFilesCount} 个文件，0 语法/语义错误` +
        (report.suggestionCount > 0 ? ` (${report.suggestionCount} 项建议已忽略)` : '，0 废弃/建议告警') +
        `。${colors.reset}\n`
      );
    } else {
      console.log(
        `${colors.red}${colors.bold}❌ LSP 深度诊断未通过！发现 ${report.errorCount} 个错误` +
        (report.suggestionCount > 0 ? `，${report.suggestionCount} 项建议/废弃告警` : '') +
        `。请修正后重新运行。${colors.reset}\n`
      );
    }
  }

  process.exit(isSuccess ? 0 : 1);
}

run();
